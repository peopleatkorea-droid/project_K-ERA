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

    let recent_validations = match load_recent_validations(&conn, &site_id) {
        Ok(items) => items,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let updates_by_id = match load_updates_by_id(&conn, &site_id) {
        Ok(items) => items,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let contribution_payloads = match load_contribution_payloads(&conn, &site_id) {
        Ok(items) => items,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };

    let contributor_user_ids = contribution_payloads
        .iter()
        .filter_map(|payload| json_string_field(payload, "user_id"))
        .collect::<Vec<_>>();
    let alias_map = lookup_public_aliases(&conn, &contributor_user_ids).unwrap_or_default();

    let pending_updates = updates_by_id
        .values()
        .filter(|(_, status)| is_pending_model_update_status(status))
        .count() as i64;
    let recent_contributions =
        build_recent_contributions(&contribution_payloads, &alias_map, &updates_by_id);
    let contribution_leaderboard = build_contribution_leaderboard(
        &site_id,
        current_user_id.as_deref(),
        &contribution_payloads,
        &alias_map,
    );

    Ok(SiteActivityResponse {
        pending_updates,
        recent_validations,
        recent_contributions,
        contribution_leaderboard: Some(contribution_leaderboard),
    })
}
