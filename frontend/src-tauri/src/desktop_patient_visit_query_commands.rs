#[tauri::command]
pub(super) fn list_patients(payload: ListPatientsRequest) -> Result<Vec<PatientRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let mut sql = "
      select patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at
      from patients
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id)];
    if let Some(created_by_user_id) = payload
        .created_by_user_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and created_by_user_id = ?");
        params.push(Value::Text(created_by_user_id.to_string()));
    }
    sql.push_str(" order by created_at desc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), patient_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut patients = Vec::new();
    for row in rows {
        patients.push(row.map_err(|error| error.to_string())?);
    }
    Ok(patients)
}

#[tauri::command]
pub(super) fn lookup_patient_id(payload: PatientLookupRequest) -> Result<PatientIdLookupResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let requested_patient_id = payload.patient_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&requested_patient_id)?;
    let conn = open_data_plane_db()?;
    let patient = get_patient(&conn, &site_id, &normalized_patient_id)?;
    let visit_count = conn
        .query_row(
            "select count(*) from visits where site_id = ? and patient_id = ?",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let image_count = conn
        .query_row(
            "select count(*) from images where site_id = ? and patient_id = ?",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let latest_visit_date = conn
        .query_row(
            "
            select visit_date
            from visits
            where site_id = ? and patient_id = ?
            order by visit_index desc, visit_date desc
            limit 1
            ",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();

    Ok(PatientIdLookupResponse {
        requested_patient_id,
        normalized_patient_id,
        exists: patient.is_some(),
        patient,
        visit_count,
        image_count,
        latest_visit_date,
    })
}

#[tauri::command]
pub(super) fn list_visits(payload: ListVisitsRequest) -> Result<Vec<VisitRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let mut sql = "
      select
        visit_id,
        patient_id,
        created_by_user_id,
        visit_date,
        actual_visit_date,
        culture_confirmed,
        culture_category,
        culture_species,
        additional_organisms,
        contact_lens_use,
        predisposing_factor,
        other_history,
        visit_status,
        active_stage,
        is_initial_visit,
        smear_result,
        polymicrobial,
        created_at
      from visits
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id)];
    if let Some(patient_id) = payload
        .patient_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and patient_id = ?");
        params.push(Value::Text(normalize_patient_pseudonym(patient_id)?));
    }
    sql.push_str(" order by patient_id asc, visit_index asc, visit_date asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), visit_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut visits = Vec::new();
    for row in rows {
        visits.push(row.map_err(|error| error.to_string())?);
    }
    Ok(visits)
}
