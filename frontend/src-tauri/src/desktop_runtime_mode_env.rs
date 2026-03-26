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

pub(super) fn initialize_desktop_runtime_owner() {
    let owner = process_env_value("KERA_RUNTIME_OWNER")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let _ = DESKTOP_RUNTIME_OWNER.set(owner);
}

pub(super) fn desktop_runtime_owner() -> String {
    DESKTOP_RUNTIME_OWNER
        .get()
        .cloned()
        .or_else(|| process_env_value("KERA_RUNTIME_OWNER"))
        .unwrap_or_else(|| Uuid::new_v4().to_string())
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
