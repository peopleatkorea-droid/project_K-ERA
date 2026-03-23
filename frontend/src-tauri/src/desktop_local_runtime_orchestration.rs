pub(super) fn ensure_local_runtime_ready_internal() -> Result<LocalBackendStatus, String> {
    let backend = ensure_local_backend_ready_internal()?;
    if local_backend_should_be_managed(&backend.base_url) {
        ensure_local_worker_ready_internal()?;
    }
    if ml_sidecar_should_be_used() {
        ensure_ml_sidecar_ready_internal()?;
        schedule_ml_sidecar_workflow_warmup();
    }
    Ok(backend)
}

pub(super) fn stop_local_runtime_internal() -> Result<LocalBackendStatus, String> {
    let _ = stop_local_worker_internal();
    let _ = stop_ml_sidecar_internal();
    stop_local_backend_internal()
}
