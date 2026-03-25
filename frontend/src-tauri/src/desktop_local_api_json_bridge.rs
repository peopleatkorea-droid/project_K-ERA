pub(super) fn request_local_api_json_owned(
    method: HttpMethod,
    path: &str,
    token: &str,
    query: Vec<(String, String)>,
    body: Option<JsonValue>,
    control_plane_owner: Option<String>,
) -> Result<JsonValue, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Local API path is required.".to_string());
    }
    if local_backend_should_be_managed(&local_node_api_base_url()) {
        ensure_local_backend_ready_internal()?;
    }
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("{}{}", local_node_api_base_url(), normalized_path);
    let client = HttpClient::builder()
        .build()
        .map_err(|error| format!("Failed to initialize local API bridge: {error}"))?;
    let mut request = client.request(method, &url);
    let normalized_token = token.trim();
    if !normalized_token.is_empty() {
        request = request.bearer_auth(normalized_token);
    }
    let normalized_owner = control_plane_owner
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(owner) = normalized_owner {
        request = request.header("x-kera-control-plane-owner", owner);
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request
        .send()
        .map_err(|_| "Local API server is unavailable.".to_string())?;
    let status = response.status();
    let body_text = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(local_api_error_detail(&body_text, status.as_u16()));
    }
    serde_json::from_str::<JsonValue>(&body_text)
        .map_err(|error| format!("Invalid JSON response from local API: {error}"))
}

pub(super) fn request_local_api_json(
    method: HttpMethod,
    path: &str,
    token: &str,
    query: Vec<(&str, String)>,
    body: Option<JsonValue>,
) -> Result<JsonValue, String> {
    request_local_api_json_owned(
        method,
        path,
        token,
        query
            .into_iter()
            .map(|(name, value)| (name.to_string(), value))
            .collect(),
        body,
        None,
    )
}
