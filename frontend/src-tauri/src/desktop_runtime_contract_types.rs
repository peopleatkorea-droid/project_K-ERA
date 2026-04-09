#[derive(Debug, Serialize)]
pub(super) struct DesktopAppConfigResponse {
    pub(super) runtime: String,
    pub(super) config_path: String,
    pub(super) app_local_data_dir: String,
    pub(super) repo_root: String,
    pub(super) backend_root: String,
    pub(super) backend_entry: String,
    pub(super) worker_module: String,
    pub(super) storage_state_file: Option<String>,
    pub(super) setup_ready: bool,
    pub(super) runtime_contract: DesktopRuntimeContractResponse,
    pub(super) values: DesktopAppConfigValues,
}

#[derive(Debug, Serialize)]
pub(super) struct DesktopRuntimeContractResponse {
    pub(super) mode: String,
    pub(super) packaged_mode: bool,
    pub(super) env_source: String,
    pub(super) resource_dir: Option<String>,
    pub(super) runtime_dir: String,
    pub(super) logs_dir: String,
    pub(super) backend_source: String,
    pub(super) backend_candidates: Vec<String>,
    pub(super) python_candidates: Vec<String>,
    pub(super) python_preflight: Option<DesktopPythonRuntimePreflight>,
    pub(super) disk_notice: Option<DesktopBundledRuntimeDiskNotice>,
    pub(super) errors: Vec<String>,
    pub(super) warnings: Vec<String>,
}

#[derive(Debug)]
struct DesktopRuntimeReadiness {
    backend_candidates: Vec<String>,
    python_candidates: Vec<String>,
    python_preflight: Option<DesktopPythonRuntimePreflight>,
    errors: Vec<String>,
    warnings: Vec<String>,
}
