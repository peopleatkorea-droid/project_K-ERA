pub(super) fn local_node_api_base_url() -> String {
    for key in [
        "KERA_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_API_BASE_URL",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() {
                return normalized;
            }
        }
    }
    "http://127.0.0.1:8000".to_string()
}

pub(super) fn desktop_ml_transport() -> String {
    for key in [
        "KERA_DESKTOP_ML_TRANSPORT",
        "NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "http" {
                return "http".to_string();
            }
            if normalized == "sidecar" {
                return "sidecar".to_string();
            }
        }
    }
    "sidecar".to_string()
}

pub(super) fn desktop_local_backend_mode() -> String {
    for key in [
        "KERA_DESKTOP_LOCAL_BACKEND_MODE",
        "NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "external" {
                return "external".to_string();
            }
            if normalized == "managed" {
                return "managed".to_string();
            }
        }
    }
    if desktop_ml_transport() == "http" {
        "external".to_string()
    } else {
        "managed".to_string()
    }
}
