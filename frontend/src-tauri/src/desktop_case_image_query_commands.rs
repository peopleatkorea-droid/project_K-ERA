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
    query_images(
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
    list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)
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
        "select image_id, image_path from images where site_id = ? and image_id in ({placeholders})"
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
        let preview_path = preview_file_path(&site_id, &image_id, &source_path, max_side).ok();
        records.push(ImagePreviewPathRecord {
            image_id,
            ready: preview_path.is_some(),
            preview_path,
            fallback_path,
        });
    }
    Ok(records)
}
