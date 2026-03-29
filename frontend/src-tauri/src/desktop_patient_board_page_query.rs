fn query_patient_board_page_ids(
    conn: &Connection,
    payload: &ListPatientBoardRequest,
    site_id: &str,
    page: u32,
    page_size: u32,
) -> Result<(Vec<String>, HashMap<String, i64>, u32, u32), String> {
    let mine_user_id = payload
        .created_by_user_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let mut ids_params = vec![
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
    ];
    let mine_clause = if let Some(created_by_user_id) = mine_user_id.as_ref() {
        ids_params.push(Value::Text(created_by_user_id.clone()));
        " and p.created_by_user_id = ? ".to_string()
    } else {
        String::new()
    };
    let search_clause = build_search_clause(site_id, &payload.search, &mut ids_params);
    ids_params.push(Value::Text(site_id.to_string()));
    let raw_offset = (page.saturating_sub(1) * page_size) as i64;
    ids_params.push(Value::Integer(page_size as i64));
    ids_params.push(Value::Integer(raw_offset));

    let ids_sql = format!(
        "
        with filtered_visits as (
          select v.visit_id, v.patient_id, v.created_at, v.visit_index
          from patients p
          join visits v on p.site_id = v.site_id and p.patient_id = v.patient_id
          where p.site_id = ? and v.site_id = ?
          {mine_clause}
          {search_clause}
        ),
        image_stats as (
          select visit_id, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and visit_id in (select visit_id from filtered_visits)
          group by visit_id
        ),
        all_patients as (
          select
            fv.patient_id,
            count(fv.visit_id) as case_count,
            max(coalesce(image_stats.latest_image_uploaded_at, '')) as max_upload,
            max(coalesce(fv.created_at, '')) as max_created,
            max(coalesce(fv.visit_index, 0)) as max_visit_index
          from filtered_visits fv
          left join image_stats on fv.visit_id = image_stats.visit_id
          group by fv.patient_id
        )
        select
          patient_id,
          case_count,
          max_upload,
          max_created,
          max_visit_index,
          (select count(*) from all_patients) as total_count
        from all_patients
        order by max_upload desc, max_created desc, max_visit_index desc
        limit ? offset ?
        "
    );

    let mut patient_ids = Vec::new();
    let mut case_counts = HashMap::new();
    let mut total_count: u32 = 0;
    let mut stmt = conn.prepare(&ids_sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(ids_params), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (patient_id, case_count, row_total) = row.map_err(|error| error.to_string())?;
        if total_count == 0 {
            total_count = row_total.max(0) as u32;
        }
        case_counts.insert(patient_id.clone(), case_count);
        patient_ids.push(patient_id);
    }

    let total_pages = total_count.max(1).div_ceil(page_size);
    let safe_page = page.min(total_pages.max(1));
    Ok((patient_ids, case_counts, total_count, safe_page))
}
