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
