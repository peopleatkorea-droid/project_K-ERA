fn parse_json_array(raw: Option<String>) -> Vec<JsonValue> {
    match parse_json_value(raw, JsonValue::Array(Vec::new())) {
        JsonValue::Array(items) => items,
        _ => Vec::new(),
    }
}

fn parse_json_string_array(raw: Option<String>) -> Vec<String> {
    parse_json_array(raw)
        .into_iter()
        .filter_map(|item| item.as_str().map(|value| value.to_string()))
        .collect()
}

fn parse_organism_array(raw: Option<String>) -> Vec<OrganismRecord> {
    parse_json_array(raw)
        .into_iter()
        .filter_map(|item| {
            let category = item
                .get("culture_category")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_lowercase())?;
            let species = item
                .get("culture_species")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())?;
            if category.is_empty() || species.is_empty() {
                return None;
            }
            Some(OrganismRecord {
                culture_category: category,
                culture_species: species,
            })
        })
        .collect()
}
