#[tauri::command]
pub(super) fn get_case_history(payload: CaseHistoryRequest) -> Result<CaseHistoryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let history_path = case_history_path(&site_id, &patient_id, &visit_date)?;
    if !history_path.exists() {
        return Ok(CaseHistoryResponse {
            validations: Vec::new(),
            contributions: Vec::new(),
        });
    }
    let raw = fs::read_to_string(history_path).map_err(|error| error.to_string())?;
    let payload = serde_json::from_str::<JsonValue>(&raw).unwrap_or_else(|_| json!({}));
    let validations = payload
        .get("validations")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let contributions = payload
        .get("contributions")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(CaseHistoryResponse {
        validations,
        contributions,
    })
}

#[tauri::command]
pub(super) fn list_stored_case_lesion_previews(
    payload: StoredLesionPreviewsRequest,
) -> Result<Vec<LesionPreviewRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() {
        return Err("site_id, patient_id, and visit_date are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let images = query_images(&conn, &site_id, Some(&patient_id), Some(&visit_date), None)?;
    if images.is_empty() {
        return Err(format!(
            "No images found for patient {patient_id} / {visit_date}."
        ));
    }

    let lesion_meta_dir = site_dir(&site_id)?
        .join("artifacts")
        .join("lesion_preview_meta");
    let mut previews = Vec::new();
    for image in images {
        let Some(lesion_prompt_box) = image.lesion_prompt_box.clone() else {
            continue;
        };
        let artifact_name = Path::new(&image.image_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Image path is invalid.".to_string())?;
        let mask_path = site_dir(&site_id)?
            .join("artifacts")
            .join("lesion_masks")
            .join(format!("{artifact_name}_mask.png"));
        let crop_path = site_dir(&site_id)?
            .join("artifacts")
            .join("lesion_crops")
            .join(format!("{artifact_name}_crop.png"));
        let metadata_path = lesion_meta_dir.join(format!("{artifact_name}.json"));
        let backend = if metadata_path.exists() {
            let metadata_raw = fs::read_to_string(&metadata_path).unwrap_or_default();
            let metadata =
                serde_json::from_str::<JsonValue>(&metadata_raw).unwrap_or(JsonValue::Null);
            json_string_field(&metadata, "backend").unwrap_or_else(|| "unknown".to_string())
        } else {
            "unknown".to_string()
        };
        previews.push(LesionPreviewRecord {
            patient_id: patient_id.clone(),
            visit_date: visit_date.clone(),
            image_id: Some(image.image_id.clone()),
            view: image.view.clone(),
            is_representative: image.is_representative,
            source_image_path: image.image_path.clone(),
            has_lesion_crop: crop_path.exists(),
            has_lesion_mask: mask_path.exists(),
            backend,
            lesion_prompt_box: Some(lesion_prompt_box),
        });
    }

    Ok(previews)
}
