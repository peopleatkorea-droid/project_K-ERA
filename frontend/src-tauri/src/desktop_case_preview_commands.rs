#[tauri::command]
pub(super) fn fetch_site_job(payload: SiteJobCommandRequest) -> Result<JsonValue, String> {
    fetch_site_job_command(payload)
}

#[tauri::command]
pub(super) fn start_site_job_event_stream(
    app: AppHandle,
    payload: SiteJobCommandRequest,
) -> Result<(), String> {
    start_site_job_event_stream_command(app, payload)
}

#[tauri::command]
pub(super) async fn fetch_case_roi_preview(payload: CasePreviewCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("fetch_case_roi_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::GET,
            &format!("/api/sites/{site_id}/cases/roi-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            vec![
                (
                    "patient_id",
                    request_payload
                        .get("patient_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "visit_date",
                    request_payload
                        .get("visit_date")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
            ],
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn fetch_case_lesion_preview(
    payload: CasePreviewCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("fetch_case_lesion_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::GET,
            &format!("/api/sites/{site_id}/cases/lesion-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            vec![
                (
                    "patient_id",
                    request_payload
                        .get("patient_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "visit_date",
                    request_payload
                        .get("visit_date")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
            ],
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn start_live_lesion_preview(
    payload: LiveLesionPreviewStartCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let token = payload.token;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "image_id": image_id.clone(),
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("start_live_lesion_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/images/{image_id}/lesion-live-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn fetch_live_lesion_preview_job(
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<JsonValue, String> {
    fetch_live_lesion_preview_job_command(payload).await
}

#[tauri::command]
pub(super) fn start_live_lesion_preview_event_stream(
    app: AppHandle,
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<(), String> {
    start_live_lesion_preview_event_stream_command(app, payload)
}

#[tauri::command]
pub(super) fn fetch_image_semantic_prompt_scores(
    payload: SemanticPromptCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "image_id": image_id,
        "top_k": payload.top_k.unwrap_or(3),
        "input_mode": payload
            .input_mode
            .unwrap_or_else(|| "source".to_string()),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_image_semantic_prompt_scores", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!(
            "/api/sites/{}/images/{}/semantic-prompts",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("image_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        vec![
            (
                "top_k",
                request_payload
                    .get("top_k")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(3)
                    .to_string(),
            ),
            (
                "input_mode",
                request_payload
                    .get("input_mode")
                    .and_then(|value| value.as_str())
                    .unwrap_or("source")
                    .to_string(),
            ),
        ],
        None,
    )
}

