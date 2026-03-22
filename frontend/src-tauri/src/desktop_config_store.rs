use super::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(super) struct DesktopAppConfigValues {
    pub(super) storage_dir: String,
    pub(super) control_plane_api_base_url: String,
    pub(super) control_plane_node_id: String,
    pub(super) control_plane_node_token: String,
    pub(super) control_plane_site_id: String,
    pub(super) local_backend_python: String,
    pub(super) local_backend_mode: String,
    pub(super) ml_transport: String,
}

impl Default for DesktopAppConfigValues {
    fn default() -> Self {
        Self {
            storage_dir: String::new(),
            control_plane_api_base_url: String::new(),
            control_plane_node_id: String::new(),
            control_plane_node_token: String::new(),
            control_plane_site_id: String::new(),
            local_backend_python: String::new(),
            local_backend_mode: "managed".to_string(),
            ml_transport: "sidecar".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub(super) struct DesktopAppConfigFile {
    pub(super) env: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct DesktopAppConfigInput {
    pub(super) storage_dir: Option<String>,
    pub(super) control_plane_api_base_url: Option<String>,
    pub(super) control_plane_node_id: Option<String>,
    pub(super) control_plane_node_token: Option<String>,
    pub(super) control_plane_site_id: Option<String>,
    pub(super) local_backend_python: Option<String>,
    pub(super) local_backend_mode: Option<String>,
    pub(super) ml_transport: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub(super) struct SaveDesktopAppConfigRequest {
    pub(super) config: DesktopAppConfigInput,
}

pub(super) fn desktop_config_path() -> PathBuf {
    desktop_app_local_data_dir().join("desktop-config.json")
}

pub(super) fn read_desktop_config_file() -> DesktopAppConfigFile {
    let path = desktop_config_path();
    let Ok(raw) = fs::read_to_string(path) else {
        return DesktopAppConfigFile::default();
    };
    serde_json::from_str::<DesktopAppConfigFile>(&raw).unwrap_or_default()
}

pub(super) fn write_desktop_config_file(config: &DesktopAppConfigFile) -> Result<(), String> {
    let path = desktop_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

pub(super) fn clear_desktop_config_file() -> Result<(), String> {
    let path = desktop_config_path();
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) fn storage_state_file_path() -> PathBuf {
    if let Some(local_appdata) = process_env_value("LOCALAPPDATA") {
        return PathBuf::from(local_appdata)
            .join("KERA")
            .join("storage_dir.txt");
    }
    if let Some(home) = process_env_value("USERPROFILE").or_else(|| process_env_value("HOME")) {
        return PathBuf::from(home).join(".kera").join("storage_dir.txt");
    }
    desktop_app_local_data_dir().join("storage_dir.txt")
}

pub(super) fn storage_state_file_hint() -> Option<String> {
    Some(storage_state_file_path().to_string_lossy().to_string())
}

pub(super) fn normalize_storage_bundle_path(candidate: PathBuf) -> PathBuf {
    let resolved = candidate;
    let is_sites_dir = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("sites"))
        .unwrap_or(false);
    if !is_sites_dir {
        return resolved;
    }
    let Some(parent) = resolved.parent() else {
        return resolved;
    };
    let parent = parent.to_path_buf();
    let is_kera_data = parent
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("kera_data"))
        .unwrap_or(false);
    if is_kera_data
        || parent.join("control_plane").exists()
        || parent.join("models").exists()
        || parent.join("kera.db").exists()
        || parent.join("control_plane_cache.db").exists()
    {
        return parent;
    }
    resolved
}

pub(super) fn looks_like_storage_bundle(candidate: &Path) -> bool {
    candidate.is_dir()
        && [
            "sites",
            "control_plane",
            "models",
            "kera.db",
            "control_plane_cache.db",
            "kera_secret.key",
        ]
        .iter()
        .any(|marker| candidate.join(marker).exists())
}

pub(super) fn default_desktop_storage_dir() -> PathBuf {
    desktop_app_local_data_dir().join("KERA_DATA")
}

pub(super) fn read_storage_state_dir() -> Option<PathBuf> {
    let path = storage_state_file_path();
    let raw = fs::read_to_string(path).ok()?;
    let normalized = raw.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalize_storage_bundle_path(PathBuf::from(normalized)))
}

pub(super) fn write_storage_state_dir(storage_dir: &Path) -> Result<(), String> {
    let path = storage_state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, storage_dir.to_string_lossy().to_string()).map_err(|error| error.to_string())
}

pub(super) fn set_config_env_value(
    target: &mut BTreeMap<String, String>,
    key: &str,
    value: Option<String>,
) {
    let normalized = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match normalized {
        Some(value) => {
            target.insert(key.to_string(), value);
        }
        None => {
            target.remove(key);
        }
    }
}

pub(super) fn normalized_storage_dir_value(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(value) = normalized else {
        return Ok(None);
    };
    let path = normalize_storage_bundle_path(PathBuf::from(value));
    ensure_storage_bundle_dirs(&path)?;
    write_storage_state_dir(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}
