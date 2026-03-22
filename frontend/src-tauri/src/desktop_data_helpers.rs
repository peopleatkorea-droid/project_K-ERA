use super::*;

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

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn federation_salt_config_path() -> Option<PathBuf> {
    control_plane_dir()
        .ok()
        .map(|dir| dir.join("federation_salt.json"))
}

fn read_federation_salt_config_file() -> FederationSaltConfigFile {
    let Some(path) = federation_salt_config_path() else {
        return FederationSaltConfigFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return FederationSaltConfigFile::default();
    };
    serde_json::from_str::<FederationSaltConfigFile>(&raw).unwrap_or_default()
}

fn write_federation_salt_config_file(config: &FederationSaltConfigFile) -> Result<(), String> {
    let Some(path) = federation_salt_config_path() else {
        return Err("Federation salt config path is unavailable.".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn resolve_federation_salt_config() -> FederationSaltConfigFile {
    let stored = read_federation_salt_config_file();
    let explicit_case = env_value("KERA_CASE_REFERENCE_SALT");
    let explicit_patient = env_value("KERA_PATIENT_REFERENCE_SALT");
    let explicit_public = env_value("KERA_PUBLIC_ALIAS_SALT");
    let legacy_secret = env_value("KERA_API_SECRET");

    let case_reference_salt = explicit_case
        .clone()
        .or_else(|| normalize_optional_text(stored.case_reference_salt.clone()))
        .or_else(|| legacy_secret.clone())
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string());
    let patient_reference_salt = explicit_patient
        .clone()
        .or_else(|| normalize_optional_text(stored.patient_reference_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());
    let public_alias_salt = explicit_public
        .clone()
        .or_else(|| normalize_optional_text(stored.public_alias_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());

    let source =
        if explicit_case.is_some() || explicit_patient.is_some() || explicit_public.is_some() {
            "explicit_env".to_string()
        } else if normalize_optional_text(stored.case_reference_salt.clone()).is_some() {
            normalize_optional_text(stored.source.clone()).unwrap_or_else(|| "stored".to_string())
        } else if legacy_secret.is_some() {
            "legacy_kera_api_secret".to_string()
        } else {
            "default".to_string()
        };

    let resolved = FederationSaltConfigFile {
        case_reference_salt: Some(case_reference_salt),
        patient_reference_salt: Some(patient_reference_salt),
        public_alias_salt: Some(public_alias_salt),
        source: Some(source),
    };

    if resolved != stored {
        let _ = write_federation_salt_config_file(&resolved);
    }

    resolved
}

pub(super) fn local_node_api_base_url() -> String {
    for key in [
        "KERA_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_API_BASE_URL",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() {
                return normalized;
            }
        }
    }
    "http://127.0.0.1:8000".to_string()
}

pub(super) fn desktop_ml_transport() -> String {
    for key in [
        "KERA_DESKTOP_ML_TRANSPORT",
        "NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "http" {
                return "http".to_string();
            }
            if normalized == "sidecar" {
                return "sidecar".to_string();
            }
        }
    }
    "sidecar".to_string()
}

pub(super) fn desktop_local_backend_mode() -> String {
    for key in [
        "KERA_DESKTOP_LOCAL_BACKEND_MODE",
        "NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "external" {
                return "external".to_string();
            }
            if normalized == "managed" {
                return "managed".to_string();
            }
        }
    }
    if desktop_ml_transport() == "http" {
        "external".to_string()
    } else {
        "managed".to_string()
    }
}

pub(super) fn python_command_available(command_name: &str) -> bool {
    Command::new(command_name)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

pub(super) fn preview_cache_path(
    site_id: &str,
    image_id: &str,
    max_side: u32,
) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?
        .join("artifacts")
        .join("image_previews")
        .join(max_side.to_string())
        .join(format!("{image_id}.jpg")))
}

#[derive(Debug, Clone)]
pub(super) struct WarmPreviewJob {
    pub(super) site_id: String,
    pub(super) image_id: String,
    pub(super) image_path: PathBuf,
    pub(super) max_side: u32,
}

fn preview_warm_state() -> &'static Mutex<HashSet<String>> {
    PREVIEW_WARM_STATE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn preview_job_key(site_id: &str, image_id: &str, max_side: u32) -> String {
    format!("{site_id}::{image_id}::{max_side}")
}

fn ensure_preview(image_path: &Path, preview_path: &Path, max_side: u32) -> Result<(), String> {
    if preview_path.exists() {
        return Ok(());
    }
    if !image_path.exists() {
        return Err(format!(
            "Image file not found on disk: {}",
            image_path.display()
        ));
    }
    if let Some(parent) = preview_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let image = image::open(image_path).map_err(|error| error.to_string())?;
    let clamped_side = max_side.clamp(96, 1024);
    let thumbnail = image.thumbnail(clamped_side, clamped_side);
    thumbnail
        .save_with_format(preview_path, ImageFormat::Jpeg)
        .map_err(|error| error.to_string())
}

pub(super) fn existing_file_path_string(path: &Path) -> Option<String> {
    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

pub(super) fn cached_preview_file_path(
    site_id: &str,
    image_id: &str,
    max_side: u32,
) -> Result<Option<String>, String> {
    let preview_path = preview_cache_path(site_id, image_id, max_side)?;
    Ok(existing_file_path_string(&preview_path))
}

pub(super) fn preview_file_path(
    site_id: &str,
    image_id: &str,
    image_path: &Path,
    max_side: u32,
) -> Result<String, String> {
    let preview_path = preview_cache_path(site_id, image_id, max_side)?;
    ensure_preview(image_path, &preview_path, max_side)?;
    Ok(preview_path.to_string_lossy().to_string())
}

pub(super) fn maybe_queue_preview_job(
    site_id: &str,
    image_id: &str,
    image_path: &Path,
    max_side: u32,
) -> Option<WarmPreviewJob> {
    let preview_path = preview_cache_path(site_id, image_id, max_side).ok()?;
    if preview_path.exists() || !image_path.exists() {
        return None;
    }
    Some(WarmPreviewJob {
        site_id: site_id.to_string(),
        image_id: image_id.to_string(),
        image_path: image_path.to_path_buf(),
        max_side,
    })
}

pub(super) fn queue_preview_generation_batch(jobs: Vec<WarmPreviewJob>) {
    if jobs.is_empty() {
        return;
    }
    let mut queued_jobs = Vec::new();
    {
        let mut queued = preview_warm_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for job in jobs {
            let job_key = preview_job_key(&job.site_id, &job.image_id, job.max_side);
            if queued.insert(job_key.clone()) {
                queued_jobs.push((job_key, job));
            }
        }
    }
    if queued_jobs.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for (job_key, job) in queued_jobs {
            if let Ok(preview_path) = preview_cache_path(&job.site_id, &job.image_id, job.max_side)
            {
                let _ = ensure_preview(&job.image_path, &preview_path, job.max_side);
            }
            let mut queued = preview_warm_state()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            queued.remove(&job_key);
        }
    });
}

pub(super) fn open_data_plane_db() -> Result<Connection, String> {
    let path = sqlite_database_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|error| error.to_string())?;
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    Ok(conn)
}

pub(super) fn ensure_data_plane_indexes() {
    let Ok(conn) = open_data_plane_db() else {
        return;
    };
    let _ = conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_images_site_visit
          ON images(site_id, visit_id);
        CREATE INDEX IF NOT EXISTS idx_images_site_image_id
          ON images(site_id, image_id);
        CREATE INDEX IF NOT EXISTS idx_images_site_representative
          ON images(site_id, visit_id, is_representative);
        CREATE INDEX IF NOT EXISTS idx_visits_site_patient
          ON visits(site_id, patient_id);
        CREATE INDEX IF NOT EXISTS idx_visits_site_visit_id
          ON visits(site_id, visit_id);
        CREATE INDEX IF NOT EXISTS idx_patients_site_patient
          ON patients(site_id, patient_id);
    ",
    );
}

fn control_plane_sqlite_database_path() -> Result<PathBuf, String> {
    for key in [
        "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_DATABASE_URL",
        "DATABASE_URL",
    ] {
        let Some(raw) = env_value(key) else {
            continue;
        };
        let normalized = raw.trim();
        let Some(path) = normalized
            .strip_prefix("sqlite:///")
            .or_else(|| normalized.strip_prefix("sqlite://"))
        else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        return Ok(PathBuf::from(path));
    }
    Err("A local SQLite control-plane cache is not configured.".to_string())
}

pub(super) fn open_control_plane_db() -> Result<Connection, String> {
    let path = control_plane_sqlite_database_path()?;
    if !path.exists() {
        return Err(format!(
            "Control-plane cache database does not exist: {}",
            path.display()
        ));
    }
    Connection::open(path).map_err(|error| error.to_string())
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

fn patient_reference_salt() -> String {
    resolve_federation_salt_config()
        .patient_reference_salt
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string())
}

pub(super) fn make_id(prefix: &str) -> String {
    let identifier = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &identifier[..10])
}

pub(super) fn make_patient_reference_id(site_id: &str, patient_id: &str) -> String {
    let payload = format!(
        "{}::{}::{}",
        patient_reference_salt(),
        site_id.trim(),
        patient_id.trim()
    );
    let digest = Sha256::digest(payload.as_bytes());
    let hex = format!("{digest:x}");
    format!("ptref_{}", &hex[..20])
}

pub(super) fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
