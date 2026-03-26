pub(super) fn local_worker_should_be_managed() -> bool {
    local_backend_should_be_managed(&local_node_api_base_url())
}

fn orphan_local_worker_process_fragments(backend: &DesktopBackendTarget) -> Vec<String> {
    let mut fragments = vec![
        "-m".to_string(),
        backend.worker_module.clone(),
        "--poll-interval".to_string(),
    ];
    for python_path in local_backend_python_candidates() {
        fragments.push(python_path);
    }
    fragments
}

fn terminate_orphan_local_worker_processes(backend: &DesktopBackendTarget) -> Result<Vec<u32>, String> {
    terminate_windows_processes_matching_all_fragments(&orphan_local_worker_process_fragments(backend))
}

fn spawn_local_worker_process() -> Result<SpawnedLocalWorker, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let worker_entry = backend
        .root
        .join("src")
        .join("kera_research")
        .join("worker.py");
    if !worker_entry.exists() && backend.worker_module == "kera_research.worker" {
        return Err(format!(
            "Local worker entrypoint was not found: {}",
            worker_entry.display()
        ));
    }
    let storage_dir = resolve_storage_dir(&values);
    ensure_storage_bundle_dirs(&storage_dir)?;
    let _ = write_storage_state_dir(&storage_dir);
    let (stdout_log_path, stderr_log_path) = local_worker_log_paths()?;
    let python_preflight = ensure_desktop_runtime_readiness_for_backend()?;
    let mut errors = Vec::new();

    for python_path in [python_preflight.candidate_path.clone()] {
        let stdout_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stdout_log_path)
            .map_err(|error| error.to_string())?;
        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .map_err(|error| error.to_string())?;

        let launch_command = vec![
            python_path.clone(),
            "-m".to_string(),
            backend.worker_module.clone(),
            "--poll-interval".to_string(),
            "2.0".to_string(),
        ];

        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg(&backend.worker_module)
            .arg("--poll-interval")
            .arg("2.0")
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                register_managed_process("worker", child.id(), Some(&python_path))?;
                return Ok(SpawnedLocalWorker {
                    child,
                    python_path,
                    python_preflight: python_preflight.clone(),
                    launch_command,
                    stdout_log_path: stdout_log_path.to_string_lossy().to_string(),
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop-managed local worker. {}",
        errors.join(" | ")
    ))
}

fn sync_local_worker_runtime(runtime: &mut LocalWorkerRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!(
                    "Desktop-managed local worker exited with status {status}."
                ));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!(
                    "Failed to inspect desktop-managed local worker: {error}"
                ));
            }
        }
    }
    if let Some(error) = cleared_error {
        let pid = runtime.child.as_ref().map(Child::id);
        runtime.child = None;
        let _ = unregister_managed_process(pid);
        runtime.python_preflight = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn local_worker_status_snapshot(runtime: &LocalWorkerRuntime) -> LocalWorkerStatus {
    let managed = local_worker_should_be_managed();
    LocalWorkerStatus {
        mode: if managed {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        managed,
        running: runtime.child.is_some(),
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        python_preflight: runtime.python_preflight.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: runtime.stdout_log_path.clone(),
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

pub(super) fn get_local_worker_status_internal() -> Result<LocalWorkerStatus, String> {
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    Ok(local_worker_status_snapshot(&runtime))
}

pub(super) fn ensure_local_worker_ready_internal() -> Result<LocalWorkerStatus, String> {
    if !local_worker_should_be_managed() {
        return get_local_worker_status_internal();
    }
    let python_preflight = ensure_desktop_runtime_readiness_for_backend()?;
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if runtime.child.is_none() {
        let mut terminated = cleanup_registered_managed_processes("worker")?;
        terminated.extend(terminate_orphan_local_worker_processes(&backend)?);
        if !terminated.is_empty() {
            runtime.last_error = Some(format!(
                "Restarted {} stale desktop-managed local worker process(es).",
                terminated.len()
            ));
        }
        let spawned = spawn_local_worker_process()?;
        runtime.child = Some(spawned.child);
        runtime.python_path = Some(spawned.python_path);
        runtime.python_preflight = Some(spawned.python_preflight);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stdout_log_path = Some(spawned.stdout_log_path);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
    } else {
        runtime.python_preflight = Some(python_preflight);
    }
    Ok(local_worker_status_snapshot(&runtime))
}

pub(super) fn stop_local_worker_internal() -> Result<LocalWorkerStatus, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if let Some(mut child) = runtime.child.take() {
        let _ = unregister_managed_process(Some(child.id()));
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.launched_by_desktop = false;
    runtime.python_preflight = None;
    let _ = cleanup_registered_managed_processes("worker");
    let _ = terminate_orphan_local_worker_processes(&backend);
    Ok(local_worker_status_snapshot(&runtime))
}
