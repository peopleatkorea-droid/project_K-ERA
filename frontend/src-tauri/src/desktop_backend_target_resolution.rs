pub(super) struct DesktopBackendTarget {
    pub(super) root: PathBuf,
    pub(super) backend_entry_path: PathBuf,
    pub(super) backend_module: String,
    pub(super) worker_module: String,
    pub(super) python_path_entries: Vec<PathBuf>,
    pub(super) source: String,
}

pub(super) fn desktop_backend_root_candidates(
    values: &HashMap<String, String>,
) -> Vec<DesktopPathCandidate> {
    let mut candidates = Vec::new();
    if !desktop_packaged_mode() {
        push_unique_path_candidate(&mut candidates, project_root(), "repo_root");
    }
    if let Some(value) = configured_or_process_env_value("KERA_DESKTOP_BACKEND_ROOT", values) {
        push_unique_path_candidate(
            &mut candidates,
            PathBuf::from(value),
            "configured_backend_root",
        );
    }
    if let Some(value) = configured_or_process_env_value("KERA_DESKTOP_RUNTIME_ROOT", values) {
        let runtime_root = PathBuf::from(value);
        push_unique_path_candidate(
            &mut candidates,
            runtime_root.join("backend"),
            "configured_runtime_root/backend",
        );
        push_unique_path_candidate(&mut candidates, runtime_root, "configured_runtime_root");
    }
    for resource_dir in desktop_resource_dir_candidates() {
        push_unique_path_candidate(
            &mut candidates,
            resource_dir.join("backend"),
            "bundled_resources/backend",
        );
        push_unique_path_candidate(
            &mut candidates,
            resource_dir.join("python-backend"),
            "bundled_resources/python-backend",
        );
        push_unique_path_candidate(&mut candidates, resource_dir.clone(), "bundled_resources/root");
    }
    push_unique_path_candidate(
        &mut candidates,
        desktop_app_local_data_dir().join("runtime").join("backend"),
        "app_local_runtime/backend",
    );
    push_unique_path_candidate(
        &mut candidates,
        desktop_app_local_data_dir().join("backend"),
        "app_local/backend",
    );
    candidates
}

pub(super) fn resolve_desktop_backend_target(
    values: &HashMap<String, String>,
) -> Result<DesktopBackendTarget, String> {
    let candidates = desktop_backend_root_candidates(values);
    for candidate in &candidates {
        let root = &candidate.path;
        let package_entry = root
            .join("src")
            .join("kera_research")
            .join("api")
            .join("app.py");
        let app_entry = root.join("app.py");
        let worker_entry = root.join("src").join("kera_research").join("worker.py");
        if package_entry.exists() {
            let mut python_path_entries = Vec::new();
            let src_dir = root.join("src");
            if src_dir.exists() {
                python_path_entries.push(src_dir);
            }
            return Ok(DesktopBackendTarget {
                root: root.clone(),
                backend_entry_path: package_entry,
                backend_module: "kera_research.api.app:app".to_string(),
                worker_module: if worker_entry.exists() {
                    "kera_research.worker".to_string()
                } else {
                    "kera_research.worker".to_string()
                },
                python_path_entries,
                source: candidate.source.clone(),
            });
        }
        if app_entry.exists() {
            let mut python_path_entries = Vec::new();
            let src_dir = root.join("src");
            if src_dir.exists() {
                python_path_entries.push(src_dir);
            }
            return Ok(DesktopBackendTarget {
                root: root.clone(),
                backend_entry_path: app_entry,
                backend_module: "app:app".to_string(),
                worker_module: "kera_research.worker".to_string(),
                python_path_entries,
                source: candidate.source.clone(),
            });
        }
    }
    let searched = candidates
        .iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.path.display()))
        .collect::<Vec<_>>()
        .join(" | ");
    let prefix = if desktop_packaged_mode() {
        "Packaged desktop backend assets were not found."
    } else {
        "Desktop backend entrypoint was not found."
    };
    Err(format!("{prefix} Looked in: {searched}"))
}
