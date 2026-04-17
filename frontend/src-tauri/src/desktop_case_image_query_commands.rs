fn desktop_image_workspace_visit_condition(alias: &str) -> String {
    format!(
        "
        (
          {alias}.soft_deleted_at is null
          and (
            {alias}.research_registry_source is null
            or {alias}.research_registry_source != 'raw_inventory_sync'
            or lower(
              trim(
                coalesce(
                  {alias}.culture_status,
                  case
                    when {alias}.culture_confirmed = 1
                      or trim(coalesce({alias}.culture_category, '')) != ''
                      or trim(coalesce({alias}.culture_species, '')) != ''
                    then 'positive'
                    else 'unknown'
                  end
                )
              )
            ) = 'positive'
          )
        )
        "
    )
}

fn query_visible_workspace_images(
    conn: &Connection,
    site_id: &str,
    patient_id: Option<&str>,
    visit_date: Option<&str>,
    preview_max_side: Option<u32>,
) -> Result<Vec<DesktopImageRecord>, String> {
    let visible_visit_condition = desktop_image_workspace_visit_condition("v");
    let mut sql = format!(
        "
      select
        i.image_id,
        i.visit_id,
        i.patient_id,
        i.visit_date,
        i.view,
        i.image_path,
        i.is_representative,
        i.lesion_prompt_box,
        i.uploaded_at,
        i.quality_scores
      from images i
      join visits v on i.site_id = v.site_id and i.visit_id = v.visit_id
      where i.site_id = ?
        and i.soft_deleted_at is null
        and {visible_visit_condition}
    "
    );
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(value) = patient_id {
        sql.push_str(" and i.patient_id = ?");
        params.push(Value::Text(value.to_string()));
    }
    if let Some(value) = visit_date {
        sql.push_str(" and i.visit_date = ?");
        params.push(Value::Text(value.to_string()));
    }
    sql.push_str(" order by i.patient_id asc, i.visit_date asc, i.uploaded_at asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut images = Vec::new();
    let mut warm_preview_jobs = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let (image, warm_preview_job) =
            desktop_image_record_from_row(row, site_id, preview_max_side)?;
        if let Some(job) = warm_preview_job {
            warm_preview_jobs.push(job);
        }
        images.push(image);
    }
    queue_preview_generation_batch(warm_preview_jobs);
    Ok(images)
}

#[tauri::command]
pub(super) fn list_images(payload: ListImagesRequest) -> Result<Vec<DesktopImageRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = payload
        .patient_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(normalize_patient_pseudonym)
        .transpose()?;
    let visit_date = payload
        .visit_date
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(normalize_visit_label)
        .transpose()?;
    let preview_max_side = if patient_id.is_some() && visit_date.is_some() {
        Some(640)
    } else {
        None
    };
    let conn = open_data_plane_db()?;
    query_visible_workspace_images(
        &conn,
        &site_id,
        patient_id.as_deref(),
        visit_date.as_deref(),
        preview_max_side,
    )
}

#[tauri::command]
pub(super) fn get_visit_images(payload: VisitImagesRequest) -> Result<Vec<DesktopImageRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    query_visible_workspace_images(&conn, &site_id, Some(&patient_id), Some(&visit_date), Some(640))
}

#[tauri::command]
pub(super) fn ensure_image_previews(
    payload: EnsureImagePreviewsRequest,
) -> Result<Vec<ImagePreviewPathRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let max_side = payload.max_side.unwrap_or(640).clamp(96, 1024);
    let mut seen_ids: HashSet<String> = HashSet::new();
    let unique_ids: Vec<String> = payload
        .image_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen_ids.insert(id.clone()))
        .collect();
    if unique_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_data_plane_db()?;
    let placeholders = std::iter::repeat("?")
        .take(unique_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let batch_sql = format!(
        "select image_id, image_path from images where site_id = ? and soft_deleted_at is null and image_id in ({placeholders})"
    );
    let mut batch_params: Vec<Value> = vec![Value::Text(site_id.clone())];
    for id in &unique_ids {
        batch_params.push(Value::Text(id.clone()));
    }
    let mut path_by_id: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare(&batch_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(batch_params), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (image_id, image_path) = row.map_err(|e| e.to_string())?;
            path_by_id.insert(image_id, image_path);
        }
    }

    let mut records = Vec::new();
    let mut warm_preview_jobs = Vec::new();
    for image_id in unique_ids {
        let Some(stored_image_path) = path_by_id.get(&image_id) else {
            records.push(ImagePreviewPathRecord {
                image_id,
                preview_path: None,
                fallback_path: None,
                ready: false,
            });
            continue;
        };
        let source_path = resolve_site_runtime_path(&site_id, stored_image_path)?;
        let fallback_path = existing_file_path_string(&source_path);
        let preview_path = match cached_preview_file_path(&site_id, &image_id, max_side) {
            Ok(Some(path)) => Some(path),
            Ok(None) => {
                if let Some(job) =
                    maybe_queue_preview_job(&site_id, &image_id, &source_path, max_side)
                {
                    warm_preview_jobs.push(job);
                }
                None
            }
            Err(_) => None,
        };
        records.push(ImagePreviewPathRecord {
            image_id,
            ready: preview_path.is_some(),
            preview_path,
            fallback_path,
        });
    }
    queue_preview_generation_batch(warm_preview_jobs);
    Ok(records)
}

#[cfg(test)]
mod desktop_case_image_query_command_tests {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use rusqlite::{params, Connection};

    use super::{ensure_image_previews, query_visible_workspace_images, EnsureImagePreviewsRequest};

    fn test_env_lock() -> &'static Mutex<()> {
        static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_image_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = env::temp_dir().join(format!("kera_image_query_test_{suffix}_{name}.png"));
        fs::write(&path, b"test-image").expect("write image");
        path
    }

    fn temp_valid_image_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = env::temp_dir().join(format!("kera_image_query_valid_{suffix}_{name}.png"));
        let image = image::RgbImage::from_pixel(32, 32, image::Rgb([180, 80, 60]));
        image.save(&path).expect("save image");
        path
    }

    fn setup_image_query_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "
            create table visits (
              site_id text not null,
              visit_id text not null,
              patient_id text not null,
              created_by_user_id text,
              visit_date text not null,
              actual_visit_date text,
              culture_status text,
              culture_confirmed integer,
              culture_category text,
              culture_species text,
              additional_organisms text,
              contact_lens_use text,
              predisposing_factor text,
              other_history text,
              visit_status text,
              active_stage integer,
              is_initial_visit integer,
              smear_result text,
              polymicrobial integer,
              created_at text,
              patient_reference_id text,
              visit_index integer,
              research_registry_status text,
              research_registry_updated_at text,
              research_registry_updated_by text,
              research_registry_source text,
              soft_deleted_at text
            );
            create table images (
              site_id text not null,
              visit_id text not null,
              image_id text not null,
              patient_id text not null,
              visit_date text not null,
              view text,
              image_path text,
              is_representative integer,
              uploaded_at text,
              lesion_prompt_box text,
              quality_scores text,
              soft_deleted_at text
            );
            ",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn list_images_hides_raw_inventory_sync_non_positive_rows() {
        let conn = setup_image_query_test_db();
        let hidden_path = temp_image_path("hidden");
        let visible_path = temp_image_path("visible");
        let visits = [
            (
                "visit_hidden",
                "PAT-001",
                "Initial",
                "unknown",
                0_i64,
                "",
                "",
                Some("raw_inventory_sync"),
                1_i64,
                "2026-04-07T00:00:00+00:00",
            ),
            (
                "visit_visible",
                "PAT-001",
                "FU #1",
                "negative",
                0_i64,
                "",
                "",
                None,
                2_i64,
                "2026-04-07T01:00:00+00:00",
            ),
        ];
        for (
            visit_id,
            patient_id,
            visit_date,
            culture_status,
            culture_confirmed,
            culture_category,
            culture_species,
            research_registry_source,
            visit_index,
            created_at,
        ) in visits
        {
            conn.execute(
                "insert into visits (
                   site_id, visit_id, patient_id, created_by_user_id, visit_date, actual_visit_date,
                   culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
                   contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
                   smear_result, polymicrobial, created_at, patient_reference_id, visit_index,
                   research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    patient_id,
                    "user_a",
                    visit_date,
                    Option::<&str>::None,
                    culture_status,
                    culture_confirmed,
                    culture_category,
                    culture_species,
                    "[]",
                    "none",
                    "[]",
                    "",
                    "active",
                    1_i64,
                    0_i64,
                    "",
                    0_i64,
                    created_at,
                    Option::<&str>::None,
                    visit_index,
                    "analysis_only",
                    Option::<&str>::None,
                    Option::<&str>::None,
                    research_registry_source,
                ],
            )
            .expect("insert visit");
        }
        let images = [
            ("img_hidden", "visit_hidden", "Initial", hidden_path.clone()),
            ("img_visible", "visit_visible", "FU #1", visible_path.clone()),
        ];
        for (image_id, visit_id, visit_date, image_path) in images {
            conn.execute(
                "insert into images (
                   site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative,
                   uploaded_at, lesion_prompt_box, quality_scores
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    image_id,
                    "PAT-001",
                    visit_date,
                    "slit",
                    image_path.to_string_lossy().to_string(),
                    1_i64,
                    "2026-04-07T00:00:00+00:00",
                    Option::<&str>::None,
                    Option::<&str>::None,
                ],
            )
            .expect("insert image");
        }

        let images =
            query_visible_workspace_images(&conn, "site_a", Some("PAT-001"), None, None).expect("visible images");
        let visit_dates = images
            .iter()
            .map(|image| image.visit_date.as_str())
            .collect::<Vec<_>>();

        assert_eq!(visit_dates, vec!["FU #1"]);

        fs::remove_file(hidden_path).ok();
        fs::remove_file(visible_path).ok();
    }

    #[test]
    fn list_images_hides_soft_deleted_rows() {
        let conn = setup_image_query_test_db();
        let hidden_path = temp_image_path("soft_deleted_hidden");
        let visible_path = temp_image_path("soft_deleted_visible");
        conn.execute(
            "insert into visits (
               site_id, visit_id, patient_id, created_by_user_id, visit_date, actual_visit_date,
               culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
               contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
               smear_result, polymicrobial, created_at, patient_reference_id, visit_index,
               research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source,
               soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "PAT-001",
                "user_a",
                "Visible",
                Option::<&str>::None,
                "negative",
                0_i64,
                "",
                "",
                "[]",
                "none",
                "[]",
                "",
                "active",
                1_i64,
                0_i64,
                "",
                0_i64,
                "2026-04-07T01:00:00+00:00",
                Option::<&str>::None,
                1_i64,
                "analysis_only",
                Option::<&str>::None,
                Option::<&str>::None,
                Option::<&str>::None,
                Option::<&str>::None,
            ],
        )
        .expect("insert visit");
        conn.execute(
            "insert into images (
               site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative,
               uploaded_at, lesion_prompt_box, quality_scores, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "img_hidden",
                "PAT-001",
                "Visible",
                "slit",
                hidden_path.to_string_lossy().to_string(),
                0_i64,
                "2026-04-07T01:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
                "2026-04-08T00:00:00+00:00",
            ],
        )
        .expect("insert soft-deleted image");
        conn.execute(
            "insert into images (
               site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative,
               uploaded_at, lesion_prompt_box, quality_scores, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "img_visible",
                "PAT-001",
                "Visible",
                "white",
                visible_path.to_string_lossy().to_string(),
                1_i64,
                "2026-04-07T02:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
                Option::<&str>::None,
            ],
        )
        .expect("insert visible image");

        let images =
            query_visible_workspace_images(&conn, "site_a", Some("PAT-001"), None, None).expect("visible images");
        let image_ids = images
            .iter()
            .map(|image| image.image_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(image_ids, vec!["img_visible"]);

        fs::remove_file(hidden_path).ok();
        fs::remove_file(visible_path).ok();
    }

    #[test]
    fn ensure_image_previews_returns_fallback_without_sync_generation() {
        let _guard = test_env_lock().lock().expect("test env lock");
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = env::temp_dir().join(format!("kera_image_preview_query_{suffix}"));
        let storage_dir = root.join("storage");
        let db_path = root.join("data-plane.sqlite3");
        let image_path = temp_valid_image_path("preview");

        fs::create_dir_all(&storage_dir).expect("storage dir");
        let conn = Connection::open(&db_path).expect("sqlite file");
        conn.execute_batch(
            "
            create table images (
              site_id text not null,
              visit_id text not null,
              image_id text not null,
              patient_id text not null,
              visit_date text not null,
              image_path text,
              soft_deleted_at text
            );
            ",
        )
        .expect("schema");
        conn.execute(
            "insert into images (
               site_id, visit_id, image_id, patient_id, visit_date, image_path, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_a",
                "img_preview",
                "PAT-001",
                "Initial",
                image_path.to_string_lossy().to_string(),
                Option::<&str>::None,
            ],
        )
        .expect("insert image");
        drop(conn);

        env::set_var(
            "KERA_DATA_PLANE_DATABASE_URL",
            format!("sqlite:///{}", db_path.to_string_lossy()),
        );
        env::set_var("KERA_STORAGE_DIR", &storage_dir);

        let records = ensure_image_previews(EnsureImagePreviewsRequest {
            site_id: "site_a".to_string(),
            image_ids: vec!["img_preview".to_string()],
            max_side: Some(640),
        })
        .expect("ensure previews");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].image_id, "img_preview");
        assert_eq!(
            records[0].fallback_path.as_deref(),
            Some(image_path.to_string_lossy().as_ref())
        );
        assert_eq!(records[0].preview_path, None);
        assert!(!records[0].ready);

        env::remove_var("KERA_STORAGE_DIR");
        env::remove_var("KERA_DATA_PLANE_DATABASE_URL");
        fs::remove_file(image_path).ok();
        let _ = fs::remove_dir_all(root);
    }
}
