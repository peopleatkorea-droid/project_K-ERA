pub(super) fn get_patient(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
) -> Result<Option<PatientRecord>, String> {
    let sql = "
      select patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at
      from patients
      where site_id = ? and patient_id = ?
    ";
    conn.query_row(sql, params![site_id, patient_id], patient_record_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

pub(super) fn get_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Option<VisitRecord>, String> {
    let sql = "
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
      where site_id = ? and patient_id = ? and visit_date = ?
    ";
    conn.query_row(
        sql,
        params![site_id, patient_id, visit_date],
        visit_record_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}

pub(super) fn query_images(
    conn: &Connection,
    site_id: &str,
    patient_id: Option<&str>,
    visit_date: Option<&str>,
    preview_max_side: Option<u32>,
) -> Result<Vec<DesktopImageRecord>, String> {
    let mut sql = "
      select
        image_id,
        visit_id,
        patient_id,
        visit_date,
        view,
        image_path,
        is_representative,
        lesion_prompt_box,
        uploaded_at,
        quality_scores
      from images
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(value) = patient_id {
        sql.push_str(" and patient_id = ?");
        params.push(Value::Text(value.to_string()));
    }
    if let Some(value) = visit_date {
        sql.push_str(" and visit_date = ?");
        params.push(Value::Text(value.to_string()));
    }
    sql.push_str(" order by patient_id asc, visit_date asc, uploaded_at asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut images = Vec::new();
    let mut warm_preview_jobs = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let (image, warm_preview_job) =
            desktop_image_record_from_row(row, site_id, preview_max_side)?;
        if let Some(job) = warm_preview_job {
            warm_preview_jobs.push(job);
        }
        images.push(image);
    }
    queue_preview_generation_batch(warm_preview_jobs);
    Ok(images)
}

pub(super) fn list_images_for_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Vec<DesktopImageRecord>, String> {
    query_images(conn, site_id, Some(patient_id), Some(visit_date), Some(640))
}

pub(super) fn query_case_summaries(
    conn: &Connection,
    site_id: &str,
    created_by_user_id: Option<&str>,
    patient_id: Option<&str>,
) -> Result<Vec<CaseSummaryRecord>, String> {
    let mut sql = "
      with image_stats as (
        select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
        from images
        where site_id = ?
        group by visit_id
      ),
      representative_images as (
        select visit_id, image_id as representative_image_id, view as representative_view
        from images
        where site_id = ? and is_representative = 1
      )
      select
        v.visit_id,
        v.patient_id,
        v.patient_reference_id,
        v.visit_date,
        v.visit_index,
        v.actual_visit_date,
        v.culture_category,
        v.culture_species,
        v.additional_organisms,
        v.contact_lens_use,
        v.predisposing_factor,
        v.other_history,
        v.visit_status,
        v.active_stage,
        v.is_initial_visit,
        v.smear_result,
        v.polymicrobial,
        v.research_registry_status,
        v.research_registry_updated_at,
        v.research_registry_updated_by,
        v.research_registry_source,
        v.created_at,
        p.chart_alias,
        p.local_case_code,
        p.sex,
        p.age,
        p.created_by_user_id,
        coalesce(image_stats.image_count, 0) as image_count,
        image_stats.latest_image_uploaded_at,
        representative_images.representative_image_id,
        representative_images.representative_view
      from visits v
      join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
      left join image_stats on v.visit_id = image_stats.visit_id
      left join representative_images on v.visit_id = representative_images.visit_id
      where v.site_id = ?
    "
    .to_string();
    let mut params = vec![
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
    ];
    if let Some(user_id) = created_by_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and p.created_by_user_id = ?");
        params.push(Value::Text(user_id.to_string()));
    }
    if let Some(patient_id) = patient_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and v.patient_id = ?");
        params.push(Value::Text(patient_id.to_string()));
    }
    sql.push_str(" order by coalesce(v.visit_index, 0) desc, image_stats.latest_image_uploaded_at desc, v.created_at desc");

    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        items.push(case_summary_from_row(row).map_err(|error| error.to_string())?);
    }
    Ok(items)
}

pub(super) fn lookup_public_aliases(
    conn: &Connection,
    user_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let normalized = user_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(normalized.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "select user_id, public_alias from users where user_id in ({placeholders}) and public_alias is not null"
    );
    let params = normalized
        .iter()
        .cloned()
        .map(Value::Text)
        .collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut aliases = HashMap::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let user_id = row
            .get::<_, String>(0)
            .map_err(|error| error.to_string())?
            .trim()
            .to_string();
        let alias = row
            .get::<_, Option<String>>(1)
            .map_err(|error| error.to_string())?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if !user_id.is_empty() {
            if let Some(public_alias) = alias {
                aliases.insert(user_id, public_alias);
            }
        }
    }
    Ok(aliases)
}
