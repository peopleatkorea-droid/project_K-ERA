#[tauri::command]
pub(super) fn cancel_site_job(payload: CancelSiteJobCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("cancel_site_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!(
            "/api/sites/{}/jobs/{}/cancel",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("job_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
pub(super) fn fetch_cross_validation_reports(
    payload: CrossValidationReportsCommandRequest,
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
        return request_ml_sidecar_json("fetch_cross_validation_reports", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/training/cross-validation"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
pub(super) fn run_cross_validation(payload: CrossValidationCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "architecture": payload.architecture.unwrap_or_else(|| "convnext_tiny".to_string()),
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "case_aggregation": payload.case_aggregation.unwrap_or_else(|| "mean".to_string()),
        "num_folds": payload.num_folds.unwrap_or(5),
        "epochs": payload.epochs.unwrap_or(10),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_cross_validation", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/cross-validation"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "architecture": request_payload.get("architecture").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "case_aggregation": request_payload.get("case_aggregation").cloned().unwrap_or(JsonValue::Null),
            "num_folds": request_payload.get("num_folds").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
pub(super) fn run_ssl_pretraining(payload: SSLPretrainingCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let archive_base_dir = payload
        .archive_base_dir
        .unwrap_or_default()
        .trim()
        .to_string();
    if archive_base_dir.is_empty() {
        return Err("archive_base_dir is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "archive_base_dir": archive_base_dir,
        "architecture": payload.architecture.unwrap_or_else(|| "convnext_tiny".to_string()),
        "init_mode": payload.init_mode.unwrap_or_else(|| "imagenet".to_string()),
        "method": payload.method.unwrap_or_else(|| "byol".to_string()),
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "image_size": payload.image_size.unwrap_or(224),
        "batch_size": payload.batch_size.unwrap_or(24),
        "epochs": payload.epochs.unwrap_or(10),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "weight_decay": payload.weight_decay.unwrap_or(1e-4),
        "num_workers": payload.num_workers.unwrap_or(8),
        "min_patient_quality": payload.min_patient_quality.unwrap_or_else(|| "medium".to_string()),
        "include_review_rows": payload.include_review_rows.unwrap_or(false),
        "use_amp": payload.use_amp.unwrap_or(true),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_ssl_pretraining", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/ssl"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "archive_base_dir": request_payload.get("archive_base_dir").cloned().unwrap_or(JsonValue::Null),
            "architecture": request_payload.get("architecture").cloned().unwrap_or(JsonValue::Null),
            "init_mode": request_payload.get("init_mode").cloned().unwrap_or(JsonValue::Null),
            "method": request_payload.get("method").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "image_size": request_payload.get("image_size").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "weight_decay": request_payload.get("weight_decay").cloned().unwrap_or(JsonValue::Null),
            "num_workers": request_payload.get("num_workers").cloned().unwrap_or(JsonValue::Null),
            "min_patient_quality": request_payload.get("min_patient_quality").cloned().unwrap_or(JsonValue::Null),
            "include_review_rows": request_payload.get("include_review_rows").cloned().unwrap_or(JsonValue::Null),
            "use_amp": request_payload.get("use_amp").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
pub(super) fn fetch_ai_clinic_embedding_status(
    payload: AiClinicEmbeddingStatusCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let model_version_id = payload
        .model_version_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "model_version_id": model_version_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_ai_clinic_embedding_status", request_payload);
    }
    let mut query = Vec::new();
    if let Some(model_version_id) = request_payload
        .get("model_version_id")
        .and_then(|value| value.as_str())
    {
        query.push(("model_version_id", model_version_id.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/ai-clinic/embeddings/status"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
pub(super) fn backfill_ai_clinic_embeddings(
    payload: EmbeddingBackfillCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "model_version_id": payload.model_version_id,
        "force_refresh": payload.force_refresh.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("backfill_ai_clinic_embeddings", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/ai-clinic/embeddings/backfill"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
            "force_refresh": request_payload.get("force_refresh").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}
