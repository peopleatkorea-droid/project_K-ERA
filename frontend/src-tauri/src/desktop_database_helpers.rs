fn ensure_data_plane_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn.prepare(&pragma).map_err(|error| error.to_string())?;
    let column_names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if column_names.iter().any(|value| value == column_name) {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    conn.execute(&sql, []).map_err(|error| error.to_string())?;
    Ok(())
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
    let _ = ensure_data_plane_column(&conn, "visits", "fl_retained", "INTEGER NOT NULL DEFAULT 0");
    let _ = ensure_data_plane_column(&conn, "visits", "fl_retained_at", "TEXT");
    let _ = ensure_data_plane_column(&conn, "visits", "fl_retention_scopes", "TEXT NOT NULL DEFAULT '[]'");
    let _ = ensure_data_plane_column(&conn, "visits", "fl_retention_last_update_id", "TEXT");
    let _ = ensure_data_plane_column(&conn, "visits", "soft_deleted_at", "TEXT");
    let _ = ensure_data_plane_column(&conn, "visits", "soft_delete_reason", "TEXT");
    let _ = ensure_data_plane_column(&conn, "images", "soft_deleted_at", "TEXT");
    let _ = ensure_data_plane_column(&conn, "images", "soft_delete_reason", "TEXT");
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
        CREATE INDEX IF NOT EXISTS idx_visits_site_fl_retained
          ON visits(site_id, fl_retained);
        CREATE INDEX IF NOT EXISTS idx_visits_site_soft_deleted
          ON visits(site_id, soft_deleted_at);
        CREATE INDEX IF NOT EXISTS idx_images_site_soft_deleted
          ON images(site_id, soft_deleted_at);
        CREATE INDEX IF NOT EXISTS idx_patients_site_patient
          ON patients(site_id, patient_id);
    ",
    );
    let _ = conn.execute_batch(
        "
        CREATE VIRTUAL TABLE IF NOT EXISTS patient_case_search USING fts5(
          site_id UNINDEXED,
          visit_id UNINDEXED,
          patient_id,
          local_case_code,
          chart_alias,
          culture_category,
          culture_species,
          visit_date,
          actual_visit_date,
          tokenize = 'unicode61 remove_diacritics 2'
        );
        DROP TRIGGER IF EXISTS patient_case_search_visits_ai;
        DROP TRIGGER IF EXISTS patient_case_search_visits_au;
        DROP TRIGGER IF EXISTS patient_case_search_visits_ad;
        DROP TRIGGER IF EXISTS patient_case_search_patients_ai;
        DROP TRIGGER IF EXISTS patient_case_search_patients_au;
        DROP TRIGGER IF EXISTS patient_case_search_patients_ad;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_ai
        AFTER INSERT ON visits
        BEGIN
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            NEW.visit_id,
            NEW.patient_id,
            COALESCE(p.local_case_code, ''),
            COALESCE(p.chart_alias, ''),
            COALESCE(NEW.culture_category, ''),
            COALESCE(NEW.culture_species, ''),
            COALESCE(NEW.visit_date, ''),
            COALESCE(NEW.actual_visit_date, '')
          FROM patients p
          WHERE p.site_id = NEW.site_id AND p.patient_id = NEW.patient_id;
        END;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_au
        AFTER UPDATE ON visits
        BEGIN
          DELETE FROM patient_case_search WHERE visit_id = OLD.visit_id;
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            NEW.visit_id,
            NEW.patient_id,
            COALESCE(p.local_case_code, ''),
            COALESCE(p.chart_alias, ''),
            COALESCE(NEW.culture_category, ''),
            COALESCE(NEW.culture_species, ''),
            COALESCE(NEW.visit_date, ''),
            COALESCE(NEW.actual_visit_date, '')
          FROM patients p
          WHERE p.site_id = NEW.site_id AND p.patient_id = NEW.patient_id;
        END;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_visits_ad
        AFTER DELETE ON visits
        BEGIN
          DELETE FROM patient_case_search WHERE visit_id = OLD.visit_id;
        END;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_ai
        AFTER INSERT ON patients
        BEGIN
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            v.visit_id,
            NEW.patient_id,
            COALESCE(NEW.local_case_code, ''),
            COALESCE(NEW.chart_alias, ''),
            COALESCE(v.culture_category, ''),
            COALESCE(v.culture_species, ''),
            COALESCE(v.visit_date, ''),
            COALESCE(v.actual_visit_date, '')
          FROM visits v
          WHERE v.site_id = NEW.site_id AND v.patient_id = NEW.patient_id;
        END;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_au
        AFTER UPDATE ON patients
        BEGIN
          DELETE FROM patient_case_search
          WHERE site_id = OLD.site_id AND patient_id = OLD.patient_id;
          INSERT INTO patient_case_search (
            site_id,
            visit_id,
            patient_id,
            local_case_code,
            chart_alias,
            culture_category,
            culture_species,
            visit_date,
            actual_visit_date
          )
          SELECT
            NEW.site_id,
            v.visit_id,
            NEW.patient_id,
            COALESCE(NEW.local_case_code, ''),
            COALESCE(NEW.chart_alias, ''),
            COALESCE(v.culture_category, ''),
            COALESCE(v.culture_species, ''),
            COALESCE(v.visit_date, ''),
            COALESCE(v.actual_visit_date, '')
          FROM visits v
          WHERE v.site_id = NEW.site_id AND v.patient_id = NEW.patient_id;
        END;
        CREATE TRIGGER IF NOT EXISTS patient_case_search_patients_ad
        AFTER DELETE ON patients
        BEGIN
          DELETE FROM patient_case_search
          WHERE site_id = OLD.site_id AND patient_id = OLD.patient_id;
        END;
        DELETE FROM patient_case_search;
        INSERT INTO patient_case_search (
          site_id,
          visit_id,
          patient_id,
          local_case_code,
          chart_alias,
          culture_category,
          culture_species,
          visit_date,
          actual_visit_date
        )
        SELECT
          v.site_id,
          v.visit_id,
          v.patient_id,
          COALESCE(p.local_case_code, ''),
          COALESCE(p.chart_alias, ''),
          COALESCE(v.culture_category, ''),
          COALESCE(v.culture_species, ''),
          COALESCE(v.visit_date, ''),
          COALESCE(v.actual_visit_date, '')
        FROM visits v
        JOIN patients p
          ON v.site_id = p.site_id
         AND v.patient_id = p.patient_id;
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
