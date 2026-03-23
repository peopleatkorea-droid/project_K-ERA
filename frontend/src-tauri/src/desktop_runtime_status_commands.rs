#[tauri::command]
pub(super) fn get_local_backend_status() -> Result<LocalBackendStatus, String> {
    get_local_backend_status_internal()
}

#[tauri::command]
pub(super) fn get_local_worker_status() -> Result<LocalWorkerStatus, String> {
    get_local_worker_status_internal()
}

#[tauri::command]
pub(super) async fn ensure_local_worker() -> Result<LocalWorkerStatus, String> {
    tauri::async_runtime::spawn_blocking(ensure_local_worker_ready_internal)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) async fn ensure_local_backend() -> Result<LocalBackendStatus, String> {
    tauri::async_runtime::spawn_blocking(ensure_local_backend_ready_internal)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) async fn ensure_local_runtime() -> Result<LocalBackendStatus, String> {
    tauri::async_runtime::spawn_blocking(ensure_local_runtime_ready_internal)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) fn stop_local_backend() -> Result<LocalBackendStatus, String> {
    stop_local_backend_internal()
}

#[tauri::command]
pub(super) fn stop_local_worker() -> Result<LocalWorkerStatus, String> {
    stop_local_worker_internal()
}

#[tauri::command]
pub(super) fn stop_local_runtime() -> Result<LocalBackendStatus, String> {
    stop_local_runtime_internal()
}

#[tauri::command]
pub(super) fn get_ml_sidecar_status() -> Result<MlSidecarStatus, String> {
    get_ml_sidecar_status_internal()
}

#[tauri::command]
pub(super) fn ensure_ml_sidecar() -> Result<MlSidecarStatus, String> {
    let status = ensure_ml_sidecar_ready_internal()?;
    schedule_ml_sidecar_workflow_warmup();
    Ok(status)
}

#[tauri::command]
pub(super) fn stop_ml_sidecar() -> Result<MlSidecarStatus, String> {
    stop_ml_sidecar_internal()
}
