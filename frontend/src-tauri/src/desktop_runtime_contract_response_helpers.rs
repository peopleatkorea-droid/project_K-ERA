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
        python_preflight: readiness.python_preflight,
        disk_notice: bundled_runtime_disk_notice(),
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
