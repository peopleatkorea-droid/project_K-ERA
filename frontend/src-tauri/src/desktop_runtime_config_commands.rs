#[tauri::command]
pub(super) fn get_desktop_app_config() -> Result<DesktopAppConfigResponse, String> {
    Ok(desktop_app_config_response())
}

#[tauri::command]
pub(super) fn save_desktop_app_config(
    payload: SaveDesktopAppConfigRequest,
) -> Result<DesktopAppConfigResponse, String> {
    let mut next_config = read_desktop_config_file();
    set_config_env_value(
        &mut next_config.env,
        "KERA_STORAGE_DIR",
        normalized_storage_dir_value(payload.config.storage_dir)?,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_API_BASE_URL",
        payload.config.control_plane_api_base_url,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_NODE_ID",
        payload.config.control_plane_node_id,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_NODE_TOKEN",
        payload.config.control_plane_node_token,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_SITE_ID",
        payload.config.control_plane_site_id,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_LOCAL_BACKEND_PYTHON",
        payload.config.local_backend_python,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_LOCAL_BACKEND_MODE",
        payload.config.local_backend_mode.map(|value| {
            if value.eq_ignore_ascii_case("external") {
                "external"
            } else {
                "managed"
            }
            .to_string()
        }),
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_ML_TRANSPORT",
        payload.config.ml_transport.map(|value| {
            if value.eq_ignore_ascii_case("http") {
                "http"
            } else {
                "sidecar"
            }
            .to_string()
        }),
    );
    write_desktop_config_file(&next_config)?;
    let _ = stop_local_runtime_internal();
    Ok(desktop_app_config_response())
}

#[tauri::command]
pub(super) fn clear_desktop_app_config() -> Result<DesktopAppConfigResponse, String> {
    clear_desktop_config_file()?;
    let _ = stop_local_runtime_internal();
    Ok(desktop_app_config_response())
}

#[tauri::command]
pub(super) fn export_desktop_diagnostics_bundle(app: AppHandle) -> Result<Option<FilePathResponse>, String> {
    let default_file_name = support_bundle_default_name();
    let mut dialog = rfd::FileDialog::new()
        .set_title("Export desktop support bundle")
        .add_filter("ZIP archive", &["zip"])
        .set_file_name(&default_file_name);
    let default_dir = desktop_app_local_data_dir();
    if default_dir.exists() {
        dialog = dialog.set_directory(default_dir);
    }
    let Some(target_path) = dialog.save_file() else {
        return Ok(None);
    };
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let bundle_file = File::create(&target_path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(bundle_file);

    let config_response = desktop_app_config_response();
    let mut desktop_config = read_desktop_config_file();
    desktop_config.env = redacted_desktop_env(&desktop_config.env);
    let runtime_dir = PathBuf::from(&config_response.runtime_contract.runtime_dir);
    let local_backend_status = redacted_json(&diagnostics_value(get_local_backend_status()));
    let local_worker_status = redacted_json(&diagnostics_value(get_local_worker_status()));
    let ml_sidecar_status = redacted_json(&diagnostics_value(get_ml_sidecar_status()));
    let local_health = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/health",
        "",
        Vec::new(),
        None,
        None,
    )));
    let local_node_status = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/control-plane/node/status",
        "",
        Vec::new(),
        None,
        None,
    )));
    let desktop_self_check = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/desktop/self-check",
        "",
        Vec::new(),
        None,
        None,
    )));
    let control_plane_auth_status = redacted_json(&fetch_control_plane_status_for_bundle(
        &config_response.values.control_plane_api_base_url,
    ));
    let exported_logs = append_runtime_logs_to_bundle(&mut zip, &runtime_dir)?;
    let redacted_config_response = redacted_json(&config_response);

    write_zip_json_entry(
        &mut zip,
        "manifest.json",
        &json!({
            "exported_at": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            "app_version": app.package_info().version.to_string(),
            "runtime_mode": config_response.runtime_contract.mode,
            "packaged_mode": config_response.runtime_contract.packaged_mode,
            "runtime_dir": config_response.runtime_contract.runtime_dir,
            "config_path": config_response.config_path,
            "control_plane_api_base_url": config_response.values.control_plane_api_base_url,
            "included_log_paths": exported_logs,
        }),
    )?;
    write_zip_json_entry(&mut zip, "desktop-config.json", &desktop_config)?;
    write_zip_json_entry(&mut zip, "desktop-app-config-response.json", &redacted_config_response)?;
    write_zip_json_entry(&mut zip, "local-backend-status.json", &local_backend_status)?;
    write_zip_json_entry(&mut zip, "local-worker-status.json", &local_worker_status)?;
    write_zip_json_entry(&mut zip, "ml-sidecar-status.json", &ml_sidecar_status)?;
    write_zip_json_entry(&mut zip, "local-health.json", &local_health)?;
    write_zip_json_entry(&mut zip, "local-node-status.json", &local_node_status)?;
    write_zip_json_entry(&mut zip, "desktop-self-check.json", &desktop_self_check)?;
    write_zip_json_entry(
        &mut zip,
        "control-plane-desktop-auth-status.json",
        &control_plane_auth_status,
    )?;

    zip.finish().map_err(|error| error.to_string())?;
    Ok(Some(FilePathResponse {
        path: target_path.to_string_lossy().to_string(),
    }))
}
