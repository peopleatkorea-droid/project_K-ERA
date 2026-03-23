#[tauri::command]
pub(super) fn create_patient(payload: CreatePatientRequest) -> Result<PatientRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let conn = open_data_plane_db()?;
    if get_patient(&conn, &site_id, &normalized_patient_id)?.is_some() {
        return Err(format!("Patient {normalized_patient_id} already exists."));
    }
    let record = PatientRecord {
        patient_id: normalized_patient_id.clone(),
        created_by_user_id: payload
            .user_id
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        sex: payload.sex,
        age: payload.age,
        chart_alias: payload.chart_alias.unwrap_or_default().trim().to_string(),
        local_case_code: payload
            .local_case_code
            .unwrap_or_default()
            .trim()
            .to_string(),
        created_at: Some(utc_now()),
    };
    conn.execute(
        "
        insert into patients (site_id, patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            site_id,
            record.patient_id,
            record.created_by_user_id,
            record.sex,
            record.age,
            record.chart_alias,
            record.local_case_code,
            record.created_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(record)
}

#[tauri::command]
pub(super) fn update_patient(payload: UpdatePatientRequest) -> Result<PatientRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let auth = MutationAuth {
        user_id: payload.user_id.clone(),
        user_role: payload.user_role.clone(),
    };
    let conn = open_data_plane_db()?;
    let existing = get_patient(&conn, &site_id, &normalized_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_patient_id} does not exist."))?;
    require_record_owner(
        &auth,
        existing.created_by_user_id.as_deref(),
        "Only the creator or a site admin can modify this patient.",
    )?;
    conn.execute(
        "
        update patients
        set sex = ?, age = ?, chart_alias = ?, local_case_code = ?
        where site_id = ? and patient_id = ?
        ",
        params![
            payload.sex,
            payload.age,
            payload.chart_alias.unwrap_or_default().trim().to_string(),
            payload
                .local_case_code
                .unwrap_or_default()
                .trim()
                .to_string(),
            site_id,
            normalized_patient_id
        ],
    )
    .map_err(|error| error.to_string())?;
    get_patient(&conn, &site_id, &normalized_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_patient_id} does not exist."))
}
