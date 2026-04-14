const DEFAULT_DESKTOP_CONTROL_PLANE_API_BASE_URL: &str =
    "https://k-era.org/control-plane/api";

fn compile_time_env_value(key: &str) -> Option<String> {
    let value = match key {
        "KERA_CONTROL_PLANE_API_BASE_URL" => option_env!("KERA_CONTROL_PLANE_API_BASE_URL"),
        "NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL" => {
            option_env!("NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL")
        }
        "KERA_LOCAL_API_JWT_PUBLIC_KEY_B64" => option_env!("KERA_LOCAL_API_JWT_PUBLIC_KEY_B64"),
        "KERA_LOCAL_API_JWT_ISSUER" => option_env!("KERA_LOCAL_API_JWT_ISSUER"),
        "KERA_LOCAL_API_JWT_AUDIENCE" => option_env!("KERA_LOCAL_API_JWT_AUDIENCE"),
        "KERA_GOOGLE_DESKTOP_CLIENT_ID" => option_env!("KERA_GOOGLE_DESKTOP_CLIENT_ID"),
        "NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID" => option_env!("NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID"),
        "KERA_GOOGLE_CLIENT_ID" => option_env!("KERA_GOOGLE_CLIENT_ID"),
        "NEXT_PUBLIC_GOOGLE_CLIENT_ID" => option_env!("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
        "KERA_GOOGLE_CLIENT_IDS" => option_env!("KERA_GOOGLE_CLIENT_IDS"),
        _ => None,
    };
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn resolved_env_values() -> HashMap<String, String> {
    let mut values = configured_env_values();
    for key in [
        "KERA_CONTROL_PLANE_API_BASE_URL",
        "NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL",
        "KERA_LOCAL_API_JWT_PUBLIC_KEY_B64",
        "KERA_LOCAL_API_JWT_ISSUER",
        "KERA_LOCAL_API_JWT_AUDIENCE",
        "KERA_GOOGLE_DESKTOP_CLIENT_ID",
        "NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID",
        "KERA_GOOGLE_CLIENT_ID",
        "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
        "KERA_GOOGLE_CLIENT_IDS",
    ] {
        if configured_or_process_env_value(key, &values).is_none() {
            if let Some(value) = compile_time_env_value(key) {
                values.insert(key.to_string(), value);
            }
        }
    }
    let storage_dir = resolve_storage_dir(&values);
    values.insert(
        "KERA_STORAGE_DIR".to_string(),
        storage_dir.to_string_lossy().to_string(),
    );
    if configured_or_process_env_value("KERA_DATA_PLANE_DATABASE_URL", &values).is_none()
        && configured_or_process_env_value("KERA_LOCAL_DATABASE_URL", &values).is_none()
    {
        values.insert(
            "KERA_DATA_PLANE_DATABASE_URL".to_string(),
            sqlite_url_for_path(&storage_dir.join("kera.db")),
        );
    }
    let control_plane_api_base_url = configured_or_process_env_value(
        "KERA_CONTROL_PLANE_API_BASE_URL",
        &values,
    )
    .or_else(|| compile_time_env_value("NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL"))
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| DEFAULT_DESKTOP_CONTROL_PLANE_API_BASE_URL.to_string());
    values.insert(
        "KERA_CONTROL_PLANE_API_BASE_URL".to_string(),
        control_plane_api_base_url,
    );
    if configured_or_process_env_value("KERA_LOCAL_CONTROL_PLANE_DATABASE_URL", &values)
        .is_none()
        && configured_or_process_env_value("KERA_CONTROL_PLANE_LOCAL_DATABASE_URL", &values)
            .is_none()
    {
        values.insert(
            "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL".to_string(),
            sqlite_url_for_path(&storage_dir.join("control_plane_cache.db")),
        );
    }
    let mut google_client_ids = Vec::new();
    for key in [
        "KERA_GOOGLE_DESKTOP_CLIENT_ID",
        "NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID",
        "KERA_GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_ID",
        "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
    ] {
        if let Some(value) = configured_or_process_env_value(key, &values) {
            if !value.is_empty() && !google_client_ids.contains(&value) {
                google_client_ids.push(value);
            }
        }
    }
    if configured_or_process_env_value("KERA_GOOGLE_CLIENT_ID", &values).is_none() {
        if let Some(client_id) = google_client_ids.first().cloned() {
            values.insert("KERA_GOOGLE_CLIENT_ID".to_string(), client_id);
        }
    }
    if configured_or_process_env_value("KERA_GOOGLE_CLIENT_IDS", &values).is_none()
        && !google_client_ids.is_empty()
    {
        values.insert(
            "KERA_GOOGLE_CLIENT_IDS".to_string(),
            google_client_ids.join(","),
        );
    }
    values
}

pub(super) fn env_value(key: &str) -> Option<String> {
    process_env_value(key)
        .or_else(|| resolved_env_values().get(key).cloned())
        .map(|value| value.trim().to_string())
}
