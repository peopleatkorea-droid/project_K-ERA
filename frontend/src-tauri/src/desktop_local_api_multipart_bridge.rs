pub(super) fn request_local_api_multipart(
    path: &str,
    token: &str,
    query: Vec<(String, String)>,
    fields: Vec<LocalApiMultipartField>,
    files: Vec<LocalApiMultipartFile>,
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
    let mut form = MultipartForm::new();
    for field in fields {
        let name = field.name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        form = form.text(name, field.value);
    }
    for file in files {
        let field_name = file.field_name.trim().to_string();
        let file_name = file.file_name.trim().to_string();
        if field_name.is_empty() || file_name.is_empty() {
            continue;
        }
        let file_bytes = BASE64_STANDARD
            .decode(&file.data)
            .map_err(|error| format!("Invalid base64 file data for {file_name}: {error}"))?;
        let mut part = MultipartPart::bytes(file_bytes).file_name(file_name.clone());
        let content_type = file
            .content_type
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| mime_type_for_path(Path::new(&file_name)));
        part = part
            .mime_str(&content_type)
            .map_err(|error| format!("Invalid multipart content type: {error}"))?;
        form = form.part(field_name, part);
    }
    let mut request = client.post(&url);
    let normalized_token = token.trim();
    if !normalized_token.is_empty() {
        request = request.bearer_auth(normalized_token);
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    let response = request
        .multipart(form)
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
