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
