#[tauri::command]
pub(super) fn read_validation_artifact(
    payload: ValidationArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty()
        || validation_id.is_empty()
        || patient_id.is_empty()
        || visit_date.is_empty()
    {
        return Err("site_id, validation_id, patient_id, and visit_date are required.".to_string());
    }
    let artifact_path = validation_artifact_path(
        &site_id,
        &validation_id,
        &patient_id,
        &visit_date,
        &payload.artifact_kind,
    )?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
pub(super) fn resolve_validation_artifact_path(
    payload: ValidationArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty()
        || validation_id.is_empty()
        || patient_id.is_empty()
        || visit_date.is_empty()
    {
        return Err("site_id, validation_id, patient_id, and visit_date are required.".to_string());
    }
    let artifact_path = validation_artifact_path(
        &site_id,
        &validation_id,
        &patient_id,
        &visit_date,
        &payload.artifact_kind,
    )?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}
