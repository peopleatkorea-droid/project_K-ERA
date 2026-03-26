#[derive(Debug, Serialize, Deserialize, Clone)]
pub(super) struct DesktopPythonRuntimePreflight {
    pub(super) candidate_path: String,
    pub(super) candidate_source: String,
    pub(super) interpreter_path: String,
    pub(super) python_version: Option<String>,
    pub(super) torch_version: Option<String>,
    pub(super) cuda_available: Option<bool>,
    pub(super) gpu_name: Option<String>,
}

pub(super) struct LocalBackendRuntime {
    child: Option<Child>,
    python_path: Option<String>,
    python_preflight: Option<DesktopPythonRuntimePreflight>,
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
    python_preflight: Option<DesktopPythonRuntimePreflight>,
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
            python_preflight: None,
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
    python_preflight: DesktopPythonRuntimePreflight,
    launch_command: Vec<String>,
    stdout_log_path: String,
    stderr_log_path: String,
}

impl Default for LocalWorkerRuntime {
    fn default() -> Self {
        Self {
            child: None,
            python_path: None,
            python_preflight: None,
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
    python_preflight: DesktopPythonRuntimePreflight,
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
    python_preflight: Option<DesktopPythonRuntimePreflight>,
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
    python_preflight: Option<DesktopPythonRuntimePreflight>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

fn local_backend_state() -> &'static Mutex<LocalBackendRuntime> {
    LOCAL_BACKEND_STATE.get_or_init(|| Mutex::new(LocalBackendRuntime::default()))
}

fn local_worker_state() -> &'static Mutex<LocalWorkerRuntime> {
    LOCAL_WORKER_STATE.get_or_init(|| Mutex::new(LocalWorkerRuntime::default()))
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
