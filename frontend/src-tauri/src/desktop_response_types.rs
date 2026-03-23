#[derive(Debug, Serialize, Clone)]
struct PatientRecord {
    patient_id: String,
    created_by_user_id: Option<String>,
    sex: String,
    age: i64,
    chart_alias: String,
    local_case_code: String,
    created_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct PatientIdLookupResponse {
    requested_patient_id: String,
    normalized_patient_id: String,
    exists: bool,
    patient: Option<PatientRecord>,
    visit_count: i64,
    image_count: i64,
    latest_visit_date: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct VisitRecord {
    visit_id: String,
    patient_id: String,
    created_by_user_id: Option<String>,
    visit_date: String,
    actual_visit_date: Option<String>,
    culture_confirmed: bool,
    culture_category: String,
    culture_species: String,
    additional_organisms: Vec<OrganismRecord>,
    contact_lens_use: String,
    predisposing_factor: Vec<String>,
    other_history: String,
    visit_status: String,
    active_stage: bool,
    is_initial_visit: bool,
    smear_result: String,
    polymicrobial: bool,
    created_at: String,
}

#[derive(Debug, Serialize, Clone)]
struct CaseSummaryRecord {
    case_id: String,
    visit_id: String,
    patient_id: String,
    patient_reference_id: Option<String>,
    visit_date: String,
    visit_index: Option<i64>,
    actual_visit_date: Option<String>,
    chart_alias: String,
    local_case_code: String,
    sex: String,
    age: Option<i64>,
    culture_category: String,
    culture_species: String,
    additional_organisms: Vec<JsonValue>,
    contact_lens_use: String,
    predisposing_factor: Vec<JsonValue>,
    other_history: String,
    visit_status: String,
    active_stage: bool,
    is_initial_visit: bool,
    smear_result: String,
    polymicrobial: bool,
    research_registry_status: String,
    research_registry_updated_at: Option<String>,
    research_registry_updated_by: Option<String>,
    research_registry_source: Option<String>,
    image_count: i64,
    representative_image_id: Option<String>,
    representative_view: Option<String>,
    created_by_user_id: Option<String>,
    created_at: Option<String>,
    latest_image_uploaded_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct PatientListThumbnailRecord {
    case_id: String,
    image_id: String,
    view: Option<String>,
    preview_url: Option<String>,
    fallback_url: Option<String>,
    preview_path: Option<String>,
    fallback_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct PatientListRowRecord {
    patient_id: String,
    latest_case: CaseSummaryRecord,
    case_count: i64,
    organism_summary: String,
    representative_thumbnails: Vec<PatientListThumbnailRecord>,
}

#[derive(Debug, Serialize, Clone)]
struct PatientListPageResponse {
    items: Vec<PatientListRowRecord>,
    page: u32,
    page_size: u32,
    total_count: u32,
    total_pages: u32,
}

#[derive(Debug, Serialize, Clone)]
struct DesktopImageRecord {
    image_id: String,
    visit_id: String,
    patient_id: String,
    visit_date: String,
    view: String,
    image_path: String,
    is_representative: bool,
    content_url: Option<String>,
    preview_url: Option<String>,
    content_path: Option<String>,
    preview_path: Option<String>,
    lesion_prompt_box: Option<JsonValue>,
    uploaded_at: String,
    quality_scores: Option<JsonValue>,
}

#[derive(Debug, Serialize, Clone)]
struct ImagePreviewPathRecord {
    image_id: String,
    preview_path: Option<String>,
    fallback_path: Option<String>,
    ready: bool,
}

#[derive(Debug, Serialize)]
struct DeleteVisitResponse {
    patient_id: String,
    visit_date: String,
    deleted_images: i64,
    deleted_patient: bool,
    remaining_visit_count: i64,
}

#[derive(Debug, Serialize)]
struct DeleteImagesResponse {
    deleted_count: i64,
}

#[derive(Debug, Serialize)]
struct RepresentativeImageResponse {
    images: Vec<DesktopImageRecord>,
}

#[derive(Debug, Serialize)]
struct CaseHistoryResponse {
    validations: Vec<JsonValue>,
    contributions: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
struct ImageBinaryResponse {
    data: String,
    media_type: String,
}

#[derive(Debug, Serialize)]
struct FilePathResponse {
    path: String,
}

#[derive(Debug, Serialize, Clone)]
struct LesionPreviewRecord {
    patient_id: String,
    visit_date: String,
    image_id: Option<String>,
    view: String,
    is_representative: bool,
    source_image_path: String,
    has_lesion_crop: bool,
    has_lesion_mask: bool,
    backend: String,
    lesion_prompt_box: Option<JsonValue>,
}

#[derive(Debug, Serialize, Clone)]
struct ContributionLeaderboardEntry {
    rank: i64,
    user_id: String,
    public_alias: String,
    contribution_count: i64,
    last_contribution_at: Option<String>,
    is_current_user: bool,
}

#[derive(Debug, Serialize, Clone)]
struct ContributionLeaderboard {
    scope: String,
    site_id: Option<String>,
    leaderboard: Vec<ContributionLeaderboardEntry>,
    current_user: Option<ContributionLeaderboardEntry>,
}

#[derive(Debug, Serialize, Clone)]
struct SiteActivityValidationRecord {
    validation_id: String,
    run_date: String,
    model_version: String,
    model_architecture: String,
    n_cases: i64,
    n_images: i64,
    accuracy: Option<f64>,
    #[serde(rename = "AUROC")]
    auroc: Option<f64>,
    site_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct SiteActivityContributionRecord {
    contribution_id: String,
    contribution_group_id: Option<String>,
    created_at: String,
    user_id: String,
    public_alias: Option<String>,
    case_reference_id: Option<String>,
    update_id: String,
    update_status: Option<String>,
    upload_type: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct SiteActivityResponse {
    pending_updates: i64,
    recent_validations: Vec<SiteActivityValidationRecord>,
    recent_contributions: Vec<SiteActivityContributionRecord>,
    contribution_leaderboard: Option<ContributionLeaderboard>,
}

