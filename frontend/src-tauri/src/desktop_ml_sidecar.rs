use super::*;

pub(super) struct MlSidecarRuntime {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    next_request_id: u64,
    python_path: Option<String>,
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
    let mut errors = Vec::new();

    for python_path in local_backend_python_candidates() {
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
        runtime.child = None;
        runtime.stdin = None;
        runtime.stdout = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn stop_ml_sidecar_runtime(runtime: &mut MlSidecarRuntime) {
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.stdin = None;
    runtime.stdout = None;
    runtime.launched_by_desktop = false;
}

fn call_ml_sidecar_json_unlocked(
    runtime: &mut MlSidecarRuntime,
    method: &str,
    params: JsonValue,
) -> Result<JsonValue, String> {
    let request_id = runtime.next_request_id;
    runtime.next_request_id = runtime.next_request_id.saturating_add(1);
    let payload = json!({
        "id": request_id,
        "method": method,
        "params": params,
    });
    let stdin = runtime
        .stdin
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdin is unavailable.".to_string())?;
    let serialized = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize sidecar request: {error}"))?;
    stdin
        .write_all(serialized.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write to the desktop ML sidecar: {error}"))?;

    let stdout = runtime
        .stdout
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdout is unavailable.".to_string())?;
    let mut line = String::new();
    let bytes_read = stdout
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read from the desktop ML sidecar: {error}"))?;
    if bytes_read == 0 || line.trim().is_empty() {
        return Err("Desktop ML sidecar closed the response stream.".to_string());
    }
    let response = serde_json::from_str::<JsonValue>(&line)
        .map_err(|error| format!("Invalid sidecar response JSON: {error}"))?;
    if response.get("id").and_then(|value| value.as_u64()) != Some(request_id) {
        return Err("Desktop ML sidecar returned an unexpected response id.".to_string());
    }
    if response.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(JsonValue::Null));
    }
    let error_message = response
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Desktop ML sidecar request failed.".to_string());
    Err(error_message)
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
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: None,
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

pub(super) fn get_ml_sidecar_status_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let healthy = if runtime.child.is_some() {
        call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_ok()
    } else {
        false
    };
    Ok(ml_sidecar_status_snapshot(&runtime, healthy))
}

pub(super) fn ensure_ml_sidecar_ready_internal() -> Result<MlSidecarStatus, String> {
    if !ml_sidecar_should_be_used() {
        return get_ml_sidecar_status_internal();
    }
    ensure_desktop_runtime_readiness_for_sidecar()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let mut needs_spawn = runtime.child.is_none();
    if !needs_spawn && call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_err()
    {
        stop_ml_sidecar_runtime(&mut runtime);
        needs_spawn = true;
    }
    if needs_spawn {
        let spawned = spawn_ml_sidecar_process()?;
        runtime.child = Some(spawned.child);
        runtime.stdin = Some(spawned.stdin);
        runtime.stdout = Some(spawned.stdout);
        runtime.python_path = Some(spawned.python_path);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
        if let Err(error) = call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null) {
            stop_ml_sidecar_runtime(&mut runtime);
            runtime.last_error = Some(error.clone());
            return Err(error);
        }
    }
    Ok(ml_sidecar_status_snapshot(&runtime, true))
}

pub(super) fn stop_ml_sidecar_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    stop_ml_sidecar_runtime(&mut runtime);
    Ok(ml_sidecar_status_snapshot(&runtime, false))
}

pub(super) fn request_ml_sidecar_json(method: &str, params: JsonValue) -> Result<JsonValue, String> {
    ensure_ml_sidecar_ready_internal()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    match call_ml_sidecar_json_unlocked(&mut runtime, method, params) {
        Ok(result) => Ok(result),
        Err(error) => {
            runtime.last_error = Some(error.clone());
            Err(error)
        }
    }
}

pub(super) fn schedule_ml_sidecar_workflow_warmup() {
    if !ml_sidecar_should_be_used() {
        return;
    }
    std::thread::spawn(|| {
        let mut runtime = match ml_sidecar_state().lock() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        sync_ml_sidecar_runtime(&mut runtime);
        if runtime.child.is_none() {
            return;
        }
        let _ = call_ml_sidecar_json_unlocked(&mut runtime, "warm_workflow", JsonValue::Null);
    });
}
