#[tauri::command]
pub(super) async fn request_local_json(payload: LocalApiJsonCommandRequest) -> Result<JsonValue, String> {
    let method = normalize_http_method(payload.method.as_deref())?;
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let body = payload.body;
    let control_plane_owner = payload.control_plane_owner;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_json_owned(method, &path, &token, query, body, control_plane_owner)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn request_local_binary(
    payload: LocalApiJsonCommandRequest,
) -> Result<ImageBinaryResponse, String> {
    let method = normalize_http_method(payload.method.as_deref())?;
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let body = payload.body;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_binary_owned(method, &path, &token, query, body)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn request_local_multipart(payload: LocalApiMultipartCommandRequest) -> Result<JsonValue, String> {
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let fields = payload.fields.unwrap_or_default();
    let files = payload.files;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_multipart(&path, &token, query, fields, files)
    })
    .await
    .map_err(|error| error.to_string())?
}
