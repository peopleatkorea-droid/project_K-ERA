pub(super) fn parse_json_value(raw: Option<String>, fallback: JsonValue) -> JsonValue {
    raw.and_then(|value| serde_json::from_str::<JsonValue>(&value).ok())
        .unwrap_or(fallback)
}

pub(super) fn has_site_wide_write_access(auth: &MutationAuth) -> bool {
    matches!(
        auth.user_role
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(role) if role == "admin" || role == "site_admin"
    )
}

pub(super) fn require_record_owner(
    auth: &MutationAuth,
    owner_user_id: Option<&str>,
    detail: &str,
) -> Result<(), String> {
    if has_site_wide_write_access(auth) {
        return Ok(());
    }
    let current_user_id = auth
        .user_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let owner = owner_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    if owner.is_some() && owner == current_user_id {
        return Ok(());
    }
    Err(detail.to_string())
}

pub(super) fn json_string_field(value: &JsonValue, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}
