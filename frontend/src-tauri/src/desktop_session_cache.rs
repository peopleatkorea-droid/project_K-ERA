use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct CachedSessionUser {
    pub(super) user_id: String,
    pub(super) username: String,
    pub(super) full_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) public_alias: Option<String>,
    pub(super) role: String,
    pub(super) site_ids: Option<Vec<String>>,
    pub(super) approval_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct CachedSessionSite {
    pub(super) site_id: String,
    pub(super) display_name: String,
    pub(super) hospital_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) source_institution_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct SessionCachePayload {
    pub(super) token: String,
    pub(super) user: CachedSessionUser,
    pub(super) sites: Vec<CachedSessionSite>,
}

pub(super) fn session_cache_path() -> PathBuf {
    desktop_app_local_data_dir().join("session_cache.json")
}

#[tauri::command]
pub(super) fn load_session_cache() -> Option<SessionCachePayload> {
    let path = session_cache_path();
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
pub(super) fn save_session_cache(payload: SessionCachePayload) -> Result<(), String> {
    let path = session_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn clear_session_cache() -> Result<(), String> {
    let path = session_cache_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(())
}
