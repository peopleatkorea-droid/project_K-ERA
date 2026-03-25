fn spawn_local_backend_process(base_url: &str) -> Result<SpawnedLocalBackend, String> {
    let parsed = HttpUrl::parse(base_url)
        .map_err(|error| format!("Invalid local backend base URL: {error}"))?;
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port_or_known_default().unwrap_or(8000).to_string();
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    if !backend.backend_entry_path.exists() {
        return Err(format!(
            "Local backend entrypoint was not found: {}",
            backend.backend_entry_path.display()
        ));
    }
    let storage_dir = resolve_storage_dir(&values);
    ensure_storage_bundle_dirs(&storage_dir)?;
    let _ = write_storage_state_dir(&storage_dir);
    let (stdout_log_path, stderr_log_path) = local_backend_log_paths()?;
    let mut errors = Vec::new();

    for python_path in local_backend_python_candidates() {
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
            "uvicorn".to_string(),
            backend.backend_module.clone(),
            "--host".to_string(),
            host.clone(),
            "--port".to_string(),
            port.clone(),
            "--log-level".to_string(),
            "warning".to_string(),
        ];

        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg("uvicorn")
            .arg(&backend.backend_module)
            .arg("--host")
            .arg(&host)
            .arg("--port")
            .arg(&port)
            .arg("--log-level")
            .arg("warning")
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                return Ok(SpawnedLocalBackend {
                    child,
                    python_path,
                    launch_command,
                    stdout_log_path: stdout_log_path.to_string_lossy().to_string(),
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop-managed local backend. {}",
        errors.join(" | ")
    ))
}

fn sync_local_backend_runtime(runtime: &mut LocalBackendRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!(
                    "Desktop-managed local backend exited with status {status}."
                ));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!(
                    "Failed to inspect desktop-managed local backend: {error}"
                ));
            }
        }
    }
    if let Some(error) = cleared_error {
        runtime.child = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn local_backend_status_snapshot(
    base_url: &str,
    runtime: &LocalBackendRuntime,
    healthy: bool,
) -> LocalBackendStatus {
    let managed = local_backend_should_be_managed(base_url);
    LocalBackendStatus {
        transport: desktop_ml_transport(),
        mode: if managed {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        base_url: base_url.to_string(),
        local_url: local_backend_targets_local_url(base_url),
        managed,
        running: runtime.child.is_some() || healthy,
        healthy,
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: runtime.stdout_log_path.clone(),
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

pub(super) fn get_local_backend_status_internal() -> Result<LocalBackendStatus, String> {
    let base_url = local_node_api_base_url();
    let healthy = local_backend_is_healthy(&base_url);
    let mut runtime = local_backend_state()
        .lock()
        .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
    sync_local_backend_runtime(&mut runtime);
    Ok(local_backend_status_snapshot(&base_url, &runtime, healthy))
}

pub(super) fn ensure_local_backend_ready_internal() -> Result<LocalBackendStatus, String> {
    let base_url = local_node_api_base_url();
    if local_backend_is_healthy(&base_url) {
        return get_local_backend_status_internal();
    }
    if !local_backend_should_be_managed(&base_url) {
        return Err(format!(
            "Local backend is unavailable at {base_url}. Start the local node manually or set KERA_DESKTOP_LOCAL_BACKEND_MODE=managed."
        ));
    }
    ensure_desktop_runtime_readiness_for_backend()?;

    {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if runtime.child.is_none() {
            if local_backend_port_is_occupied(&base_url) {
                return Err(format!(
                    "Another local server is already listening at {base_url}, but it is not responding to the K-ERA local backend health endpoint. Stop the conflicting server and try again."
                ));
            }
            let spawned = spawn_local_backend_process(&base_url)?;
            runtime.child = Some(spawned.child);
            runtime.python_path = Some(spawned.python_path);
            runtime.launch_command = Some(spawned.launch_command);
            runtime.stdout_log_path = Some(spawned.stdout_log_path);
            runtime.stderr_log_path = Some(spawned.stderr_log_path);
            runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
            runtime.last_error = None;
            runtime.launched_by_desktop = true;
        }
    }

    if let Err(error) = wait_for_local_backend_health(&base_url, local_backend_startup_timeout()) {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if let Some(mut child) = runtime.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error.clone());
        return Err(error);
    }

    get_local_backend_status_internal()
}

pub(super) fn stop_local_backend_internal() -> Result<LocalBackendStatus, String> {
    {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if let Some(mut child) = runtime.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        runtime.launched_by_desktop = false;
    }
    get_local_backend_status_internal()
}
