#[tauri::command]
pub(super) fn delete_visit(payload: DeleteVisitRequest) -> Result<DeleteVisitResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let auth = MutationAuth {
        user_id: payload.user_id,
        user_role: payload.user_role,
    };
    let conn = open_data_plane_db()?;
    if get_visit(&conn, &site_id, &patient_id, &visit_date)?.is_none() {
        return Err(format!("Visit {patient_id} / {visit_date} does not exist."));
    }
    require_visit_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    let existing_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    for image in &existing_images {
        let _ = delete_image_preview_cache(&site_id, &image.image_id)?;
        let source_path = PathBuf::from(&image.image_path);
        if source_path.exists() {
            fs::remove_file(&source_path).map_err(|error| error.to_string())?;
        }
    }
    conn.execute(
        "delete from images where site_id = ? and patient_id = ? and visit_date = ?",
        params![payload.site_id, patient_id, visit_date],
    )
    .map_err(|error| error.to_string())?;
    let history_path = case_history_path(&payload.site_id, &patient_id, &visit_date)?;
    if history_path.exists() {
        fs::remove_file(&history_path).map_err(|error| error.to_string())?;
    }
    conn.execute(
        "delete from visits where site_id = ? and patient_id = ? and visit_date = ?",
        params![payload.site_id, patient_id, visit_date],
    )
    .map_err(|error| error.to_string())?;
    let remaining_visit_count = conn
        .query_row(
            "select count(*) from visits where site_id = ? and patient_id = ?",
            params![payload.site_id, patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let deleted_patient = delete_patient_if_empty(&conn, &payload.site_id, &patient_id)?;
    schedule_ai_clinic_vector_index_rebuild(&site_id, "visit_delete");
    schedule_federated_retrieval_corpus_sync(&site_id, "visit_delete");
    Ok(DeleteVisitResponse {
        patient_id,
        visit_date,
        deleted_images: existing_images.len() as i64,
        deleted_patient,
        remaining_visit_count,
    })
}
