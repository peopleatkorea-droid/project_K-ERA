pub(super) fn patient_record_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<PatientRecord> {
    Ok(PatientRecord {
        patient_id: row.get("patient_id")?,
        created_by_user_id: row.get("created_by_user_id")?,
        sex: row.get::<_, Option<String>>("sex")?.unwrap_or_default(),
        age: row.get::<_, i64>("age")?,
        chart_alias: row
            .get::<_, Option<String>>("chart_alias")?
            .unwrap_or_default(),
        local_case_code: row
            .get::<_, Option<String>>("local_case_code")?
            .unwrap_or_default(),
        created_at: row.get("created_at")?,
    })
}

pub(super) fn visit_record_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<VisitRecord> {
    let additional_organisms =
        parse_organism_array(row.get::<_, Option<String>>("additional_organisms")?);
    let predisposing_factor =
        parse_json_string_array(row.get::<_, Option<String>>("predisposing_factor")?);
    let visit_status = row
        .get::<_, Option<String>>("visit_status")?
        .unwrap_or_else(|| "active".to_string());
    Ok(VisitRecord {
        visit_id: row.get("visit_id")?,
        patient_id: row.get("patient_id")?,
        created_by_user_id: row.get("created_by_user_id")?,
        visit_date: row.get("visit_date")?,
        actual_visit_date: row.get("actual_visit_date")?,
        culture_confirmed: row.get::<_, Option<i64>>("culture_confirmed")?.unwrap_or(1) != 0,
        culture_category: row
            .get::<_, Option<String>>("culture_category")?
            .unwrap_or_default(),
        culture_species: row
            .get::<_, Option<String>>("culture_species")?
            .unwrap_or_default(),
        additional_organisms,
        contact_lens_use: row
            .get::<_, Option<String>>("contact_lens_use")?
            .unwrap_or_default(),
        predisposing_factor,
        other_history: row
            .get::<_, Option<String>>("other_history")?
            .unwrap_or_default(),
        visit_status: visit_status.clone(),
        active_stage: row
            .get::<_, Option<i64>>("active_stage")?
            .map(|value| value != 0)
            .unwrap_or_else(|| visit_status == "active"),
        is_initial_visit: row.get::<_, Option<i64>>("is_initial_visit")?.unwrap_or(0) != 0,
        smear_result: row
            .get::<_, Option<String>>("smear_result")?
            .unwrap_or_default(),
        polymicrobial: row.get::<_, Option<i64>>("polymicrobial")?.unwrap_or(0) != 0,
        created_at: row
            .get::<_, Option<String>>("created_at")?
            .unwrap_or_default(),
    })
}
