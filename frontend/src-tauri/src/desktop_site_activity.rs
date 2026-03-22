use super::*;

fn json_i64_field(value: &JsonValue, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| {
        item.as_i64()
            .or_else(|| item.as_u64().map(|raw| raw as i64))
    })
}

fn json_f64_field(value: &JsonValue, key: &str) -> Option<f64> {
    value.get(key).and_then(|item| item.as_f64())
}

fn is_pending_model_update_status(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "pending" | "pending_review" | "pending_upload"
    )
}

fn empty_contribution_leaderboard(site_id: &str) -> ContributionLeaderboard {
    ContributionLeaderboard {
        scope: "site".to_string(),
        site_id: Some(site_id.to_string()),
        leaderboard: Vec::new(),
        current_user: None,
    }
}

fn empty_site_activity_response(site_id: &str) -> SiteActivityResponse {
    SiteActivityResponse {
        pending_updates: 0,
        recent_validations: Vec::new(),
        recent_contributions: Vec::new(),
        contribution_leaderboard: Some(empty_contribution_leaderboard(site_id)),
    }
}

pub(super) fn get_site_activity_response(
    payload: SiteActivityRequest,
) -> Result<SiteActivityResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let current_user_id = payload
        .current_user_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let conn = match open_control_plane_db() {
        Ok(connection) => connection,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };

    let mut validation_rows = match conn.prepare(
        "
        select summary_json
        from validation_runs
        where site_id = ?
        order by run_date desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let validation_payloads = validation_rows
        .query_map(params![site_id.clone()], |row| {
            row.get::<_, Option<String>>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let recent_validations = validation_payloads
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
                site_id: json_string_field(&payload, "site_id").unwrap_or_else(|| site_id.clone()),
            }
        })
        .collect::<Vec<_>>();

    let mut update_stmt = match conn.prepare(
        "
        select payload_json, update_id, status
        from model_updates
        where site_id = ?
        order by created_at desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let update_rows = update_stmt
        .query_map(params![site_id.clone()], |row| {
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
    let pending_updates = updates_by_id
        .values()
        .filter(|(_, status)| is_pending_model_update_status(status))
        .count() as i64;

    let mut contribution_stmt = match conn.prepare(
        "
        select payload_json, contribution_id, user_id, created_at
        from contributions
        where site_id = ?
        order by created_at desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let contribution_rows = contribution_stmt
        .query_map(params![site_id.clone()], |row| {
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
    let contribution_payloads = contribution_rows
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
        .collect::<Vec<_>>();

    let contributor_user_ids = contribution_payloads
        .iter()
        .filter_map(|payload| json_string_field(payload, "user_id"))
        .collect::<Vec<_>>();
    let alias_map = lookup_public_aliases(&conn, &contributor_user_ids).unwrap_or_default();

    let recent_contributions = contribution_payloads
        .iter()
        .take(5)
        .map(|payload| {
            let user_id = json_string_field(payload, "user_id").unwrap_or_default();
            let update_id = json_string_field(payload, "update_id").unwrap_or_default();
            let public_alias = json_string_field(payload, "public_alias")
                .or_else(|| alias_map.get(&user_id).cloned());
            let update = updates_by_id.get(&update_id);
            SiteActivityContributionRecord {
                contribution_id: json_string_field(payload, "contribution_id").unwrap_or_default(),
                contribution_group_id: json_string_field(payload, "contribution_group_id"),
                created_at: json_string_field(payload, "created_at").unwrap_or_default(),
                user_id,
                public_alias,
                case_reference_id: json_string_field(payload, "case_reference_id"),
                update_id,
                update_status: update.map(|(item, status)| {
                    json_string_field(item, "status").unwrap_or_else(|| status.clone())
                }),
                upload_type: update.and_then(|(item, _)| json_string_field(item, "upload_type")),
            }
        })
        .collect::<Vec<_>>();

    let mut contributor_counts: HashMap<String, (i64, Option<String>, Option<String>)> =
        HashMap::new();
    for payload in &contribution_payloads {
        let Some(user_id) = json_string_field(payload, "user_id") else {
            continue;
        };
        let created_at = json_string_field(payload, "created_at");
        let payload_alias = json_string_field(payload, "public_alias");
        let entry = contributor_counts.entry(user_id).or_insert((0, None, None));
        entry.0 += 1;
        if let Some(alias) = payload_alias {
            entry.2 = Some(alias);
        }
        if let Some(created_at_value) = created_at {
            if entry
                .1
                .as_ref()
                .map(|current| created_at_value > *current)
                .unwrap_or(true)
            {
                entry.1 = Some(created_at_value);
            }
        }
    }

    let mut ranked = contributor_counts
        .into_iter()
        .map(
            |(user_id, (contribution_count, last_contribution_at, payload_alias))| {
                let public_alias = payload_alias
                    .or_else(|| alias_map.get(&user_id).cloned())
                    .unwrap_or_else(|| "Anonymous member".to_string());
                (
                    user_id,
                    contribution_count,
                    last_contribution_at,
                    public_alias,
                )
            },
        )
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| {
                right
                    .2
                    .clone()
                    .unwrap_or_default()
                    .cmp(&left.2.clone().unwrap_or_default())
            })
            .then_with(|| right.0.cmp(&left.0))
    });

    let mut leaderboard = Vec::new();
    let mut current_user_entry = None;
    for (index, (user_id, contribution_count, last_contribution_at, public_alias)) in
        ranked.into_iter().enumerate()
    {
        let entry = ContributionLeaderboardEntry {
            rank: (index + 1) as i64,
            user_id: user_id.clone(),
            public_alias,
            contribution_count,
            last_contribution_at,
            is_current_user: current_user_id
                .as_deref()
                .map(|current| current == user_id)
                .unwrap_or(false),
        };
        if entry.rank <= 5 {
            leaderboard.push(entry.clone());
        }
        if entry.is_current_user {
            current_user_entry = Some(entry);
        }
    }

    Ok(SiteActivityResponse {
        pending_updates,
        recent_validations,
        recent_contributions,
        contribution_leaderboard: Some(ContributionLeaderboard {
            scope: "site".to_string(),
            site_id: Some(site_id),
            leaderboard,
            current_user: current_user_entry,
        }),
    })
}
