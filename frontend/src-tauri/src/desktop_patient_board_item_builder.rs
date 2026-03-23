fn build_patient_board_items(
    site_id: &str,
    patient_ids: Vec<String>,
    case_counts: &HashMap<String, i64>,
    mut cases_by_patient: HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>>,
) -> Result<Vec<PatientListRowRecord>, String> {
    let mut items = Vec::new();
    for patient_id in patient_ids {
        let mut cases = cases_by_patient.remove(&patient_id).unwrap_or_default();
        if cases.is_empty() {
            continue;
        }
        cases.sort_by(|left, right| case_sort_key(&right.0).cmp(&case_sort_key(&left.0)));

        let latest_case = cases
            .first()
            .map(|item| item.0.clone())
            .ok_or_else(|| "Latest case missing.".to_string())?;
        let representative_thumbnails = cases
            .iter()
            .filter_map(|(case_record, representative_image_path)| {
                let image_id = case_record.representative_image_id.clone()?;
                let stored_path = representative_image_path.as_ref()?;
                let source_path = resolve_site_runtime_path(site_id, stored_path).ok()?;
                let fallback_path = source_path.to_str().map(|s| s.to_string());
                Some(PatientListThumbnailRecord {
                    case_id: case_record.case_id.clone(),
                    image_id,
                    view: case_record.representative_view.clone(),
                    preview_url: None,
                    fallback_url: None,
                    preview_path: None,
                    fallback_path,
                })
            })
            .take(3)
            .collect::<Vec<_>>();

        items.push(PatientListRowRecord {
            patient_id: patient_id.clone(),
            latest_case: latest_case.clone(),
            case_count: case_counts
                .get(&patient_id)
                .copied()
                .unwrap_or(representative_thumbnails.len() as i64),
            organism_summary: organism_summary_label(
                &latest_case.culture_species,
                &latest_case.additional_organisms,
                2,
            ),
            representative_thumbnails,
        });
    }
    Ok(items)
}
