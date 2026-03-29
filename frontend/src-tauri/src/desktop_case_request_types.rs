#[derive(Debug, Deserialize)]
struct ListPatientBoardRequest {
    site_id: String,
    created_by_user_id: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    search: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListCasesRequest {
    site_id: String,
    created_by_user_id: Option<String>,
    patient_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SiteActivityRequest {
    site_id: String,
    current_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListPatientsRequest {
    site_id: String,
    created_by_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PatientLookupRequest {
    site_id: String,
    patient_id: String,
}

#[derive(Debug, Deserialize)]
struct ListVisitsRequest {
    site_id: String,
    patient_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListImagesRequest {
    site_id: String,
    patient_id: Option<String>,
    visit_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VisitImagesRequest {
    site_id: String,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct EnsureImagePreviewsRequest {
    site_id: String,
    image_ids: Vec<String>,
    max_side: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CaseHistoryRequest {
    site_id: String,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct StoredLesionPreviewsRequest {
    site_id: String,
    patient_id: String,
    visit_date: String,
}

#[derive(Debug, Deserialize)]
struct ImageBlobRequest {
    site_id: String,
    image_id: String,
}

#[derive(Debug, Deserialize)]
struct ValidationArtifactRequest {
    site_id: String,
    validation_id: String,
    patient_id: String,
    visit_date: String,
    artifact_kind: String,
}

#[derive(Debug, Deserialize)]
struct CasePreviewArtifactRequest {
    site_id: String,
    patient_id: String,
    visit_date: String,
    image_id: String,
    artifact_kind: String,
}

