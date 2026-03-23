fn query_patient_board_cases(
    conn: &Connection,
    site_id: &str,
    patient_ids: &[String],
) -> Result<HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>>, String> {
    let placeholders = std::iter::repeat("?")
        .take(patient_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let mut case_params = vec![Value::Text(site_id.to_string())];
    for patient_id in patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }
    case_params.push(Value::Text(site_id.to_string()));
    case_params.push(Value::Text(site_id.to_string()));
    case_params.push(Value::Text(site_id.to_string()));
    for patient_id in patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }

    let case_sql = format!(
        "
        with paged_patient_visits as (
          select visit_id from visits
          where site_id = ? and patient_id in ({placeholders})
        ),
        image_stats as (
          select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and visit_id in (select visit_id from paged_patient_visits)
          group by visit_id
        ),
        representative_images as (
          select visit_id, image_id as representative_image_id, view as representative_view, image_path as representative_image_path
          from images
          where site_id = ? and is_representative = 1
            and visit_id in (select visit_id from paged_patient_visits)
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
          representative_images.representative_view,
          representative_images.representative_image_path
        from visits v
        join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
        left join image_stats on v.visit_id = image_stats.visit_id
        left join representative_images on v.visit_id = representative_images.visit_id
        where v.site_id = ? and v.patient_id in ({placeholders})
        order by image_stats.latest_image_uploaded_at desc, v.created_at desc, v.visit_index desc
        "
    );

    let mut cases_by_patient: HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>> =
        HashMap::new();
    let mut stmt = conn.prepare(&case_sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(case_params), |row| {
            let record = case_summary_from_row(row)?;
            let representative_image_path =
                row.get::<_, Option<String>>("representative_image_path")?;
            Ok((record, representative_image_path))
        })
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (record, representative_image_path) = row.map_err(|error| error.to_string())?;
        cases_by_patient
            .entry(record.patient_id.clone())
            .or_default()
            .push((record, representative_image_path));
    }
    Ok(cases_by_patient)
}
