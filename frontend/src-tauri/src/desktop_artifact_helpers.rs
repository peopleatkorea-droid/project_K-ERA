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
    let prediction = items.iter().find(|item| {
        json_string_field(item, "patient_id").as_deref() == Some(patient_id)
            && json_string_field(item, "visit_date").as_deref() == Some(visit_date)
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
