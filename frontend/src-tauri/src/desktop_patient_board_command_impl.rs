#[tauri::command]
pub(super) fn list_patient_board(payload: ListPatientBoardRequest) -> Result<PatientListPageResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }

    let page_size = payload.page_size.unwrap_or(25).clamp(1, 100);
    let page = payload.page.unwrap_or(1).max(1);
    let conn = open_data_plane_db()?;

    let (patient_ids, case_counts, total_count, safe_page) =
        query_patient_board_page_ids(&conn, &payload, &site_id, page, page_size)?;
    let total_pages = total_count.max(1).div_ceil(page_size);

    if patient_ids.is_empty() {
        return Ok(PatientListPageResponse {
            items: Vec::new(),
            page: safe_page,
            page_size,
            total_count,
            total_pages: total_pages.max(1),
        });
    }

    let cases_by_patient = query_patient_board_cases(&conn, &site_id, &patient_ids)?;
    let items = build_patient_board_items(&site_id, patient_ids, &case_counts, cases_by_patient)?;

    Ok(PatientListPageResponse {
        items,
        page: safe_page,
        page_size,
        total_count,
        total_pages: total_pages.max(1),
    })
}
