pub(super) fn organism_summary_label(
    culture_species: &str,
    additional_organisms: &[JsonValue],
    max_visible_species: usize,
) -> String {
    let mut species = Vec::new();
    if !culture_species.trim().is_empty() {
        species.push(culture_species.trim().to_string());
    }
    for item in additional_organisms {
        if let Some(value) = item.get("culture_species").and_then(|value| value.as_str()) {
            let normalized = value.trim();
            if !normalized.is_empty()
                && !species
                    .iter()
                    .any(|entry| entry.eq_ignore_ascii_case(normalized))
            {
                species.push(normalized.to_string());
            }
        }
    }
    if species.is_empty() {
        return String::new();
    }
    let visible_count = max_visible_species.max(1);
    if species.len() <= visible_count {
        return species.join(" / ");
    }
    let visible = species
        .iter()
        .take(visible_count)
        .cloned()
        .collect::<Vec<_>>();
    format!(
        "{} + {}",
        visible.join(" / "),
        species.len() - visible.len()
    )
}

pub(super) fn case_sort_key(record: &CaseSummaryRecord) -> (String, String, String, String) {
    (
        record.latest_image_uploaded_at.clone().unwrap_or_default(),
        record.created_at.clone().unwrap_or_default(),
        record.visit_date.clone(),
        record.patient_id.clone(),
    )
}

pub(super) fn build_search_clause(search: &Option<String>, params: &mut Vec<Value>) -> String {
    let normalized = search
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    if let Some(search_value) = normalized {
        let pattern = format!("%{search_value}%");
        for _ in 0..7 {
            params.push(Value::Text(pattern.clone()));
        }
        "
          and (
            lower(coalesce(p.patient_id, '')) like ?
            or lower(coalesce(p.local_case_code, '')) like ?
            or lower(coalesce(p.chart_alias, '')) like ?
            or lower(coalesce(v.culture_category, '')) like ?
            or lower(coalesce(v.culture_species, '')) like ?
            or lower(coalesce(v.visit_date, '')) like ?
            or lower(coalesce(v.actual_visit_date, '')) like ?
          )
        "
        .to_string()
    } else {
        String::new()
    }
}

pub(super) fn mime_type_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("csv") => "text/csv".to_string(),
        Some("txt") => "text/plain".to_string(),
        Some("json") => "application/json".to_string(),
        Some("zip") => "application/zip".to_string(),
        Some("png") => "image/png".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("bmp") => "image/bmp".to_string(),
        Some("tif") | Some("tiff") => "image/tiff".to_string(),
        Some("gif") => "image/gif".to_string(),
        _ => "image/jpeg".to_string(),
    }
}
