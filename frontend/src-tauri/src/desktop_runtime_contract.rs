use super::*;

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
    pub(super) errors: Vec<String>,
    pub(super) warnings: Vec<String>,
}

#[derive(Debug)]
struct DesktopRuntimeReadiness {
    backend_candidates: Vec<String>,
    python_candidates: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

fn desktop_config_values_from_env(env: &HashMap<String, String>) -> DesktopAppConfigValues {
    let read = |key: &str| env.get(key).cloned().unwrap_or_default();
    DesktopAppConfigValues {
        storage_dir: read("KERA_STORAGE_DIR"),
        control_plane_api_base_url: read("KERA_CONTROL_PLANE_API_BASE_URL"),
        control_plane_node_id: read("KERA_CONTROL_PLANE_NODE_ID"),
        control_plane_node_token: read("KERA_CONTROL_PLANE_NODE_TOKEN"),
        control_plane_site_id: read("KERA_CONTROL_PLANE_SITE_ID"),
        local_backend_python: read("KERA_DESKTOP_LOCAL_BACKEND_PYTHON"),
        local_backend_mode: {
            let normalized = read("KERA_DESKTOP_LOCAL_BACKEND_MODE");
            if normalized.eq_ignore_ascii_case("external") {
                "external".to_string()
            } else {
                "managed".to_string()
            }
        },
        ml_transport: {
            let normalized = read("KERA_DESKTOP_ML_TRANSPORT");
            if normalized.eq_ignore_ascii_case("http") {
                "http".to_string()
            } else {
                "sidecar".to_string()
            }
        },
    }
}

fn desktop_primary_resource_dir() -> Option<PathBuf> {
    let candidates = desktop_resource_dir_candidates();
    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

fn desktop_runtime_readiness(
    values: &HashMap<String, String>,
    config_values: &DesktopAppConfigValues,
    backend: Option<&DesktopBackendTarget>,
) -> DesktopRuntimeReadiness {
    let backend_candidates = desktop_backend_root_candidates(values)
        .into_iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.path.display()))
        .collect::<Vec<_>>();
    let python_candidate_infos = local_backend_python_candidate_infos(values);
    let python_candidates = python_candidate_infos
        .iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.value))
        .collect::<Vec<_>>();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if desktop_packaged_mode() && desktop_primary_resource_dir().is_none() {
        errors.push(
            "Packaged desktop runtime did not resolve a Tauri resource directory. Reinstall the desktop app or rebuild the installer."
                .to_string(),
        );
    }

    if backend.is_none() {
        if desktop_packaged_mode() {
            errors.push(
                "Packaged desktop runtime did not resolve a bundled backend. Reinstall the desktop app or rebuild the packaged resources."
                    .to_string(),
            );
        } else {
            warnings.push(
                "Desktop backend entrypoint was not resolved from the current dev/runtime candidates."
                    .to_string(),
            );
        }
    }

    if config_values.local_backend_mode != "external" && python_candidate_infos.is_empty() {
        if desktop_packaged_mode() {
            errors.push(
                "Packaged managed runtime did not find a bundled or explicitly configured Python interpreter."
                    .to_string(),
            );
        } else {
            warnings.push("No desktop local backend Python candidate was resolved.".to_string());
        }
    }

    if config_values.ml_transport == "sidecar" && python_candidate_infos.is_empty() {
        let message =
            "Desktop ML sidecar requires a bundled or explicitly configured Python interpreter."
                .to_string();
        if desktop_packaged_mode() {
            if !errors.iter().any(|existing| existing == &message) {
                errors.push(message);
            }
        } else if !warnings.iter().any(|existing| existing == &message) {
            warnings.push(message);
        }
    }

    DesktopRuntimeReadiness {
        backend_candidates,
        python_candidates,
        errors,
        warnings,
    }
}

fn desktop_runtime_contract_response(
    values: &HashMap<String, String>,
    config_values: &DesktopAppConfigValues,
    backend: Option<&DesktopBackendTarget>,
) -> DesktopRuntimeContractResponse {
    let runtime_dir = desktop_app_local_data_dir().join("runtime");
    let readiness = desktop_runtime_readiness(values, config_values, backend);

    DesktopRuntimeContractResponse {
        mode: desktop_runtime_mode().as_str().to_string(),
        packaged_mode: desktop_packaged_mode(),
        env_source: if desktop_packaged_mode() {
            "desktop_config_only".to_string()
        } else {
            "repo_env_plus_desktop_config".to_string()
        },
        resource_dir: desktop_primary_resource_dir().map(|path| path.to_string_lossy().to_string()),
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        logs_dir: runtime_dir.to_string_lossy().to_string(),
        backend_source: backend
            .map(|resolved| resolved.source.clone())
            .unwrap_or_else(|| "missing".to_string()),
        backend_candidates: readiness.backend_candidates,
        python_candidates: readiness.python_candidates,
        errors: readiness.errors,
        warnings: readiness.warnings,
    }
}

fn desktop_setup_ready(values: &DesktopAppConfigValues) -> bool {
    let resolved_values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&resolved_values);
    let backend_ref = backend.as_ref().ok();
    desktop_runtime_readiness(&resolved_values, values, backend_ref)
        .errors
        .is_empty()
}

pub(super) fn ensure_desktop_runtime_readiness_for_backend() -> Result<(), String> {
    let values = resolved_env_values();
    let config_values = desktop_config_values_from_env(&values);
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    Ok(())
}

pub(super) fn ensure_desktop_runtime_readiness_for_sidecar() -> Result<(), String> {
    let values = resolved_env_values();
    let mut config_values = desktop_config_values_from_env(&values);
    config_values.ml_transport = "sidecar".to_string();
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    Ok(())
}

pub(super) fn desktop_app_config_response() -> DesktopAppConfigResponse {
    let values = resolved_env_values();
    let config_values = desktop_config_values_from_env(&values);
    let backend = resolve_desktop_backend_target(&values);
    let backend_ref = backend.as_ref().ok();
    DesktopAppConfigResponse {
        runtime: "desktop".to_string(),
        config_path: desktop_config_path().to_string_lossy().to_string(),
        app_local_data_dir: desktop_app_local_data_dir().to_string_lossy().to_string(),
        repo_root: project_root().to_string_lossy().to_string(),
        backend_root: backend_ref
            .map(|resolved| resolved.root.to_string_lossy().to_string())
            .unwrap_or_default(),
        backend_entry: backend_ref
            .map(|resolved| resolved.backend_entry_path.to_string_lossy().to_string())
            .unwrap_or_default(),
        worker_module: backend_ref
            .map(|resolved| resolved.worker_module.clone())
            .unwrap_or_else(|| "kera_research.worker".to_string()),
        storage_state_file: storage_state_file_hint(),
        setup_ready: desktop_setup_ready(&config_values),
        runtime_contract: desktop_runtime_contract_response(&values, &config_values, backend_ref),
        values: config_values,
    }
}
