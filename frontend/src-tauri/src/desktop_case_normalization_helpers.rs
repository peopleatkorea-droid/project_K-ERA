pub(super) fn normalize_patient_pseudonym(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err("Patient ID is required.".to_string());
    }
    let length = normalized.chars().count();
    if length == 0 || length > 64 {
        return Err(
            "Patient ID must use a local chart/MRN-style ID (letters, numbers, ., -, _ only)."
                .to_string(),
        );
    }
    let mut chars = normalized.chars();
    let first = chars
        .next()
        .ok_or_else(|| "Patient ID is required.".to_string())?;
    if !first.is_ascii_alphanumeric() {
        return Err(
            "Patient ID must use a local chart/MRN-style ID (letters, numbers, ., -, _ only)."
                .to_string(),
        );
    }
    if chars.any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))) {
        return Err(
            "Patient ID must use a local chart/MRN-style ID (letters, numbers, ., -, _ only)."
                .to_string(),
        );
    }
    Ok(normalized.to_string())
}

pub(super) fn normalize_visit_label(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err("Visit reference is required.".to_string());
    }
    let lower = normalized.to_ascii_lowercase();
    if lower == "initial" || lower == "initial visit" || normalized == "초진" {
        return Ok("Initial".to_string());
    }
    let upper = normalized.to_ascii_uppercase();
    let simplified = upper
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '_' | '-' | '#'))
        .collect::<String>();
    let follow_up_digits = simplified
        .strip_prefix("F/U")
        .or_else(|| simplified.strip_prefix("FU"))
        .unwrap_or("");
    if !follow_up_digits.is_empty() && follow_up_digits.chars().all(|ch| ch.is_ascii_digit()) {
        let parsed = follow_up_digits.parse::<u32>().unwrap_or(1).max(1);
        return Ok(format!("FU #{parsed}"));
    }
    Err(
        "Visit reference must be 'Initial' or 'FU #N'. Store the exact calendar date in actual_visit_date only."
            .to_string(),
    )
}

pub(super) fn visit_index_from_label(value: &str) -> Result<i64, String> {
    let normalized = normalize_visit_label(value)?;
    if normalized == "Initial" {
        return Ok(0);
    }
    let digits = normalized
        .strip_prefix("FU #")
        .ok_or_else(|| "Visit reference must resolve to Initial or FU #N.".to_string())?;
    let parsed = digits
        .parse::<i64>()
        .map_err(|_| "Visit reference must resolve to Initial or FU #N.".to_string())?;
    Ok(parsed.max(1))
}

pub(super) fn normalize_actual_visit_date(value: Option<&str>) -> Result<Option<String>, String> {
    let normalized = value.unwrap_or("").trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    let valid = normalized.len() == 10
        && normalized
            .chars()
            .enumerate()
            .all(|(index, ch)| match index {
                4 | 7 => ch == '-',
                _ => ch.is_ascii_digit(),
            });
    if !valid {
        return Err("Actual visit date must use YYYY-MM-DD format.".to_string());
    }
    Ok(Some(normalized.to_string()))
}

pub(super) fn normalize_additional_organisms(
    primary_category: &str,
    primary_species: &str,
    additional_organisms: &[OrganismRecord],
) -> Vec<OrganismRecord> {
    let primary_key = format!(
        "{}::{}",
        primary_category.trim().to_lowercase(),
        primary_species.trim().to_lowercase()
    );
    let mut seen = vec![primary_key];
    let mut normalized = Vec::new();
    for organism in additional_organisms {
        let category = organism.culture_category.trim().to_lowercase();
        let species = organism.culture_species.trim().to_string();
        if category.is_empty() || species.is_empty() {
            continue;
        }
        let key = format!("{category}::{}", species.to_lowercase());
        if seen.iter().any(|entry| entry == &key) {
            continue;
        }
        seen.push(key);
        normalized.push(OrganismRecord {
            culture_category: category,
            culture_species: species,
        });
    }
    normalized
}

pub(super) fn normalize_visit_status(value: Option<&str>, active_stage: bool) -> String {
    let normalized = value.unwrap_or("").trim().to_lowercase();
    match normalized.as_str() {
        "active" | "scar" | "healed" => normalized,
        _ => {
            if active_stage {
                "active".to_string()
            } else {
                "scar".to_string()
            }
        }
    }
}
