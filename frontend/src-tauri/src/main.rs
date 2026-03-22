#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Cursor, Seek, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat};
use reqwest::blocking::multipart::{Form as MultipartForm, Part as MultipartPart};
use reqwest::blocking::Client as HttpClient;
use reqwest::Method as HttpMethod;
use reqwest::Url as HttpUrl;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_oauth::{cancel as cancel_oauth, start as start_oauth};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

mod desktop_diagnostics;
mod desktop_artifact_helpers;
mod desktop_config_store;
mod desktop_data_helpers;
mod desktop_case_queries;
mod desktop_local_api_bridge;
mod desktop_image_quality;
mod desktop_job_streams;
mod desktop_local_runtime;
mod desktop_ml_sidecar;
mod desktop_runtime_env;
mod desktop_runtime_contract;
mod desktop_site_activity;

use desktop_diagnostics::*;
use desktop_artifact_helpers::*;
use desktop_config_store::*;
use desktop_case_queries::*;
use desktop_data_helpers::*;
use desktop_image_quality::*;
use desktop_job_streams::*;
use desktop_local_api_bridge::*;
use desktop_local_runtime::*;
use desktop_ml_sidecar::*;
use desktop_runtime_env::*;
use desktop_runtime_contract::*;
use desktop_site_activity::*;

static LOCAL_BACKEND_STATE: OnceLock<Mutex<LocalBackendRuntime>> = OnceLock::new();
static ML_SIDECAR_STATE: OnceLock<Mutex<MlSidecarRuntime>> = OnceLock::new();
static LOCAL_WORKER_STATE: OnceLock<Mutex<LocalWorkerRuntime>> = OnceLock::new();
static DESKTOP_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static PREVIEW_WARM_STATE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SITE_JOB_UPDATE_EVENT: &str = "kera://site-job-update";
const LIVE_LESION_PREVIEW_UPDATE_EVENT: &str = "kera://live-lesion-preview-update";
const GOOGLE_OAUTH_REDIRECT_EVENT: &str = "kera://oauth-redirect";
const DEFAULT_CASE_REFERENCE_SALT: &str = "kera-case-reference-v1";

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

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq, Eq)]
struct FederationSaltConfigFile {
    case_reference_salt: Option<String>,
    patient_reference_salt: Option<String>,
    public_alias_salt: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenDesktopPathRequest {
    path: String,
}

#[derive(Debug, Deserialize, Default)]
struct PickDesktopDirectoryRequest {
    title: Option<String>,
    default_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct GoogleOAuthServerResponse {
    port: u16,
}

fn open_path_in_shell(path: &Path) -> Result<(), String> {
    let resolved = if path.exists() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    };
    if !resolved.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        if path.exists() && path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(&resolved);
        }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if path.exists() && path.is_file() {
            command.arg("-R").arg(path);
        } else {
            command.arg(&resolved);
        }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&resolved)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("Opening desktop paths is not supported on this platform.".to_string())
}

fn open_external_url_in_browser(url: &str) -> Result<(), String> {
    let parsed = HttpUrl::parse(url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https URLs are supported.".to_string()),
    }

    #[cfg(windows)]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("Opening external URLs is not supported on this platform.".to_string())
}

fn normalize_patient_pseudonym(value: &str) -> Result<String, String> {
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

fn normalize_visit_label(value: &str) -> Result<String, String> {
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

fn visit_index_from_label(value: &str) -> Result<i64, String> {
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

fn normalize_actual_visit_date(value: Option<&str>) -> Result<Option<String>, String> {
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

fn parse_json_value(raw: Option<String>, fallback: JsonValue) -> JsonValue {
    raw.and_then(|value| serde_json::from_str::<JsonValue>(&value).ok())
        .unwrap_or(fallback)
}

fn normalize_additional_organisms(
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

fn normalize_visit_status(value: Option<&str>, active_stage: bool) -> String {
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

fn organism_summary_label(
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

fn case_sort_key(record: &CaseSummaryRecord) -> (String, String, String, String) {
    (
        record.latest_image_uploaded_at.clone().unwrap_or_default(),
        record.created_at.clone().unwrap_or_default(),
        record.visit_date.clone(),
        record.patient_id.clone(),
    )
}

fn build_search_clause(search: &Option<String>, params: &mut Vec<Value>) -> String {
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

fn mime_type_for_path(path: &Path) -> String {
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

fn has_site_wide_write_access(auth: &MutationAuth) -> bool {
    matches!(
        auth.user_role
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(role) if role == "admin" || role == "site_admin"
    )
}

fn require_record_owner(
    auth: &MutationAuth,
    owner_user_id: Option<&str>,
    detail: &str,
) -> Result<(), String> {
    if has_site_wide_write_access(auth) {
        return Ok(());
    }
    let current_user_id = auth
        .user_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let owner = owner_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    if owner.is_some() && owner == current_user_id {
        return Ok(());
    }
    Err(detail.to_string())
}

fn json_string_field(value: &JsonValue, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

#[tauri::command]
fn get_local_backend_status() -> Result<LocalBackendStatus, String> {
    get_local_backend_status_internal()
}

#[tauri::command]
fn get_local_worker_status() -> Result<LocalWorkerStatus, String> {
    get_local_worker_status_internal()
}

#[tauri::command]
fn ensure_local_worker() -> Result<LocalWorkerStatus, String> {
    ensure_local_worker_ready_internal()
}

#[tauri::command]
fn ensure_local_backend() -> Result<LocalBackendStatus, String> {
    ensure_local_backend_ready_internal()
}

#[tauri::command]
fn ensure_local_runtime() -> Result<LocalBackendStatus, String> {
    ensure_local_runtime_ready_internal()
}

#[tauri::command]
fn stop_local_backend() -> Result<LocalBackendStatus, String> {
    stop_local_backend_internal()
}

#[tauri::command]
fn stop_local_worker() -> Result<LocalWorkerStatus, String> {
    stop_local_worker_internal()
}

#[tauri::command]
fn stop_local_runtime() -> Result<LocalBackendStatus, String> {
    stop_local_runtime_internal()
}

#[tauri::command]
fn get_ml_sidecar_status() -> Result<MlSidecarStatus, String> {
    get_ml_sidecar_status_internal()
}

#[tauri::command]
fn ensure_ml_sidecar() -> Result<MlSidecarStatus, String> {
    let status = ensure_ml_sidecar_ready_internal()?;
    schedule_ml_sidecar_workflow_warmup();
    Ok(status)
}

#[tauri::command]
fn stop_ml_sidecar() -> Result<MlSidecarStatus, String> {
    stop_ml_sidecar_internal()
}

#[tauri::command]
fn get_desktop_app_config() -> Result<DesktopAppConfigResponse, String> {
    Ok(desktop_app_config_response())
}

#[tauri::command]
fn save_desktop_app_config(
    payload: SaveDesktopAppConfigRequest,
) -> Result<DesktopAppConfigResponse, String> {
    let mut next_config = read_desktop_config_file();
    set_config_env_value(
        &mut next_config.env,
        "KERA_STORAGE_DIR",
        normalized_storage_dir_value(payload.config.storage_dir)?,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_API_BASE_URL",
        payload.config.control_plane_api_base_url,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_NODE_ID",
        payload.config.control_plane_node_id,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_NODE_TOKEN",
        payload.config.control_plane_node_token,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_CONTROL_PLANE_SITE_ID",
        payload.config.control_plane_site_id,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_LOCAL_BACKEND_PYTHON",
        payload.config.local_backend_python,
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_LOCAL_BACKEND_MODE",
        payload.config.local_backend_mode.map(|value| {
            if value.eq_ignore_ascii_case("external") {
                "external"
            } else {
                "managed"
            }
            .to_string()
        }),
    );
    set_config_env_value(
        &mut next_config.env,
        "KERA_DESKTOP_ML_TRANSPORT",
        payload.config.ml_transport.map(|value| {
            if value.eq_ignore_ascii_case("http") {
                "http"
            } else {
                "sidecar"
            }
            .to_string()
        }),
    );
    write_desktop_config_file(&next_config)?;
    let _ = stop_local_runtime_internal();
    Ok(desktop_app_config_response())
}

#[tauri::command]
fn clear_desktop_app_config() -> Result<DesktopAppConfigResponse, String> {
    clear_desktop_config_file()?;
    let _ = stop_local_runtime_internal();
    Ok(desktop_app_config_response())
}

#[tauri::command]
fn open_desktop_path(payload: OpenDesktopPathRequest) -> Result<(), String> {
    let normalized = payload.path.trim();
    if normalized.is_empty() {
        return Err("Path is required.".to_string());
    }
    open_path_in_shell(&PathBuf::from(normalized))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err("URL is required.".to_string());
    }
    open_external_url_in_browser(normalized)
}

#[tauri::command]
fn export_desktop_diagnostics_bundle(app: AppHandle) -> Result<Option<FilePathResponse>, String> {
    let default_file_name = support_bundle_default_name();
    let mut dialog = rfd::FileDialog::new()
        .set_title("Export desktop support bundle")
        .add_filter("ZIP archive", &["zip"])
        .set_file_name(&default_file_name);
    let default_dir = desktop_app_local_data_dir();
    if default_dir.exists() {
        dialog = dialog.set_directory(default_dir);
    }
    let Some(target_path) = dialog.save_file() else {
        return Ok(None);
    };
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let bundle_file = File::create(&target_path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(bundle_file);

    let config_response = desktop_app_config_response();
    let mut desktop_config = read_desktop_config_file();
    desktop_config.env = redacted_desktop_env(&desktop_config.env);
    let runtime_dir = PathBuf::from(&config_response.runtime_contract.runtime_dir);
    let local_backend_status = redacted_json(&diagnostics_value(get_local_backend_status()));
    let local_worker_status = redacted_json(&diagnostics_value(get_local_worker_status()));
    let ml_sidecar_status = redacted_json(&diagnostics_value(get_ml_sidecar_status()));
    let local_health = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/health",
        "",
        Vec::new(),
        None,
    )));
    let local_node_status = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/control-plane/node/status",
        "",
        Vec::new(),
        None,
    )));
    let desktop_self_check = redacted_json(&diagnostics_value(request_local_api_json_owned(
        HttpMethod::GET,
        "/api/desktop/self-check",
        "",
        Vec::new(),
        None,
    )));
    let control_plane_auth_status = redacted_json(&fetch_control_plane_status_for_bundle(
        &config_response.values.control_plane_api_base_url,
    ));
    let exported_logs = append_runtime_logs_to_bundle(&mut zip, &runtime_dir)?;
    let redacted_config_response = redacted_json(&config_response);

    write_zip_json_entry(
        &mut zip,
        "manifest.json",
        &json!({
            "exported_at": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            "app_version": app.package_info().version.to_string(),
            "runtime_mode": config_response.runtime_contract.mode,
            "packaged_mode": config_response.runtime_contract.packaged_mode,
            "runtime_dir": config_response.runtime_contract.runtime_dir,
            "config_path": config_response.config_path,
            "control_plane_api_base_url": config_response.values.control_plane_api_base_url,
            "included_log_paths": exported_logs,
        }),
    )?;
    write_zip_json_entry(&mut zip, "desktop-config.json", &desktop_config)?;
    write_zip_json_entry(&mut zip, "desktop-app-config-response.json", &redacted_config_response)?;
    write_zip_json_entry(&mut zip, "local-backend-status.json", &local_backend_status)?;
    write_zip_json_entry(&mut zip, "local-worker-status.json", &local_worker_status)?;
    write_zip_json_entry(&mut zip, "ml-sidecar-status.json", &ml_sidecar_status)?;
    write_zip_json_entry(&mut zip, "local-health.json", &local_health)?;
    write_zip_json_entry(&mut zip, "local-node-status.json", &local_node_status)?;
    write_zip_json_entry(&mut zip, "desktop-self-check.json", &desktop_self_check)?;
    write_zip_json_entry(
        &mut zip,
        "control-plane-desktop-auth-status.json",
        &control_plane_auth_status,
    )?;

    zip.finish().map_err(|error| error.to_string())?;
    Ok(Some(FilePathResponse {
        path: target_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
fn start_google_oauth_server(window: Window) -> Result<GoogleOAuthServerResponse, String> {
    let listener_window = window.clone();
    let port = start_oauth(move |url| {
        let _ = listener_window.emit(GOOGLE_OAUTH_REDIRECT_EVENT, url);
    })
    .map_err(|error| error.to_string())?;
    Ok(GoogleOAuthServerResponse { port })
}

#[tauri::command]
fn cancel_google_oauth_server(port: u16) -> Result<(), String> {
    cancel_oauth(port).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_desktop_directory(payload: PickDesktopDirectoryRequest) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Select a directory");
    dialog = dialog.set_title(title);
    if let Some(default_path) = payload
        .default_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let candidate = PathBuf::from(default_path);
        let start_dir = if candidate.is_dir() {
            candidate
        } else {
            candidate
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or(candidate)
        };
        if start_dir.exists() {
            dialog = dialog.set_directory(start_dir);
        }
    }
    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn request_local_json(payload: LocalApiJsonCommandRequest) -> Result<JsonValue, String> {
    let method = normalize_http_method(payload.method.as_deref())?;
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let body = payload.body;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_json_owned(method, &path, &token, query, body)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn request_local_binary(
    payload: LocalApiJsonCommandRequest,
) -> Result<ImageBinaryResponse, String> {
    let method = normalize_http_method(payload.method.as_deref())?;
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let body = payload.body;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_binary_owned(method, &path, &token, query, body)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn request_local_multipart(payload: LocalApiMultipartCommandRequest) -> Result<JsonValue, String> {
    let path = payload.path;
    let token = payload.token.unwrap_or_default();
    let query = normalize_local_api_query(payload.query);
    let fields = payload.fields.unwrap_or_default();
    let files = payload.files;
    tauri::async_runtime::spawn_blocking(move || {
        request_local_api_multipart(&path, &token, query, fields, files)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_case_validation(payload: CaseValidationCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let model_version_id = payload.model_version_id;
    let model_version_ids = payload.model_version_ids;
    let generate_gradcam = payload.generate_gradcam.unwrap_or(true);
    let generate_medsam = payload.generate_medsam.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "generate_gradcam": generate_gradcam,
            "generate_medsam": generate_medsam,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_validation", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/validate"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
                "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_case_validation_compare(
    payload: CaseValidationCompareCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let model_version_ids = payload.model_version_ids;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let generate_gradcam = payload.generate_gradcam.unwrap_or(false);
    let generate_medsam = payload.generate_medsam.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "model_version_ids": model_version_ids,
            "execution_mode": execution_mode,
            "generate_gradcam": generate_gradcam,
            "generate_medsam": generate_medsam,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_validation_compare", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/validate/compare"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
                "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_case_ai_clinic(payload: CaseAiClinicCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let model_version_id = payload.model_version_id;
    let model_version_ids = payload.model_version_ids;
    let top_k = payload.top_k.unwrap_or(3);
    let retrieval_backend = payload.retrieval_backend.unwrap_or_else(|| "standard".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "top_k": top_k,
            "retrieval_backend": retrieval_backend,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_ai_clinic", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/ai-clinic"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "top_k": request_payload.get("top_k").cloned().unwrap_or(JsonValue::Null),
                "retrieval_backend": request_payload.get("retrieval_backend").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_case_ai_clinic_similar_cases(payload: CaseAiClinicCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    let execution_mode = payload.execution_mode.unwrap_or_else(|| "auto".to_string());
    let model_version_id = payload.model_version_id;
    let model_version_ids = payload.model_version_ids;
    let top_k = payload.top_k.unwrap_or(3);
    let retrieval_backend = payload.retrieval_backend.unwrap_or_else(|| "classifier".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "execution_mode": execution_mode,
            "model_version_id": model_version_id,
            "model_version_ids": model_version_ids,
            "top_k": top_k,
            "retrieval_backend": retrieval_backend,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("run_case_ai_clinic_similar_cases", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/cases/ai-clinic/similar-cases"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            Some(json!({
                "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
                "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
                "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
                "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
                "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
                "top_k": request_payload.get("top_k").cloned().unwrap_or(JsonValue::Null),
                "retrieval_backend": request_payload.get("retrieval_backend").cloned().unwrap_or(JsonValue::Null),
            })),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn run_case_contribution(payload: CaseContributionCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "patient_id": payload.patient_id,
        "visit_date": payload.visit_date,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "model_version_id": payload.model_version_id,
        "model_version_ids": payload.model_version_ids,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_case_contribution", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/cases/contribute"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "patient_id": request_payload.get("patient_id").cloned().unwrap_or(JsonValue::Null),
            "visit_date": request_payload.get("visit_date").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
            "model_version_ids": request_payload.get("model_version_ids").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn fetch_site_job(payload: SiteJobCommandRequest) -> Result<JsonValue, String> {
    fetch_site_job_command(payload)
}

#[tauri::command]
fn start_site_job_event_stream(
    app: AppHandle,
    payload: SiteJobCommandRequest,
) -> Result<(), String> {
    start_site_job_event_stream_command(app, payload)
}

#[tauri::command]
async fn fetch_case_roi_preview(payload: CasePreviewCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("fetch_case_roi_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::GET,
            &format!("/api/sites/{site_id}/cases/roi-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            vec![
                (
                    "patient_id",
                    request_payload
                        .get("patient_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "visit_date",
                    request_payload
                        .get("visit_date")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
            ],
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_case_lesion_preview(payload: CasePreviewCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let token = payload.token;
    let patient_id = payload.patient_id;
    let visit_date = payload.visit_date;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "patient_id": patient_id,
            "visit_date": visit_date,
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("fetch_case_lesion_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::GET,
            &format!("/api/sites/{site_id}/cases/lesion-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            vec![
                (
                    "patient_id",
                    request_payload
                        .get("patient_id")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
                (
                    "visit_date",
                    request_payload
                        .get("visit_date")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .to_string(),
                ),
            ],
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_live_lesion_preview(
    payload: LiveLesionPreviewStartCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let token = payload.token;
    tauri::async_runtime::spawn_blocking(move || {
        let request_payload = json!({
            "site_id": site_id.clone(),
            "token": token,
            "image_id": image_id.clone(),
        });
        if ml_sidecar_should_be_used() {
            return request_ml_sidecar_json("start_live_lesion_preview", request_payload);
        }
        request_local_api_json(
            HttpMethod::POST,
            &format!("/api/sites/{site_id}/images/{image_id}/lesion-live-preview"),
            request_payload
                .get("token")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            Vec::new(),
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_live_lesion_preview_job(
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<JsonValue, String> {
    fetch_live_lesion_preview_job_command(payload).await
}

#[tauri::command]
fn start_live_lesion_preview_event_stream(
    app: AppHandle,
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<(), String> {
    start_live_lesion_preview_event_stream_command(app, payload)
}

#[tauri::command]
fn fetch_image_semantic_prompt_scores(
    payload: SemanticPromptCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "image_id": image_id,
        "top_k": payload.top_k.unwrap_or(3),
        "input_mode": payload
            .input_mode
            .unwrap_or_else(|| "source".to_string()),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_image_semantic_prompt_scores", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!(
            "/api/sites/{}/images/{}/semantic-prompts",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("image_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        vec![
            (
                "top_k",
                request_payload
                    .get("top_k")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(3)
                    .to_string(),
            ),
            (
                "input_mode",
                request_payload
                    .get("input_mode")
                    .and_then(|value| value.as_str())
                    .unwrap_or("source")
                    .to_string(),
            ),
        ],
        None,
    )
}

#[tauri::command]
fn fetch_site_validations(payload: SiteValidationsCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let limit = payload.limit.filter(|value| *value > 0);
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "limit": limit,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_validations", request_payload);
    }
    let mut query = Vec::new();
    if let Some(limit) = request_payload
        .get("limit")
        .and_then(|value| value.as_i64())
    {
        query.push(("limit", limit.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/validations"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
fn fetch_validation_cases(payload: ValidationCasesCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    if site_id.is_empty() || validation_id.is_empty() {
        return Err("site_id and validation_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "validation_id": validation_id,
        "misclassified_only": payload.misclassified_only.unwrap_or(false),
        "limit": payload.limit,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_validation_cases", request_payload);
    }
    let mut query = Vec::new();
    if request_payload
        .get("misclassified_only")
        .and_then(|value| value.as_bool())
        == Some(true)
    {
        query.push(("misclassified_only", "true".to_string()));
    }
    if let Some(limit) = request_payload
        .get("limit")
        .and_then(|value| value.as_i64())
    {
        query.push(("limit", limit.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!(
            "/api/sites/{}/validations/{}/cases",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("validation_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
fn fetch_site_model_versions(
    payload: SiteModelVersionsCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_model_versions", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/model-versions"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
fn run_site_validation(payload: SiteValidationRunCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "generate_gradcam": payload.generate_gradcam.unwrap_or(true),
        "generate_medsam": payload.generate_medsam.unwrap_or(true),
        "model_version_id": payload.model_version_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_site_validation", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/validations/run"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "generate_gradcam": request_payload.get("generate_gradcam").cloned().unwrap_or(JsonValue::Null),
            "generate_medsam": request_payload.get("generate_medsam").cloned().unwrap_or(JsonValue::Null),
            "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn run_initial_training(payload: InitialTrainingCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "architecture": payload.architecture.unwrap_or_else(|| "convnext_tiny".to_string()),
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "case_aggregation": payload.case_aggregation.unwrap_or_else(|| "mean".to_string()),
        "epochs": payload.epochs.unwrap_or(30),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "test_split": payload.test_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
        "regenerate_split": payload.regenerate_split.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_initial_training", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/initial"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "architecture": request_payload.get("architecture").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "case_aggregation": request_payload.get("case_aggregation").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "test_split": request_payload.get("test_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
            "regenerate_split": request_payload.get("regenerate_split").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn run_initial_training_benchmark(
    payload: InitialTrainingBenchmarkCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "architectures": payload.architectures,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "case_aggregation": payload.case_aggregation.unwrap_or_else(|| "mean".to_string()),
        "epochs": payload.epochs.unwrap_or(30),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "test_split": payload.test_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
        "regenerate_split": payload.regenerate_split.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_initial_training_benchmark", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/initial/benchmark"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "architectures": request_payload.get("architectures").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "case_aggregation": request_payload.get("case_aggregation").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "test_split": request_payload.get("test_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
            "regenerate_split": request_payload.get("regenerate_split").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn resume_initial_training_benchmark(
    payload: ResumeInitialTrainingBenchmarkCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "job_id": job_id,
        "execution_mode": payload.execution_mode,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("resume_initial_training_benchmark", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!(
            "/api/sites/{}/training/initial/benchmark/resume",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "job_id": request_payload.get("job_id").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn cancel_site_job(payload: CancelSiteJobCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("cancel_site_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!(
            "/api/sites/{}/jobs/{}/cancel",
            request_payload
                .get("site_id")
                .and_then(|value| value.as_str())
                .unwrap_or(""),
            request_payload
                .get("job_id")
                .and_then(|value| value.as_str())
                .unwrap_or("")
        ),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
fn fetch_cross_validation_reports(
    payload: CrossValidationReportsCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_cross_validation_reports", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/training/cross-validation"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        None,
    )
}

#[tauri::command]
fn run_cross_validation(payload: CrossValidationCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "architecture": payload.architecture.unwrap_or_else(|| "convnext_tiny".to_string()),
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "crop_mode": payload.crop_mode.unwrap_or_else(|| "automated".to_string()),
        "case_aggregation": payload.case_aggregation.unwrap_or_else(|| "mean".to_string()),
        "num_folds": payload.num_folds.unwrap_or(5),
        "epochs": payload.epochs.unwrap_or(10),
        "learning_rate": payload.learning_rate.unwrap_or(1e-4),
        "batch_size": payload.batch_size.unwrap_or(16),
        "val_split": payload.val_split.unwrap_or(0.2),
        "use_pretrained": payload.use_pretrained.unwrap_or(true),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("run_cross_validation", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/training/cross-validation"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "architecture": request_payload.get("architecture").cloned().unwrap_or(JsonValue::Null),
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "crop_mode": request_payload.get("crop_mode").cloned().unwrap_or(JsonValue::Null),
            "case_aggregation": request_payload.get("case_aggregation").cloned().unwrap_or(JsonValue::Null),
            "num_folds": request_payload.get("num_folds").cloned().unwrap_or(JsonValue::Null),
            "epochs": request_payload.get("epochs").cloned().unwrap_or(JsonValue::Null),
            "learning_rate": request_payload.get("learning_rate").cloned().unwrap_or(JsonValue::Null),
            "batch_size": request_payload.get("batch_size").cloned().unwrap_or(JsonValue::Null),
            "val_split": request_payload.get("val_split").cloned().unwrap_or(JsonValue::Null),
            "use_pretrained": request_payload.get("use_pretrained").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn fetch_ai_clinic_embedding_status(
    payload: AiClinicEmbeddingStatusCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let model_version_id = payload
        .model_version_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "model_version_id": model_version_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_ai_clinic_embedding_status", request_payload);
    }
    let mut query = Vec::new();
    if let Some(model_version_id) = request_payload
        .get("model_version_id")
        .and_then(|value| value.as_str())
    {
        query.push(("model_version_id", model_version_id.to_string()));
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/ai-clinic/embeddings/status"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        query,
        None,
    )
}

#[tauri::command]
fn backfill_ai_clinic_embeddings(
    payload: EmbeddingBackfillCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "model_version_id": payload.model_version_id,
        "force_refresh": payload.force_refresh.unwrap_or(false),
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("backfill_ai_clinic_embeddings", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!("/api/sites/{site_id}/ai-clinic/embeddings/backfill"),
        request_payload
            .get("token")
            .and_then(|value| value.as_str())
            .unwrap_or(""),
        Vec::new(),
        Some(json!({
            "execution_mode": request_payload.get("execution_mode").cloned().unwrap_or(JsonValue::Null),
            "model_version_id": request_payload.get("model_version_id").cloned().unwrap_or(JsonValue::Null),
            "force_refresh": request_payload.get("force_refresh").cloned().unwrap_or(JsonValue::Null),
        })),
    )
}

#[tauri::command]
fn list_cases(payload: ListCasesRequest) -> Result<Vec<CaseSummaryRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    query_case_summaries(
        &conn,
        &site_id,
        payload
            .created_by_user_id
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty()),
    )
}

#[tauri::command]
fn get_site_activity(payload: SiteActivityRequest) -> Result<SiteActivityResponse, String> {
    get_site_activity_response(payload)
}

#[tauri::command]
fn list_patients(payload: ListPatientsRequest) -> Result<Vec<PatientRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let mut sql = "
      select patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at
      from patients
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id)];
    if let Some(created_by_user_id) = payload
        .created_by_user_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and created_by_user_id = ?");
        params.push(Value::Text(created_by_user_id.to_string()));
    }
    sql.push_str(" order by created_at desc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), patient_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut patients = Vec::new();
    for row in rows {
        patients.push(row.map_err(|error| error.to_string())?);
    }
    Ok(patients)
}

#[tauri::command]
fn lookup_patient_id(payload: PatientLookupRequest) -> Result<PatientIdLookupResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let requested_patient_id = payload.patient_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&requested_patient_id)?;
    let conn = open_data_plane_db()?;
    let patient = get_patient(&conn, &site_id, &normalized_patient_id)?;
    let visit_count = conn
        .query_row(
            "select count(*) from visits where site_id = ? and patient_id = ?",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let image_count = conn
        .query_row(
            "select count(*) from images where site_id = ? and patient_id = ?",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let latest_visit_date = conn
        .query_row(
            "
            select visit_date
            from visits
            where site_id = ? and patient_id = ?
            order by visit_index desc, visit_date desc
            limit 1
            ",
            params![site_id, normalized_patient_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();

    Ok(PatientIdLookupResponse {
        requested_patient_id,
        normalized_patient_id,
        exists: patient.is_some(),
        patient,
        visit_count,
        image_count,
        latest_visit_date,
    })
}

#[tauri::command]
fn list_visits(payload: ListVisitsRequest) -> Result<Vec<VisitRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let mut sql = "
      select
        visit_id,
        patient_id,
        created_by_user_id,
        visit_date,
        actual_visit_date,
        culture_confirmed,
        culture_category,
        culture_species,
        additional_organisms,
        contact_lens_use,
        predisposing_factor,
        other_history,
        visit_status,
        active_stage,
        is_initial_visit,
        smear_result,
        polymicrobial,
        created_at
      from visits
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id)];
    if let Some(patient_id) = payload
        .patient_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and patient_id = ?");
        params.push(Value::Text(normalize_patient_pseudonym(patient_id)?));
    }
    sql.push_str(" order by patient_id asc, visit_index asc, visit_date asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), visit_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut visits = Vec::new();
    for row in rows {
        visits.push(row.map_err(|error| error.to_string())?);
    }
    Ok(visits)
}

#[tauri::command]
fn list_images(payload: ListImagesRequest) -> Result<Vec<DesktopImageRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = payload
        .patient_id
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(normalize_patient_pseudonym)
        .transpose()?;
    let visit_date = payload
        .visit_date
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(normalize_visit_label)
        .transpose()?;
    let preview_max_side = if patient_id.is_some() && visit_date.is_some() {
        Some(640)
    } else {
        None
    };
    let conn = open_data_plane_db()?;
    query_images(
        &conn,
        &site_id,
        patient_id.as_deref(),
        visit_date.as_deref(),
        preview_max_side,
    )
}

#[tauri::command]
fn get_visit_images(payload: VisitImagesRequest) -> Result<Vec<DesktopImageRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)
}

#[tauri::command]
fn ensure_image_previews(
    payload: EnsureImagePreviewsRequest,
) -> Result<Vec<ImagePreviewPathRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let max_side = payload.max_side.unwrap_or(640).clamp(96, 1024);
    // Deduplicate preserving order
    let mut seen_ids: HashSet<String> = HashSet::new();
    let unique_ids: Vec<String> = payload
        .image_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen_ids.insert(id.clone()))
        .collect();
    if unique_ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_data_plane_db()?;

    // Batch fetch all image paths in a single IN query instead of N round-trips
    let placeholders = std::iter::repeat("?")
        .take(unique_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let batch_sql = format!(
        "select image_id, image_path from images where site_id = ? and image_id in ({placeholders})"
    );
    let mut batch_params: Vec<Value> = vec![Value::Text(site_id.clone())];
    for id in &unique_ids {
        batch_params.push(Value::Text(id.clone()));
    }
    let mut path_by_id: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare(&batch_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(batch_params), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (image_id, image_path) = row.map_err(|e| e.to_string())?;
            path_by_id.insert(image_id, image_path);
        }
    }

    let mut records = Vec::new();
    for image_id in unique_ids {
        let Some(stored_image_path) = path_by_id.get(&image_id) else {
            records.push(ImagePreviewPathRecord {
                image_id,
                preview_path: None,
                fallback_path: None,
                ready: false,
            });
            continue;
        };
        let source_path = resolve_site_runtime_path(&site_id, stored_image_path)?;
        let fallback_path = existing_file_path_string(&source_path);
        let preview_path = preview_file_path(&site_id, &image_id, &source_path, max_side).ok();
        records.push(ImagePreviewPathRecord {
            image_id,
            ready: preview_path.is_some(),
            preview_path,
            fallback_path,
        });
    }
    Ok(records)
}

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

// ─── Session cache: store user+sites locally so app opens instantly without Python ───

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedSessionUser {
    user_id: String,
    username: String,
    full_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    public_alias: Option<String>,
    role: String,
    site_ids: Option<Vec<String>>,
    approval_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedSessionSite {
    site_id: String,
    display_name: String,
    hospital_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_institution_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionCachePayload {
    token: String,
    user: CachedSessionUser,
    sites: Vec<CachedSessionSite>,
}

fn session_cache_path() -> PathBuf {
    desktop_app_local_data_dir().join("session_cache.json")
}

#[tauri::command]
fn load_session_cache() -> Option<SessionCachePayload> {
    let path = session_cache_path();
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
fn save_session_cache(payload: SessionCachePayload) -> Result<(), String> {
    let path = session_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_session_cache() -> Result<(), String> {
    let path = session_cache_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_patient_board(payload: ListPatientBoardRequest) -> Result<PatientListPageResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }

    let page_size = payload.page_size.unwrap_or(25).clamp(1, 100);
    let page = payload.page.unwrap_or(1).max(1);
    let conn = open_data_plane_db()?;

    let mine_user_id = payload
        .created_by_user_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    // Build the mine/search clauses using ids_params directly (one query instead of two)
    let mut ids_params = vec![
        Value::Text(site_id.clone()),
        Value::Text(site_id.clone()),
    ];
    let mine_clause = if let Some(created_by_user_id) = mine_user_id.as_ref() {
        ids_params.push(Value::Text(created_by_user_id.clone()));
        " and p.created_by_user_id = ? ".to_string()
    } else {
        String::new()
    };
    let search_clause = build_search_clause(&payload.search, &mut ids_params);
    ids_params.push(Value::Text(site_id.clone())); // image_stats: site_id
    let raw_offset = (page.saturating_sub(1) * page_size) as i64;
    ids_params.push(Value::Integer(page_size as i64));
    ids_params.push(Value::Integer(raw_offset));

    // Single query: paged patient rows + total count via scalar subquery.
    // Eliminates the separate COUNT round-trip to SQLite.
    let ids_sql = format!(
        "
        with filtered_visits as (
          select v.visit_id, v.patient_id, v.created_at, v.visit_index
          from patients p
          join visits v on p.site_id = v.site_id and p.patient_id = v.patient_id
          where p.site_id = ? and v.site_id = ?
          {mine_clause}
          {search_clause}
        ),
        image_stats as (
          select visit_id, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and visit_id in (select visit_id from filtered_visits)
          group by visit_id
        ),
        all_patients as (
          select
            fv.patient_id,
            count(fv.visit_id) as case_count,
            max(coalesce(image_stats.latest_image_uploaded_at, '')) as max_upload,
            max(coalesce(fv.created_at, '')) as max_created,
            max(coalesce(fv.visit_index, 0)) as max_visit_index
          from filtered_visits fv
          left join image_stats on fv.visit_id = image_stats.visit_id
          group by fv.patient_id
        )
        select
          patient_id,
          case_count,
          max_upload,
          max_created,
          max_visit_index,
          (select count(*) from all_patients) as total_count
        from all_patients
        order by max_upload desc, max_created desc, max_visit_index desc
        limit ? offset ?
        "
    );

    let mut patient_ids = Vec::new();
    let mut case_counts = HashMap::new();
    let mut total_count: u32 = 0;
    {
        let mut stmt = conn.prepare(&ids_sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(ids_params), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (patient_id, case_count, row_total) = row.map_err(|error| error.to_string())?;
            if total_count == 0 {
                total_count = row_total.max(0) as u32;
            }
            case_counts.insert(patient_id.clone(), case_count);
            patient_ids.push(patient_id);
        }
    }
    let total_pages = total_count.max(1).div_ceil(page_size);
    let safe_page = page.min(total_pages.max(1));

    if patient_ids.is_empty() {
        return Ok(PatientListPageResponse {
            items: Vec::new(),
            page: safe_page,
            page_size,
            total_count,
            total_pages: total_pages.max(1),
        });
    }

    let placeholders = std::iter::repeat("?")
        .take(patient_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    // params: site_id + patient_ids (paged_visits), site_id (image_stats),
    //         site_id (rep_images), site_id (main WHERE) + patient_ids
    let mut case_params = vec![Value::Text(site_id.clone())];
    for patient_id in &patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }
    case_params.push(Value::Text(site_id.clone()));
    case_params.push(Value::Text(site_id.clone()));
    case_params.push(Value::Text(site_id.clone()));
    for patient_id in &patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }

    let case_sql = format!(
        "
        with paged_patient_visits as (
          select visit_id from visits
          where site_id = ? and patient_id in ({placeholders})
        ),
        image_stats as (
          select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and visit_id in (select visit_id from paged_patient_visits)
          group by visit_id
        ),
        representative_images as (
          select visit_id, image_id as representative_image_id, view as representative_view, image_path as representative_image_path
          from images
          where site_id = ? and is_representative = 1
            and visit_id in (select visit_id from paged_patient_visits)
        )
        select
          v.visit_id,
          v.patient_id,
          v.patient_reference_id,
          v.visit_date,
          v.visit_index,
          v.actual_visit_date,
          v.culture_category,
          v.culture_species,
          v.additional_organisms,
          v.contact_lens_use,
          v.predisposing_factor,
          v.other_history,
          v.visit_status,
          v.active_stage,
          v.is_initial_visit,
          v.smear_result,
          v.polymicrobial,
          v.research_registry_status,
          v.research_registry_updated_at,
          v.research_registry_updated_by,
          v.research_registry_source,
          v.created_at,
          p.chart_alias,
          p.local_case_code,
          p.sex,
          p.age,
          p.created_by_user_id,
          coalesce(image_stats.image_count, 0) as image_count,
          image_stats.latest_image_uploaded_at,
          representative_images.representative_image_id,
          representative_images.representative_view,
          representative_images.representative_image_path
        from visits v
        join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
        left join image_stats on v.visit_id = image_stats.visit_id
        left join representative_images on v.visit_id = representative_images.visit_id
        where v.site_id = ? and v.patient_id in ({placeholders})
        order by image_stats.latest_image_uploaded_at desc, v.created_at desc, v.visit_index desc
        "
    );

    let mut cases_by_patient: HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>> =
        HashMap::new();
    {
        let mut stmt = conn.prepare(&case_sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(case_params), |row| {
                let record = case_summary_from_row(row)?;
                let representative_image_path =
                    row.get::<_, Option<String>>("representative_image_path")?;
                Ok((record, representative_image_path))
            })
            .map_err(|error| error.to_string())?;

        for row in rows {
            let (record, representative_image_path) = row.map_err(|error| error.to_string())?;
            cases_by_patient
                .entry(record.patient_id.clone())
                .or_default()
                .push((record, representative_image_path));
        }
    }

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
        // Return raw file paths only — no stat() calls, no preview generation.
        // Frontend requests previews asynchronously after the list renders.
        let representative_thumbnails = cases
            .iter()
            .filter_map(|(case_record, representative_image_path)| {
                let image_id = case_record.representative_image_id.clone()?;
                let stored_path = representative_image_path.as_ref()?;
                let source_path = resolve_site_runtime_path(&site_id, stored_path).ok()?;
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
    Ok(PatientListPageResponse {
        items,
        page: safe_page,
        page_size,
        total_count,
        total_pages: total_pages.max(1),
    })
}

#[tauri::command]
fn create_patient(payload: CreatePatientRequest) -> Result<PatientRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let conn = open_data_plane_db()?;
    if get_patient(&conn, &site_id, &normalized_patient_id)?.is_some() {
        return Err(format!("Patient {normalized_patient_id} already exists."));
    }
    let record = PatientRecord {
        patient_id: normalized_patient_id.clone(),
        created_by_user_id: payload
            .user_id
            .as_deref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        sex: payload.sex,
        age: payload.age,
        chart_alias: payload.chart_alias.unwrap_or_default().trim().to_string(),
        local_case_code: payload
            .local_case_code
            .unwrap_or_default()
            .trim()
            .to_string(),
        created_at: Some(utc_now()),
    };
    conn.execute(
        "
        insert into patients (site_id, patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            site_id,
            record.patient_id,
            record.created_by_user_id,
            record.sex,
            record.age,
            record.chart_alias,
            record.local_case_code,
            record.created_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(record)
}

#[tauri::command]
fn update_patient(payload: UpdatePatientRequest) -> Result<PatientRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let auth = MutationAuth {
        user_id: payload.user_id.clone(),
        user_role: payload.user_role.clone(),
    };
    let conn = open_data_plane_db()?;
    let existing = get_patient(&conn, &site_id, &normalized_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_patient_id} does not exist."))?;
    require_record_owner(
        &auth,
        existing.created_by_user_id.as_deref(),
        "Only the creator or a site admin can modify this patient.",
    )?;
    conn.execute(
        "
        update patients
        set sex = ?, age = ?, chart_alias = ?, local_case_code = ?
        where site_id = ? and patient_id = ?
        ",
        params![
            payload.sex,
            payload.age,
            payload.chart_alias.unwrap_or_default().trim().to_string(),
            payload
                .local_case_code
                .unwrap_or_default()
                .trim()
                .to_string(),
            site_id,
            normalized_patient_id
        ],
    )
    .map_err(|error| error.to_string())?;
    get_patient(&conn, &site_id, &normalized_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_patient_id} does not exist."))
}

#[tauri::command]
fn create_visit(payload: CreateVisitRequest) -> Result<VisitRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let normalized_visit_date = normalize_visit_label(&payload.visit_date)?;
    let normalized_actual_visit_date =
        normalize_actual_visit_date(payload.actual_visit_date.as_deref())?;
    if !payload.culture_confirmed {
        return Err("Only culture-proven keratitis cases are allowed.".to_string());
    }
    let conn = open_data_plane_db()?;
    if get_patient(&conn, &site_id, &normalized_patient_id)?.is_none() {
        return Err(format!("Patient {normalized_patient_id} does not exist."));
    }
    if get_visit(
        &conn,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .is_some()
    {
        return Err(format!(
            "Visit {normalized_patient_id} / {normalized_visit_date} already exists."
        ));
    }
    let normalized_category = payload.culture_category.trim().to_lowercase();
    let normalized_species = payload.culture_species.trim().to_string();
    let normalized_additional_organisms = normalize_additional_organisms(
        &normalized_category,
        &normalized_species,
        payload.additional_organisms.as_deref().unwrap_or(&[]),
    );
    let normalized_status = normalize_visit_status(payload.visit_status.as_deref(), true);
    let created_at = utc_now();
    let visit_id = make_id("visit");
    let created_by_user_id = payload
        .user_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    conn.execute(
        "
        insert into visits (
          visit_id, site_id, patient_id, patient_reference_id, created_by_user_id,
          visit_date, visit_index, actual_visit_date, culture_confirmed, culture_category, culture_species,
          contact_lens_use, predisposing_factor, additional_organisms, other_history, visit_status,
          active_stage, is_initial_visit, smear_result, polymicrobial,
          research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            visit_id,
            site_id,
            normalized_patient_id,
            make_patient_reference_id(&payload.site_id, &normalized_patient_id),
            created_by_user_id,
            normalized_visit_date,
            visit_index_from_label(&payload.visit_date)?,
            normalized_actual_visit_date,
            1,
            normalized_category,
            normalized_species,
            payload.contact_lens_use,
            serde_json::to_string(&payload.predisposing_factor.unwrap_or_default()).map_err(|error| error.to_string())?,
            serde_json::to_string(&normalized_additional_organisms).map_err(|error| error.to_string())?,
            payload.other_history.unwrap_or_default(),
            normalized_status.clone(),
            if normalized_status == "active" { 1 } else { 0 },
            if payload.is_initial_visit.unwrap_or(false) { 1 } else { 0 },
            payload.smear_result.unwrap_or_else(|| "not done".to_string()).trim().to_string(),
            if payload.polymicrobial.unwrap_or(false) || !normalized_additional_organisms.is_empty() { 1 } else { 0 },
            "analysis_only",
            created_at.clone(),
            payload.user_id,
            "visit_create",
            created_at
        ],
    )
    .map_err(|error| error.to_string())?;
    get_visit(
        &conn,
        &payload.site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .ok_or_else(|| {
        format!("Visit {normalized_patient_id} / {normalized_visit_date} does not exist.")
    })
}

#[tauri::command]
fn update_visit(payload: UpdateVisitRequest) -> Result<VisitRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let auth = MutationAuth {
        user_id: payload.user_id.clone(),
        user_role: payload.user_role.clone(),
    };
    let normalized_patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let normalized_visit_date = normalize_visit_label(&payload.visit_date)?;
    let normalized_target_patient_id = normalize_patient_pseudonym(&payload.target_patient_id)?;
    let normalized_target_visit_date = normalize_visit_label(&payload.target_visit_date)?;
    let normalized_actual_visit_date =
        normalize_actual_visit_date(payload.actual_visit_date.as_deref())?;
    if !payload.culture_confirmed {
        return Err("Only culture-proven keratitis cases are allowed.".to_string());
    }
    let conn = open_data_plane_db()?;
    if get_visit(
        &conn,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?
    .is_none()
    {
        return Err(format!(
            "Visit {normalized_patient_id} / {normalized_visit_date} does not exist."
        ));
    }
    require_visit_write_access(
        &conn,
        &auth,
        &site_id,
        &normalized_patient_id,
        &normalized_visit_date,
    )?;
    let target_patient = get_patient(&conn, &site_id, &normalized_target_patient_id)?
        .ok_or_else(|| format!("Patient {normalized_target_patient_id} does not exist."))?;
    if normalized_target_patient_id != normalized_patient_id {
        require_record_owner(
            &auth,
            target_patient.created_by_user_id.as_deref(),
            "Only the creator or a site admin can move a visit into this patient.",
        )?;
    }
    let target_changed = normalized_target_patient_id != normalized_patient_id
        || normalized_target_visit_date != normalized_visit_date;
    if target_changed
        && get_visit(
            &conn,
            &site_id,
            &normalized_target_patient_id,
            &normalized_target_visit_date,
        )?
        .is_some()
    {
        return Err(format!(
            "Visit {normalized_target_patient_id} / {normalized_target_visit_date} already exists."
        ));
    }
    let normalized_category = payload.culture_category.trim().to_lowercase();
    let normalized_species = payload.culture_species.trim().to_string();
    let normalized_additional_organisms = normalize_additional_organisms(
        &normalized_category,
        &normalized_species,
        payload.additional_organisms.as_deref().unwrap_or(&[]),
    );
    let normalized_status = normalize_visit_status(payload.visit_status.as_deref(), true);
    conn.execute(
        "
        update visits
        set patient_id = ?, patient_reference_id = ?, actual_visit_date = ?, visit_date = ?, visit_index = ?,
            culture_confirmed = ?, culture_category = ?, culture_species = ?, contact_lens_use = ?,
            predisposing_factor = ?, additional_organisms = ?, other_history = ?, visit_status = ?,
            active_stage = ?, is_initial_visit = ?, smear_result = ?, polymicrobial = ?
        where site_id = ? and patient_id = ? and visit_date = ?
        ",
        params![
            normalized_target_patient_id,
            make_patient_reference_id(&site_id, &normalized_target_patient_id),
            normalized_actual_visit_date,
            normalized_target_visit_date,
            visit_index_from_label(&payload.target_visit_date)?,
            1,
            normalized_category,
            normalized_species,
            payload.contact_lens_use,
            serde_json::to_string(&payload.predisposing_factor.unwrap_or_default()).map_err(|error| error.to_string())?,
            serde_json::to_string(&normalized_additional_organisms).map_err(|error| error.to_string())?,
            payload.other_history.unwrap_or_default(),
            normalized_status.clone(),
            if normalized_status == "active" { 1 } else { 0 },
            if payload.is_initial_visit.unwrap_or(false) { 1 } else { 0 },
            payload.smear_result.unwrap_or_else(|| "not done".to_string()).trim().to_string(),
            if payload.polymicrobial.unwrap_or(false) || !normalized_additional_organisms.is_empty() { 1 } else { 0 },
            site_id,
            normalized_patient_id,
            normalized_visit_date
        ],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "
        update images
        set patient_id = ?, visit_date = ?
        where site_id = ? and patient_id = ? and visit_date = ?
        ",
        params![
            normalized_target_patient_id,
            normalized_target_visit_date,
            payload.site_id,
            normalized_patient_id,
            normalized_visit_date
        ],
    )
    .map_err(|error| error.to_string())?;
    if target_changed {
        let source_history_path = case_history_path(
            &payload.site_id,
            &normalized_patient_id,
            &normalized_visit_date,
        )?;
        let target_history_path = case_history_path(
            &payload.site_id,
            &normalized_target_patient_id,
            &normalized_target_visit_date,
        )?;
        if source_history_path.exists() {
            if target_history_path.exists() {
                fs::remove_file(&target_history_path).map_err(|error| error.to_string())?;
            }
            fs::rename(&source_history_path, &target_history_path)
                .map_err(|error| error.to_string())?;
        } else if target_history_path.exists() {
            fs::remove_file(&target_history_path).map_err(|error| error.to_string())?;
        }
        if normalized_target_patient_id != normalized_patient_id {
            let _ = delete_patient_if_empty(&conn, &payload.site_id, &normalized_patient_id)?;
        }
    }
    get_visit(
        &conn,
        &payload.site_id,
        &normalized_target_patient_id,
        &normalized_target_visit_date,
    )?
    .ok_or_else(|| {
        format!(
            "Visit {normalized_target_patient_id} / {normalized_target_visit_date} does not exist."
        )
    })
}

#[tauri::command]
fn delete_visit(payload: DeleteVisitRequest) -> Result<DeleteVisitResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let auth = MutationAuth {
        user_id: payload.user_id,
        user_role: payload.user_role,
    };
    let conn = open_data_plane_db()?;
    if get_visit(&conn, &site_id, &patient_id, &visit_date)?.is_none() {
        return Err(format!("Visit {patient_id} / {visit_date} does not exist."));
    }
    require_visit_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    let existing_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    for image in &existing_images {
        let _ = delete_image_preview_cache(&site_id, &image.image_id)?;
        let source_path = PathBuf::from(&image.image_path);
        if source_path.exists() {
            fs::remove_file(&source_path).map_err(|error| error.to_string())?;
        }
    }
    conn.execute(
        "delete from images where site_id = ? and patient_id = ? and visit_date = ?",
        params![payload.site_id, patient_id, visit_date],
    )
    .map_err(|error| error.to_string())?;
    let history_path = case_history_path(&payload.site_id, &patient_id, &visit_date)?;
    if history_path.exists() {
        fs::remove_file(&history_path).map_err(|error| error.to_string())?;
    }
    conn.execute(
        "delete from visits where site_id = ? and patient_id = ? and visit_date = ?",
        params![payload.site_id, patient_id, visit_date],
    )
    .map_err(|error| error.to_string())?;
    let remaining_visit_count = conn
        .query_row(
            "select count(*) from visits where site_id = ? and patient_id = ?",
            params![payload.site_id, patient_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let deleted_patient = delete_patient_if_empty(&conn, &payload.site_id, &patient_id)?;
    Ok(DeleteVisitResponse {
        patient_id,
        visit_date,
        deleted_images: existing_images.len() as i64,
        deleted_patient,
        remaining_visit_count,
    })
}

#[tauri::command]
fn upload_image(payload: UploadImageRequest) -> Result<DesktopImageRecord, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let conn = open_data_plane_db()?;
    let visit = get_visit(&conn, &site_id, &patient_id, &visit_date)?
        .ok_or_else(|| "Visit must exist before image upload.".to_string())?;
    let visit_dir = raw_dir(&site_id)?.join(&patient_id).join(&visit_date);
    fs::create_dir_all(&visit_dir).map_err(|error| error.to_string())?;
    let image_id = make_id("image");
    let (sanitized_content, normalized_suffix) = sanitize_image_bytes(
        &payload.bytes,
        payload.file_name.as_deref().unwrap_or("upload.bin"),
    )?;
    let destination = visit_dir.join(format!("{image_id}{normalized_suffix}"));
    fs::write(&destination, sanitized_content).map_err(|error| error.to_string())?;
    let quality_scores = score_slit_lamp_image(&destination, &payload.view).ok();
    let uploaded_at = utc_now();
    conn.execute(
        "
        insert into images (
          image_id, visit_id, site_id, patient_id, visit_date, created_by_user_id, view, image_path,
          is_representative, lesion_prompt_box, has_lesion_box, has_roi_crop, has_medsam_mask,
          has_lesion_crop, has_lesion_mask, quality_scores, artifact_status_updated_at, uploaded_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ",
        params![
            image_id,
            visit.visit_id,
            site_id,
            patient_id,
            visit_date,
            payload.user_id,
            payload.view,
            destination.to_string_lossy().to_string(),
            if payload.is_representative.unwrap_or(false) {
                1
            } else {
                0
            },
            Option::<String>::None,
            0,
            0,
            0,
            0,
            0,
            quality_scores.as_ref().map(|value| value.to_string()),
            uploaded_at.clone(),
            uploaded_at
        ],
    )
    .map_err(|error| error.to_string())?;
    let _ = preview_file_path(&payload.site_id, &image_id, &destination, 256);
    let _ = preview_file_path(&payload.site_id, &image_id, &destination, 640);
    let mut stmt = conn
        .prepare(
            "
            select
              image_id, visit_id, patient_id, visit_date, view, image_path, is_representative,
              lesion_prompt_box, uploaded_at, quality_scores
            from images
            where site_id = ? and image_id = ?
            ",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params![payload.site_id, image_id])
        .map_err(|error| error.to_string())?;
    let row = rows
        .next()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Uploaded image not found.".to_string())?;
    desktop_image_record_from_row(row, &payload.site_id, Some(640)).map(|(record, _)| record)
}

#[tauri::command]
fn delete_visit_images(payload: DeleteVisitImagesRequest) -> Result<DeleteImagesResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let auth = MutationAuth {
        user_id: payload.user_id,
        user_role: payload.user_role,
    };
    let conn = open_data_plane_db()?;
    require_visit_image_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    let existing_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    for image in &existing_images {
        let _ = delete_image_preview_cache(&site_id, &image.image_id)?;
        let source_path = PathBuf::from(&image.image_path);
        if source_path.exists() {
            fs::remove_file(&source_path).map_err(|error| error.to_string())?;
        }
    }
    conn.execute(
        "delete from images where site_id = ? and patient_id = ? and visit_date = ?",
        params![payload.site_id, patient_id, visit_date],
    )
    .map_err(|error| error.to_string())?;
    Ok(DeleteImagesResponse {
        deleted_count: existing_images.len() as i64,
    })
}

#[tauri::command]
fn set_representative_image(
    payload: RepresentativeImageRequest,
) -> Result<RepresentativeImageResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let representative_image_id = payload.representative_image_id.trim().to_string();
    if representative_image_id.is_empty() {
        return Err("representative_image_id is required.".to_string());
    }
    let auth = MutationAuth {
        user_id: payload.user_id,
        user_role: payload.user_role,
    };
    let conn = open_data_plane_db()?;
    let visit_images = list_images_for_visit(&conn, &site_id, &patient_id, &visit_date)?;
    if visit_images.is_empty() {
        return Err("No images found for this visit.".to_string());
    }
    require_visit_image_write_access(&conn, &auth, &site_id, &patient_id, &visit_date)?;
    if !visit_images
        .iter()
        .any(|image| image.image_id == representative_image_id)
    {
        return Err("Representative image is not part of this visit.".to_string());
    }
    for image in &visit_images {
        conn.execute(
            "update images set is_representative = ? where site_id = ? and image_id = ?",
            params![
                if image.image_id == representative_image_id {
                    1
                } else {
                    0
                },
                payload.site_id,
                image.image_id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(RepresentativeImageResponse {
        images: list_images_for_visit(&conn, &payload.site_id, &patient_id, &visit_date)?,
    })
}

#[tauri::command]
fn get_case_history(payload: CaseHistoryRequest) -> Result<CaseHistoryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let patient_id = normalize_patient_pseudonym(&payload.patient_id)?;
    let visit_date = normalize_visit_label(&payload.visit_date)?;
    let history_path = case_history_path(&site_id, &patient_id, &visit_date)?;
    if !history_path.exists() {
        return Ok(CaseHistoryResponse {
            validations: Vec::new(),
            contributions: Vec::new(),
        });
    }
    let raw = fs::read_to_string(history_path).map_err(|error| error.to_string())?;
    let payload = serde_json::from_str::<JsonValue>(&raw).unwrap_or_else(|_| json!({}));
    let validations = payload
        .get("validations")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let contributions = payload
        .get("contributions")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(CaseHistoryResponse {
        validations,
        contributions,
    })
}

#[tauri::command]
fn list_stored_case_lesion_previews(
    payload: StoredLesionPreviewsRequest,
) -> Result<Vec<LesionPreviewRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() {
        return Err("site_id, patient_id, and visit_date are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let images = query_images(&conn, &site_id, Some(&patient_id), Some(&visit_date), None)?;
    if images.is_empty() {
        return Err(format!(
            "No images found for patient {patient_id} / {visit_date}."
        ));
    }

    let lesion_meta_dir = site_dir(&site_id)?
        .join("artifacts")
        .join("lesion_preview_meta");
    let mut previews = Vec::new();
    for image in images {
        let Some(lesion_prompt_box) = image.lesion_prompt_box.clone() else {
            continue;
        };
        let artifact_name = Path::new(&image.image_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Image path is invalid.".to_string())?;
        let mask_path = site_dir(&site_id)?
            .join("artifacts")
            .join("lesion_masks")
            .join(format!("{artifact_name}_mask.png"));
        let crop_path = site_dir(&site_id)?
            .join("artifacts")
            .join("lesion_crops")
            .join(format!("{artifact_name}_crop.png"));
        let metadata_path = lesion_meta_dir.join(format!("{artifact_name}.json"));
        let backend = if metadata_path.exists() {
            let metadata_raw = fs::read_to_string(&metadata_path).unwrap_or_default();
            let metadata =
                serde_json::from_str::<JsonValue>(&metadata_raw).unwrap_or(JsonValue::Null);
            json_string_field(&metadata, "backend").unwrap_or_else(|| "unknown".to_string())
        } else {
            "unknown".to_string()
        };
        previews.push(LesionPreviewRecord {
            patient_id: patient_id.clone(),
            visit_date: visit_date.clone(),
            image_id: Some(image.image_id.clone()),
            view: image.view.clone(),
            is_representative: image.is_representative,
            source_image_path: image.image_path.clone(),
            has_lesion_crop: crop_path.exists(),
            has_lesion_mask: mask_path.exists(),
            backend,
            lesion_prompt_box: Some(lesion_prompt_box),
        });
    }

    Ok(previews)
}

#[tauri::command]
fn read_validation_artifact(
    payload: ValidationArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty()
        || validation_id.is_empty()
        || patient_id.is_empty()
        || visit_date.is_empty()
    {
        return Err("site_id, validation_id, patient_id, and visit_date are required.".to_string());
    }
    let artifact_path = validation_artifact_path(
        &site_id,
        &validation_id,
        &patient_id,
        &visit_date,
        &payload.artifact_kind,
    )?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
fn resolve_validation_artifact_path(
    payload: ValidationArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let validation_id = payload.validation_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    if site_id.is_empty()
        || validation_id.is_empty()
        || patient_id.is_empty()
        || visit_date.is_empty()
    {
        return Err("site_id, validation_id, patient_id, and visit_date are required.".to_string());
    }
    let artifact_path = validation_artifact_path(
        &site_id,
        &validation_id,
        &patient_id,
        &visit_date,
        &payload.artifact_kind,
    )?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn read_case_roi_preview_artifact(
    payload: CasePreviewArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        roi_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
fn resolve_case_roi_preview_artifact_path(
    payload: CasePreviewArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        roi_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn read_case_lesion_preview_artifact(
    payload: CasePreviewArtifactRequest,
) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        lesion_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    read_binary_path(&artifact_path)
}

#[tauri::command]
fn resolve_case_lesion_preview_artifact_path(
    payload: CasePreviewArtifactRequest,
) -> Result<FilePathResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let patient_id = payload.patient_id.trim().to_string();
    let visit_date = payload.visit_date.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || patient_id.is_empty() || visit_date.is_empty() || image_id.is_empty() {
        return Err("site_id, patient_id, visit_date, and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let image = find_visit_image_record(&conn, &site_id, &patient_id, &visit_date, &image_id)?;
    let artifact_path =
        lesion_preview_artifact_path(&site_id, &image.image_path, &payload.artifact_kind)?;
    Ok(FilePathResponse {
        path: artifact_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn read_image_blob(payload: ImageBlobRequest) -> Result<ImageBinaryResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() {
        return Err("site_id and image_id are required.".to_string());
    }
    let conn = open_data_plane_db()?;
    let stored_image_path = conn
        .query_row(
            "select image_path from images where site_id = ? and image_id = ?",
            params![site_id, image_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Image not found.".to_string())?;
    let source_path = resolve_site_runtime_path(&payload.site_id, &stored_image_path)?;
    let bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
    Ok(ImageBinaryResponse {
        data: BASE64_STANDARD.encode(&bytes),
        media_type: mime_type_for_path(&source_path),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .setup(|app| {
            if let Ok(path) = app.path().resource_dir() {
                store_desktop_resource_dir(path);
            }
            // Ensure SQLite performance indexes exist (no-op if already present)
            ensure_data_plane_indexes();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_backend_status,
            get_local_worker_status,
            ensure_local_worker,
            ensure_local_backend,
            ensure_local_runtime,
            stop_local_backend,
            stop_local_worker,
            stop_local_runtime,
            get_ml_sidecar_status,
            ensure_ml_sidecar,
            stop_ml_sidecar,
            get_desktop_app_config,
            save_desktop_app_config,
            clear_desktop_app_config,
            open_desktop_path,
            open_external_url,
            export_desktop_diagnostics_bundle,
            start_google_oauth_server,
            cancel_google_oauth_server,
            pick_desktop_directory,
            request_local_json,
            request_local_binary,
            request_local_multipart,
            run_case_validation,
            run_case_validation_compare,
            run_case_ai_clinic,
            run_case_ai_clinic_similar_cases,
            run_case_contribution,
            fetch_site_job,
            start_site_job_event_stream,
            fetch_case_roi_preview,
            fetch_case_lesion_preview,
            start_live_lesion_preview,
            fetch_live_lesion_preview_job,
            start_live_lesion_preview_event_stream,
            fetch_image_semantic_prompt_scores,
            fetch_site_validations,
            fetch_validation_cases,
            fetch_site_model_versions,
            run_site_validation,
            run_initial_training,
            run_initial_training_benchmark,
            resume_initial_training_benchmark,
            cancel_site_job,
            fetch_cross_validation_reports,
            run_cross_validation,
            fetch_ai_clinic_embedding_status,
            backfill_ai_clinic_embeddings,
            list_cases,
            get_site_activity,
            list_patients,
            lookup_patient_id,
            list_patient_board,
            list_visits,
            list_images,
            get_visit_images,
            ensure_image_previews,
            create_patient,
            update_patient,
            create_visit,
            update_visit,
            delete_visit,
            upload_image,
            delete_visit_images,
            set_representative_image,
            get_case_history,
            list_stored_case_lesion_previews,
            read_validation_artifact,
            resolve_validation_artifact_path,
            read_case_roi_preview_artifact,
            resolve_case_roi_preview_artifact_path,
            read_case_lesion_preview_artifact,
            resolve_case_lesion_preview_artifact_path,
            read_image_blob,
            load_session_cache,
            save_session_cache,
            clear_session_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running K-ERA desktop shell");
}
