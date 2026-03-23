fn load_recent_validations(
    conn: &Connection,
    site_id: &str,
) -> Result<Vec<SiteActivityValidationRecord>, String> {
    let mut validation_rows = conn
        .prepare(
            "
        select summary_json
        from validation_runs
        where site_id = ?
        order by run_date desc
        ",
        )
        .map_err(|error| error.to_string())?;
    let validation_payloads = validation_rows
        .query_map(params![site_id], |row| row.get::<_, Option<String>>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(validation_payloads
        .into_iter()
        .take(5)
        .map(|raw| {
            let payload = parse_json_value(raw, json!({}));
            SiteActivityValidationRecord {
                validation_id: json_string_field(&payload, "validation_id").unwrap_or_default(),
                run_date: json_string_field(&payload, "run_date").unwrap_or_default(),
                model_version: json_string_field(&payload, "model_version").unwrap_or_default(),
                model_architecture: json_string_field(&payload, "model_architecture")
                    .unwrap_or_default(),
                n_cases: json_i64_field(&payload, "n_cases").unwrap_or(0),
                n_images: json_i64_field(&payload, "n_images").unwrap_or(0),
                accuracy: json_f64_field(&payload, "accuracy"),
                auroc: json_f64_field(&payload, "AUROC"),
                site_id: json_string_field(&payload, "site_id")
                    .unwrap_or_else(|| site_id.to_string()),
            }
        })
        .collect())
}

fn load_updates_by_id(
    conn: &Connection,
    site_id: &str,
) -> Result<HashMap<String, (JsonValue, String)>, String> {
    let mut update_stmt = conn
        .prepare(
            "
        select payload_json, update_id, status
        from model_updates
        where site_id = ?
        order by created_at desc
        ",
        )
        .map_err(|error| error.to_string())?;
    let update_rows = update_stmt
        .query_map(params![site_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut updates_by_id = HashMap::new();
    for (raw_payload, update_id, status) in update_rows {
        let payload = parse_json_value(raw_payload, json!({}));
        let normalized_update_id = json_string_field(&payload, "update_id")
            .or(update_id)
            .unwrap_or_default();
        if normalized_update_id.is_empty() {
            continue;
        }
        let normalized_status = json_string_field(&payload, "status")
            .or(status)
            .unwrap_or_default();
        updates_by_id.insert(normalized_update_id, (payload, normalized_status));
    }
    Ok(updates_by_id)
}

fn load_contribution_payloads(conn: &Connection, site_id: &str) -> Result<Vec<JsonValue>, String> {
    let mut contribution_stmt = conn
        .prepare(
            "
        select payload_json, contribution_id, user_id, created_at
        from contributions
        where site_id = ?
        order by created_at desc
        ",
        )
        .map_err(|error| error.to_string())?;
    let contribution_rows = contribution_stmt
        .query_map(params![site_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(contribution_rows
        .into_iter()
        .map(|(raw_payload, contribution_id, user_id, created_at)| {
            let mut payload = parse_json_value(raw_payload, json!({}));
            if let JsonValue::Object(ref mut map) = payload {
                if !map.contains_key("contribution_id") {
                    if let Some(value) = contribution_id {
                        map.insert("contribution_id".to_string(), JsonValue::String(value));
                    }
                }
                if !map.contains_key("user_id") {
                    if let Some(value) = user_id {
                        map.insert("user_id".to_string(), JsonValue::String(value));
                    }
                }
                if !map.contains_key("created_at") {
                    if let Some(value) = created_at {
                        map.insert("created_at".to_string(), JsonValue::String(value));
                    }
                }
            }
            payload
        })
        .collect())
}
