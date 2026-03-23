#[tauri::command]
pub(super) fn fetch_site_validations(payload: SiteValidationsCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let limit = payload.limit.filter(|value| *value > 0);
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "limit": limit,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_validations", request_payload);
    }
    let mut query = Vec::new();
    if let Some(limit) = request_payload.get("limit").and_then(|value| value.as_i64()) {
        query.push(("limit", limit.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/validations"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
pub(super) fn fetch_validation_cases(payload: ValidationCasesCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    if site_id.is_empty() || validation_id.is_empty() {
        return Err("site_id and validation_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "validation_id": validation_id,
        "misclassified_only": payload.misclassified_only.unwrap_or(false),
        "limit": payload.limit,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_validation_cases", request_payload);
    }
    let mut query = Vec::new();
    if request_payload
        .get("misclassified_only")
        .and_then(|value| value.as_bool())
        == Some(true)
    {
        query.push(("misclassified_only", "true".to_string()));
    }
    if let Some(limit) = request_payload.get("limit").and_then(|value| value.as_i64()) {
        query.push(("limit", limit.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!(
            "/api/sites/{}/validations/{}/cases",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("validation_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
pub(super) fn fetch_site_model_versions(
    payload: SiteModelVersionsCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_model_versions", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/model-versions"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
pub(super) fn run_site_validation(payload: SiteValidationRunCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "generate_gradcam": payload.generate_gradcam.unwrap_or(true),
        "generate_medsam": payload.generate_medsam.unwrap_or(true),
        "model_version_id": payload.model_version_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_site_validation", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/validations/run"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
            "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

