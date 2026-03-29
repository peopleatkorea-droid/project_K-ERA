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

fn search_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in value.chars() {
        if ch.is_alphanumeric() {
            current.extend(ch.to_lowercase());
            continue;
        }
        if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn build_fts_match_query(search: &Option<String>) -> Option<String> {
    let tokens = search_tokens(search.as_deref().unwrap_or(""));
    if tokens.is_empty() {
        return None;
    }
    Some(
        tokens
            .into_iter()
            .map(|token| format!("{token}*"))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

pub(super) fn build_search_clause(
    site_id: &str,
    search: &Option<String>,
    params: &mut Vec<Value>,
) -> String {
    if let Some(search_value) = build_fts_match_query(search) {
        params.push(Value::Text(site_id.to_string()));
        params.push(Value::Text(search_value));
        "
          and v.visit_id in (
            select visit_id
            from patient_case_search
            where site_id = ?
              and patient_case_search match ?
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
