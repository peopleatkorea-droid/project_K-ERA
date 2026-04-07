#[derive(Debug, Deserialize, Clone)]
struct MutationAuth {
    user_id: Option<String>,
    user_role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreatePatientRequest {
    site_id: String,
    user_id: Option<String>,
    #[serde(rename = "user_role")]
    _user_role: Option<String>,
    patient_id: String,
    sex: String,
    age: i64,
    chart_alias: Option<String>,
    local_case_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdatePatientRequest {
    site_id: String,
    user_id: Option<String>,
    user_role: Option<String>,
    patient_id: String,
    sex: String,
    age: i64,
    chart_alias: Option<String>,
    local_case_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct OrganismRecord {
    culture_category: String,
    culture_species: String,
}

#[derive(Debug, Deserialize)]
struct CreateVisitRequest {
    site_id: String,
    user_id: Option<String>,
    #[serde(rename = "user_role")]
    _user_role: Option<String>,
    patient_id: String,
    visit_date: String,
    actual_visit_date: Option<String>,
    culture_status: Option<String>,
    culture_confirmed: bool,
    culture_category: String,
    culture_species: String,
    additional_organisms: Option<Vec<OrganismRecord>>,
    contact_lens_use: String,
    predisposing_factor: Option<Vec<String>>,
    other_history: Option<String>,
    visit_status: Option<String>,
    is_initial_visit: Option<bool>,
    smear_result: Option<String>,
    polymicrobial: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct UpdateVisitRequest {
    site_id: String,
    user_id: Option<String>,
    user_role: Option<String>,
    patient_id: String,
    visit_date: String,
    target_patient_id: String,
    target_visit_date: String,
    actual_visit_date: Option<String>,
    culture_status: Option<String>,
    culture_confirmed: bool,
    culture_category: String,
    culture_species: String,
    additional_organisms: Option<Vec<OrganismRecord>>,
    contact_lens_use: String,
    predisposing_factor: Option<Vec<String>>,
    other_history: Option<String>,
    visit_status: Option<String>,
    is_initial_visit: Option<bool>,
    smear_result: Option<String>,
    polymicrobial: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DeleteVisitRequest {
    site_id: String,
    user_id: Option<String>,
    user_role: Option<String>,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct UploadImageRequest {
    site_id: String,
    user_id: Option<String>,
    #[serde(rename = "user_role")]
    _user_role: Option<String>,
    patient_id: String,
    visit_date: String,
    view: String,
    is_representative: Option<bool>,
    file_name: Option<String>,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct DeleteVisitImagesRequest {
    site_id: String,
    user_id: Option<String>,
    user_role: Option<String>,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct RepresentativeImageRequest {
    site_id: String,
    user_id: Option<String>,
    user_role: Option<String>,
    patient_id: String,
    visit_date: String,
    representative_image_id: String,
}

