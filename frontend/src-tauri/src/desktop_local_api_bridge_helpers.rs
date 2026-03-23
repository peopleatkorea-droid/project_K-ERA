fn local_api_error_detail(body: &str, status_code: u16) -> String {
    if let Ok(payload) = serde_json::from_str::<JsonValue>(body) {
        if let Some(detail) = payload.get("detail") {
            if let Some(text) = detail.as_str() {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    return normalized.to_string();
                }
            }
            if detail.is_array() || detail.is_object() {
                return detail.to_string();
            }
        }
    }
    let normalized = body.trim();
    if normalized.is_empty() {
        format!("Local API request failed ({status_code}).")
    } else {
        normalized.to_string()
    }
}

pub(super) fn normalize_http_method(method: Option<&str>) -> Result<HttpMethod, String> {
    let normalized = method.unwrap_or("GET").trim().to_ascii_uppercase();
    match normalized.as_str() {
        "GET" => Ok(HttpMethod::GET),
        "POST" => Ok(HttpMethod::POST),
        "PATCH" => Ok(HttpMethod::PATCH),
        "PUT" => Ok(HttpMethod::PUT),
        "DELETE" => Ok(HttpMethod::DELETE),
        _ => Err(format!("Unsupported local API method: {normalized}")),
    }
}

pub(super) fn normalize_local_api_query(
    query: Option<Vec<LocalApiQueryParam>>,
) -> Vec<(String, String)> {
    query
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let name = item.name.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some((name, item.value))
        })
        .collect()
}
