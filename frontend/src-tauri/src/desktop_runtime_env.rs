use super::*;

#[derive(Debug, Clone)]
pub(super) struct DesktopPathCandidate {
    pub(super) path: PathBuf,
    pub(super) source: String,
}

#[derive(Debug, Clone)]
pub(super) struct DesktopStringCandidate {
    pub(super) value: String,
    pub(super) source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DesktopRuntimeMode {
    Dev,
    Packaged,
}

impl DesktopRuntimeMode {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Packaged => "packaged",
        }
    }
}

fn normalized_trueish(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub(super) fn desktop_runtime_mode() -> DesktopRuntimeMode {
    if let Some(value) = process_env_value("KERA_DESKTOP_RUNTIME_MODE") {
        match value.trim().to_ascii_lowercase().as_str() {
            "dev" => return DesktopRuntimeMode::Dev,
            "packaged" => return DesktopRuntimeMode::Packaged,
            _ => {}
        }
    }
    if process_env_value("KERA_DESKTOP_FORCE_DEV_MODE")
        .map(|value| normalized_trueish(&value))
        .unwrap_or(false)
    {
        return DesktopRuntimeMode::Dev;
    }
    if process_env_value("KERA_DESKTOP_FORCE_PACKAGED_MODE")
        .map(|value| normalized_trueish(&value))
        .unwrap_or(false)
    {
        return DesktopRuntimeMode::Packaged;
    }
    if cfg!(debug_assertions) {
        DesktopRuntimeMode::Dev
    } else {
        DesktopRuntimeMode::Packaged
    }
}

pub(super) fn desktop_packaged_mode() -> bool {
    desktop_runtime_mode() == DesktopRuntimeMode::Packaged
}

pub(super) fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

pub(super) fn desktop_app_local_data_dir() -> PathBuf {
    process_env_value("KERA_DESKTOP_APP_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            process_env_value("LOCALAPPDATA").map(|value| PathBuf::from(value).join("KERA"))
        })
        .or_else(|| {
            process_env_value("USERPROFILE")
                .or_else(|| process_env_value("HOME"))
                .map(|value| PathBuf::from(value).join(".kera-desktop"))
        })
        .unwrap_or_else(|| {
            if desktop_packaged_mode() {
                current_exe_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".kera-desktop")
            } else {
                project_root().join(".desktop-app")
            }
        })
}

pub(super) fn process_env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn configured_env_values() -> HashMap<String, String> {
    let mut values = HashMap::new();
    if !desktop_packaged_mode() {
        let env_path = project_root().join(".env.local");
        if let Ok(entries) = dotenvy::from_path_iter(env_path) {
            for entry in entries.flatten() {
                values.insert(entry.0, entry.1);
            }
        }
    }
    for (key, value) in read_desktop_config_file().env {
        values.insert(key, value);
    }
    values
}

fn configured_or_process_env_value(key: &str, values: &HashMap<String, String>) -> Option<String> {
    process_env_value(key).or_else(|| {
        values
            .get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn push_unique_path(target: &mut Vec<PathBuf>, candidate: PathBuf) {
    let normalized = candidate.to_string_lossy().to_lowercase();
    if target
        .iter()
        .any(|existing| existing.to_string_lossy().to_lowercase() == normalized)
    {
        return;
    }
    target.push(candidate);
}

fn push_unique_path_candidate(
    target: &mut Vec<DesktopPathCandidate>,
    path: PathBuf,
    source: &str,
) {
    let normalized = path.to_string_lossy().to_lowercase();
    if target
        .iter()
        .any(|existing| existing.path.to_string_lossy().to_lowercase() == normalized)
    {
        return;
    }
    target.push(DesktopPathCandidate {
        path,
        source: source.to_string(),
    });
}

fn push_unique_string_candidate(
    target: &mut Vec<DesktopStringCandidate>,
    value: String,
    source: &str,
) {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return;
    }
    if target
        .iter()
        .any(|existing| existing.value.eq_ignore_ascii_case(&normalized))
    {
        return;
    }
    target.push(DesktopStringCandidate {
        value: normalized,
        source: source.to_string(),
    });
}

fn storage_dir_candidates(configured_storage_dir: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = configured_storage_dir {
        let normalized = value.trim();
        if !normalized.is_empty() {
            push_unique_path(
                &mut candidates,
                normalize_storage_bundle_path(PathBuf::from(normalized)),
            );
        }
    }
    if let Some(value) = read_storage_state_dir() {
        push_unique_path(&mut candidates, value);
    }
    if !desktop_packaged_mode() {
        if let Some(parent) = project_root().parent() {
            push_unique_path(&mut candidates, parent.join("KERA_DATA"));
        }
    }
    for root in [
        process_env_value("HOME"),
        process_env_value("USERPROFILE"),
        process_env_value("OneDrive"),
        process_env_value("OneDriveCommercial"),
        process_env_value("OneDriveConsumer"),
    ]
    .into_iter()
    .flatten()
    {
        let root_path = PathBuf::from(root);
        push_unique_path(&mut candidates, root_path.join("KERA_DATA"));
        push_unique_path(&mut candidates, root_path.join("KERA").join("KERA_DATA"));
    }
    push_unique_path(&mut candidates, default_desktop_storage_dir());
    candidates
}

pub(super) fn resolve_storage_dir(values: &HashMap<String, String>) -> PathBuf {
    let configured = configured_or_process_env_value("KERA_STORAGE_DIR", values);
    let candidates = storage_dir_candidates(configured.as_deref());
    for candidate in candidates {
        if looks_like_storage_bundle(&candidate) {
            return candidate;
        }
    }
    configured
        .map(|value| normalize_storage_bundle_path(PathBuf::from(value)))
        .unwrap_or_else(default_desktop_storage_dir)
}

fn sqlite_url_for_path(path: &Path) -> String {
    format!("sqlite:///{}", path.to_string_lossy().replace('\\', "/"))
}

pub(super) fn ensure_storage_bundle_dirs(storage_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(storage_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("sites")).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("control_plane")).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("models")).map_err(|error| error.to_string())?;
    Ok(())
}

fn current_exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(Path::to_path_buf)
}

pub(super) fn store_desktop_resource_dir(path: PathBuf) {
    let _ = DESKTOP_RESOURCE_DIR.set(path);
}

fn known_desktop_resource_dir() -> Option<PathBuf> {
    DESKTOP_RESOURCE_DIR.get().cloned()
}

pub(super) fn desktop_resource_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = known_desktop_resource_dir() {
        push_unique_path(&mut candidates, path);
    }
    if let Some(value) = process_env_value("KERA_DESKTOP_RESOURCE_DIR") {
        push_unique_path(&mut candidates, PathBuf::from(value));
    }
    if let Some(exe_dir) = current_exe_dir() {
        push_unique_path(&mut candidates, exe_dir.join("resources"));
        if let Some(parent) = exe_dir.parent() {
            push_unique_path(&mut candidates, parent.join("resources"));
            push_unique_path(&mut candidates, parent.join("Resources"));
        }
    }
    candidates
}

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
    if !desktop_packaged_mode() {
        push_unique_path_candidate(&mut candidates, project_root(), "repo_root");
    }
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
                let backend_venv = backend
                    .root
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe");
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
            let repo_python = project_root()
                .join(".venv")
                .join("Scripts")
                .join("python.exe");
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
                    backend
                        .root
                        .join("python-runtime")
                        .join("bin")
                        .join("python"),
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
            if python_command_available("python3") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python3".to_string(),
                    "system_python3",
                );
            }
            if python_command_available("python") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python".to_string(),
                    "system_python",
                );
            }
        }
    }
    candidates
}

pub(super) fn resolved_env_values() -> HashMap<String, String> {
    let mut values = configured_env_values();
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
    let control_plane_api_base_url =
        configured_or_process_env_value("KERA_CONTROL_PLANE_API_BASE_URL", &values)
            .unwrap_or_default();
    if control_plane_api_base_url.trim().is_empty() {
        if configured_or_process_env_value("KERA_CONTROL_PLANE_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("KERA_AUTH_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("KERA_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("DATABASE_URL", &values).is_none()
        {
            values.insert(
                "KERA_CONTROL_PLANE_DATABASE_URL".to_string(),
                sqlite_url_for_path(&storage_dir.join("kera.db")),
            );
        }
    } else if configured_or_process_env_value("KERA_LOCAL_CONTROL_PLANE_DATABASE_URL", &values)
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
