#[tauri::command]
pub(super) async fn run_case_ai_clinic(payload: CaseAiClinicCommandRequest) -> Result<JsonValue, String> {
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
    let top_k = payload.top_k.unwrap_or(3);
    let retrieval_backend = payload
        .retrieval_backend
        .unwrap_or_else(|| "standard".to_string());
    let retrieval_profile = payload
        .retrieval_profile
        .unwrap_or_else(|| "dinov2_lesion_crop".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "top_k": top_k,
            "retrieval_backend": retrieval_backend,
            "retrieval_profile": retrieval_profile,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_ai_clinic", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/ai-clinic"),
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
                "top_k": request_payload.get("top_k").cloned().unwrap_or(JsonValue::Null),
                "retrieval_backend": request_payload.get("retrieval_backend").cloned().unwrap_or(JsonValue::Null),
                "retrieval_profile": request_payload.get("retrieval_profile").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn run_case_ai_clinic_similar_cases(
    payload: CaseAiClinicCommandRequest,
) -> Result<JsonValue, String> {
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
    let top_k = payload.top_k.unwrap_or(3);
    let retrieval_backend = payload
        .retrieval_backend
        .unwrap_or_else(|| "standard".to_string());
    let retrieval_profile = payload
        .retrieval_profile
        .unwrap_or_else(|| "dinov2_lesion_crop".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "top_k": top_k,
            "retrieval_backend": retrieval_backend,
            "retrieval_profile": retrieval_profile,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_ai_clinic_similar_cases", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/ai-clinic/similar-cases"),
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
                "top_k": request_payload.get("top_k").cloned().unwrap_or(JsonValue::Null),
                "retrieval_backend": request_payload.get("retrieval_backend").cloned().unwrap_or(JsonValue::Null),
                "retrieval_profile": request_payload.get("retrieval_profile").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) fn run_case_contribution(payload: CaseContributionCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "patient_id": payload.patient_id,
        "visit_date": payload.visit_date,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "model_version_id": payload.model_version_id,
        "model_version_ids": payload.model_version_ids,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_case_contribution", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/cases/contribute"),
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
        })),
    )
}
