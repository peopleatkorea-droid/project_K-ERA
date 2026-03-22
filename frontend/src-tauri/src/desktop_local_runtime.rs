use super::*;

pub(super) struct LocalBackendRuntime {
    child: Option<Child>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

pub(super) struct LocalWorkerRuntime {
    child: Option<Child>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

impl Default for LocalBackendRuntime {
    fn default() -> Self {
        Self {
            child: None,
            python_path: None,
            launch_command: None,
            stdout_log_path: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedLocalBackend {
    child: Child,
    python_path: String,
    launch_command: Vec<String>,
    stdout_log_path: String,
    stderr_log_path: String,
}

impl Default for LocalWorkerRuntime {
    fn default() -> Self {
        Self {
            child: None,
            python_path: None,
            launch_command: None,
            stdout_log_path: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedLocalWorker {
    child: Child,
    python_path: String,
    launch_command: Vec<String>,
    stdout_log_path: String,
    stderr_log_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub(super) struct LocalBackendStatus {
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

#[derive(Debug, Serialize, Clone)]
pub(super) struct LocalWorkerStatus {
    mode: String,
    managed: bool,
    running: bool,
    launched_by_desktop: bool,
    pid: Option<u32>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

fn local_backend_state() -> &'static Mutex<LocalBackendRuntime> {
    LOCAL_BACKEND_STATE.get_or_init(|| Mutex::new(LocalBackendRuntime::default()))
}

pub(super) fn local_backend_targets_local_url(base_url: &str) -> bool {
    let Ok(url) = HttpUrl::parse(base_url) else {
        return false;
    };
    match url.host_str() {
        Some("127.0.0.1") | Some("localhost") => true,
        _ => false,
    }
}

pub(super) fn local_backend_should_be_managed(base_url: &str) -> bool {
    desktop_local_backend_mode() == "managed" && local_backend_targets_local_url(base_url)
}

fn local_backend_startup_timeout() -> Duration {
    for key in [
        "KERA_DESKTOP_LOCAL_BACKEND_STARTUP_TIMEOUT_MS",
        "NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_STARTUP_TIMEOUT_MS",
    ] {
        if let Some(value) = env_value(key) {
            if let Ok(milliseconds) = value.trim().parse::<u64>() {
                if milliseconds > 0 {
                    return Duration::from_millis(milliseconds);
                }
            }
        }
    }
    Duration::from_secs(30)
}

pub(super) fn desktop_runtime_dir() -> Result<PathBuf, String> {
    let path = desktop_app_local_data_dir().join("runtime");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn local_backend_log_paths() -> Result<(PathBuf, PathBuf), String> {
    let runtime_dir = desktop_runtime_dir()?;
    Ok((
        runtime_dir.join("local-node.stdout.log"),
        runtime_dir.join("local-node.stderr.log"),
    ))
}

fn local_worker_log_paths() -> Result<(PathBuf, PathBuf), String> {
    let runtime_dir = desktop_runtime_dir()?;
    Ok((
        runtime_dir.join("local-worker.stdout.log"),
        runtime_dir.join("local-worker.stderr.log"),
    ))
}

fn local_backend_health_url(base_url: &str) -> String {
    format!("{}/api/health", base_url.trim_end_matches('/'))
}

fn local_backend_is_healthy(base_url: &str) -> bool {
    let Ok(client) = HttpClient::builder()
        .timeout(Duration::from_millis(1200))
        .build()
    else {
        return false;
    };
    let Ok(response) = client.get(local_backend_health_url(base_url)).send() else {
        return false;
    };
    response.status().is_success()
}

fn wait_for_local_backend_health(base_url: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if local_backend_is_healthy(base_url) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "Desktop-managed local backend did not become healthy within {} ms.",
        timeout.as_millis()
    ))
}

pub(super) fn apply_runtime_env_to_command(command: &mut Command, python_path_entries: &[PathBuf]) {
    for (key, value) in resolved_env_values() {
        if !value.trim().is_empty() {
            command.env(key, value);
        }
    }
    command
        .env("KERA_SKIP_LOCAL_ENV_FILE", "1")
        .env("KERA_LLM_RELAY_ONLY", "1")
        .env("KERA_STORAGE_STATE_FILE", storage_state_file_path())
        .env("KERA_SEGMENTATION_BACKEND", "medsam")
        .env("SEGMENTATION_BACKEND", "medsam")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1");
    for key in [
        "OPENAI_API_KEY",
        "KERA_AI_CLINIC_OPENAI_API_KEY",
        "KERA_CONTROL_PLANE_OPENAI_API_KEY",
        "KERA_SEGMENTATION_ROOT",
        "SEGMENTATION_ROOT",
        "KERA_SEGMENTATION_SCRIPT",
        "SEGMENTATION_SCRIPT",
        "KERA_SEGMENTATION_CHECKPOINT",
        "SEGMENTATION_CHECKPOINT",
        "MEDSAM_SCRIPT",
        "MEDSAM_CHECKPOINT",
    ] {
        command.env_remove(key);
    }
    if let Some(value) = python_path_with_entries(python_path_entries) {
        command.env("PYTHONPATH", value);
    }
}

pub(super) fn local_backend_python_candidates() -> Vec<String> {
    let values = resolved_env_values();
    local_backend_python_candidate_infos(&values)
        .into_iter()
        .map(|candidate| candidate.value)
        .collect()
}

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

fn local_worker_state() -> &'static Mutex<LocalWorkerRuntime> {
    LOCAL_WORKER_STATE.get_or_init(|| Mutex::new(LocalWorkerRuntime::default()))
}

pub(super) fn local_worker_should_be_managed() -> bool {
    local_backend_should_be_managed(&local_node_api_base_url())
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
                return Ok(SpawnedLocalWorker {
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
        "Failed to launch the desktop-managed local worker. {}",
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
        runtime.child = None;
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
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: runtime.stdout_log_path.clone(),
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
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

pub(super) fn get_local_worker_status_internal() -> Result<LocalWorkerStatus, String> {
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    Ok(local_worker_status_snapshot(&runtime))
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

pub(super) fn ensure_local_worker_ready_internal() -> Result<LocalWorkerStatus, String> {
    if !local_worker_should_be_managed() {
        return get_local_worker_status_internal();
    }
    ensure_desktop_runtime_readiness_for_backend()?;
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if runtime.child.is_none() {
        let spawned = spawn_local_worker_process()?;
        runtime.child = Some(spawned.child);
        runtime.python_path = Some(spawned.python_path);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stdout_log_path = Some(spawned.stdout_log_path);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
    }
    Ok(local_worker_status_snapshot(&runtime))
}

pub(super) fn stop_local_worker_internal() -> Result<LocalWorkerStatus, String> {
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.launched_by_desktop = false;
    Ok(local_worker_status_snapshot(&runtime))
}

pub(super) fn ensure_local_runtime_ready_internal() -> Result<LocalBackendStatus, String> {
    let backend = ensure_local_backend_ready_internal()?;
    if local_backend_should_be_managed(&backend.base_url) {
        ensure_local_worker_ready_internal()?;
    }
    if ml_sidecar_should_be_used() {
        ensure_ml_sidecar_ready_internal()?;
        schedule_ml_sidecar_workflow_warmup();
    }
    Ok(backend)
}

pub(super) fn stop_local_runtime_internal() -> Result<LocalBackendStatus, String> {
    let _ = stop_local_worker_internal();
    let _ = stop_ml_sidecar_internal();
    stop_local_backend_internal()
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
