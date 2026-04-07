pub(super) fn case_summary_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CaseSummaryRecord> {
    let patient_id: String = row.get("patient_id")?;
    let visit_date: String = row.get("visit_date")?;
    let additional_organisms =
        parse_json_array(row.get::<_, Option<String>>("additional_organisms")?);
    let predisposing_factor =
        parse_json_array(row.get::<_, Option<String>>("predisposing_factor")?);
    let stored_active_stage = row
        .get::<_, Option<i64>>("active_stage")?
        .map(|value| value != 0);
    let visit_status = normalize_visit_status(
        row.get::<_, Option<String>>("visit_status")?.as_deref(),
        stored_active_stage.unwrap_or(true),
    );
    let research_registry_status = row
        .get::<_, Option<String>>("research_registry_status")?
        .unwrap_or_else(|| "analysis_only".to_string());
    let active_stage = stored_active_stage.unwrap_or_else(|| visit_status == "active");
    let stored_culture_confirmed = row.get::<_, Option<i64>>("culture_confirmed")?.unwrap_or(0) != 0;
    let culture_status = normalize_culture_status(
        row.get::<_, Option<String>>("culture_status")?.as_deref(),
        stored_culture_confirmed,
    );
    let polymicrobial = row.get::<_, Option<i64>>("polymicrobial")?.unwrap_or(0) != 0
        || !additional_organisms.is_empty();

    Ok(CaseSummaryRecord {
        case_id: format!("{patient_id}::{visit_date}"),
        visit_id: row.get("visit_id")?,
        patient_id,
        patient_reference_id: row.get("patient_reference_id")?,
        visit_date,
        visit_index: row.get("visit_index")?,
        actual_visit_date: row.get("actual_visit_date")?,
        chart_alias: row
            .get::<_, Option<String>>("chart_alias")?
            .unwrap_or_default(),
        local_case_code: row
            .get::<_, Option<String>>("local_case_code")?
            .unwrap_or_default(),
        sex: row.get::<_, Option<String>>("sex")?.unwrap_or_default(),
        age: row.get("age")?,
        culture_status: culture_status.clone(),
        culture_confirmed: culture_status == "positive",
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
        visit_status,
        active_stage,
        is_initial_visit: row.get::<_, Option<i64>>("is_initial_visit")?.unwrap_or(0) != 0,
        smear_result: row
            .get::<_, Option<String>>("smear_result")?
            .unwrap_or_default(),
        polymicrobial,
        research_registry_status,
        research_registry_updated_at: row.get("research_registry_updated_at")?,
        research_registry_updated_by: row.get("research_registry_updated_by")?,
        research_registry_source: row.get("research_registry_source")?,
        image_count: row.get::<_, i64>("image_count")?,
        representative_image_id: row.get("representative_image_id")?,
        representative_view: row.get("representative_view")?,
        created_by_user_id: row.get("created_by_user_id")?,
        created_at: row.get("created_at")?,
        latest_image_uploaded_at: row.get("latest_image_uploaded_at")?,
    })
}

pub(super) fn desktop_image_record_from_row(
    row: &rusqlite::Row<'_>,
    site_id: &str,
    preview_max_side: Option<u32>,
) -> Result<(DesktopImageRecord, Option<WarmPreviewJob>), String> {
    let image_id = row
        .get::<_, String>("image_id")
        .map_err(|error| error.to_string())?;
    let stored_image_path = row
        .get::<_, String>("image_path")
        .map_err(|error| error.to_string())?;
    let source_path = resolve_site_runtime_path(site_id, &stored_image_path)?;
    let content_path = existing_file_path_string(&source_path);
    let mut warm_preview_job = None;
    let preview_path = preview_max_side
        .and_then(
            |max_side| match cached_preview_file_path(site_id, &image_id, max_side) {
                Ok(Some(path)) => Some(path),
                Ok(None) => {
                    warm_preview_job =
                        maybe_queue_preview_job(site_id, &image_id, &source_path, max_side);
                    None
                }
                Err(_) => None,
            },
        )
        .or_else(|| content_path.clone());

    Ok((
        DesktopImageRecord {
            image_id,
            visit_id: row
                .get::<_, String>("visit_id")
                .map_err(|error| error.to_string())?,
            patient_id: row
                .get::<_, String>("patient_id")
                .map_err(|error| error.to_string())?,
            visit_date: row
                .get::<_, String>("visit_date")
                .map_err(|error| error.to_string())?,
            view: row
                .get::<_, Option<String>>("view")
                .map_err(|error| error.to_string())?
                .unwrap_or_else(|| "white".to_string()),
            image_path: source_path.to_string_lossy().to_string(),
            is_representative: row
                .get::<_, Option<i64>>("is_representative")
                .map_err(|error| error.to_string())?
                .unwrap_or(0)
                != 0,
            content_url: None,
            preview_url: None,
            content_path,
            preview_path,
            lesion_prompt_box: match parse_json_value(
                row.get::<_, Option<String>>("lesion_prompt_box")
                    .map_err(|error| error.to_string())?,
                JsonValue::Null,
            ) {
                JsonValue::Null => None,
                value => Some(value),
            },
            uploaded_at: row
                .get::<_, Option<String>>("uploaded_at")
                .map_err(|error| error.to_string())?
                .unwrap_or_default(),
            quality_scores: match parse_json_value(
                row.get::<_, Option<String>>("quality_scores")
                    .map_err(|error| error.to_string())?,
                JsonValue::Null,
            ) {
                JsonValue::Null => None,
                value => Some(value),
            },
        },
        warm_preview_job,
    ))
}
