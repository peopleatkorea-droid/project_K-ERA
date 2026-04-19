use super::*;

pub(super) fn read_binary_path(path: &Path) -> Result<ImageBinaryResponse, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(ImageBinaryResponse {
        data: BASE64_STANDARD.encode(&bytes),
        media_type: mime_type_for_path(path),
    })
}

pub(super) fn ensure_path_within_site(site_id: &str, path: &Path) -> Result<PathBuf, String> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        site_dir(site_id)?.join(path)
    };
    let site_root = site_dir(site_id)?;
    let resolved_site_root = site_root.canonicalize().unwrap_or(site_root);
    if !candidate.exists() {
        return Err("Artifact file not found on disk.".to_string());
    }
    let resolved_candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.clone());
    if !resolved_candidate.starts_with(&resolved_site_root) {
        return Err("Artifact is outside the site workspace.".to_string());
    }
    Ok(resolved_candidate)
}

fn artifact_preview_cache_path(
    site_id: &str,
    artifact_path: &Path,
    max_side: u32,
) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(artifact_path.to_string_lossy().as_bytes());
    let hashed_name = format!("{:x}", hasher.finalize());
    Ok(site_dir(site_id)?
        .join("artifacts")
        .join("render_previews")
        .join(max_side.to_string())
        .join(format!("{hashed_name}.jpg")))
}

pub(super) fn resolve_artifact_display_path(
    site_id: &str,
    artifact_path: &Path,
    preview_max_side: Option<u32>,
) -> Result<PathBuf, String> {
    let Some(max_side) = preview_max_side else {
        return Ok(artifact_path.to_path_buf());
    };
    let clamped_side = max_side.clamp(192, 1024);
    let preview_path = artifact_preview_cache_path(site_id, artifact_path, clamped_side)?;
    ensure_preview(artifact_path, &preview_path, clamped_side)?;
    Ok(preview_path)
}

pub(super) fn find_visit_image_record(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
    image_id: &str,
) -> Result<DesktopImageRecord, String> {
    let images = query_images(conn, site_id, Some(patient_id), Some(visit_date), None)?;
    images
        .into_iter()
        .find(|item| item.image_id == image_id)
        .ok_or_else(|| "Image not found for this case.".to_string())
}

pub(super) fn validation_artifact_path(
    site_id: &str,
    validation_id: &str,
    patient_id: &str,
    visit_date: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_key = match artifact_kind.trim() {
        "gradcam" => "gradcam_path",
        "gradcam_cornea" => "gradcam_cornea_path",
        "gradcam_lesion" => "gradcam_lesion_path",
        "roi_crop" => "roi_crop_path",
        "medsam_mask" => "medsam_mask_path",
        "lesion_crop" => "lesion_crop_path",
        "lesion_mask" => "lesion_mask_path",
        _ => return Err("Unknown validation artifact.".to_string()),
    };

    let case_path = control_plane_case_dir()?.join(format!("{}.json", validation_id.trim()));
    if !case_path.exists() {
        return Err("Validation case prediction not found.".to_string());
    }
    let raw = fs::read_to_string(&case_path).map_err(|error| error.to_string())?;
    let payload = serde_json::from_str::<JsonValue>(&raw).map_err(|error| error.to_string())?;
    let items = payload
        .as_array()
        .ok_or_else(|| "Validation case prediction file is invalid.".to_string())?;
    let expected_case_reference_id = make_case_reference_id(site_id, patient_id, visit_date);
    let prediction = items.iter().find(|item| {
        let matches_identity = json_string_field(item, "patient_id").as_deref() == Some(patient_id)
            && json_string_field(item, "visit_date").as_deref() == Some(visit_date);
        let matches_case_reference = json_string_field(item, "case_reference_id")
            .as_deref()
            == Some(expected_case_reference_id.as_str());
        matches_identity || matches_case_reference
    });
    let prediction =
        prediction.ok_or_else(|| "Validation case prediction not found.".to_string())?;
    let artifact_path_value = json_string_field(prediction, artifact_key)
        .ok_or_else(|| "Requested artifact is not available.".to_string())?;
    ensure_path_within_site(site_id, &PathBuf::from(artifact_path_value))
}

pub(super) fn roi_preview_artifact_path(
    site_id: &str,
    image_path: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_name = Path::new(image_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Image path is invalid.".to_string())?;
    let relative = match artifact_kind.trim() {
        "roi_crop" => PathBuf::from("artifacts")
            .join("roi_crops")
            .join(format!("{artifact_name}_crop.png")),
        "medsam_mask" => PathBuf::from("artifacts")
            .join("medsam_masks")
            .join(format!("{artifact_name}_mask.png")),
        _ => return Err("Unknown ROI preview artifact.".to_string()),
    };
    ensure_path_within_site(site_id, &site_dir(site_id)?.join(relative))
}

pub(super) fn lesion_preview_artifact_path(
    site_id: &str,
    image_path: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_name = Path::new(image_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Image path is invalid.".to_string())?;
    let relative = match artifact_kind.trim() {
        "lesion_crop" => PathBuf::from("artifacts")
            .join("lesion_crops")
            .join(format!("{artifact_name}_crop.png")),
        "lesion_mask" => PathBuf::from("artifacts")
            .join("lesion_masks")
            .join(format!("{artifact_name}_mask.png")),
        _ => return Err("Unknown lesion preview artifact.".to_string()),
    };
    ensure_path_within_site(site_id, &site_dir(site_id)?.join(relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_env_lock() -> &'static Mutex<()> {
        TEST_ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn validation_artifact_path_falls_back_to_case_reference_id() {
        let _guard = test_env_lock().lock().expect("test env lock");
        let suffix = Uuid::new_v4().simple().to_string();
        let root = std::env::temp_dir().join(format!("kera_validation_artifact_{suffix}"));
        let storage_dir = root.join("storage");
        let control_plane_dir = storage_dir.join("control_plane");
        let site_id = "39100103";
        let patient_id = "17196699";
        let visit_date = "FU #9";
        let validation_id = "validation_test";
        let site_root = storage_dir.join("sites").join(site_id);
        let artifact_path = site_root
            .join("artifacts")
            .join("gradcam")
            .join("image_gradcam.png");
        let case_path = control_plane_dir
            .join("validation_cases")
            .join(format!("{validation_id}.json"));

        std::env::set_var("KERA_STORAGE_DIR", &storage_dir);
        std::env::set_var("KERA_CONTROL_PLANE_DIR", &control_plane_dir);
        std::env::set_var("KERA_CASE_REFERENCE_SALT", "desktop-test-case-salt");
        fs::create_dir_all(artifact_path.parent().expect("artifact parent")).expect("artifact dir");
        fs::create_dir_all(case_path.parent().expect("case parent")).expect("case dir");
        fs::write(&artifact_path, b"gradcam").expect("artifact write");
        let payload = serde_json::json!([
            {
                "validation_id": validation_id,
                "case_reference_id": make_case_reference_id(site_id, patient_id, visit_date),
                "gradcam_path": PathBuf::from("artifacts")
                    .join("gradcam")
                    .join("image_gradcam.png")
                    .to_string_lossy()
                    .to_string()
            }
        ]);
        fs::write(
            &case_path,
            serde_json::to_string_pretty(&payload).expect("case payload"),
        )
        .expect("case write");

        let resolved = validation_artifact_path(
            site_id,
            validation_id,
            patient_id,
            visit_date,
            "gradcam",
        )
        .expect("artifact path");

        assert_eq!(
            resolved,
            artifact_path.canonicalize().expect("artifact canonicalize")
        );

        std::env::remove_var("KERA_CASE_REFERENCE_SALT");
        std::env::remove_var("KERA_CONTROL_PLANE_DIR");
        std::env::remove_var("KERA_STORAGE_DIR");
        let _ = fs::remove_dir_all(root);
    }
}
