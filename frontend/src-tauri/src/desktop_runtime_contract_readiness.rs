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

fn normalized_python_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn allowed_dev_python_paths(backend: Option<&DesktopBackendTarget>) -> Vec<PathBuf> {
    let mut allowed = Vec::new();
    if let Some(backend) = backend {
        let backend_venv = if cfg!(windows) {
            backend.root.join(".venv").join("Scripts").join("python.exe")
        } else {
            backend.root.join(".venv").join("bin").join("python")
        };
        if backend_venv.exists() {
            allowed.push(backend_venv);
        }
    }
    let repo_venv = if cfg!(windows) {
        project_root().join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root().join(".venv").join("bin").join("python")
    };
    if repo_venv.exists() {
        allowed.push(repo_venv);
    }
    allowed
}

fn python_runtime_preflight(
    candidate: &DesktopStringCandidate,
    backend: Option<&DesktopBackendTarget>,
) -> Result<DesktopPythonRuntimePreflight, String> {
    let script = r#"
import json
import sys
payload = {
    "interpreter_path": sys.executable,
    "python_version": sys.version.split()[0] if sys.version else None,
    "torch_version": None,
    "cuda_available": None,
    "gpu_name": None,
}
try:
    import torch
    payload["torch_version"] = getattr(torch, "__version__", None)
    cuda_available = bool(torch.cuda.is_available())
    payload["cuda_available"] = cuda_available
    if cuda_available:
        try:
            payload["gpu_name"] = torch.cuda.get_device_name(0)
        except Exception as gpu_error:
            payload["gpu_name"] = f"[unavailable] {gpu_error}"
except Exception as error:
    payload["torch_error"] = f"{error.__class__.__name__}: {error}"
print(json.dumps(payload))
"#;
    let mut command = Command::new(&candidate.value);
    command.arg("-c").arg(script);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("Failed to run Python preflight for {}: {error}", candidate.value))?;
    if !output.status.success() {
        return Err(format!(
            "Python preflight failed for {}: {}",
            candidate.value,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let payload = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if payload.is_empty() {
        return Err(format!("Python preflight returned no output for {}.", candidate.value));
    }
    let value = serde_json::from_str::<JsonValue>(&payload)
        .map_err(|error| format!("Failed to parse Python preflight JSON for {}: {error}", candidate.value))?;
    let interpreter_path = value
        .get("interpreter_path")
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("Python preflight did not report sys.executable for {}.", candidate.value))?;
    if let Some(torch_error) = value
        .get("torch_error")
        .and_then(|item| item.as_str())
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
    {
        return Err(format!("Python preflight could not import torch: {torch_error}"));
    }
    let actual_path = PathBuf::from(&interpreter_path);
    if desktop_packaged_mode() {
        let expected = PathBuf::from(&candidate.value);
        if normalized_python_path(&actual_path) != normalized_python_path(&expected) {
            return Err(format!(
                "Packaged desktop runtime must use the bundled Python interpreter. Resolved {interpreter_path} instead of {}.",
                expected.display()
            ));
        }
    } else {
        let allowed = allowed_dev_python_paths(backend);
        let actual_normalized = normalized_python_path(&actual_path);
        let allowed_match = allowed
            .iter()
            .any(|path| normalized_python_path(path) == actual_normalized);
        if !allowed_match {
            return Err(format!(
                "Desktop dev runtime requires the repository/backend .venv interpreter, but resolved {interpreter_path}."
            ));
        }
    }
    Ok(DesktopPythonRuntimePreflight {
        candidate_path: candidate.value.clone(),
        candidate_source: candidate.source.clone(),
        interpreter_path,
        python_version: value
            .get("python_version")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
        torch_version: value
            .get("torch_version")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
        cuda_available: value.get("cuda_available").and_then(|item| item.as_bool()),
        gpu_name: value
            .get("gpu_name")
            .and_then(|item| item.as_str())
            .map(|item| item.to_string()),
    })
}

fn resolve_valid_python_preflight(
    candidates: &[DesktopStringCandidate],
    backend: Option<&DesktopBackendTarget>,
) -> Result<DesktopPythonRuntimePreflight, String> {
    let mut errors = Vec::new();
    for candidate in candidates {
        match python_runtime_preflight(candidate, backend) {
            Ok(preflight) => return Ok(preflight),
            Err(error) => errors.push(format!("{} -> {}", candidate.source, error)),
        }
    }
    Err(errors.join(" | "))
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
    let bundled_runtime_notice = bundled_runtime_disk_notice();
    let bundled_runtime_pending = bundled_runtime_notice
        .as_ref()
        .map(|notice| notice.first_launch_runtime_pending)
        .unwrap_or(false);
    let bundled_runtime_space_blocked = bundled_runtime_notice
        .as_ref()
        .map(|notice| notice.runtime_space_ok == Some(false))
        .unwrap_or(false);
    let python_preflight = if config_values.local_backend_mode != "external"
        || config_values.ml_transport == "sidecar"
    {
        resolve_valid_python_preflight(&python_candidate_infos, backend).ok()
    } else {
        None
    };
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

    if let Some(error) = last_bundled_runtime_prep_error() {
        let is_low_space_error = error.starts_with(LOW_SPACE_ERROR_PREFIX);
        if (!is_low_space_error || bundled_runtime_space_blocked) && !errors.iter().any(|existing| existing == &error) {
            errors.push(error);
        }
    }

    if config_values.local_backend_mode != "external"
        && python_candidate_infos.is_empty()
        && !(desktop_packaged_mode() && bundled_runtime_pending && !bundled_runtime_space_blocked)
    {
        errors.push(if desktop_packaged_mode() {
            "Packaged managed runtime did not find a bundled Python interpreter.".to_string()
        } else {
            "Desktop dev runtime requires the repository .venv interpreter, but no valid .venv Python candidate was resolved."
                .to_string()
        });
    }

    if config_values.local_backend_mode != "external"
        && !python_candidate_infos.is_empty()
        && python_preflight.is_none()
    {
        let message = resolve_valid_python_preflight(&python_candidate_infos, backend)
            .err()
            .unwrap_or_else(|| "Desktop-managed runtime Python preflight failed.".to_string());
        errors.push(message);
    }

    if config_values.ml_transport == "sidecar"
        && python_candidate_infos.is_empty()
        && !(desktop_packaged_mode() && bundled_runtime_pending && !bundled_runtime_space_blocked)
    {
        let message =
            if desktop_packaged_mode() {
                "Desktop ML sidecar requires a bundled Python interpreter."
            } else {
                "Desktop ML sidecar requires the repository .venv interpreter."
            }
                .to_string();
        if !errors.iter().any(|existing| existing == &message) {
            errors.push(message);
        }
    }

    if let Some(preflight) = python_preflight.as_ref() {
        if preflight.cuda_available == Some(false) {
            warnings.push(
                "Desktop runtime Python did not detect CUDA. GPU-capable jobs will fall back to CPU."
                    .to_string(),
            );
        }
    }

    DesktopRuntimeReadiness {
        backend_candidates,
        python_candidates,
        python_preflight,
        errors,
        warnings,
    }
}

pub(super) fn ensure_desktop_runtime_readiness_for_backend() -> Result<DesktopPythonRuntimePreflight, String> {
    ensure_bundled_python_runtime_ready()?;
    let values = resolved_env_values();
    let config_values = desktop_config_values_from_env(&values);
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    readiness
        .python_preflight
        .ok_or_else(|| "Desktop-managed runtime Python preflight did not resolve a valid interpreter.".to_string())
}

pub(super) fn ensure_desktop_runtime_readiness_for_sidecar() -> Result<DesktopPythonRuntimePreflight, String> {
    ensure_bundled_python_runtime_ready()?;
    let values = resolved_env_values();
    let mut config_values = desktop_config_values_from_env(&values);
    config_values.ml_transport = "sidecar".to_string();
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    readiness
        .python_preflight
        .ok_or_else(|| "Desktop ML sidecar Python preflight did not resolve a valid interpreter.".to_string())
}
