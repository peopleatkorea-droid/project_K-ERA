pub(super) fn python_path_with_entries(entries: &[PathBuf]) -> Option<String> {
    let mut segments = entries
        .iter()
        .map(|entry| entry.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if let Some(existing) = process_env_value("PYTHONPATH")
        .or_else(|| configured_or_process_env_value("PYTHONPATH", &configured_env_values()))
    {
        segments.push(existing);
    }
    if segments.is_empty() {
        None
    } else {
        let separator = if cfg!(windows) { ";" } else { ":" };
        Some(segments.join(separator))
    }
}

pub(super) fn local_backend_python_candidate_infos(
    values: &HashMap<String, String>,
) -> Vec<DesktopStringCandidate> {
    let backend = resolve_desktop_backend_target(values).ok();
    let mut candidates = Vec::new();
    if let Some(value) =
        configured_or_process_env_value("KERA_DESKTOP_LOCAL_BACKEND_PYTHON", values)
    {
        push_unique_string_candidate(&mut candidates, value, "configured_python");
    }
    #[cfg(windows)]
    {
        for resource_dir in desktop_resource_dir_candidates() {
            let bundled_python = resource_dir.join("python-runtime").join("python.exe");
            if bundled_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    bundled_python.to_string_lossy().to_string(),
                    "bundled_resources/python-runtime",
                );
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
                push_unique_string_candidate(
                    &mut candidates,
                    candidate.0.to_string_lossy().to_string(),
                    candidate.1,
                );
            }
        }
        if let Some(backend) = backend.as_ref() {
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
                    push_unique_string_candidate(
                        &mut candidates,
                        candidate.0.to_string_lossy().to_string(),
                        candidate.1,
                    );
                }
            }
            if !desktop_packaged_mode() {
                let backend_venv = backend.root.join(".venv").join("Scripts").join("python.exe");
                if backend_venv.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        backend_venv.to_string_lossy().to_string(),
                        "backend_root/.venv",
                    );
                }
            }
        }
        if !desktop_packaged_mode() {
            let repo_python = project_root().join(".venv").join("Scripts").join("python.exe");
            if repo_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    repo_python.to_string_lossy().to_string(),
                    "repo_root/.venv",
                );
            }
            if python_command_available("python") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python".to_string(),
                    "system_python",
                );
            }
            if python_command_available("py") {
                push_unique_string_candidate(
                    &mut candidates,
                    "py".to_string(),
                    "system_py_launcher",
                );
            }
        }
    }
    #[cfg(not(windows))]
    {
        for resource_dir in desktop_resource_dir_candidates() {
            let bundled_python = resource_dir
                .join("python-runtime")
                .join("bin")
                .join("python");
            if bundled_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    bundled_python.to_string_lossy().to_string(),
                    "bundled_resources/python-runtime",
                );
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
                push_unique_string_candidate(
                    &mut candidates,
                    candidate.0.to_string_lossy().to_string(),
                    candidate.1,
                );
            }
        }
        if let Some(backend) = backend.as_ref() {
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
                    push_unique_string_candidate(
                        &mut candidates,
                        candidate.0.to_string_lossy().to_string(),
                        candidate.1,
                    );
                }
            }
            if !desktop_packaged_mode() {
                let backend_venv = backend.root.join(".venv").join("bin").join("python");
                if backend_venv.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        backend_venv.to_string_lossy().to_string(),
                        "backend_root/.venv",
                    );
                }
            }
        }
        if !desktop_packaged_mode() {
            let repo_python = project_root().join(".venv").join("bin").join("python");
            if repo_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    repo_python.to_string_lossy().to_string(),
                    "repo_root/.venv",
                );
            }
        }
        for command in ["python3", "python"] {
            if python_command_available(command) {
                push_unique_string_candidate(
                    &mut candidates,
                    command.to_string(),
                    "system_python",
                );
            }
        }
    }
    candidates
}
