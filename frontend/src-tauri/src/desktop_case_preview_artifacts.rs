#[tauri::command]
pub(super) fn read_case_roi_preview_artifact(
    payload: CasePreviewArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        roi_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
pub(super) fn resolve_case_roi_preview_artifact_path(
    payload: CasePreviewArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        roi_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(super) fn read_case_lesion_preview_artifact(
    payload: CasePreviewArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        lesion_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
pub(super) fn resolve_case_lesion_preview_artifact_path(
    payload: CasePreviewArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        lesion_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}
