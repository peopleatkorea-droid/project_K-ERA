use super::*;

fn is_active_site_job_status(status: &str) -> bool {
    matches!(
        status.trim().to_lowercase().as_str(),
        "queued" | "running" | "cancelling"
    )
}

fn fetch_site_job_response(site_id: &str, token: &str, job_id: &str) -> Result<JsonValue, String> {
    let request_payload = json!({
        "site_id": site_id,
        "token": token,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/jobs/{job_id}"),
        token,
        Vec::new(),
        None,
    )
}

fn list_site_jobs_response(
    site_id: &str,
    token: &str,
    job_type: Option<&str>,
    status: Option<&str>,
    limit: Option<i64>,
) -> Result<JsonValue, String> {
    let request_payload = json!({
        "site_id": site_id,
        "token": token,
        "job_type": job_type,
        "status": status,
        "limit": limit,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("list_site_jobs", request_payload);
    }
    let mut query = Vec::new();
    if let Some(value) = job_type.filter(|value| !value.trim().is_empty()) {
        query.push(("job_type", value.trim().to_string()));
    }
    if let Some(value) = status.filter(|value| !value.trim().is_empty()) {
        query.push(("status", value.trim().to_string()));
    }
    if let Some(value) = limit.filter(|value| *value > 0) {
        query.push(("limit", value.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/jobs"),
        token,
        query,
        None,
    )
}

fn fetch_live_lesion_preview_job_response(
    site_id: &str,
    token: &str,
    image_id: &str,
    job_id: &str,
) -> Result<JsonValue, String> {
    let request_payload = json!({
        "site_id": site_id,
        "token": token,
        "image_id": image_id,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_live_lesion_preview_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/images/{image_id}/lesion-live-preview/jobs/{job_id}"),
        token,
        Vec::new(),
        None,
    )
}

fn emit_site_job_update(
    app: &AppHandle,
    site_id: &str,
    job_id: &str,
    job: Option<JsonValue>,
    terminal: bool,
    error: Option<String>,
) {
    let status = job
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let _ = app.emit(
        SITE_JOB_UPDATE_EVENT,
        SiteJobUpdateEvent {
            site_id: site_id.to_string(),
            job_id: job_id.to_string(),
            job,
            status,
            terminal,
            error,
        },
    );
}

fn emit_live_lesion_preview_update(
    app: &AppHandle,
    site_id: &str,
    image_id: &str,
    job_id: &str,
    job: Option<JsonValue>,
    terminal: bool,
    error: Option<String>,
) {
    let status = job
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let _ = app.emit(
        LIVE_LESION_PREVIEW_UPDATE_EVENT,
        LiveLesionPreviewUpdateEvent {
            site_id: site_id.to_string(),
            image_id: image_id.to_string(),
            job_id: job_id.to_string(),
            job,
            status,
            terminal,
            error,
        },
    );
}

pub(super) fn fetch_site_job_command(
    payload: SiteJobCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    fetch_site_job_response(&site_id, &payload.token, &job_id)
}

pub(super) fn list_site_jobs_command(
    payload: SiteJobListCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    list_site_jobs_response(
        &site_id,
        &payload.token,
        payload.job_type.as_deref(),
        payload.status.as_deref(),
        payload.limit,
    )
}

pub(super) fn start_site_job_event_stream_command(
    app: AppHandle,
    payload: SiteJobCommandRequest,
) -> Result<(), String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    let token = payload.token;
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    std::thread::spawn(move || loop {
        match fetch_site_job_response(&site_id, &token, &job_id) {
            Ok(job) => {
                let status = job
                    .get("status")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string();
                let terminal = !is_active_site_job_status(&status);
                emit_site_job_update(&app, &site_id, &job_id, Some(job), terminal, None);
                if terminal {
                    break;
                }
            }
            Err(error) => {
                emit_site_job_update(&app, &site_id, &job_id, None, true, Some(error));
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(800));
    });
    Ok(())
}

pub(super) async fn fetch_live_lesion_preview_job_command(
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() || job_id.is_empty() {
        return Err("site_id, image_id, and job_id are required.".to_string());
    }
    let token = payload.token;
    tauri::async_runtime::spawn_blocking(move || {
        fetch_live_lesion_preview_job_response(&site_id, &token, &image_id, &job_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn start_live_lesion_preview_event_stream_command(
    app: AppHandle,
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<(), String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    let token = payload.token;
    if site_id.is_empty() || image_id.is_empty() || job_id.is_empty() {
        return Err("site_id, image_id, and job_id are required.".to_string());
    }
    std::thread::spawn(move || loop {
        match fetch_live_lesion_preview_job_response(&site_id, &token, &image_id, &job_id) {
            Ok(job) => {
                let terminal = !matches!(
                    job.get("status").and_then(|value| value.as_str()),
                    Some("running")
                );
                emit_live_lesion_preview_update(
                    &app,
                    &site_id,
                    &image_id,
                    &job_id,
                    Some(job),
                    terminal,
                    None,
                );
                if terminal {
                    break;
                }
            }
            Err(error) => {
                emit_live_lesion_preview_update(
                    &app,
                    &site_id,
                    &image_id,
                    &job_id,
                    None,
                    true,
                    Some(error),
                );
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(600));
    });
    Ok(())
}
