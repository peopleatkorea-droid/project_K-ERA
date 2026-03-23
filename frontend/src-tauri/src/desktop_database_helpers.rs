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
