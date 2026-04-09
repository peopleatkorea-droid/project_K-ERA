#[tauri::command]
pub(super) fn read_image_blob(payload: ImageBlobRequest) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let stored_image_path = conn
        .query_row(
            "select image_path from images where site_id = ? and image_id = ? and soft_deleted_at is null",
            params![site_id, image_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Image not found.".to_string())?;
    let source_path = resolve_site_runtime_path(&payload.site_id, &stored_image_path)?;
    let bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    Ok(ImageBinaryResponse {
        data: BASE64_STANDARD.encode(&bytes),
        media_type: mime_type_for_path(&source_path),
    })
}
