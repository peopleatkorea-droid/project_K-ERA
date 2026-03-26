pub(super) struct MlSidecarRuntime {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    next_request_id: u64,
    python_path: Option<String>,
    python_preflight: Option<DesktopPythonRuntimePreflight>,
    launch_command: Option<Vec<String>>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

impl Default for MlSidecarRuntime {
    fn default() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
            next_request_id: 1,
            python_path: None,
            python_preflight: None,
            launch_command: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedMlSidecar {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    python_path: String,
    python_preflight: DesktopPythonRuntimePreflight,
    launch_command: Vec<String>,
    stderr_log_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub(super) struct MlSidecarStatus {
    transport: String,
    mode: String,
    base_url: String,
    local_url: bool,
    managed: bool,
    running: bool,
    healthy: bool,
    launched_by_desktop: bool,
    pid: Option<u32>,
    python_path: Option<String>,
    python_preflight: Option<DesktopPythonRuntimePreflight>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

fn ml_sidecar_state() -> &'static Mutex<MlSidecarRuntime> {
    ML_SIDECAR_STATE.get_or_init(|| Mutex::new(MlSidecarRuntime::default()))
}

pub(super) fn ml_sidecar_should_be_used() -> bool {
    desktop_ml_transport() == "sidecar"
}

fn ml_sidecar_stderr_log_path() -> Result<PathBuf, String> {
    Ok(desktop_runtime_dir()?.join("ml-sidecar.stderr.log"))
}

fn spawn_ml_sidecar_process() -> Result<SpawnedMlSidecar, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let stderr_log_path = ml_sidecar_stderr_log_path()?;
    let python_preflight = ensure_desktop_runtime_readiness_for_sidecar()?;
    let mut errors = Vec::new();

    for python_path in [python_preflight.candidate_path.clone()] {
        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .map_err(|error| error.to_string())?;
        let launch_command = vec![
            python_path.clone(),
            "-m".to_string(),
            "kera_research.desktop_sidecar".to_string(),
        ];
        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg("kera_research.desktop_sidecar")
            .stdout(Stdio::piped())
            .stdin(Stdio::piped())
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(mut child) => {
                register_managed_process("ml_sidecar", child.id(), Some(&python_path))?;
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "Failed to capture ML sidecar stdin.".to_string())?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| "Failed to capture ML sidecar stdout.".to_string())?;
                return Ok(SpawnedMlSidecar {
                    child,
                    stdin,
                    stdout: BufReader::new(stdout),
                    python_path,
                    python_preflight: python_preflight.clone(),
                    launch_command,
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop ML sidecar. {}",
        errors.join(" | ")
    ))
}

fn sync_ml_sidecar_runtime(runtime: &mut MlSidecarRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!("Desktop ML sidecar exited with status {status}."));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!("Failed to inspect desktop ML sidecar: {error}"));
            }
        }
    }
    if let Some(error) = cleared_error {
        let pid = runtime.child.as_ref().map(Child::id);
        runtime.child = None;
        runtime.stdin = None;
        runtime.stdout = None;
        runtime.python_preflight = None;
        let _ = unregister_managed_process(pid);
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn stop_ml_sidecar_runtime(runtime: &mut MlSidecarRuntime) {
    if let Some(mut child) = runtime.child.take() {
        let _ = unregister_managed_process(Some(child.id()));
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.stdin = None;
    runtime.stdout = None;
    runtime.python_preflight = None;
    runtime.launched_by_desktop = false;
}

fn ml_sidecar_status_snapshot(runtime: &MlSidecarRuntime, healthy: bool) -> MlSidecarStatus {
    let base_url = local_node_api_base_url();
    MlSidecarStatus {
        transport: desktop_ml_transport(),
        mode: if ml_sidecar_should_be_used() {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        base_url: base_url.clone(),
        local_url: local_backend_targets_local_url(&base_url),
        managed: ml_sidecar_should_be_used(),
        running: runtime.child.is_some() && healthy,
        healthy,
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        python_preflight: runtime.python_preflight.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: None,
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}
