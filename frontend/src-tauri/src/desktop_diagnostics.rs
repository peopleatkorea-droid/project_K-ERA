use super::*;

pub(super) fn support_bundle_default_name() -> String {
    format!(
        "kera-desktop-support-{}.zip",
        Utc::now().format("%Y%m%d-%H%M%S")
    )
}

pub(super) fn desktop_env_value_is_sensitive(key: &str) -> bool {
    let normalized = key.trim().to_ascii_uppercase();
    if normalized.starts_with("NEXT_PUBLIC_") {
        return false;
    }
    normalized.contains("TOKEN")
        || normalized.contains("SECRET")
        || normalized.contains("PASSWORD")
        || normalized.contains("PRIVATE_KEY")
        || normalized.ends_with("_API_KEY")
}

pub(super) fn redacted_desktop_env(
    env: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    env.iter()
        .map(|(key, value)| {
            if desktop_env_value_is_sensitive(key) {
                (key.clone(), "[redacted]".to_string())
            } else {
                (key.clone(), value.clone())
            }
        })
        .collect()
}

pub(super) fn diagnostics_value<T: Serialize>(result: Result<T, String>) -> JsonValue {
    match result {
        Ok(value) => {
            serde_json::to_value(value).unwrap_or_else(|error| json!({ "error": error.to_string() }))
        }
        Err(error) => json!({ "error": error }),
    }
}

pub(super) fn desktop_json_key_is_sensitive(key: &str) -> bool {
    let normalized = key.trim().to_ascii_uppercase();
    matches!(
        normalized.as_str(),
        "TOKEN"
            | "ACCESS_TOKEN"
            | "REFRESH_TOKEN"
            | "ID_TOKEN"
            | "PASSWORD"
            | "SECRET"
            | "CLIENT_SECRET"
            | "PRIVATE_KEY"
            | "API_KEY"
            | "AUTHORIZATION"
            | "CREDENTIALS"
            | "ENV"
    ) || normalized.ends_with("_TOKEN")
        || normalized.ends_with("_PASSWORD")
        || normalized.ends_with("_SECRET")
        || normalized.ends_with("_PRIVATE_KEY")
        || normalized.ends_with("_API_KEY")
}

pub(super) fn redact_json_value(value: &mut JsonValue) {
    match value {
        JsonValue::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if desktop_json_key_is_sensitive(key) {
                    *nested = JsonValue::String("[redacted]".to_string());
                } else {
                    redact_json_value(nested);
                }
            }
        }
        JsonValue::Array(items) => {
            for item in items.iter_mut() {
                redact_json_value(item);
            }
        }
        _ => {}
    }
}

pub(super) fn redacted_json<T: Serialize>(value: &T) -> JsonValue {
    let mut payload =
        serde_json::to_value(value).unwrap_or_else(|error| json!({ "error": error.to_string() }));
    redact_json_value(&mut payload);
    payload
}

pub(super) fn write_zip_json_entry<W: Write + Seek, T: Serialize>(
    writer: &mut ZipWriter<W>,
    path: &str,
    value: &T,
) -> Result<(), String> {
    let options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer
        .start_file(path, options)
        .map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    writer.write_all(&payload).map_err(|error| error.to_string())
}

pub(super) fn write_zip_file_entry<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    archive_path: &str,
    source_path: &Path,
) -> Result<(), String> {
    if !source_path.exists() || !source_path.is_file() {
        return Ok(());
    }
    let options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer
        .start_file(archive_path, options)
        .map_err(|error| error.to_string())?;
    let bytes = fs::read(source_path).map_err(|error| error.to_string())?;
    writer.write_all(&bytes).map_err(|error| error.to_string())
}

pub(super) fn append_runtime_logs_to_bundle<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    runtime_dir: &Path,
) -> Result<Vec<String>, String> {
    if !runtime_dir.exists() {
        return Ok(Vec::new());
    }
    let mut included = Vec::new();
    for entry in fs::read_dir(runtime_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let normalized_name = file_name.trim().to_ascii_lowercase();
        if !(normalized_name.ends_with(".log")
            || normalized_name.ends_with(".txt")
            || normalized_name.ends_with(".json"))
        {
            continue;
        }
        write_zip_file_entry(writer, &format!("logs/{file_name}"), &path)?;
        included.push(path.to_string_lossy().to_string());
    }
    Ok(included)
}

pub(super) fn fetch_control_plane_status_for_bundle(base_url: &str) -> JsonValue {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return json!({ "error": "Hospital server URL is missing." });
    }
    let client = match HttpClient::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => return json!({ "error": error.to_string() }),
    };
    let url = format!("{normalized}/main/auth/desktop/status");
    let response = match client.get(url).send() {
        Ok(response) => response,
        Err(error) => return json!({ "error": error.to_string() }),
    };
    let status = response.status();
    let body_text = response.text().unwrap_or_default();
    if !status.is_success() {
        return json!({
            "error": format!("Desktop sign-in status request failed: {}", status.as_u16()),
            "status_code": status.as_u16(),
            "body": body_text,
        });
    }
    serde_json::from_str::<JsonValue>(&body_text)
        .unwrap_or_else(|_| json!({ "status_code": status.as_u16(), "body": body_text }))
}
