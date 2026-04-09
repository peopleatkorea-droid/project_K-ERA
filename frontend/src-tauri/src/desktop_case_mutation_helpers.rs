fn visit_owner_user_id(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Option<String>, String> {
    let sql = "
      select created_by_user_id
      from visits
      where site_id = ? and patient_id = ? and visit_date = ?
    ";
    conn.query_row(sql, params![site_id, patient_id, visit_date], |row| {
        row.get::<_, Option<String>>(0)
    })
    .optional()
    .map(|value| {
        value
            .flatten()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
    })
    .map_err(|error| error.to_string())
}

fn visit_fl_retained(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<bool, String> {
    conn.query_row(
        "
        select coalesce(fl_retained, 0)
        from visits
        where site_id = ? and patient_id = ? and visit_date = ?
        ",
        params![site_id, patient_id, visit_date],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map(|value| value.unwrap_or(0) != 0)
    .map_err(|error| error.to_string())
}

fn require_visit_write_access(
    conn: &Connection,
    auth: &MutationAuth,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<(), String> {
    require_record_owner(
        auth,
        visit_owner_user_id(conn, site_id, patient_id, visit_date)?.as_deref(),
        "Only the creator or a site admin can modify this visit.",
    )
}

fn require_visit_image_write_access(
    conn: &Connection,
    auth: &MutationAuth,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<(), String> {
    if has_site_wide_write_access(auth) {
        return Ok(());
    }
    let sql = "
      select created_by_user_id
      from images
      where site_id = ? and patient_id = ? and visit_date = ? and soft_deleted_at is null
      order by uploaded_at asc
    ";
    let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![site_id, patient_id, visit_date], |row| {
            row.get::<_, Option<String>>(0)
        })
        .map_err(|error| error.to_string())?;
    let mut found_images = false;
    let visit_owner = visit_owner_user_id(conn, site_id, patient_id, visit_date)?;
    for row in rows {
        found_images = true;
        let image_owner = row.map_err(|error| error.to_string())?;
        let owner = image_owner
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .or(visit_owner.as_deref());
        require_record_owner(
            auth,
            owner,
            "Only the creator or a site admin can modify images for this visit.",
        )?;
    }
    if !found_images {
        require_visit_write_access(conn, auth, site_id, patient_id, visit_date)?;
    }
    Ok(())
}

fn soft_delete_visit_images(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
    reason: &str,
) -> Result<i64, String> {
    let deleted_at = utc_now();
    conn.execute(
        "
        update images
        set soft_deleted_at = ?, soft_delete_reason = ?
        where site_id = ? and patient_id = ? and visit_date = ? and soft_deleted_at is null
        ",
        params![deleted_at, reason, site_id, patient_id, visit_date],
    )
    .map(|count| count as i64)
    .map_err(|error| error.to_string())
}

fn soft_delete_visit_row(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
    reason: &str,
) -> Result<i64, String> {
    let deleted_at = utc_now();
    conn.execute(
        "
        update visits
        set soft_deleted_at = ?, soft_delete_reason = ?
        where site_id = ? and patient_id = ? and visit_date = ? and soft_deleted_at is null
        ",
        params![deleted_at, reason, site_id, patient_id, visit_date],
    )
    .map(|count| count as i64)
    .map_err(|error| error.to_string())
}

fn delete_image_preview_cache(site_id: &str, image_id: &str) -> Result<i64, String> {
    let preview_root = site_dir(site_id)?.join("artifacts").join("image_previews");
    if !preview_root.exists() {
        return Ok(0);
    }
    let mut deleted = 0;
    for entry in fs::read_dir(preview_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let candidate = entry.path().join(format!("{image_id}.jpg"));
        if candidate.exists() {
            fs::remove_file(&candidate).map_err(|error| error.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

fn delete_patient_if_empty(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
) -> Result<bool, String> {
    let remaining_visits = conn
        .query_row(
            "select count(*) from visits where site_id = ? and patient_id = ?",
            params![site_id, patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if remaining_visits > 0 {
        return Ok(false);
    }
    conn.execute(
        "delete from patients where site_id = ? and patient_id = ?",
        params![site_id, patient_id],
    )
    .map_err(|error| error.to_string())?;
    let history_dir = case_history_dir(site_id)?.join(safe_path_component(patient_id));
    if history_dir.exists()
        && fs::read_dir(&history_dir)
            .map_err(|error| error.to_string())?
            .next()
            .is_none()
    {
        fs::remove_dir(&history_dir).map_err(|error| error.to_string())?;
    }
    Ok(true)
}

fn schedule_federated_retrieval_corpus_sync(site_id: &str, trigger: &str) {
    let normalized_site_id = site_id.trim().to_string();
    let normalized_trigger = trigger.trim().to_string();
    if normalized_site_id.is_empty() || normalized_trigger.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let _ = request_local_api_json_owned(
            HttpMethod::POST,
            &format!(
                "/api/desktop/internal/sites/{}/ai-clinic/retrieval-corpus/queue",
                normalized_site_id
            ),
            "",
            vec![("trigger".to_string(), normalized_trigger)],
            Some(json!({
                "retrieval_profile": "dinov2_lesion_crop",
                "force_refresh": false,
            })),
            Some(desktop_runtime_owner()),
        );
    });
}

fn schedule_case_embedding_refresh(site_id: &str, patient_id: &str, visit_date: &str, trigger: &str) {
    let normalized_site_id = site_id.trim().to_string();
    let normalized_patient_id = patient_id.trim().to_string();
    let normalized_visit_date = visit_date.trim().to_string();
    let normalized_trigger = trigger.trim().to_string();
    if normalized_site_id.is_empty()
        || normalized_patient_id.is_empty()
        || normalized_visit_date.is_empty()
        || normalized_trigger.is_empty()
    {
        return;
    }
    std::thread::spawn(move || {
        let _ = request_local_api_json_owned(
            HttpMethod::POST,
            &format!(
                "/api/desktop/internal/sites/{}/cases/{}/visits/{}/ai-clinic/embeddings/queue",
                normalized_site_id, normalized_patient_id, normalized_visit_date
            ),
            "",
            vec![("trigger".to_string(), normalized_trigger)],
            None,
            Some(desktop_runtime_owner()),
        );
    });
}

fn schedule_ai_clinic_vector_index_rebuild(site_id: &str, trigger: &str) {
    let normalized_site_id = site_id.trim().to_string();
    let normalized_trigger = trigger.trim().to_string();
    if normalized_site_id.is_empty() || normalized_trigger.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let _ = request_local_api_json_owned(
            HttpMethod::POST,
            &format!(
                "/api/desktop/internal/sites/{}/ai-clinic/vector-index/queue",
                normalized_site_id
            ),
            "",
            vec![("trigger".to_string(), normalized_trigger)],
            None,
            Some(desktop_runtime_owner()),
        );
    });
}

const MAX_UPLOAD_IMAGE_PIXELS: u64 = 40_000_000;

enum JpegFastPathOutcome {
    Sanitized(Vec<u8>),
    Fallback,
}

fn jpeg_marker_has_length(marker: u8) -> bool {
    !matches!(marker, 0x01 | 0xD0..=0xD9)
}

fn is_jpeg_start_of_frame_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
    )
}

fn should_strip_jpeg_app_marker(marker: u8) -> bool {
    matches!(marker, 0xE1 | 0xE3..=0xED | 0xEF)
}

fn read_be_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    bytes
        .get(offset..offset + 2)
        .map(|slice| u16::from_be_bytes([slice[0], slice[1]]))
}

fn read_tiff_u16(bytes: &[u8], offset: usize, little_endian: bool) -> Option<u16> {
    bytes.get(offset..offset + 2).map(|slice| {
        if little_endian {
            u16::from_le_bytes([slice[0], slice[1]])
        } else {
            u16::from_be_bytes([slice[0], slice[1]])
        }
    })
}

fn read_tiff_u32(bytes: &[u8], offset: usize, little_endian: bool) -> Option<u32> {
    bytes.get(offset..offset + 4).map(|slice| {
        if little_endian {
            u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]])
        } else {
            u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]])
        }
    })
}

fn jpeg_exif_orientation(payload: &[u8]) -> Result<Option<u16>, String> {
    if payload.len() < 6 || &payload[..6] != b"Exif\0\0" {
        return Ok(None);
    }
    let tiff = &payload[6..];
    if tiff.len() < 8 {
        return Err("Invalid image file.".to_string());
    }
    let little_endian = match &tiff[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return Err("Invalid image file.".to_string()),
    };
    if read_tiff_u16(tiff, 2, little_endian) != Some(42) {
        return Err("Invalid image file.".to_string());
    }
    let ifd0_offset = read_tiff_u32(tiff, 4, little_endian)
        .ok_or_else(|| "Invalid image file.".to_string())? as usize;
    if ifd0_offset + 2 > tiff.len() {
        return Err("Invalid image file.".to_string());
    }
    let entry_count = read_tiff_u16(tiff, ifd0_offset, little_endian)
        .ok_or_else(|| "Invalid image file.".to_string())? as usize;
    let entries_start = ifd0_offset + 2;
    let entries_end = entries_start + entry_count * 12;
    if entries_end > tiff.len() {
        return Err("Invalid image file.".to_string());
    }
    for entry_offset in (entries_start..entries_end).step_by(12) {
        let tag = read_tiff_u16(tiff, entry_offset, little_endian)
            .ok_or_else(|| "Invalid image file.".to_string())?;
        if tag != 0x0112 {
            continue;
        }
        let value_type = read_tiff_u16(tiff, entry_offset + 2, little_endian)
            .ok_or_else(|| "Invalid image file.".to_string())?;
        let component_count = read_tiff_u32(tiff, entry_offset + 4, little_endian)
            .ok_or_else(|| "Invalid image file.".to_string())?;
        if value_type != 3 || component_count < 1 {
            return Err("Invalid image file.".to_string());
        }
        let value_field = tiff
            .get(entry_offset + 8..entry_offset + 12)
            .ok_or_else(|| "Invalid image file.".to_string())?;
        let orientation = if little_endian {
            u16::from_le_bytes([value_field[0], value_field[1]])
        } else {
            u16::from_be_bytes([value_field[0], value_field[1]])
        };
        return Ok(Some(orientation));
    }
    Ok(None)
}

fn strip_jpeg_metadata_and_validate(content: &[u8]) -> Result<JpegFastPathOutcome, String> {
    if content.len() < 4 || content[0] != 0xFF || content[1] != 0xD8 {
        return Err("Invalid image file.".to_string());
    }
    let mut output = Vec::with_capacity(content.len());
    output.extend_from_slice(&content[..2]);
    let mut offset = 2;
    let mut saw_sof = false;
    let mut saw_sos = false;

    while offset < content.len() {
        if content[offset] != 0xFF {
            return Err("Invalid image file.".to_string());
        }
        let marker_start = offset;
        offset += 1;
        while offset < content.len() && content[offset] == 0xFF {
            offset += 1;
        }
        if offset >= content.len() {
            return Err("Invalid image file.".to_string());
        }
        let marker = content[offset];
        offset += 1;
        if marker == 0x00 {
            return Err("Invalid image file.".to_string());
        }

        if !jpeg_marker_has_length(marker) {
            output.extend_from_slice(&content[marker_start..offset]);
            if marker == 0xD9 {
                break;
            }
            continue;
        }

        let length_start = offset;
        let segment_length =
            read_be_u16(content, length_start).ok_or_else(|| "Invalid image file.".to_string())? as usize;
        if segment_length < 2 {
            return Err("Invalid image file.".to_string());
        }
        let segment_end = length_start + segment_length;
        if segment_end > content.len() {
            return Err("Invalid image file.".to_string());
        }
        let payload = &content[length_start + 2..segment_end];
        let segment = &content[marker_start..segment_end];

        if marker == 0xDA {
            if !saw_sof {
                return Err("Invalid image file.".to_string());
            }
            output.extend_from_slice(&content[marker_start..]);
            saw_sos = true;
            break;
        }

        if is_jpeg_start_of_frame_marker(marker) {
            if payload.len() < 6 {
                return Err("Invalid image file.".to_string());
            }
            let height = read_be_u16(payload, 1).ok_or_else(|| "Invalid image file.".to_string())? as u64;
            let width = read_be_u16(payload, 3).ok_or_else(|| "Invalid image file.".to_string())? as u64;
            let component_count = payload[5];
            if width == 0 || height == 0 {
                return Err("Image dimensions are invalid.".to_string());
            }
            if width * height > MAX_UPLOAD_IMAGE_PIXELS {
                return Err("Image is too large.".to_string());
            }
            if !matches!(component_count, 1 | 3) {
                return Ok(JpegFastPathOutcome::Fallback);
            }
            saw_sof = true;
            output.extend_from_slice(segment);
        } else if marker == 0xE1 {
            match jpeg_exif_orientation(payload) {
                Ok(Some(orientation)) if orientation != 1 => return Ok(JpegFastPathOutcome::Fallback),
                Ok(_) => {}
                Err(_) => return Ok(JpegFastPathOutcome::Fallback),
            }
        } else if marker == 0xFE || should_strip_jpeg_app_marker(marker) {
            // Strip lossy metadata segments while preserving scan data.
        } else {
            output.extend_from_slice(segment);
        }

        offset = segment_end;
    }

    if !saw_sof || !saw_sos {
        return Err("Invalid image file.".to_string());
    }
    Ok(JpegFastPathOutcome::Sanitized(output))
}

fn try_fast_path_jpeg(
    content: &[u8],
    file_name: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    if file_name.to_ascii_lowercase().ends_with(".png") {
        return Ok(None);
    }
    match strip_jpeg_metadata_and_validate(content)? {
        JpegFastPathOutcome::Sanitized(bytes) => Ok(Some((bytes, ".jpg".to_string()))),
        JpegFastPathOutcome::Fallback => Ok(None),
    }
}

fn sanitize_image_bytes(
    content: &[u8],
    file_name: &str,
) -> Result<(Vec<u8>, String), String> {
    let guessed = image::guess_format(content).map_err(|_| "Invalid image file.".to_string())?;
    let allowed = matches!(
        guessed,
        ImageFormat::Jpeg
            | ImageFormat::Png
            | ImageFormat::Tiff
            | ImageFormat::Bmp
            | ImageFormat::WebP
            | ImageFormat::Gif
    );
    if !allowed {
        return Err("Unsupported image format.".to_string());
    }

    if matches!(guessed, ImageFormat::Jpeg) {
        if let Some(fast_path) = try_fast_path_jpeg(content, file_name)? {
            return Ok(fast_path);
        }
    }

    let image = image::load_from_memory(content).map_err(|_| "Invalid image file.".to_string())?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err("Image dimensions are invalid.".to_string());
    }
    if u64::from(width) * u64::from(height) > MAX_UPLOAD_IMAGE_PIXELS {
        return Err("Image is too large.".to_string());
    }

    let wants_png = matches!(guessed, ImageFormat::Png)
        || image.color().has_alpha()
        || file_name.to_ascii_lowercase().ends_with(".png");
    if wants_png {
        let mut bytes = Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(|_| "Invalid image file.".to_string())?;
        let bytes = bytes.into_inner();
        return Ok((bytes, ".png".to_string()));
    }

    let output_image = if matches!(
        image.color(),
        image::ColorType::Rgb8 | image::ColorType::L8 | image::ColorType::La8
    ) {
        image
    } else {
        DynamicImage::ImageRgb8(image.to_rgb8())
    };
    let mut bytes = Cursor::new(Vec::new());
    output_image
        .write_to(&mut bytes, ImageFormat::Jpeg)
        .map_err(|_| "Invalid image file.".to_string())?;
    let bytes = bytes.into_inner();
    Ok((bytes, ".jpg".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let length = (payload.len() + 2) as u16;
        let mut bytes = vec![0xFF, marker];
        bytes.extend_from_slice(&length.to_be_bytes());
        bytes.extend_from_slice(payload);
        bytes
    }

    fn sof0_segment(width: u16, height: u16, components: u8) -> Vec<u8> {
        segment(
            0xC0,
            &[
                8,
                (height >> 8) as u8,
                height as u8,
                (width >> 8) as u8,
                width as u8,
                components,
                1,
                0x11,
                0,
                2,
                0x11,
                0,
                3,
                0x11,
                0,
            ][..(6 + usize::from(components) * 3)],
        )
    }

    fn exif_orientation_segment(orientation: u16) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(b"Exif\0\0");
        payload.extend_from_slice(b"II");
        payload.extend_from_slice(&42u16.to_le_bytes());
        payload.extend_from_slice(&8u32.to_le_bytes());
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&0x0112u16.to_le_bytes());
        payload.extend_from_slice(&3u16.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&orientation.to_le_bytes());
        payload.extend_from_slice(&0u16.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        segment(0xE1, &payload)
    }

    fn minimal_jpeg_with_segments(extra_segments: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8];
        bytes.extend(segment(0xE0, b"JFIF\0\x01\x02\0\0\x01\0\x01\0\0"));
        for segment_bytes in extra_segments {
            bytes.extend_from_slice(segment_bytes);
        }
        bytes.extend(segment(
            0xDB,
            &[
                0x00, 16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40, 26, 24, 22,
                22, 24, 49, 35, 37, 29, 40, 58, 51, 61, 60, 57, 51, 56, 55, 64, 72, 92, 78, 64, 68,
                87, 69, 55, 56, 80, 109, 81, 87, 95, 98, 103, 104, 103, 62, 77, 113, 121, 112, 100,
                120, 92, 101, 103, 99,
            ],
        ));
        bytes.extend(sof0_segment(640, 480, 3));
        bytes.extend(segment(
            0xC4,
            &[
                0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00,
            ],
        ));
        bytes.extend(segment(0xDA, &[0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00]));
        bytes.extend_from_slice(&[0x00, 0x3F, 0x00, 0xFF, 0xD9]);
        bytes
    }

    #[test]
    fn jpeg_fast_path_strips_metadata_and_preserves_safe_app_segments() {
        let bytes = minimal_jpeg_with_segments(&[
            segment(0xE1, b"http://ns.adobe.com/xap/1.0/\0xmp"),
            segment(0xE2, b"ICC_PROFILE\0keep"),
            segment(0xEE, b"Adobe\0keep"),
            segment(0xFE, b"comment"),
        ]);
        let stripped = match strip_jpeg_metadata_and_validate(&bytes).expect("jpeg strip should succeed") {
            JpegFastPathOutcome::Sanitized(value) => value,
            JpegFastPathOutcome::Fallback => panic!("expected fast-path"),
        };
        assert!(stripped.windows(2).any(|window| window == [0xFF, 0xE0]));
        assert!(stripped.windows(2).any(|window| window == [0xFF, 0xE2]));
        assert!(stripped.windows(2).any(|window| window == [0xFF, 0xEE]));
        assert!(!stripped.windows(2).any(|window| window == [0xFF, 0xE1]));
        assert!(!stripped.windows(2).any(|window| window == [0xFF, 0xFE]));
    }

    #[test]
    fn jpeg_fast_path_falls_back_for_orientation_transform() {
        let bytes = minimal_jpeg_with_segments(&[exif_orientation_segment(6)]);
        let outcome = strip_jpeg_metadata_and_validate(&bytes).expect("jpeg parse should succeed");
        assert!(matches!(outcome, JpegFastPathOutcome::Fallback));
    }
}
