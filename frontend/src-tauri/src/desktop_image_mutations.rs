#[tauri::command]
pub(super) fn upload_image(payload: UploadImageRequest) -> Result<DesktopImageRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let conn = open_data_plane_db()?;
    let visit = get_visit(&conn, &site_id, &patient_id, &visit_date)?
        .ok_or_else(|| "Visit must exist before image upload.".to_string())?;
    let visit_dir = raw_dir(&site_id)?.join(&patient_id).join(&visit_date);
    fs::create_dir_all(&visit_dir).map_err(|error| error.to_string())?;
    let image_id = make_id("image");
    let (sanitized_content, normalized_suffix) = sanitize_image_bytes(
        &payload.bytes,
        payload.file_name.as_deref().unwrap_or("upload.bin"),
    )?;
    let destination = visit_dir.join(format!("{image_id}{normalized_suffix}"));
    fs::write(&destination, sanitized_content).map_err(|error| error.to_string())?;
    let derivative_site_id = site_id.clone();
    let derivative_image_id = image_id.clone();
    let derivative_destination = destination.clone();
    let derivative_view = payload.view.clone();
    let uploaded_at = utc_now();
    conn.execute(
        "
        insert into images (
          image_id, visit_id, site_id, patient_id, visit_date, created_by_user_id, view, image_path,
          is_representative, lesion_prompt_box, has_lesion_box, has_roi_crop, has_medsam_mask,
          has_lesion_crop, has_lesion_mask, quality_scores, artifact_status_updated_at, uploaded_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            image_id,
            visit.visit_id,
            site_id,
            patient_id,
            visit_date,
            payload.user_id,
            payload.view,
            destination.to_string_lossy().to_string(),
            if payload.is_representative.unwrap_or(false) {
                1
            } else {
                0
            },
            Option::<String>::None,
            0,
            0,
            0,
            0,
            0,
            Option::<String>::None,
            uploaded_at.clone(),
            uploaded_at
        ],
    )
    .map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare(
            "
            select
              image_id, visit_id, patient_id, visit_date, view, image_path, is_representative,
              lesion_prompt_box, uploaded_at, quality_scores
            from images
            where site_id = ? and image_id = ?
            ",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params![payload.site_id, image_id])
        .map_err(|error| error.to_string())?;
    let row = rows
        .next()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Uploaded image not found.".to_string())?;
    let record = desktop_image_record_from_row(row, &site_id, Some(640)).map(|(record, _)| record)?;
    std::thread::spawn(move || {
        let quality_scores = score_slit_lamp_image(&derivative_destination, &derivative_view).ok();
        let Ok(conn) = open_data_plane_db() else {
            return;
        };
        let quality_payload = quality_scores.as_ref().map(|value| value.to_string());
        let _ = conn.execute(
            "update images set quality_scores = ? where site_id = ? and image_id = ?",
            params![quality_payload, derivative_site_id, derivative_image_id],
        );
    });
    schedule_case_embedding_refresh(&site_id, &patient_id, &visit_date, "image_upload");
    schedule_federated_retrieval_corpus_sync(&site_id, "image_upload");
    Ok(record)
}

#[tauri::command]
pub(super) fn delete_visit_images(
    payload: DeleteVisitImagesRequest,
) -> Result<DeleteImagesResponse, String> {
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
    require_visit_image_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    let existing_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    if visit_fl_retained(&conn, &site_id, &patient_id, &visit_date)? {
        for image in &existing_images {
            let _ = delete_image_preview_cache(&site_id, &image.image_id)?;
        }
        let deleted_count = soft_delete_visit_images(
            &conn,
            &site_id,
            &patient_id,
            &visit_date,
            "federated_retention_soft_delete",
        )?;
        schedule_ai_clinic_vector_index_rebuild(&site_id, "delete_images");
        schedule_federated_retrieval_corpus_sync(&site_id, "delete_images");
        return Ok(DeleteImagesResponse {
            deleted_count,
        });
    }
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
    schedule_ai_clinic_vector_index_rebuild(&site_id, "delete_images");
    schedule_federated_retrieval_corpus_sync(&site_id, "delete_images");
    Ok(DeleteImagesResponse {
        deleted_count: existing_images.len() as i64,
    })
}

#[tauri::command]
pub(super) fn set_representative_image(
    payload: RepresentativeImageRequest,
) -> Result<RepresentativeImageResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let representative_image_id = payload.representative_image_id.trim().to_string();
    if representative_image_id.is_empty() {
        return Err("representative_image_id is required.".to_string());
    }
    let auth = MutationAuth {
        user_id: payload.user_id,
        user_role: payload.user_role,
    };
    let conn = open_data_plane_db()?;
    let visit_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    if visit_images.is_empty() {
        return Err("No images found for this visit.".to_string());
    }
    require_visit_image_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    if !visit_images
        .iter()
        .any(|image| image.image_id == representative_image_id)
    {
        return Err("Representative image is not part of this visit.".to_string());
    }
    for image in &visit_images {
        conn.execute(
            "update images set is_representative = ? where site_id = ? and image_id = ?",
            params![
                if image.image_id == representative_image_id {
                    1
                } else {
                    0
                },
                payload.site_id,
                image.image_id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    schedule_case_embedding_refresh(&site_id, &patient_id, &visit_date, "representative_change");
    schedule_federated_retrieval_corpus_sync(&site_id, "representative_change");
    Ok(RepresentativeImageResponse {
        images: list_images_for_visit(&conn, &payload.site_id, &patient_id, &visit_date)?,
    })
}
