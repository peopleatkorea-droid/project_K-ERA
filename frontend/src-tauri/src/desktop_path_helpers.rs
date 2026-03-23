pub(super) fn sqlite_database_path() -> Result<PathBuf, String> {
    let raw = env_value("KERA_DATA_PLANE_DATABASE_URL")
        .ok_or_else(|| "KERA_DATA_PLANE_DATABASE_URL is not configured.".to_string())?;
    let normalized = raw.trim();
    let path = normalized
        .strip_prefix("sqlite:///")
        .or_else(|| normalized.strip_prefix("sqlite://"))
        .unwrap_or(normalized);
    if path.is_empty() {
        return Err("SQLite database path is empty.".to_string());
    }
    Ok(PathBuf::from(path))
}

pub(super) fn site_dir(site_id: &str) -> Result<PathBuf, String> {
    let raw = env_value("KERA_STORAGE_DIR")
        .ok_or_else(|| "KERA_STORAGE_DIR is not configured.".to_string())?;
    let base = PathBuf::from(raw);
    let site_root = if base
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("sites"))
        .unwrap_or(false)
    {
        base
    } else {
        base.join("sites")
    };
    Ok(site_root.join(site_id))
}

pub(super) fn control_plane_dir() -> Result<PathBuf, String> {
    if let Some(raw) = env_value("KERA_CONTROL_PLANE_DIR") {
        let normalized = raw.trim();
        if !normalized.is_empty() {
            return Ok(PathBuf::from(normalized));
        }
    }
    let raw = env_value("KERA_STORAGE_DIR")
        .ok_or_else(|| "KERA_STORAGE_DIR is not configured.".to_string())?;
    Ok(PathBuf::from(raw).join("control_plane"))
}

pub(super) fn control_plane_case_dir() -> Result<PathBuf, String> {
    Ok(control_plane_dir()?.join("validation_cases"))
}

pub(super) fn raw_dir(site_id: &str) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?.join("data").join("raw"))
}

pub(super) fn case_history_dir(site_id: &str) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?.join("case_history"))
}

pub(super) fn resolve_site_runtime_path(site_id: &str, value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Path value is empty.".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return Ok(candidate);
    }
    Ok(site_dir(site_id)?.join(candidate))
}

pub(super) fn safe_path_component(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

pub(super) fn case_history_path(
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<PathBuf, String> {
    let patient_dir = case_history_dir(site_id)?.join(safe_path_component(patient_id));
    fs::create_dir_all(&patient_dir).map_err(|error| error.to_string())?;
    Ok(patient_dir.join(format!("{}.json", safe_path_component(visit_date))))
}
