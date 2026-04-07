#[tauri::command]
pub(super) fn update_visit(payload: UpdateVisitRequest) -> Result<VisitRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let auth = MutationAuth {
        user_id: payload.user_id.clone(),
        user_role: payload.user_role.clone(),
    };
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let normalized_visit_date = normalize_visit_label(&payload.visit_date)?;
    let normalized_target_patient_id = normalize_patient_pseudonym(&payload.target_patient_id)?;
    let normalized_target_visit_date = normalize_visit_label(&payload.target_visit_date)?;
    let normalized_actual_visit_date =
        normalize_actual_visit_date(payload.actual_visit_date.as_deref())?;
    let conn = open_data_plane_db()?;
    if get_visit(
        &conn,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .is_none()
    {
        return Err(format!(
            "Visit {normalized_patient_id} / {normalized_visit_date} does not exist."
        ));
    }
    require_visit_write_access(
        &conn,
        &auth,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?;
    let target_patient = get_patient(&conn, &site_id, &normalized_target_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_target_patient_id} does not exist."))?;
    if normalized_target_patient_id != normalized_patient_id {
        require_record_owner(
            &auth,
            target_patient.created_by_user_id.as_deref(),
            "Only the creator or a site admin can move a visit into this patient.",
        )?;
    }
    let target_changed = normalized_target_patient_id != normalized_patient_id
        || normalized_target_visit_date != normalized_visit_date;
    if target_changed
        && get_visit(
            &conn,
            &site_id,
            &normalized_target_patient_id,
            &normalized_target_visit_date,
        )?
        .is_some()
    {
        return Err(format!(
            "Visit {normalized_target_patient_id} / {normalized_target_visit_date} already exists."
        ));
    }
    let (
        normalized_culture_status,
        normalized_culture_confirmed,
        normalized_category,
        normalized_species,
        normalized_additional_organisms,
        normalized_polymicrobial,
    ) = normalize_visit_culture_fields(
        payload.culture_status.as_deref(),
        payload.culture_confirmed,
        &payload.culture_category,
        &payload.culture_species,
        payload.additional_organisms.as_deref().unwrap_or(&[]),
        payload.polymicrobial.unwrap_or(false),
    )?;
    let normalized_status = normalize_visit_status(payload.visit_status.as_deref(), true);
    conn.execute(
        "
        update visits
        set patient_id = ?, patient_reference_id = ?, actual_visit_date = ?, visit_date = ?, visit_index = ?,
            culture_status = ?, culture_confirmed = ?, culture_category = ?, culture_species = ?, contact_lens_use = ?,
            predisposing_factor = ?, additional_organisms = ?, other_history = ?, visit_status = ?,
            active_stage = ?, is_initial_visit = ?, smear_result = ?, polymicrobial = ?
        where site_id = ? and patient_id = ? and visit_date = ?
        ",
        params![
            normalized_target_patient_id,
            make_patient_reference_id(&site_id, &normalized_target_patient_id),
            normalized_actual_visit_date,
            normalized_target_visit_date,
            visit_index_from_label(&payload.target_visit_date)?,
            normalized_culture_status,
            if normalized_culture_confirmed { 1 } else { 0 },
            normalized_category,
            normalized_species,
            payload.contact_lens_use,
            serde_json::to_string(&payload.predisposing_factor.unwrap_or_default()).map_err(|error| error.to_string())?,
            serde_json::to_string(&normalized_additional_organisms).map_err(|error| error.to_string())?,
            payload.other_history.unwrap_or_default(),
            normalized_status.clone(),
            if normalized_status == "active" { 1 } else { 0 },
            if payload.is_initial_visit.unwrap_or(false) { 1 } else { 0 },
            payload.smear_result.unwrap_or_else(|| "not done".to_string()).trim().to_string(),
            if normalized_polymicrobial { 1 } else { 0 },
            site_id,
            normalized_patient_id,
            normalized_visit_date
        ],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "
        update images
        set patient_id = ?, visit_date = ?
        where site_id = ? and patient_id = ? and visit_date = ?
        ",
        params![
            normalized_target_patient_id,
            normalized_target_visit_date,
            payload.site_id,
            normalized_patient_id,
            normalized_visit_date
        ],
    )
    .map_err(|error| error.to_string())?;
    if target_changed {
        let source_history_path = case_history_path(
            &payload.site_id,
            &normalized_patient_id,
            &normalized_visit_date,
        )?;
        let target_history_path = case_history_path(
            &payload.site_id,
            &normalized_target_patient_id,
            &normalized_target_visit_date,
        )?;
        if source_history_path.exists() {
            if target_history_path.exists() {
                fs::remove_file(&target_history_path).map_err(|error| error.to_string())?;
            }
            fs::rename(&source_history_path, &target_history_path)
                .map_err(|error| error.to_string())?;
        } else if target_history_path.exists() {
            fs::remove_file(&target_history_path).map_err(|error| error.to_string())?;
        }
        if normalized_target_patient_id != normalized_patient_id {
            let _ = delete_patient_if_empty(&conn, &payload.site_id, &normalized_patient_id)?;
        }
    }
    get_visit(
        &conn,
        &payload.site_id,
        &normalized_target_patient_id,
        &normalized_target_visit_date,
    )?
    .ok_or_else(|| {
        format!(
            "Visit {normalized_target_patient_id} / {normalized_target_visit_date} does not exist."
        )
    })
}
