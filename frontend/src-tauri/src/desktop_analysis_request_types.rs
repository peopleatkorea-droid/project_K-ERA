#[derive(Debug, Deserialize)]
struct CaseValidationCommandRequest {
    site_id: String,
    token: String,
    patient_id: String,
    visit_date: String,
    execution_mode: Option<String>,
    model_version_id: Option<String>,
    model_version_ids: Option<Vec<String>>,
    generate_gradcam: Option<bool>,
    generate_medsam: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CaseValidationCompareCommandRequest {
    site_id: String,
    token: String,
    patient_id: String,
    visit_date: String,
    model_version_ids: Vec<String>,
    execution_mode: Option<String>,
    generate_gradcam: Option<bool>,
    generate_medsam: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CaseAiClinicCommandRequest {
    site_id: String,
    token: String,
    patient_id: String,
    visit_date: String,
    execution_mode: Option<String>,
    model_version_id: Option<String>,
    model_version_ids: Option<Vec<String>>,
    top_k: Option<i64>,
    retrieval_backend: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CaseContributionCommandRequest {
    site_id: String,
    token: String,
    patient_id: String,
    visit_date: String,
    execution_mode: Option<String>,
    model_version_id: Option<String>,
    model_version_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct SiteJobCommandRequest {
    site_id: String,
    token: String,
    job_id: String,
}

#[derive(Debug, Deserialize)]
struct CasePreviewCommandRequest {
    site_id: String,
    token: String,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct LiveLesionPreviewStartCommandRequest {
    site_id: String,
    token: String,
    image_id: String,
}

#[derive(Debug, Deserialize)]
struct LiveLesionPreviewJobCommandRequest {
    site_id: String,
    token: String,
    image_id: String,
    job_id: String,
}

#[derive(Debug, Serialize, Clone)]
struct SiteJobUpdateEvent {
    site_id: String,
    job_id: String,
    job: Option<JsonValue>,
    status: Option<String>,
    terminal: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct LiveLesionPreviewUpdateEvent {
    site_id: String,
    image_id: String,
    job_id: String,
    job: Option<JsonValue>,
    status: Option<String>,
    terminal: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SemanticPromptCommandRequest {
    site_id: String,
    token: String,
    image_id: String,
    top_k: Option<i64>,
    input_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LocalApiQueryParam {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct LocalApiJsonCommandRequest {
    method: Option<String>,
    path: String,
    token: Option<String>,
    query: Option<Vec<LocalApiQueryParam>>,
    body: Option<JsonValue>,
}

#[derive(Debug, Deserialize)]
struct LocalApiMultipartField {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct LocalApiMultipartFile {
    field_name: String,
    file_name: String,
    content_type: Option<String>,
    data: String,
}

#[derive(Debug, Deserialize)]
struct LocalApiMultipartCommandRequest {
    path: String,
    token: Option<String>,
    query: Option<Vec<LocalApiQueryParam>>,
    fields: Option<Vec<LocalApiMultipartField>>,
    files: Vec<LocalApiMultipartFile>,
}

#[derive(Debug, Deserialize)]
struct SiteValidationsCommandRequest {
    site_id: String,
    token: String,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ValidationCasesCommandRequest {
    site_id: String,
    token: String,
    validation_id: String,
    misclassified_only: Option<bool>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SiteModelVersionsCommandRequest {
    site_id: String,
    token: String,
}

#[derive(Debug, Deserialize)]
struct SiteValidationRunCommandRequest {
    site_id: String,
    token: String,
    execution_mode: Option<String>,
    generate_gradcam: Option<bool>,
    generate_medsam: Option<bool>,
    model_version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InitialTrainingCommandRequest {
    site_id: String,
    token: String,
    architecture: Option<String>,
    execution_mode: Option<String>,
    crop_mode: Option<String>,
    case_aggregation: Option<String>,
    epochs: Option<i64>,
    learning_rate: Option<f64>,
    batch_size: Option<i64>,
    val_split: Option<f64>,
    test_split: Option<f64>,
    use_pretrained: Option<bool>,
    regenerate_split: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct InitialTrainingBenchmarkCommandRequest {
    site_id: String,
    token: String,
    architectures: Vec<String>,
    execution_mode: Option<String>,
    crop_mode: Option<String>,
    case_aggregation: Option<String>,
    epochs: Option<i64>,
    learning_rate: Option<f64>,
    batch_size: Option<i64>,
    val_split: Option<f64>,
    test_split: Option<f64>,
    use_pretrained: Option<bool>,
    regenerate_split: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ResumeInitialTrainingBenchmarkCommandRequest {
    site_id: String,
    token: String,
    job_id: String,
    execution_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CancelSiteJobCommandRequest {
    site_id: String,
    token: String,
    job_id: String,
}

#[derive(Debug, Deserialize)]
struct CrossValidationReportsCommandRequest {
    site_id: String,
    token: String,
}

#[derive(Debug, Deserialize)]
struct CrossValidationCommandRequest {
    site_id: String,
    token: String,
    architecture: Option<String>,
    execution_mode: Option<String>,
    crop_mode: Option<String>,
    case_aggregation: Option<String>,
    num_folds: Option<i64>,
    epochs: Option<i64>,
    learning_rate: Option<f64>,
    batch_size: Option<i64>,
    val_split: Option<f64>,
    use_pretrained: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct AiClinicEmbeddingStatusCommandRequest {
    site_id: String,
    token: String,
    model_version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingBackfillCommandRequest {
    site_id: String,
    token: String,
    execution_mode: Option<String>,
    model_version_id: Option<String>,
    force_refresh: Option<bool>,
}

