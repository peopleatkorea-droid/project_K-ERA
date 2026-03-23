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
      where site_id = ? and patient_id = ? and visit_date = ?
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

fn sanitize_image_bytes(content: &[u8], file_name: &str) -> Result<(Vec<u8>, String), String> {
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
    let image = image::load_from_memory(content).map_err(|_| "Invalid image file.".to_string())?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err("Image dimensions are invalid.".to_string());
    }
    if u64::from(width) * u64::from(height) > 40_000_000 {
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
        return Ok((bytes.into_inner(), ".png".to_string()));
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
    Ok((bytes.into_inner(), ".jpg".to_string()))
}
