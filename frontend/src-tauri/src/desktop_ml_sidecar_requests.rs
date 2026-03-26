fn call_ml_sidecar_json_unlocked(
    runtime: &mut MlSidecarRuntime,
    method: &str,
    params: JsonValue,
) -> Result<JsonValue, String> {
    let request_id = runtime.next_request_id;
    runtime.next_request_id = runtime.next_request_id.saturating_add(1);
    let payload = json!({
        "id": request_id,
        "method": method,
        "params": params,
    });
    let stdin = runtime
        .stdin
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdin is unavailable.".to_string())?;
    let serialized = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize sidecar request: {error}"))?;
    stdin
        .write_all(serialized.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write to the desktop ML sidecar: {error}"))?;

    let stdout = runtime
        .stdout
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdout is unavailable.".to_string())?;
    let mut line = String::new();
    let bytes_read = stdout
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read from the desktop ML sidecar: {error}"))?;
    if bytes_read == 0 || line.trim().is_empty() {
        return Err("Desktop ML sidecar closed the response stream.".to_string());
    }
    let response = serde_json::from_str::<JsonValue>(&line)
        .map_err(|error| format!("Invalid sidecar response JSON: {error}"))?;
    if response.get("id").and_then(|value| value.as_u64()) != Some(request_id) {
        return Err("Desktop ML sidecar returned an unexpected response id.".to_string());
    }
    if response.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(JsonValue::Null));
    }
    let error_message = response
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Desktop ML sidecar request failed.".to_string());
    Err(error_message)
}

pub(super) fn get_ml_sidecar_status_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let healthy = if runtime.child.is_some() {
        call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_ok()
    } else {
        false
    };
    Ok(ml_sidecar_status_snapshot(&runtime, healthy))
}

pub(super) fn ensure_ml_sidecar_ready_internal() -> Result<MlSidecarStatus, String> {
    if !ml_sidecar_should_be_used() {
        return get_ml_sidecar_status_internal();
    }
    let python_preflight = ensure_desktop_runtime_readiness_for_sidecar()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let mut needs_spawn = runtime.child.is_none();
    if !needs_spawn && call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_err()
    {
        stop_ml_sidecar_runtime(&mut runtime);
        needs_spawn = true;
    }
    if needs_spawn {
        let _ = cleanup_registered_managed_processes("ml_sidecar");
        let spawned = spawn_ml_sidecar_process()?;
        runtime.child = Some(spawned.child);
        runtime.stdin = Some(spawned.stdin);
        runtime.stdout = Some(spawned.stdout);
        runtime.python_path = Some(spawned.python_path);
        runtime.python_preflight = Some(spawned.python_preflight);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
        if let Err(error) = call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null) {
            stop_ml_sidecar_runtime(&mut runtime);
            runtime.last_error = Some(error.clone());
            return Err(error);
        }
    } else {
        runtime.python_preflight = Some(python_preflight);
    }
    Ok(ml_sidecar_status_snapshot(&runtime, true))
}

pub(super) fn stop_ml_sidecar_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    stop_ml_sidecar_runtime(&mut runtime);
    Ok(ml_sidecar_status_snapshot(&runtime, false))
}

pub(super) fn request_ml_sidecar_json(method: &str, params: JsonValue) -> Result<JsonValue, String> {
    ensure_ml_sidecar_ready_internal()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    match call_ml_sidecar_json_unlocked(&mut runtime, method, params) {
        Ok(result) => Ok(result),
        Err(error) => {
            runtime.last_error = Some(error.clone());
            Err(error)
        }
    }
}

pub(super) fn schedule_ml_sidecar_workflow_warmup() {
    if !ml_sidecar_should_be_used() {
        return;
    }
    std::thread::spawn(|| {
        let mut runtime = match ml_sidecar_state().lock() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        sync_ml_sidecar_runtime(&mut runtime);
        if runtime.child.is_none() {
            return;
        }
        let _ = call_ml_sidecar_json_unlocked(&mut runtime, "warm_workflow", JsonValue::Null);
    });
}
