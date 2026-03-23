fn build_recent_contributions(
    contribution_payloads: &[JsonValue],
    alias_map: &HashMap<String, String>,
    updates_by_id: &HashMap<String, (JsonValue, String)>,
) -> Vec<SiteActivityContributionRecord> {
    contribution_payloads
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
        .collect()
}

fn build_contribution_leaderboard(
    site_id: &str,
    current_user_id: Option<&str>,
    contribution_payloads: &[JsonValue],
    alias_map: &HashMap<String, String>,
) -> ContributionLeaderboard {
    let mut contributor_counts: HashMap<String, (i64, Option<String>, Option<String>)> =
        HashMap::new();
    for payload in contribution_payloads {
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
                .map(|current| current == user_id.as_str())
                .unwrap_or(false),
        };
        if entry.rank <= 5 {
            leaderboard.push(entry.clone());
        }
        if entry.is_current_user {
            current_user_entry = Some(entry);
        }
    }

    ContributionLeaderboard {
        scope: "site".to_string(),
        site_id: Some(site_id.to_string()),
        leaderboard,
        current_user: current_user_entry,
    }
}
