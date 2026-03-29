#[tauri::command]
pub(super) fn run_initial_training(payload: InitialTrainingCommandRequest) -> Result<JsonValue, String> {
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
        "epochs": payload.epochs.unwrap_or(30),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "test_split": payload.test_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
        "pretraining_source": payload.pretraining_source,
        "ssl_checkpoint_path": payload.ssl_checkpoint_path,
        "regenerate_split": payload.regenerate_split.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_initial_training", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/initial"),
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
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "test_split": request_payload.get("test_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
            "pretraining_source": request_payload.get("pretraining_source").cloned().unwrap_or(JsonValue::Null),
            "ssl_checkpoint_path": request_payload.get("ssl_checkpoint_path").cloned().unwrap_or(JsonValue::Null),
            "regenerate_split": request_payload.get("regenerate_split").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
pub(super) fn run_initial_training_benchmark(
    payload: InitialTrainingBenchmarkCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "architectures": payload.architectures,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "case_aggregation": payload.case_aggregation.unwrap_or_else(|| "mean".to_string()),
        "epochs": payload.epochs.unwrap_or(30),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "test_split": payload.test_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
        "pretraining_source": payload.pretraining_source,
        "ssl_checkpoint_path": payload.ssl_checkpoint_path,
        "benchmark_suite_key": payload.benchmark_suite_key,
        "regenerate_split": payload.regenerate_split.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_initial_training_benchmark", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/initial/benchmark"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "architectures": request_payload.get("architectures").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "case_aggregation": request_payload.get("case_aggregation").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "test_split": request_payload.get("test_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
            "pretraining_source": request_payload.get("pretraining_source").cloned().unwrap_or(JsonValue::Null),
            "ssl_checkpoint_path": request_payload.get("ssl_checkpoint_path").cloned().unwrap_or(JsonValue::Null),
            "benchmark_suite_key": request_payload.get("benchmark_suite_key").cloned().unwrap_or(JsonValue::Null),
            "regenerate_split": request_payload.get("regenerate_split").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
pub(super) fn resume_initial_training_benchmark(
    payload: ResumeInitialTrainingBenchmarkCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "job_id": job_id,
        "execution_mode": payload.execution_mode,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("resume_initial_training_benchmark", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!(
            "/api/sites/{}/training/initial/benchmark/resume",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "job_id": request_payload.get("job_id").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
pub(super) fn run_retrieval_baseline(payload: RetrievalBaselineCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "top_k": payload.top_k.unwrap_or(10),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_retrieval_baseline", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/retrieval-baseline"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "top_k": request_payload.get("top_k").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}
