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

fn local_backend_health_url(base_url: &str) -> String {
    format!("{}/api/health", base_url.trim_end_matches('/'))
}

fn local_backend_startup_allows_required_check_failure(check: &str) -> bool {
    matches!(check.trim(), "model_artifacts")
}

fn local_backend_health_body_allows_startup(body: &str) -> bool {
    let Ok(payload) = serde_json::from_str::<JsonValue>(body) else {
        return false;
    };
    let Some(failing_required_checks) = payload
        .get("failing_required_checks")
        .and_then(|value| value.as_array())
    else {
        return false;
    };
    !failing_required_checks.is_empty()
        && failing_required_checks.iter().all(|value| {
            value
                .as_str()
                .map(local_backend_startup_allows_required_check_failure)
                .unwrap_or(false)
        })
}

pub(super) fn local_backend_port_is_occupied(base_url: &str) -> bool {
    let Ok(url) = HttpUrl::parse(base_url) else {
        return false;
    };
    let host = url.host_str().unwrap_or("127.0.0.1");
    let port = url.port_or_known_default().unwrap_or(8000);
    let Ok(addresses) = std::net::ToSocketAddrs::to_socket_addrs(&format!("{host}:{port}")) else {
        return false;
    };
    for address in addresses {
        if std::net::TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return true;
        }
    }
    false
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
    if response.status().is_success() {
        return true;
    }
    let Ok(body) = response.text() else {
        return false;
    };
    // Missing local model artifacts should not block desktop login or case-list startup.
    local_backend_health_body_allows_startup(&body)
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
    if let Some(resource_dir) = desktop_resource_dir_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
    {
        command.env("KERA_DESKTOP_RESOURCE_DIR", resource_dir);
    }
    command
        .env("KERA_SKIP_LOCAL_ENV_FILE", "1")
        .env("KERA_LLM_RELAY_ONLY", "1")
        .env("KERA_RUNTIME_OWNER", desktop_runtime_owner())
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
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONSTARTUP",
        "PYTHONEXECUTABLE",
        "PYTHONUSERBASE",
        "PYTHONNOUSERSITE",
        "VIRTUAL_ENV",
        "__PYVENV_LAUNCHER__",
        "CONDA_PREFIX",
        "CONDA_DEFAULT_ENV",
        "CONDA_PROMPT_MODIFIER",
        "PYENV_VERSION",
        "UV_PROJECT_ENVIRONMENT",
    ] {
        command.env_remove(key);
    }
    if let Some(value) = python_path_with_entries(python_path_entries) {
        command.env("PYTHONPATH", value);
    } else {
        command.env_remove("PYTHONPATH");
    }
}

pub(super) fn local_backend_python_candidates() -> Vec<String> {
    let values = resolved_env_values();
    local_backend_python_candidate_infos(&values)
        .into_iter()
        .map(|candidate| candidate.value)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_accepts_model_artifact_only_health_failure() {
        let body = r#"{
            "status": "error",
            "ready": false,
            "failing_required_checks": ["model_artifacts"]
        }"#;

        assert!(local_backend_health_body_allows_startup(body));
    }

    #[test]
    fn startup_rejects_storage_or_database_health_failures() {
        let body = r#"{
            "status": "error",
            "ready": false,
            "failing_required_checks": ["data_plane_database"]
        }"#;

        assert!(!local_backend_health_body_allows_startup(body));
    }

    #[test]
    fn startup_rejects_mixed_required_failures() {
        let body = r#"{
            "status": "error",
            "ready": false,
            "failing_required_checks": ["model_artifacts", "storage.storage_dir"]
        }"#;

        assert!(!local_backend_health_body_allows_startup(body));
    }
}
