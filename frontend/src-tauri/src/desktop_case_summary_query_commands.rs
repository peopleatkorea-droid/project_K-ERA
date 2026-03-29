#[tauri::command]
pub(super) fn list_cases(payload: ListCasesRequest) -> Result<Vec<CaseSummaryRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = payload
        .patient_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(normalize_patient_pseudonym)
        .transpose()?;
    let conn = open_data_plane_db()?;
    query_case_summaries(
        &conn,
        &site_id,
        payload
            .created_by_user_id
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty()),
        patient_id.as_deref(),
    )
}

#[tauri::command]
pub(super) fn get_site_activity(payload: SiteActivityRequest) -> Result<SiteActivityResponse, String> {
    get_site_activity_response(payload)
}
