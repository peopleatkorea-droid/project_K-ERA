#[tauri::command]
pub(super) async fn run_case_validation(payload: CaseValidationCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let model_version_id = payload.model_version_id;
    let model_version_ids = payload.model_version_ids;
    let selection_profile = payload.selection_profile;
    let generate_gradcam = payload.generate_gradcam.unwrap_or(true);
    let generate_medsam = payload.generate_medsam.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "selection_profile": selection_profile,
            "generate_gradcam": generate_gradcam,
            "generate_medsam": generate_medsam,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_validation", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/validate"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "selection_profile": request_payload.get("selection_profile").cloned().unwrap_or(JsonValue::Null),
                "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
                "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn run_case_validation_compare(
    payload: CaseValidationCompareCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let model_version_ids = payload.model_version_ids;
    let selection_profile = payload.selection_profile;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let generate_gradcam = payload.generate_gradcam.unwrap_or(false);
    let generate_medsam = payload.generate_medsam.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_ids": model_version_ids,
            "selection_profile": selection_profile,
            "execution_mode": execution_mode,
            "generate_gradcam": generate_gradcam,
            "generate_medsam": generate_medsam,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_validation_compare", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/validate/compare"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "selection_profile": request_payload.get("selection_profile").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
                "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
