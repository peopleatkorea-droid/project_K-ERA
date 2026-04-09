#[tauri::command]
pub(super) fn create_visit(payload: CreateVisitRequest) -> Result<VisitRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let normalized_visit_date = normalize_visit_label(&payload.visit_date)?;
    let normalized_actual_visit_date =
        normalize_actual_visit_date(payload.actual_visit_date.as_deref())?;
    let conn = open_data_plane_db()?;
    if get_patient(&conn, &site_id, &normalized_patient_id)?.is_none() {
        return Err(format!("Patient {normalized_patient_id} does not exist."));
    }
    if normalized_visit_date == "Initial" {
        let existing_visit_count: i64 = conn
            .query_row(
                "select count(*) from visits where site_id = ? and patient_id = ?",
                params![&site_id, &normalized_patient_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if existing_visit_count > 0 {
            return Err(
                "Existing patients can only receive follow-up visits. Use a FU #N label."
                    .to_string(),
            );
        }
    }
    if get_visit(
        &conn,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .is_some()
    {
        return Err(format!(
            "Visit {normalized_patient_id} / {normalized_visit_date} already exists."
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
    let created_at = utc_now();
    let visit_id = make_id("visit");
    let created_by_user_id = payload
        .user_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    conn.execute(
        "
        insert into visits (
          visit_id, site_id, patient_id, patient_reference_id, created_by_user_id,
          visit_date, visit_index, actual_visit_date, culture_status, culture_confirmed, culture_category, culture_species,
          contact_lens_use, predisposing_factor, additional_organisms, other_history, visit_status,
          active_stage, is_initial_visit, smear_result, polymicrobial,
          research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            visit_id,
            site_id,
            normalized_patient_id,
            make_patient_reference_id(&payload.site_id, &normalized_patient_id),
            created_by_user_id,
            normalized_visit_date,
            visit_index_from_label(&payload.visit_date)?,
            normalized_actual_visit_date,
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
            "analysis_only",
            created_at.clone(),
            payload.user_id,
            "visit_create",
            created_at
        ],
    )
    .map_err(|error| error.to_string())?;
    let created_visit = get_visit(
        &conn,
        &payload.site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .ok_or_else(|| {
        format!("Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
    })?;
    schedule_federated_retrieval_corpus_sync(&site_id, "visit_create");
    Ok(created_visit)
}
