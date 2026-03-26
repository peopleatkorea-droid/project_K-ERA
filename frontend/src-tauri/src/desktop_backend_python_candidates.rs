pub(super) fn python_path_with_entries(entries: &[PathBuf]) -> Option<String> {
    let segments = entries
        .iter()
        .map(|entry| entry.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        None
    } else {
        let separator = if cfg!(windows) { ";" } else { ":" };
        Some(segments.join(separator))
    }
}

fn allowed_dev_python_candidates(backend: Option<&DesktopBackendTarget>) -> Vec<(PathBuf, &'static str)> {
    let mut candidates = Vec::new();
    if let Some(backend) = backend {
        let backend_venv = if cfg!(windows) {
            backend.root.join(".venv").join("Scripts").join("python.exe")
        } else {
            backend.root.join(".venv").join("bin").join("python")
        };
        if backend_venv.exists() {
            candidates.push((backend_venv, "backend_root/.venv"));
        }
    }
    let repo_venv = if cfg!(windows) {
        project_root().join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root().join(".venv").join("bin").join("python")
    };
    if repo_venv.exists() {
        candidates.push((repo_venv, "repo_root/.venv"));
    }
    candidates
}

#[cfg(windows)]
fn bundled_python_candidates(backend: Option<&DesktopBackendTarget>) -> Vec<(PathBuf, &'static str)> {
    let mut candidates = Vec::new();
    for resource_dir in desktop_resource_dir_candidates() {
        let bundled_python = resource_dir.join("python-runtime").join("python.exe");
        if bundled_python.exists() {
            candidates.push((bundled_python, "bundled_resources/python-runtime"));
        }
    }
    for candidate in [
        (
            desktop_app_local_data_dir()
                .join("runtime")
                .join("python")
                .join("python.exe"),
            "app_local_runtime/python",
        ),
        (
            desktop_app_local_data_dir().join("python").join("python.exe"),
            "app_local/python",
        ),
    ] {
        if candidate.0.exists() {
            candidates.push(candidate);
        }
    }
    if let Some(backend) = backend {
        for candidate in [
            (
                backend.root.join("python").join("python.exe"),
                "backend_root/python",
            ),
            (
                backend.root.join("python-runtime").join("python.exe"),
                "backend_root/python-runtime",
            ),
        ] {
            if candidate.0.exists() {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

#[cfg(not(windows))]
fn bundled_python_candidates(backend: Option<&DesktopBackendTarget>) -> Vec<(PathBuf, &'static str)> {
    let mut candidates = Vec::new();
    for resource_dir in desktop_resource_dir_candidates() {
        let bundled_python = resource_dir
            .join("python-runtime")
            .join("bin")
            .join("python");
        if bundled_python.exists() {
            candidates.push((bundled_python, "bundled_resources/python-runtime"));
        }
    }
    for candidate in [
        (
            desktop_app_local_data_dir()
                .join("runtime")
                .join("python")
                .join("bin")
                .join("python"),
            "app_local_runtime/python",
        ),
        (
            desktop_app_local_data_dir()
                .join("python")
                .join("bin")
                .join("python"),
            "app_local/python",
        ),
    ] {
        if candidate.0.exists() {
            candidates.push(candidate);
        }
    }
    if let Some(backend) = backend {
        for candidate in [
            (
                backend.root.join("python").join("bin").join("python"),
                "backend_root/python",
            ),
            (
                backend.root.join("python-runtime").join("bin").join("python"),
                "backend_root/python-runtime",
            ),
        ] {
            if candidate.0.exists() {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

pub(super) fn local_backend_python_candidate_infos(
    values: &HashMap<String, String>,
) -> Vec<DesktopStringCandidate> {
    let backend = resolve_desktop_backend_target(values).ok();
    let mut candidates = Vec::new();
    if desktop_packaged_mode() {
        for (path, source) in bundled_python_candidates(backend.as_ref()) {
            push_unique_string_candidate(
                &mut candidates,
                path.to_string_lossy().to_string(),
                source,
            );
        }
        return candidates;
    }

    let allowed_dev_candidates = allowed_dev_python_candidates(backend.as_ref());
    if let Some(value) =
        configured_or_process_env_value("KERA_DESKTOP_LOCAL_BACKEND_PYTHON", values)
    {
        let configured_path = PathBuf::from(&value);
        let configured_allowed = allowed_dev_candidates.iter().any(|(allowed, _)| {
            let configured_normalized = configured_path
                .canonicalize()
                .unwrap_or(configured_path.clone())
                .to_string_lossy()
                .to_ascii_lowercase();
            let allowed_normalized = allowed
                .canonicalize()
                .unwrap_or(allowed.clone())
                .to_string_lossy()
                .to_ascii_lowercase();
            configured_normalized == allowed_normalized
        });
        if configured_allowed {
            push_unique_string_candidate(&mut candidates, value, "configured_python");
        }
    }
    for (path, source) in allowed_dev_candidates {
        push_unique_string_candidate(&mut candidates, path.to_string_lossy().to_string(), source);
    }
    candidates
}
