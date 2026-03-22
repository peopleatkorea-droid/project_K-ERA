#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Cursor, Write};
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
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

static LOCAL_BACKEND_STATE: OnceLock<Mutex<LocalBackendRuntime>> = OnceLock::new();
static ML_SIDECAR_STATE: OnceLock<Mutex<MlSidecarRuntime>> = OnceLock::new();
static LOCAL_WORKER_STATE: OnceLock<Mutex<LocalWorkerRuntime>> = OnceLock::new();
static DESKTOP_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static PREVIEW_WARM_STATE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SITE_JOB_UPDATE_EVENT: &str = "kera://site-job-update";
const LIVE_LESION_PREVIEW_UPDATE_EVENT: &str = "kera://live-lesion-preview-update";
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

struct LocalBackendRuntime {
    child: Option<Child>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

struct LocalWorkerRuntime {
    child: Option<Child>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

impl Default for LocalBackendRuntime {
    fn default() -> Self {
        Self {
            child: None,
            python_path: None,
            launch_command: None,
            stdout_log_path: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedLocalBackend {
    child: Child,
    python_path: String,
    launch_command: Vec<String>,
    stdout_log_path: String,
    stderr_log_path: String,
}

impl Default for LocalWorkerRuntime {
    fn default() -> Self {
        Self {
            child: None,
            python_path: None,
            launch_command: None,
            stdout_log_path: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedLocalWorker {
    child: Child,
    python_path: String,
    launch_command: Vec<String>,
    stdout_log_path: String,
    stderr_log_path: String,
}

struct MlSidecarRuntime {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    next_request_id: u64,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
    launched_by_desktop: bool,
}

impl Default for MlSidecarRuntime {
    fn default() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
            next_request_id: 1,
            python_path: None,
            launch_command: None,
            stderr_log_path: None,
            last_started_at: None,
            last_error: None,
            launched_by_desktop: false,
        }
    }
}

struct SpawnedMlSidecar {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    python_path: String,
    launch_command: Vec<String>,
    stderr_log_path: String,
}

#[derive(Debug, Serialize, Clone)]
struct LocalBackendStatus {
    transport: String,
    mode: String,
    base_url: String,
    local_url: bool,
    managed: bool,
    running: bool,
    healthy: bool,
    launched_by_desktop: bool,
    pid: Option<u32>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct LocalWorkerStatus {
    mode: String,
    managed: bool,
    running: bool,
    launched_by_desktop: bool,
    pid: Option<u32>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct MlSidecarStatus {
    transport: String,
    mode: String,
    base_url: String,
    local_url: bool,
    managed: bool,
    running: bool,
    healthy: bool,
    launched_by_desktop: bool,
    pid: Option<u32>,
    python_path: Option<String>,
    launch_command: Option<Vec<String>>,
    stdout_log_path: Option<String>,
    stderr_log_path: Option<String>,
    last_started_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopAppConfigValues {
    storage_dir: String,
    control_plane_api_base_url: String,
    control_plane_node_id: String,
    control_plane_node_token: String,
    control_plane_site_id: String,
    local_backend_python: String,
    local_backend_mode: String,
    ml_transport: String,
}

impl Default for DesktopAppConfigValues {
    fn default() -> Self {
        Self {
            storage_dir: String::new(),
            control_plane_api_base_url: String::new(),
            control_plane_node_id: String::new(),
            control_plane_node_token: String::new(),
            control_plane_site_id: String::new(),
            local_backend_python: String::new(),
            local_backend_mode: "managed".to_string(),
            ml_transport: "sidecar".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct DesktopAppConfigFile {
    env: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq, Eq)]
struct FederationSaltConfigFile {
    case_reference_salt: Option<String>,
    patient_reference_salt: Option<String>,
    public_alias_salt: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct DesktopAppConfigInput {
    storage_dir: Option<String>,
    control_plane_api_base_url: Option<String>,
    control_plane_node_id: Option<String>,
    control_plane_node_token: Option<String>,
    control_plane_site_id: Option<String>,
    local_backend_python: Option<String>,
    local_backend_mode: Option<String>,
    ml_transport: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SaveDesktopAppConfigRequest {
    config: DesktopAppConfigInput,
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
struct DesktopAppConfigResponse {
    runtime: String,
    config_path: String,
    app_local_data_dir: String,
    repo_root: String,
    backend_root: String,
    backend_entry: String,
    worker_module: String,
    storage_state_file: Option<String>,
    setup_ready: bool,
    runtime_contract: DesktopRuntimeContractResponse,
    values: DesktopAppConfigValues,
}

#[derive(Debug, Serialize)]
struct DesktopRuntimeContractResponse {
    mode: String,
    packaged_mode: bool,
    env_source: String,
    resource_dir: Option<String>,
    runtime_dir: String,
    logs_dir: String,
    backend_source: String,
    backend_candidates: Vec<String>,
    python_candidates: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug)]
struct DesktopRuntimeReadiness {
    backend_candidates: Vec<String>,
    python_candidates: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct DesktopPathCandidate {
    path: PathBuf,
    source: String,
}

#[derive(Debug, Clone)]
struct DesktopStringCandidate {
    value: String,
    source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopRuntimeMode {
    Dev,
    Packaged,
}

impl DesktopRuntimeMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Packaged => "packaged",
        }
    }
}

fn normalized_trueish(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn desktop_runtime_mode() -> DesktopRuntimeMode {
    if let Some(value) = process_env_value("KERA_DESKTOP_RUNTIME_MODE") {
        match value.trim().to_ascii_lowercase().as_str() {
            "dev" => return DesktopRuntimeMode::Dev,
            "packaged" => return DesktopRuntimeMode::Packaged,
            _ => {}
        }
    }
    if process_env_value("KERA_DESKTOP_FORCE_DEV_MODE")
        .map(|value| normalized_trueish(&value))
        .unwrap_or(false)
    {
        return DesktopRuntimeMode::Dev;
    }
    if process_env_value("KERA_DESKTOP_FORCE_PACKAGED_MODE")
        .map(|value| normalized_trueish(&value))
        .unwrap_or(false)
    {
        return DesktopRuntimeMode::Packaged;
    }
    if cfg!(debug_assertions) {
        DesktopRuntimeMode::Dev
    } else {
        DesktopRuntimeMode::Packaged
    }
}

fn desktop_packaged_mode() -> bool {
    desktop_runtime_mode() == DesktopRuntimeMode::Packaged
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn desktop_app_local_data_dir() -> PathBuf {
    process_env_value("KERA_DESKTOP_APP_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            process_env_value("LOCALAPPDATA").map(|value| PathBuf::from(value).join("KERA"))
        })
        .or_else(|| {
            process_env_value("USERPROFILE")
                .or_else(|| process_env_value("HOME"))
                .map(|value| PathBuf::from(value).join(".kera-desktop"))
        })
        .unwrap_or_else(|| {
            if desktop_packaged_mode() {
                current_exe_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".kera-desktop")
            } else {
                project_root().join(".desktop-app")
            }
        })
}

fn desktop_config_path() -> PathBuf {
    desktop_app_local_data_dir().join("desktop-config.json")
}

fn read_desktop_config_file() -> DesktopAppConfigFile {
    let path = desktop_config_path();
    let Ok(raw) = fs::read_to_string(path) else {
        return DesktopAppConfigFile::default();
    };
    serde_json::from_str::<DesktopAppConfigFile>(&raw).unwrap_or_default()
}

fn write_desktop_config_file(config: &DesktopAppConfigFile) -> Result<(), String> {
    let path = desktop_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn clear_desktop_config_file() -> Result<(), String> {
    let path = desktop_config_path();
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn process_env_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn configured_env_values() -> HashMap<String, String> {
    let mut values = HashMap::new();
    if !desktop_packaged_mode() {
        let env_path = project_root().join(".env.local");
        if let Ok(entries) = dotenvy::from_path_iter(env_path) {
            for entry in entries.flatten() {
                values.insert(entry.0, entry.1);
            }
        }
    }
    for (key, value) in read_desktop_config_file().env {
        values.insert(key, value);
    }
    values
}

fn configured_or_process_env_value(key: &str, values: &HashMap<String, String>) -> Option<String> {
    process_env_value(key).or_else(|| {
        values
            .get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn storage_state_file_path() -> PathBuf {
    if let Some(local_appdata) = process_env_value("LOCALAPPDATA") {
        return PathBuf::from(local_appdata)
            .join("KERA")
            .join("storage_dir.txt");
    }
    if let Some(home) = process_env_value("USERPROFILE").or_else(|| process_env_value("HOME")) {
        return PathBuf::from(home).join(".kera").join("storage_dir.txt");
    }
    desktop_app_local_data_dir().join("storage_dir.txt")
}

fn storage_state_file_hint() -> Option<String> {
    Some(storage_state_file_path().to_string_lossy().to_string())
}

fn normalize_storage_bundle_path(candidate: PathBuf) -> PathBuf {
    let resolved = candidate;
    let is_sites_dir = resolved
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("sites"))
        .unwrap_or(false);
    if !is_sites_dir {
        return resolved;
    }
    let Some(parent) = resolved.parent() else {
        return resolved;
    };
    let parent = parent.to_path_buf();
    let is_kera_data = parent
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("kera_data"))
        .unwrap_or(false);
    if is_kera_data
        || parent.join("control_plane").exists()
        || parent.join("models").exists()
        || parent.join("kera.db").exists()
        || parent.join("control_plane_cache.db").exists()
    {
        return parent;
    }
    resolved
}

fn looks_like_storage_bundle(candidate: &Path) -> bool {
    candidate.is_dir()
        && [
            "sites",
            "control_plane",
            "models",
            "kera.db",
            "control_plane_cache.db",
            "kera_secret.key",
        ]
        .iter()
        .any(|marker| candidate.join(marker).exists())
}

fn push_unique_path(target: &mut Vec<PathBuf>, candidate: PathBuf) {
    let normalized = candidate.to_string_lossy().to_lowercase();
    if target
        .iter()
        .any(|existing| existing.to_string_lossy().to_lowercase() == normalized)
    {
        return;
    }
    target.push(candidate);
}

fn push_unique_path_candidate(target: &mut Vec<DesktopPathCandidate>, path: PathBuf, source: &str) {
    let normalized = path.to_string_lossy().to_lowercase();
    if target
        .iter()
        .any(|existing| existing.path.to_string_lossy().to_lowercase() == normalized)
    {
        return;
    }
    target.push(DesktopPathCandidate {
        path,
        source: source.to_string(),
    });
}

fn push_unique_string_candidate(
    target: &mut Vec<DesktopStringCandidate>,
    value: String,
    source: &str,
) {
    let normalized = value.trim().to_string();
    if normalized.is_empty() {
        return;
    }
    if target
        .iter()
        .any(|existing| existing.value.eq_ignore_ascii_case(&normalized))
    {
        return;
    }
    target.push(DesktopStringCandidate {
        value: normalized,
        source: source.to_string(),
    });
}

fn default_desktop_storage_dir() -> PathBuf {
    desktop_app_local_data_dir().join("KERA_DATA")
}

fn read_storage_state_dir() -> Option<PathBuf> {
    let path = storage_state_file_path();
    let raw = fs::read_to_string(path).ok()?;
    let normalized = raw.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalize_storage_bundle_path(PathBuf::from(normalized)))
}

fn write_storage_state_dir(storage_dir: &Path) -> Result<(), String> {
    let path = storage_state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, storage_dir.to_string_lossy().to_string()).map_err(|error| error.to_string())
}

fn storage_dir_candidates(configured_storage_dir: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = configured_storage_dir {
        let normalized = value.trim();
        if !normalized.is_empty() {
            push_unique_path(
                &mut candidates,
                normalize_storage_bundle_path(PathBuf::from(normalized)),
            );
        }
    }
    if let Some(value) = read_storage_state_dir() {
        push_unique_path(&mut candidates, value);
    }
    if !desktop_packaged_mode() {
        if let Some(parent) = project_root().parent() {
            push_unique_path(&mut candidates, parent.join("KERA_DATA"));
        }
    }
    for root in [
        process_env_value("HOME"),
        process_env_value("USERPROFILE"),
        process_env_value("OneDrive"),
        process_env_value("OneDriveCommercial"),
        process_env_value("OneDriveConsumer"),
    ]
    .into_iter()
    .flatten()
    {
        let root_path = PathBuf::from(root);
        push_unique_path(&mut candidates, root_path.join("KERA_DATA"));
        push_unique_path(&mut candidates, root_path.join("KERA").join("KERA_DATA"));
    }
    push_unique_path(&mut candidates, default_desktop_storage_dir());
    candidates
}

fn resolve_storage_dir(values: &HashMap<String, String>) -> PathBuf {
    let configured = configured_or_process_env_value("KERA_STORAGE_DIR", values);
    let candidates = storage_dir_candidates(configured.as_deref());
    for candidate in candidates {
        if looks_like_storage_bundle(&candidate) {
            return candidate;
        }
    }
    configured
        .map(|value| normalize_storage_bundle_path(PathBuf::from(value)))
        .unwrap_or_else(default_desktop_storage_dir)
}

fn sqlite_url_for_path(path: &Path) -> String {
    format!("sqlite:///{}", path.to_string_lossy().replace('\\', "/"))
}

fn ensure_storage_bundle_dirs(storage_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(storage_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("sites")).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("control_plane")).map_err(|error| error.to_string())?;
    fs::create_dir_all(storage_dir.join("models")).map_err(|error| error.to_string())?;
    Ok(())
}

fn current_exe_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.parent().map(Path::to_path_buf)
}

fn store_desktop_resource_dir(path: PathBuf) {
    let _ = DESKTOP_RESOURCE_DIR.set(path);
}

fn known_desktop_resource_dir() -> Option<PathBuf> {
    DESKTOP_RESOURCE_DIR.get().cloned()
}

fn desktop_resource_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = known_desktop_resource_dir() {
        push_unique_path(&mut candidates, path);
    }
    if let Some(value) = process_env_value("KERA_DESKTOP_RESOURCE_DIR") {
        push_unique_path(&mut candidates, PathBuf::from(value));
    }
    if let Some(exe_dir) = current_exe_dir() {
        push_unique_path(&mut candidates, exe_dir.join("resources"));
        if let Some(parent) = exe_dir.parent() {
            push_unique_path(&mut candidates, parent.join("resources"));
            push_unique_path(&mut candidates, parent.join("Resources"));
        }
    }
    candidates
}

struct DesktopBackendTarget {
    root: PathBuf,
    backend_entry_path: PathBuf,
    backend_module: String,
    worker_module: String,
    python_path_entries: Vec<PathBuf>,
    source: String,
}

fn desktop_backend_root_candidates(values: &HashMap<String, String>) -> Vec<DesktopPathCandidate> {
    let mut candidates = Vec::new();
    if let Some(value) = configured_or_process_env_value("KERA_DESKTOP_BACKEND_ROOT", values) {
        push_unique_path_candidate(
            &mut candidates,
            PathBuf::from(value),
            "configured_backend_root",
        );
    }
    if let Some(value) = configured_or_process_env_value("KERA_DESKTOP_RUNTIME_ROOT", values) {
        let runtime_root = PathBuf::from(value);
        push_unique_path_candidate(
            &mut candidates,
            runtime_root.join("backend"),
            "configured_runtime_root/backend",
        );
        push_unique_path_candidate(&mut candidates, runtime_root, "configured_runtime_root");
    }
    for resource_dir in desktop_resource_dir_candidates() {
        push_unique_path_candidate(
            &mut candidates,
            resource_dir.join("backend"),
            "bundled_resources/backend",
        );
        push_unique_path_candidate(
            &mut candidates,
            resource_dir.join("python-backend"),
            "bundled_resources/python-backend",
        );
        push_unique_path_candidate(
            &mut candidates,
            resource_dir.clone(),
            "bundled_resources/root",
        );
    }
    push_unique_path_candidate(
        &mut candidates,
        desktop_app_local_data_dir().join("runtime").join("backend"),
        "app_local_runtime/backend",
    );
    push_unique_path_candidate(
        &mut candidates,
        desktop_app_local_data_dir().join("backend"),
        "app_local/backend",
    );
    if !desktop_packaged_mode() {
        push_unique_path_candidate(&mut candidates, project_root(), "repo_root");
    }
    candidates
}

fn resolve_desktop_backend_target(
    values: &HashMap<String, String>,
) -> Result<DesktopBackendTarget, String> {
    let candidates = desktop_backend_root_candidates(values);
    for candidate in &candidates {
        let root = &candidate.path;
        let package_entry = root
            .join("src")
            .join("kera_research")
            .join("api")
            .join("app.py");
        let app_entry = root.join("app.py");
        let worker_entry = root.join("src").join("kera_research").join("worker.py");
        if package_entry.exists() {
            let mut python_path_entries = Vec::new();
            let src_dir = root.join("src");
            if src_dir.exists() {
                python_path_entries.push(src_dir);
            }
            return Ok(DesktopBackendTarget {
                root: root.clone(),
                backend_entry_path: package_entry,
                backend_module: "kera_research.api.app:app".to_string(),
                worker_module: if worker_entry.exists() {
                    "kera_research.worker".to_string()
                } else {
                    "kera_research.worker".to_string()
                },
                python_path_entries,
                source: candidate.source.clone(),
            });
        }
        if app_entry.exists() {
            let mut python_path_entries = Vec::new();
            let src_dir = root.join("src");
            if src_dir.exists() {
                python_path_entries.push(src_dir);
            }
            return Ok(DesktopBackendTarget {
                root: root.clone(),
                backend_entry_path: app_entry,
                backend_module: "app:app".to_string(),
                worker_module: "kera_research.worker".to_string(),
                python_path_entries,
                source: candidate.source.clone(),
            });
        }
    }
    let searched = candidates
        .iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.path.display()))
        .collect::<Vec<_>>()
        .join(" | ");
    let prefix = if desktop_packaged_mode() {
        "Packaged desktop backend assets were not found."
    } else {
        "Desktop backend entrypoint was not found."
    };
    Err(format!("{prefix} Looked in: {searched}"))
}

fn python_path_with_entries(entries: &[PathBuf]) -> Option<String> {
    let mut segments = entries
        .iter()
        .map(|entry| entry.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if let Some(existing) = process_env_value("PYTHONPATH")
        .or_else(|| configured_or_process_env_value("PYTHONPATH", &configured_env_values()))
    {
        segments.push(existing);
    }
    if segments.is_empty() {
        None
    } else {
        let separator = if cfg!(windows) { ";" } else { ":" };
        Some(segments.join(separator))
    }
}

fn local_backend_python_candidate_infos(
    values: &HashMap<String, String>,
) -> Vec<DesktopStringCandidate> {
    let backend = resolve_desktop_backend_target(values).ok();
    let mut candidates = Vec::new();
    if let Some(value) =
        configured_or_process_env_value("KERA_DESKTOP_LOCAL_BACKEND_PYTHON", values)
    {
        push_unique_string_candidate(&mut candidates, value, "configured_python");
    }
    #[cfg(windows)]
    {
        for resource_dir in desktop_resource_dir_candidates() {
            let bundled_python = resource_dir.join("python-runtime").join("python.exe");
            if bundled_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    bundled_python.to_string_lossy().to_string(),
                    "bundled_resources/python-runtime",
                );
            }
        }
        for candidate in [
            (
                desktop_app_local_data_dir()
                    .join("runtime")
                    .join("python")
                    .join("python.exe"),
                "app_local_runtime/python",
            ),
            (
                desktop_app_local_data_dir()
                    .join("python")
                    .join("python.exe"),
                "app_local/python",
            ),
        ] {
            if candidate.0.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    candidate.0.to_string_lossy().to_string(),
                    candidate.1,
                );
            }
        }
        if let Some(backend) = backend.as_ref() {
            for candidate in [
                (
                    backend.root.join("python").join("python.exe"),
                    "backend_root/python",
                ),
                (
                    backend.root.join("python-runtime").join("python.exe"),
                    "backend_root/python-runtime",
                ),
            ] {
                if candidate.0.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        candidate.0.to_string_lossy().to_string(),
                        candidate.1,
                    );
                }
            }
            if !desktop_packaged_mode() {
                let backend_venv = backend
                    .root
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe");
                if backend_venv.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        backend_venv.to_string_lossy().to_string(),
                        "backend_root/.venv",
                    );
                }
            }
        }
        if !desktop_packaged_mode() {
            let repo_python = project_root()
                .join(".venv")
                .join("Scripts")
                .join("python.exe");
            if repo_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    repo_python.to_string_lossy().to_string(),
                    "repo_root/.venv",
                );
            }
            if python_command_available("python") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python".to_string(),
                    "system_python",
                );
            }
            if python_command_available("py") {
                push_unique_string_candidate(
                    &mut candidates,
                    "py".to_string(),
                    "system_py_launcher",
                );
            }
        }
    }
    #[cfg(not(windows))]
    {
        for resource_dir in desktop_resource_dir_candidates() {
            let bundled_python = resource_dir
                .join("python-runtime")
                .join("bin")
                .join("python");
            if bundled_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    bundled_python.to_string_lossy().to_string(),
                    "bundled_resources/python-runtime",
                );
            }
        }
        for candidate in [
            (
                desktop_app_local_data_dir()
                    .join("runtime")
                    .join("python")
                    .join("bin")
                    .join("python"),
                "app_local_runtime/python",
            ),
            (
                desktop_app_local_data_dir()
                    .join("python")
                    .join("bin")
                    .join("python"),
                "app_local/python",
            ),
        ] {
            if candidate.0.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    candidate.0.to_string_lossy().to_string(),
                    candidate.1,
                );
            }
        }
        if let Some(backend) = backend.as_ref() {
            for candidate in [
                (
                    backend.root.join("python").join("bin").join("python"),
                    "backend_root/python",
                ),
                (
                    backend
                        .root
                        .join("python-runtime")
                        .join("bin")
                        .join("python"),
                    "backend_root/python-runtime",
                ),
            ] {
                if candidate.0.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        candidate.0.to_string_lossy().to_string(),
                        candidate.1,
                    );
                }
            }
            if !desktop_packaged_mode() {
                let backend_venv = backend.root.join(".venv").join("bin").join("python");
                if backend_venv.exists() {
                    push_unique_string_candidate(
                        &mut candidates,
                        backend_venv.to_string_lossy().to_string(),
                        "backend_root/.venv",
                    );
                }
            }
        }
        if !desktop_packaged_mode() {
            let repo_python = project_root().join(".venv").join("bin").join("python");
            if repo_python.exists() {
                push_unique_string_candidate(
                    &mut candidates,
                    repo_python.to_string_lossy().to_string(),
                    "repo_root/.venv",
                );
            }
            if python_command_available("python3") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python3".to_string(),
                    "system_python3",
                );
            }
            if python_command_available("python") {
                push_unique_string_candidate(
                    &mut candidates,
                    "python".to_string(),
                    "system_python",
                );
            }
        }
    }
    candidates
}

fn resolved_env_values() -> HashMap<String, String> {
    let mut values = configured_env_values();
    let storage_dir = resolve_storage_dir(&values);
    values.insert(
        "KERA_STORAGE_DIR".to_string(),
        storage_dir.to_string_lossy().to_string(),
    );
    if configured_or_process_env_value("KERA_DATA_PLANE_DATABASE_URL", &values).is_none()
        && configured_or_process_env_value("KERA_LOCAL_DATABASE_URL", &values).is_none()
    {
        values.insert(
            "KERA_DATA_PLANE_DATABASE_URL".to_string(),
            sqlite_url_for_path(&storage_dir.join("kera.db")),
        );
    }
    let control_plane_api_base_url =
        configured_or_process_env_value("KERA_CONTROL_PLANE_API_BASE_URL", &values)
            .unwrap_or_default();
    if control_plane_api_base_url.trim().is_empty() {
        if configured_or_process_env_value("KERA_CONTROL_PLANE_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("KERA_AUTH_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("KERA_DATABASE_URL", &values).is_none()
            && configured_or_process_env_value("DATABASE_URL", &values).is_none()
        {
            values.insert(
                "KERA_CONTROL_PLANE_DATABASE_URL".to_string(),
                sqlite_url_for_path(&storage_dir.join("kera.db")),
            );
        }
    } else if configured_or_process_env_value("KERA_LOCAL_CONTROL_PLANE_DATABASE_URL", &values)
        .is_none()
        && configured_or_process_env_value("KERA_CONTROL_PLANE_LOCAL_DATABASE_URL", &values)
            .is_none()
    {
        values.insert(
            "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL".to_string(),
            sqlite_url_for_path(&storage_dir.join("control_plane_cache.db")),
        );
    }
    if configured_or_process_env_value("KERA_GOOGLE_CLIENT_ID", &values).is_none() {
        if let Some(client_id) =
            configured_or_process_env_value("NEXT_PUBLIC_GOOGLE_CLIENT_ID", &values)
        {
            values.insert("KERA_GOOGLE_CLIENT_ID".to_string(), client_id);
        }
    }
    values
}

fn desktop_config_values_from_env(env: &HashMap<String, String>) -> DesktopAppConfigValues {
    let read = |key: &str| env.get(key).cloned().unwrap_or_default();
    DesktopAppConfigValues {
        storage_dir: read("KERA_STORAGE_DIR"),
        control_plane_api_base_url: read("KERA_CONTROL_PLANE_API_BASE_URL"),
        control_plane_node_id: read("KERA_CONTROL_PLANE_NODE_ID"),
        control_plane_node_token: read("KERA_CONTROL_PLANE_NODE_TOKEN"),
        control_plane_site_id: read("KERA_CONTROL_PLANE_SITE_ID"),
        local_backend_python: read("KERA_DESKTOP_LOCAL_BACKEND_PYTHON"),
        local_backend_mode: {
            let normalized = read("KERA_DESKTOP_LOCAL_BACKEND_MODE");
            if normalized.eq_ignore_ascii_case("external") {
                "external".to_string()
            } else {
                "managed".to_string()
            }
        },
        ml_transport: {
            let normalized = read("KERA_DESKTOP_ML_TRANSPORT");
            if normalized.eq_ignore_ascii_case("http") {
                "http".to_string()
            } else {
                "sidecar".to_string()
            }
        },
    }
}

fn desktop_primary_resource_dir() -> Option<PathBuf> {
    let candidates = desktop_resource_dir_candidates();
    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
}

fn desktop_runtime_readiness(
    values: &HashMap<String, String>,
    config_values: &DesktopAppConfigValues,
    backend: Option<&DesktopBackendTarget>,
) -> DesktopRuntimeReadiness {
    let backend_candidates = desktop_backend_root_candidates(values)
        .into_iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.path.display()))
        .collect::<Vec<_>>();
    let python_candidate_infos = local_backend_python_candidate_infos(values);
    let python_candidates = python_candidate_infos
        .iter()
        .map(|candidate| format!("{} -> {}", candidate.source, candidate.value))
        .collect::<Vec<_>>();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if desktop_packaged_mode() && desktop_primary_resource_dir().is_none() {
        errors.push(
            "Packaged desktop runtime did not resolve a Tauri resource directory. Reinstall the desktop app or rebuild the installer."
                .to_string(),
        );
    }

    if backend.is_none() {
        if desktop_packaged_mode() {
            errors.push(
                "Packaged desktop runtime did not resolve a bundled backend. Reinstall the desktop app or rebuild the packaged resources."
                    .to_string(),
            );
        } else {
            warnings.push(
                "Desktop backend entrypoint was not resolved from the current dev/runtime candidates.".to_string(),
            );
        }
    }

    if config_values.local_backend_mode != "external" && python_candidate_infos.is_empty() {
        if desktop_packaged_mode() {
            errors.push(
                "Packaged managed runtime did not find a bundled or explicitly configured Python interpreter."
                    .to_string(),
            );
        } else {
            warnings.push("No desktop local backend Python candidate was resolved.".to_string());
        }
    }

    if config_values.ml_transport == "sidecar" && python_candidate_infos.is_empty() {
        let message =
            "Desktop ML sidecar requires a bundled or explicitly configured Python interpreter."
                .to_string();
        if desktop_packaged_mode() {
            if !errors.iter().any(|existing| existing == &message) {
                errors.push(message);
            }
        } else if !warnings.iter().any(|existing| existing == &message) {
            warnings.push(message);
        }
    }

    DesktopRuntimeReadiness {
        backend_candidates,
        python_candidates,
        errors,
        warnings,
    }
}

fn desktop_runtime_contract_response(
    values: &HashMap<String, String>,
    config_values: &DesktopAppConfigValues,
    backend: Option<&DesktopBackendTarget>,
) -> DesktopRuntimeContractResponse {
    let runtime_dir = desktop_app_local_data_dir().join("runtime");
    let readiness = desktop_runtime_readiness(values, config_values, backend);

    DesktopRuntimeContractResponse {
        mode: desktop_runtime_mode().as_str().to_string(),
        packaged_mode: desktop_packaged_mode(),
        env_source: if desktop_packaged_mode() {
            "desktop_config_only".to_string()
        } else {
            "repo_env_plus_desktop_config".to_string()
        },
        resource_dir: desktop_primary_resource_dir().map(|path| path.to_string_lossy().to_string()),
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        logs_dir: runtime_dir.to_string_lossy().to_string(),
        backend_source: backend
            .map(|resolved| resolved.source.clone())
            .unwrap_or_else(|| "missing".to_string()),
        backend_candidates: readiness.backend_candidates,
        python_candidates: readiness.python_candidates,
        errors: readiness.errors,
        warnings: readiness.warnings,
    }
}

fn desktop_setup_ready(values: &DesktopAppConfigValues) -> bool {
    let resolved_values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&resolved_values);
    let backend_ref = backend.as_ref().ok();
    desktop_runtime_readiness(&resolved_values, values, backend_ref)
        .errors
        .is_empty()
}

fn ensure_desktop_runtime_readiness_for_backend() -> Result<(), String> {
    let values = resolved_env_values();
    let config_values = desktop_config_values_from_env(&values);
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    Ok(())
}

fn ensure_desktop_runtime_readiness_for_sidecar() -> Result<(), String> {
    let values = resolved_env_values();
    let mut config_values = desktop_config_values_from_env(&values);
    config_values.ml_transport = "sidecar".to_string();
    let backend = resolve_desktop_backend_target(&values);
    let readiness = desktop_runtime_readiness(&values, &config_values, backend.as_ref().ok());
    if !readiness.errors.is_empty() {
        return Err(readiness.errors.join(" "));
    }
    Ok(())
}

fn desktop_app_config_response() -> DesktopAppConfigResponse {
    let values = resolved_env_values();
    let config_values = desktop_config_values_from_env(&values);
    let backend = resolve_desktop_backend_target(&values);
    let backend_ref = backend.as_ref().ok();
    DesktopAppConfigResponse {
        runtime: "desktop".to_string(),
        config_path: desktop_config_path().to_string_lossy().to_string(),
        app_local_data_dir: desktop_app_local_data_dir().to_string_lossy().to_string(),
        repo_root: project_root().to_string_lossy().to_string(),
        backend_root: backend_ref
            .map(|resolved| resolved.root.to_string_lossy().to_string())
            .unwrap_or_default(),
        backend_entry: backend_ref
            .map(|resolved| resolved.backend_entry_path.to_string_lossy().to_string())
            .unwrap_or_default(),
        worker_module: backend_ref
            .map(|resolved| resolved.worker_module.clone())
            .unwrap_or_else(|| "kera_research.worker".to_string()),
        storage_state_file: storage_state_file_hint(),
        setup_ready: desktop_setup_ready(&config_values),
        runtime_contract: desktop_runtime_contract_response(&values, &config_values, backend_ref),
        values: config_values,
    }
}

fn set_config_env_value(target: &mut BTreeMap<String, String>, key: &str, value: Option<String>) {
    let normalized = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match normalized {
        Some(value) => {
            target.insert(key.to_string(), value);
        }
        None => {
            target.remove(key);
        }
    }
}

fn normalized_storage_dir_value(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(value) = normalized else {
        return Ok(None);
    };
    let path = normalize_storage_bundle_path(PathBuf::from(value));
    ensure_storage_bundle_dirs(&path)?;
    write_storage_state_dir(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn env_value(key: &str) -> Option<String> {
    process_env_value(key)
        .or_else(|| resolved_env_values().get(key).cloned())
        .map(|value| value.trim().to_string())
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

fn sqlite_database_path() -> Result<PathBuf, String> {
    let raw = env_value("KERA_DATA_PLANE_DATABASE_URL")
        .ok_or_else(|| "KERA_DATA_PLANE_DATABASE_URL is not configured.".to_string())?;
    let normalized = raw.trim();
    let path = normalized
        .strip_prefix("sqlite:///")
        .or_else(|| normalized.strip_prefix("sqlite://"))
        .unwrap_or(normalized);
    if path.is_empty() {
        return Err("SQLite database path is empty.".to_string());
    }
    Ok(PathBuf::from(path))
}

fn site_dir(site_id: &str) -> Result<PathBuf, String> {
    let raw = env_value("KERA_STORAGE_DIR")
        .ok_or_else(|| "KERA_STORAGE_DIR is not configured.".to_string())?;
    let base = PathBuf::from(raw);
    let site_root = if base
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("sites"))
        .unwrap_or(false)
    {
        base
    } else {
        base.join("sites")
    };
    Ok(site_root.join(site_id))
}

fn control_plane_dir() -> Result<PathBuf, String> {
    if let Some(raw) = env_value("KERA_CONTROL_PLANE_DIR") {
        let normalized = raw.trim();
        if !normalized.is_empty() {
            return Ok(PathBuf::from(normalized));
        }
    }
    let raw = env_value("KERA_STORAGE_DIR")
        .ok_or_else(|| "KERA_STORAGE_DIR is not configured.".to_string())?;
    Ok(PathBuf::from(raw).join("control_plane"))
}

fn control_plane_case_dir() -> Result<PathBuf, String> {
    Ok(control_plane_dir()?.join("validation_cases"))
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn federation_salt_config_path() -> Option<PathBuf> {
    control_plane_dir()
        .ok()
        .map(|dir| dir.join("federation_salt.json"))
}

fn read_federation_salt_config_file() -> FederationSaltConfigFile {
    let Some(path) = federation_salt_config_path() else {
        return FederationSaltConfigFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return FederationSaltConfigFile::default();
    };
    serde_json::from_str::<FederationSaltConfigFile>(&raw).unwrap_or_default()
}

fn write_federation_salt_config_file(config: &FederationSaltConfigFile) -> Result<(), String> {
    let Some(path) = federation_salt_config_path() else {
        return Err("Federation salt config path is unavailable.".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn resolve_federation_salt_config() -> FederationSaltConfigFile {
    let stored = read_federation_salt_config_file();
    let explicit_case = env_value("KERA_CASE_REFERENCE_SALT");
    let explicit_patient = env_value("KERA_PATIENT_REFERENCE_SALT");
    let explicit_public = env_value("KERA_PUBLIC_ALIAS_SALT");
    let legacy_secret = env_value("KERA_API_SECRET");

    let case_reference_salt = explicit_case
        .clone()
        .or_else(|| normalize_optional_text(stored.case_reference_salt.clone()))
        .or_else(|| legacy_secret.clone())
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string());
    let patient_reference_salt = explicit_patient
        .clone()
        .or_else(|| normalize_optional_text(stored.patient_reference_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());
    let public_alias_salt = explicit_public
        .clone()
        .or_else(|| normalize_optional_text(stored.public_alias_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());

    let source =
        if explicit_case.is_some() || explicit_patient.is_some() || explicit_public.is_some() {
            "explicit_env".to_string()
        } else if normalize_optional_text(stored.case_reference_salt.clone()).is_some() {
            normalize_optional_text(stored.source.clone()).unwrap_or_else(|| "stored".to_string())
        } else if legacy_secret.is_some() {
            "legacy_kera_api_secret".to_string()
        } else {
            "default".to_string()
        };

    let resolved = FederationSaltConfigFile {
        case_reference_salt: Some(case_reference_salt),
        patient_reference_salt: Some(patient_reference_salt),
        public_alias_salt: Some(public_alias_salt),
        source: Some(source),
    };

    if resolved != stored {
        let _ = write_federation_salt_config_file(&resolved);
    }

    resolved
}

fn local_node_api_base_url() -> String {
    for key in [
        "KERA_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL",
        "NEXT_PUBLIC_API_BASE_URL",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() {
                return normalized;
            }
        }
    }
    "http://127.0.0.1:8000".to_string()
}

fn desktop_ml_transport() -> String {
    for key in [
        "KERA_DESKTOP_ML_TRANSPORT",
        "NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "http" {
                return "http".to_string();
            }
            if normalized == "sidecar" {
                return "sidecar".to_string();
            }
        }
    }
    "sidecar".to_string()
}

fn desktop_local_backend_mode() -> String {
    for key in [
        "KERA_DESKTOP_LOCAL_BACKEND_MODE",
        "NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE",
    ] {
        if let Some(value) = env_value(key) {
            let normalized = value.trim().to_lowercase();
            if normalized == "external" {
                return "external".to_string();
            }
            if normalized == "managed" {
                return "managed".to_string();
            }
        }
    }
    if desktop_ml_transport() == "http" {
        "external".to_string()
    } else {
        "managed".to_string()
    }
}

fn local_backend_state() -> &'static Mutex<LocalBackendRuntime> {
    LOCAL_BACKEND_STATE.get_or_init(|| Mutex::new(LocalBackendRuntime::default()))
}

fn local_backend_targets_local_url(base_url: &str) -> bool {
    let Ok(url) = HttpUrl::parse(base_url) else {
        return false;
    };
    match url.host_str() {
        Some("127.0.0.1") | Some("localhost") => true,
        _ => false,
    }
}

fn local_backend_should_be_managed(base_url: &str) -> bool {
    desktop_local_backend_mode() == "managed" && local_backend_targets_local_url(base_url)
}

fn local_backend_startup_timeout() -> Duration {
    for key in [
        "KERA_DESKTOP_LOCAL_BACKEND_STARTUP_TIMEOUT_MS",
        "NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_STARTUP_TIMEOUT_MS",
    ] {
        if let Some(value) = env_value(key) {
            if let Ok(milliseconds) = value.trim().parse::<u64>() {
                if milliseconds > 0 {
                    return Duration::from_millis(milliseconds);
                }
            }
        }
    }
    Duration::from_secs(30)
}

fn desktop_runtime_dir() -> Result<PathBuf, String> {
    let path = desktop_app_local_data_dir().join("runtime");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn local_backend_log_paths() -> Result<(PathBuf, PathBuf), String> {
    let runtime_dir = desktop_runtime_dir()?;
    Ok((
        runtime_dir.join("local-node.stdout.log"),
        runtime_dir.join("local-node.stderr.log"),
    ))
}

fn local_worker_log_paths() -> Result<(PathBuf, PathBuf), String> {
    let runtime_dir = desktop_runtime_dir()?;
    Ok((
        runtime_dir.join("local-worker.stdout.log"),
        runtime_dir.join("local-worker.stderr.log"),
    ))
}

fn local_backend_health_url(base_url: &str) -> String {
    format!("{}/api/health", base_url.trim_end_matches('/'))
}

fn local_backend_is_healthy(base_url: &str) -> bool {
    let Ok(client) = HttpClient::builder()
        .timeout(Duration::from_millis(1200))
        .build()
    else {
        return false;
    };
    let Ok(response) = client.get(local_backend_health_url(base_url)).send() else {
        return false;
    };
    response.status().is_success()
}

fn wait_for_local_backend_health(base_url: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if local_backend_is_healthy(base_url) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "Desktop-managed local backend did not become healthy within {} ms.",
        timeout.as_millis()
    ))
}

fn apply_runtime_env_to_command(command: &mut Command, python_path_entries: &[PathBuf]) {
    for (key, value) in resolved_env_values() {
        if !value.trim().is_empty() {
            command.env(key, value);
        }
    }
    command
        .env("KERA_SKIP_LOCAL_ENV_FILE", "1")
        .env("KERA_LLM_RELAY_ONLY", "1")
        .env("KERA_STORAGE_STATE_FILE", storage_state_file_path())
        .env("KERA_SEGMENTATION_BACKEND", "medsam")
        .env("SEGMENTATION_BACKEND", "medsam")
        .env("PYTHONUNBUFFERED", "1");
    for key in [
        "OPENAI_API_KEY",
        "KERA_AI_CLINIC_OPENAI_API_KEY",
        "KERA_CONTROL_PLANE_OPENAI_API_KEY",
        "KERA_SEGMENTATION_ROOT",
        "SEGMENTATION_ROOT",
        "KERA_SEGMENTATION_SCRIPT",
        "SEGMENTATION_SCRIPT",
        "KERA_SEGMENTATION_CHECKPOINT",
        "SEGMENTATION_CHECKPOINT",
        "MEDSAM_SCRIPT",
        "MEDSAM_CHECKPOINT",
    ] {
        command.env_remove(key);
    }
    if let Some(value) = python_path_with_entries(python_path_entries) {
        command.env("PYTHONPATH", value);
    }
}

fn python_command_available(command_name: &str) -> bool {
    Command::new(command_name)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn local_backend_python_candidates() -> Vec<String> {
    let values = resolved_env_values();
    local_backend_python_candidate_infos(&values)
        .into_iter()
        .map(|candidate| candidate.value)
        .collect()
}

fn spawn_local_backend_process(base_url: &str) -> Result<SpawnedLocalBackend, String> {
    let parsed = HttpUrl::parse(base_url)
        .map_err(|error| format!("Invalid local backend base URL: {error}"))?;
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port_or_known_default().unwrap_or(8000).to_string();
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    if !backend.backend_entry_path.exists() {
        return Err(format!(
            "Local backend entrypoint was not found: {}",
            backend.backend_entry_path.display()
        ));
    }
    let storage_dir = resolve_storage_dir(&values);
    ensure_storage_bundle_dirs(&storage_dir)?;
    let _ = write_storage_state_dir(&storage_dir);
    let (stdout_log_path, stderr_log_path) = local_backend_log_paths()?;
    let mut errors = Vec::new();

    for python_path in local_backend_python_candidates() {
        let stdout_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stdout_log_path)
            .map_err(|error| error.to_string())?;
        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .map_err(|error| error.to_string())?;

        let launch_command = vec![
            python_path.clone(),
            "-m".to_string(),
            "uvicorn".to_string(),
            backend.backend_module.clone(),
            "--host".to_string(),
            host.clone(),
            "--port".to_string(),
            port.clone(),
            "--log-level".to_string(),
            "warning".to_string(),
        ];

        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg("uvicorn")
            .arg(&backend.backend_module)
            .arg("--host")
            .arg(&host)
            .arg("--port")
            .arg(&port)
            .arg("--log-level")
            .arg("warning")
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                return Ok(SpawnedLocalBackend {
                    child,
                    python_path,
                    launch_command,
                    stdout_log_path: stdout_log_path.to_string_lossy().to_string(),
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop-managed local backend. {}",
        errors.join(" | ")
    ))
}

fn local_worker_state() -> &'static Mutex<LocalWorkerRuntime> {
    LOCAL_WORKER_STATE.get_or_init(|| Mutex::new(LocalWorkerRuntime::default()))
}

fn local_worker_should_be_managed() -> bool {
    local_backend_should_be_managed(&local_node_api_base_url())
}

fn spawn_local_worker_process() -> Result<SpawnedLocalWorker, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let worker_entry = backend
        .root
        .join("src")
        .join("kera_research")
        .join("worker.py");
    if !worker_entry.exists() && backend.worker_module == "kera_research.worker" {
        return Err(format!(
            "Local worker entrypoint was not found: {}",
            worker_entry.display()
        ));
    }
    let storage_dir = resolve_storage_dir(&values);
    ensure_storage_bundle_dirs(&storage_dir)?;
    let _ = write_storage_state_dir(&storage_dir);
    let (stdout_log_path, stderr_log_path) = local_worker_log_paths()?;
    let mut errors = Vec::new();

    for python_path in local_backend_python_candidates() {
        let stdout_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stdout_log_path)
            .map_err(|error| error.to_string())?;
        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .map_err(|error| error.to_string())?;

        let launch_command = vec![
            python_path.clone(),
            "-m".to_string(),
            backend.worker_module.clone(),
            "--poll-interval".to_string(),
            "2.0".to_string(),
        ];

        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg(&backend.worker_module)
            .arg("--poll-interval")
            .arg("2.0")
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                return Ok(SpawnedLocalWorker {
                    child,
                    python_path,
                    launch_command,
                    stdout_log_path: stdout_log_path.to_string_lossy().to_string(),
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop-managed local worker. {}",
        errors.join(" | ")
    ))
}

fn sync_local_backend_runtime(runtime: &mut LocalBackendRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!(
                    "Desktop-managed local backend exited with status {status}."
                ));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!(
                    "Failed to inspect desktop-managed local backend: {error}"
                ));
            }
        }
    }
    if let Some(error) = cleared_error {
        runtime.child = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn sync_local_worker_runtime(runtime: &mut LocalWorkerRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!(
                    "Desktop-managed local worker exited with status {status}."
                ));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!(
                    "Failed to inspect desktop-managed local worker: {error}"
                ));
            }
        }
    }
    if let Some(error) = cleared_error {
        runtime.child = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn local_worker_status_snapshot(runtime: &LocalWorkerRuntime) -> LocalWorkerStatus {
    let managed = local_worker_should_be_managed();
    LocalWorkerStatus {
        mode: if managed {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        managed,
        running: runtime.child.is_some(),
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: runtime.stdout_log_path.clone(),
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

fn local_backend_status_snapshot(
    base_url: &str,
    runtime: &LocalBackendRuntime,
    healthy: bool,
) -> LocalBackendStatus {
    let managed = local_backend_should_be_managed(base_url);
    LocalBackendStatus {
        transport: desktop_ml_transport(),
        mode: if managed {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        base_url: base_url.to_string(),
        local_url: local_backend_targets_local_url(base_url),
        managed,
        running: runtime.child.is_some() || healthy,
        healthy,
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: runtime.stdout_log_path.clone(),
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

fn get_local_backend_status_internal() -> Result<LocalBackendStatus, String> {
    let base_url = local_node_api_base_url();
    let healthy = local_backend_is_healthy(&base_url);
    let mut runtime = local_backend_state()
        .lock()
        .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
    sync_local_backend_runtime(&mut runtime);
    Ok(local_backend_status_snapshot(&base_url, &runtime, healthy))
}

fn get_local_worker_status_internal() -> Result<LocalWorkerStatus, String> {
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    Ok(local_worker_status_snapshot(&runtime))
}

fn ensure_local_backend_ready_internal() -> Result<LocalBackendStatus, String> {
    let base_url = local_node_api_base_url();
    if local_backend_is_healthy(&base_url) {
        return get_local_backend_status_internal();
    }
    if !local_backend_should_be_managed(&base_url) {
        return Err(format!(
            "Local backend is unavailable at {base_url}. Start the local node manually or set KERA_DESKTOP_LOCAL_BACKEND_MODE=managed."
        ));
    }
    ensure_desktop_runtime_readiness_for_backend()?;

    {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if runtime.child.is_none() {
            let spawned = spawn_local_backend_process(&base_url)?;
            runtime.child = Some(spawned.child);
            runtime.python_path = Some(spawned.python_path);
            runtime.launch_command = Some(spawned.launch_command);
            runtime.stdout_log_path = Some(spawned.stdout_log_path);
            runtime.stderr_log_path = Some(spawned.stderr_log_path);
            runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
            runtime.last_error = None;
            runtime.launched_by_desktop = true;
        }
    }

    if let Err(error) = wait_for_local_backend_health(&base_url, local_backend_startup_timeout()) {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if let Some(mut child) = runtime.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error.clone());
        return Err(error);
    }

    get_local_backend_status_internal()
}

fn ensure_local_worker_ready_internal() -> Result<LocalWorkerStatus, String> {
    if !local_worker_should_be_managed() {
        return get_local_worker_status_internal();
    }
    ensure_desktop_runtime_readiness_for_backend()?;
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if runtime.child.is_none() {
        let spawned = spawn_local_worker_process()?;
        runtime.child = Some(spawned.child);
        runtime.python_path = Some(spawned.python_path);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stdout_log_path = Some(spawned.stdout_log_path);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
    }
    Ok(local_worker_status_snapshot(&runtime))
}

fn stop_local_worker_internal() -> Result<LocalWorkerStatus, String> {
    let mut runtime = local_worker_state()
        .lock()
        .map_err(|_| "Failed to access desktop local worker state.".to_string())?;
    sync_local_worker_runtime(&mut runtime);
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.launched_by_desktop = false;
    Ok(local_worker_status_snapshot(&runtime))
}

fn ensure_local_runtime_ready_internal() -> Result<LocalBackendStatus, String> {
    let backend = ensure_local_backend_ready_internal()?;
    if local_backend_should_be_managed(&backend.base_url) {
        ensure_local_worker_ready_internal()?;
    }
    if ml_sidecar_should_be_used() {
        ensure_ml_sidecar_ready_internal()?;
        schedule_ml_sidecar_workflow_warmup();
    }
    Ok(backend)
}

fn stop_local_runtime_internal() -> Result<LocalBackendStatus, String> {
    let _ = stop_local_worker_internal();
    let _ = stop_ml_sidecar_internal();
    stop_local_backend_internal()
}

fn stop_local_backend_internal() -> Result<LocalBackendStatus, String> {
    {
        let mut runtime = local_backend_state()
            .lock()
            .map_err(|_| "Failed to access desktop local backend state.".to_string())?;
        sync_local_backend_runtime(&mut runtime);
        if let Some(mut child) = runtime.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        runtime.launched_by_desktop = false;
    }
    get_local_backend_status_internal()
}

fn ml_sidecar_state() -> &'static Mutex<MlSidecarRuntime> {
    ML_SIDECAR_STATE.get_or_init(|| Mutex::new(MlSidecarRuntime::default()))
}

fn ml_sidecar_should_be_used() -> bool {
    desktop_ml_transport() == "sidecar"
}

fn ml_sidecar_stderr_log_path() -> Result<PathBuf, String> {
    Ok(desktop_runtime_dir()?.join("ml-sidecar.stderr.log"))
}

fn spawn_ml_sidecar_process() -> Result<SpawnedMlSidecar, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    let stderr_log_path = ml_sidecar_stderr_log_path()?;
    let mut errors = Vec::new();

    for python_path in local_backend_python_candidates() {
        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .map_err(|error| error.to_string())?;
        let launch_command = vec![
            python_path.clone(),
            "-m".to_string(),
            "kera_research.desktop_sidecar".to_string(),
        ];
        let mut command = Command::new(&python_path);
        command
            .current_dir(&backend.root)
            .arg("-m")
            .arg("kera_research.desktop_sidecar")
            .stdout(Stdio::piped())
            .stdin(Stdio::piped())
            .stderr(Stdio::from(stderr_file));
        apply_runtime_env_to_command(&mut command, &backend.python_path_entries);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(mut child) => {
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "Failed to capture ML sidecar stdin.".to_string())?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| "Failed to capture ML sidecar stdout.".to_string())?;
                return Ok(SpawnedMlSidecar {
                    child,
                    stdin,
                    stdout: BufReader::new(stdout),
                    python_path,
                    launch_command,
                    stderr_log_path: stderr_log_path.to_string_lossy().to_string(),
                });
            }
            Err(error) => errors.push(format!("{python_path}: {error}")),
        }
    }

    Err(format!(
        "Failed to launch the desktop ML sidecar. {}",
        errors.join(" | ")
    ))
}

fn sync_ml_sidecar_runtime(runtime: &mut MlSidecarRuntime) {
    let mut cleared_error: Option<String> = None;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                cleared_error = Some(format!("Desktop ML sidecar exited with status {status}."));
            }
            Ok(None) => {}
            Err(error) => {
                cleared_error = Some(format!("Failed to inspect desktop ML sidecar: {error}"));
            }
        }
    }
    if let Some(error) = cleared_error {
        runtime.child = None;
        runtime.stdin = None;
        runtime.stdout = None;
        runtime.launched_by_desktop = false;
        runtime.last_error = Some(error);
    }
}

fn stop_ml_sidecar_runtime(runtime: &mut MlSidecarRuntime) {
    if let Some(mut child) = runtime.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    runtime.stdin = None;
    runtime.stdout = None;
    runtime.launched_by_desktop = false;
}

fn call_ml_sidecar_json_unlocked(
    runtime: &mut MlSidecarRuntime,
    method: &str,
    params: JsonValue,
) -> Result<JsonValue, String> {
    let request_id = runtime.next_request_id;
    runtime.next_request_id = runtime.next_request_id.saturating_add(1);
    let payload = json!({
        "id": request_id,
        "method": method,
        "params": params,
    });
    let stdin = runtime
        .stdin
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdin is unavailable.".to_string())?;
    let serialized = serde_json::to_string(&payload)
        .map_err(|error| format!("Failed to serialize sidecar request: {error}"))?;
    stdin
        .write_all(serialized.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write to the desktop ML sidecar: {error}"))?;

    let stdout = runtime
        .stdout
        .as_mut()
        .ok_or_else(|| "Desktop ML sidecar stdout is unavailable.".to_string())?;
    let mut line = String::new();
    let bytes_read = stdout
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read from the desktop ML sidecar: {error}"))?;
    if bytes_read == 0 || line.trim().is_empty() {
        return Err("Desktop ML sidecar closed the response stream.".to_string());
    }
    let response = serde_json::from_str::<JsonValue>(&line)
        .map_err(|error| format!("Invalid sidecar response JSON: {error}"))?;
    if response.get("id").and_then(|value| value.as_u64()) != Some(request_id) {
        return Err("Desktop ML sidecar returned an unexpected response id.".to_string());
    }
    if response.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(JsonValue::Null));
    }
    let error_message = response
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Desktop ML sidecar request failed.".to_string());
    Err(error_message)
}

fn ml_sidecar_status_snapshot(runtime: &MlSidecarRuntime, healthy: bool) -> MlSidecarStatus {
    let base_url = local_node_api_base_url();
    MlSidecarStatus {
        transport: desktop_ml_transport(),
        mode: if ml_sidecar_should_be_used() {
            "managed".to_string()
        } else {
            "external".to_string()
        },
        base_url: base_url.clone(),
        local_url: local_backend_targets_local_url(&base_url),
        managed: ml_sidecar_should_be_used(),
        running: runtime.child.is_some() && healthy,
        healthy,
        launched_by_desktop: runtime.launched_by_desktop,
        pid: runtime.child.as_ref().map(Child::id),
        python_path: runtime.python_path.clone(),
        launch_command: runtime.launch_command.clone(),
        stdout_log_path: None,
        stderr_log_path: runtime.stderr_log_path.clone(),
        last_started_at: runtime.last_started_at.clone(),
        last_error: runtime.last_error.clone(),
    }
}

fn get_ml_sidecar_status_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let healthy = if runtime.child.is_some() {
        call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_ok()
    } else {
        false
    };
    Ok(ml_sidecar_status_snapshot(&runtime, healthy))
}

fn ensure_ml_sidecar_ready_internal() -> Result<MlSidecarStatus, String> {
    if !ml_sidecar_should_be_used() {
        return get_ml_sidecar_status_internal();
    }
    ensure_desktop_runtime_readiness_for_sidecar()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    let mut needs_spawn = runtime.child.is_none();
    if !needs_spawn && call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null).is_err()
    {
        stop_ml_sidecar_runtime(&mut runtime);
        needs_spawn = true;
    }
    if needs_spawn {
        let spawned = spawn_ml_sidecar_process()?;
        runtime.child = Some(spawned.child);
        runtime.stdin = Some(spawned.stdin);
        runtime.stdout = Some(spawned.stdout);
        runtime.python_path = Some(spawned.python_path);
        runtime.launch_command = Some(spawned.launch_command);
        runtime.stderr_log_path = Some(spawned.stderr_log_path);
        runtime.last_started_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
        runtime.last_error = None;
        runtime.launched_by_desktop = true;
        if let Err(error) = call_ml_sidecar_json_unlocked(&mut runtime, "ping", JsonValue::Null) {
            stop_ml_sidecar_runtime(&mut runtime);
            runtime.last_error = Some(error.clone());
            return Err(error);
        }
    }
    Ok(ml_sidecar_status_snapshot(&runtime, true))
}

fn stop_ml_sidecar_internal() -> Result<MlSidecarStatus, String> {
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    stop_ml_sidecar_runtime(&mut runtime);
    Ok(ml_sidecar_status_snapshot(&runtime, false))
}

fn request_ml_sidecar_json(method: &str, params: JsonValue) -> Result<JsonValue, String> {
    ensure_ml_sidecar_ready_internal()?;
    let mut runtime = ml_sidecar_state()
        .lock()
        .map_err(|_| "Failed to access desktop ML sidecar state.".to_string())?;
    sync_ml_sidecar_runtime(&mut runtime);
    match call_ml_sidecar_json_unlocked(&mut runtime, method, params) {
        Ok(result) => Ok(result),
        Err(error) => {
            runtime.last_error = Some(error.clone());
            Err(error)
        }
    }
}

fn schedule_ml_sidecar_workflow_warmup() {
    if !ml_sidecar_should_be_used() {
        return;
    }
    std::thread::spawn(|| {
        let mut runtime = match ml_sidecar_state().lock() {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        sync_ml_sidecar_runtime(&mut runtime);
        if runtime.child.is_none() {
            return;
        }
        let _ = call_ml_sidecar_json_unlocked(&mut runtime, "warm_workflow", JsonValue::Null);
    });
}

fn raw_dir(site_id: &str) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?.join("data").join("raw"))
}

fn case_history_dir(site_id: &str) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?.join("case_history"))
}

fn resolve_site_runtime_path(site_id: &str, value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Path value is empty.".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return Ok(candidate);
    }
    Ok(site_dir(site_id)?.join(candidate))
}

fn preview_cache_path(site_id: &str, image_id: &str, max_side: u32) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?
        .join("artifacts")
        .join("image_previews")
        .join(max_side.to_string())
        .join(format!("{image_id}.jpg")))
}

#[derive(Debug, Clone)]
struct WarmPreviewJob {
    site_id: String,
    image_id: String,
    image_path: PathBuf,
    max_side: u32,
}

fn preview_warm_state() -> &'static Mutex<HashSet<String>> {
    PREVIEW_WARM_STATE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn preview_job_key(site_id: &str, image_id: &str, max_side: u32) -> String {
    format!("{site_id}::{image_id}::{max_side}")
}

fn ensure_preview(image_path: &Path, preview_path: &Path, max_side: u32) -> Result<(), String> {
    if preview_path.exists() {
        return Ok(());
    }
    if !image_path.exists() {
        return Err(format!(
            "Image file not found on disk: {}",
            image_path.display()
        ));
    }
    if let Some(parent) = preview_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let image = image::open(image_path).map_err(|error| error.to_string())?;
    let clamped_side = max_side.clamp(96, 1024);
    let thumbnail = image.thumbnail(clamped_side, clamped_side);
    thumbnail
        .save_with_format(preview_path, ImageFormat::Jpeg)
        .map_err(|error| error.to_string())
}

fn existing_file_path_string(path: &Path) -> Option<String> {
    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn cached_preview_file_path(
    site_id: &str,
    image_id: &str,
    max_side: u32,
) -> Result<Option<String>, String> {
    let preview_path = preview_cache_path(site_id, image_id, max_side)?;
    Ok(existing_file_path_string(&preview_path))
}

fn preview_file_path(
    site_id: &str,
    image_id: &str,
    image_path: &Path,
    max_side: u32,
) -> Result<String, String> {
    let preview_path = preview_cache_path(site_id, image_id, max_side)?;
    ensure_preview(image_path, &preview_path, max_side)?;
    Ok(preview_path.to_string_lossy().to_string())
}

fn maybe_queue_preview_job(
    site_id: &str,
    image_id: &str,
    image_path: &Path,
    max_side: u32,
) -> Option<WarmPreviewJob> {
    let preview_path = preview_cache_path(site_id, image_id, max_side).ok()?;
    if preview_path.exists() || !image_path.exists() {
        return None;
    }
    Some(WarmPreviewJob {
        site_id: site_id.to_string(),
        image_id: image_id.to_string(),
        image_path: image_path.to_path_buf(),
        max_side,
    })
}

fn queue_preview_generation_batch(jobs: Vec<WarmPreviewJob>) {
    if jobs.is_empty() {
        return;
    }
    let mut queued_jobs = Vec::new();
    {
        let mut queued = preview_warm_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for job in jobs {
            let job_key = preview_job_key(&job.site_id, &job.image_id, job.max_side);
            if queued.insert(job_key.clone()) {
                queued_jobs.push((job_key, job));
            }
        }
    }
    if queued_jobs.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for (job_key, job) in queued_jobs {
            if let Ok(preview_path) = preview_cache_path(&job.site_id, &job.image_id, job.max_side)
            {
                let _ = ensure_preview(&job.image_path, &preview_path, job.max_side);
            }
            let mut queued = preview_warm_state()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            queued.remove(&job_key);
        }
    });
}

fn open_data_plane_db() -> Result<Connection, String> {
    let path = sqlite_database_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|error| error.to_string())?;
    // WAL mode: readers don't block writers, much faster for concurrent access
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    Ok(conn)
}

/// Called once at startup to ensure performance-critical indexes exist.
fn ensure_data_plane_indexes() {
    let Ok(conn) = open_data_plane_db() else {
        return;
    };
    let _ = conn.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_images_site_visit
          ON images(site_id, visit_id);
        CREATE INDEX IF NOT EXISTS idx_images_site_image_id
          ON images(site_id, image_id);
        CREATE INDEX IF NOT EXISTS idx_images_site_representative
          ON images(site_id, visit_id, is_representative);
        CREATE INDEX IF NOT EXISTS idx_visits_site_patient
          ON visits(site_id, patient_id);
        CREATE INDEX IF NOT EXISTS idx_visits_site_visit_id
          ON visits(site_id, visit_id);
        CREATE INDEX IF NOT EXISTS idx_patients_site_patient
          ON patients(site_id, patient_id);
    ");
}

fn control_plane_sqlite_database_path() -> Result<PathBuf, String> {
    for key in [
        "KERA_LOCAL_CONTROL_PLANE_DATABASE_URL",
        "KERA_CONTROL_PLANE_DATABASE_URL",
        "KERA_DATABASE_URL",
        "DATABASE_URL",
    ] {
        let Some(raw) = env_value(key) else {
            continue;
        };
        let normalized = raw.trim();
        let Some(path) = normalized
            .strip_prefix("sqlite:///")
            .or_else(|| normalized.strip_prefix("sqlite://"))
        else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        return Ok(PathBuf::from(path));
    }
    Err("A local SQLite control-plane cache is not configured.".to_string())
}

fn open_control_plane_db() -> Result<Connection, String> {
    let path = control_plane_sqlite_database_path()?;
    if !path.exists() {
        return Err(format!(
            "Control-plane cache database does not exist: {}",
            path.display()
        ));
    }
    Connection::open(path).map_err(|error| error.to_string())
}

fn safe_path_component(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

fn case_history_path(site_id: &str, patient_id: &str, visit_date: &str) -> Result<PathBuf, String> {
    let patient_dir = case_history_dir(site_id)?.join(safe_path_component(patient_id));
    fs::create_dir_all(&patient_dir).map_err(|error| error.to_string())?;
    Ok(patient_dir.join(format!("{}.json", safe_path_component(visit_date))))
}

fn patient_reference_salt() -> String {
    resolve_federation_salt_config()
        .patient_reference_salt
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string())
}

fn make_id(prefix: &str) -> String {
    let identifier = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &identifier[..10])
}

fn make_patient_reference_id(site_id: &str, patient_id: &str) -> String {
    let payload = format!(
        "{}::{}::{}",
        patient_reference_salt(),
        site_id.trim(),
        patient_id.trim()
    );
    let digest = Sha256::digest(payload.as_bytes());
    let hex = format!("{digest:x}");
    format!("ptref_{}", &hex[..20])
}

fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
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

fn patient_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PatientRecord> {
    Ok(PatientRecord {
        patient_id: row.get("patient_id")?,
        created_by_user_id: row.get("created_by_user_id")?,
        sex: row.get::<_, Option<String>>("sex")?.unwrap_or_default(),
        age: row.get::<_, i64>("age")?,
        chart_alias: row
            .get::<_, Option<String>>("chart_alias")?
            .unwrap_or_default(),
        local_case_code: row
            .get::<_, Option<String>>("local_case_code")?
            .unwrap_or_default(),
        created_at: row.get("created_at")?,
    })
}

fn visit_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<VisitRecord> {
    let additional_organisms =
        parse_organism_array(row.get::<_, Option<String>>("additional_organisms")?);
    let predisposing_factor =
        parse_json_string_array(row.get::<_, Option<String>>("predisposing_factor")?);
    let visit_status = row
        .get::<_, Option<String>>("visit_status")?
        .unwrap_or_else(|| "active".to_string());
    Ok(VisitRecord {
        visit_id: row.get("visit_id")?,
        patient_id: row.get("patient_id")?,
        created_by_user_id: row.get("created_by_user_id")?,
        visit_date: row.get("visit_date")?,
        actual_visit_date: row.get("actual_visit_date")?,
        culture_confirmed: row.get::<_, Option<i64>>("culture_confirmed")?.unwrap_or(1) != 0,
        culture_category: row
            .get::<_, Option<String>>("culture_category")?
            .unwrap_or_default(),
        culture_species: row
            .get::<_, Option<String>>("culture_species")?
            .unwrap_or_default(),
        additional_organisms,
        contact_lens_use: row
            .get::<_, Option<String>>("contact_lens_use")?
            .unwrap_or_default(),
        predisposing_factor,
        other_history: row
            .get::<_, Option<String>>("other_history")?
            .unwrap_or_default(),
        visit_status: visit_status.clone(),
        active_stage: row
            .get::<_, Option<i64>>("active_stage")?
            .map(|value| value != 0)
            .unwrap_or_else(|| visit_status == "active"),
        is_initial_visit: row.get::<_, Option<i64>>("is_initial_visit")?.unwrap_or(0) != 0,
        smear_result: row
            .get::<_, Option<String>>("smear_result")?
            .unwrap_or_default(),
        polymicrobial: row.get::<_, Option<i64>>("polymicrobial")?.unwrap_or(0) != 0,
        created_at: row
            .get::<_, Option<String>>("created_at")?
            .unwrap_or_default(),
    })
}

fn case_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CaseSummaryRecord> {
    let patient_id: String = row.get("patient_id")?;
    let visit_date: String = row.get("visit_date")?;
    let additional_organisms =
        parse_json_array(row.get::<_, Option<String>>("additional_organisms")?);
    let predisposing_factor =
        parse_json_array(row.get::<_, Option<String>>("predisposing_factor")?);
    let visit_status = row
        .get::<_, Option<String>>("visit_status")?
        .unwrap_or_else(|| "active".to_string());
    let research_registry_status = row
        .get::<_, Option<String>>("research_registry_status")?
        .unwrap_or_else(|| "analysis_only".to_string());
    let active_stage = row
        .get::<_, Option<i64>>("active_stage")?
        .map(|value| value != 0)
        .unwrap_or_else(|| visit_status == "active");
    let polymicrobial = row.get::<_, Option<i64>>("polymicrobial")?.unwrap_or(0) != 0
        || !additional_organisms.is_empty();

    Ok(CaseSummaryRecord {
        case_id: format!("{patient_id}::{visit_date}"),
        visit_id: row.get("visit_id")?,
        patient_id,
        patient_reference_id: row.get("patient_reference_id")?,
        visit_date,
        visit_index: row.get("visit_index")?,
        actual_visit_date: row.get("actual_visit_date")?,
        chart_alias: row
            .get::<_, Option<String>>("chart_alias")?
            .unwrap_or_default(),
        local_case_code: row
            .get::<_, Option<String>>("local_case_code")?
            .unwrap_or_default(),
        sex: row.get::<_, Option<String>>("sex")?.unwrap_or_default(),
        age: row.get("age")?,
        culture_category: row
            .get::<_, Option<String>>("culture_category")?
            .unwrap_or_default(),
        culture_species: row
            .get::<_, Option<String>>("culture_species")?
            .unwrap_or_default(),
        additional_organisms,
        contact_lens_use: row
            .get::<_, Option<String>>("contact_lens_use")?
            .unwrap_or_default(),
        predisposing_factor,
        other_history: row
            .get::<_, Option<String>>("other_history")?
            .unwrap_or_default(),
        visit_status,
        active_stage,
        is_initial_visit: row.get::<_, Option<i64>>("is_initial_visit")?.unwrap_or(0) != 0,
        smear_result: row
            .get::<_, Option<String>>("smear_result")?
            .unwrap_or_default(),
        polymicrobial,
        research_registry_status,
        research_registry_updated_at: row.get("research_registry_updated_at")?,
        research_registry_updated_by: row.get("research_registry_updated_by")?,
        research_registry_source: row.get("research_registry_source")?,
        image_count: row.get::<_, i64>("image_count")?,
        representative_image_id: row.get("representative_image_id")?,
        representative_view: row.get("representative_view")?,
        created_by_user_id: row.get("created_by_user_id")?,
        created_at: row.get("created_at")?,
        latest_image_uploaded_at: row.get("latest_image_uploaded_at")?,
    })
}

fn desktop_image_record_from_row(
    row: &rusqlite::Row<'_>,
    site_id: &str,
    preview_max_side: Option<u32>,
) -> Result<(DesktopImageRecord, Option<WarmPreviewJob>), String> {
    let image_id = row
        .get::<_, String>("image_id")
        .map_err(|error| error.to_string())?;
    let stored_image_path = row
        .get::<_, String>("image_path")
        .map_err(|error| error.to_string())?;
    let source_path = resolve_site_runtime_path(site_id, &stored_image_path)?;
    let content_path = existing_file_path_string(&source_path);
    let mut warm_preview_job = None;
    let preview_path = preview_max_side
        .and_then(
            |max_side| match cached_preview_file_path(site_id, &image_id, max_side) {
                Ok(Some(path)) => Some(path),
                Ok(None) => {
                    warm_preview_job =
                        maybe_queue_preview_job(site_id, &image_id, &source_path, max_side);
                    None
                }
                Err(_) => None,
            },
        )
        .or_else(|| content_path.clone());

    Ok((
        DesktopImageRecord {
            image_id,
            visit_id: row
                .get::<_, String>("visit_id")
                .map_err(|error| error.to_string())?,
            patient_id: row
                .get::<_, String>("patient_id")
                .map_err(|error| error.to_string())?,
            visit_date: row
                .get::<_, String>("visit_date")
                .map_err(|error| error.to_string())?,
            view: row
                .get::<_, Option<String>>("view")
                .map_err(|error| error.to_string())?
                .unwrap_or_else(|| "white".to_string()),
            image_path: source_path.to_string_lossy().to_string(),
            is_representative: row
                .get::<_, Option<i64>>("is_representative")
                .map_err(|error| error.to_string())?
                .unwrap_or(0)
                != 0,
            content_url: None,
            preview_url: None,
            content_path,
            preview_path,
            lesion_prompt_box: match parse_json_value(
                row.get::<_, Option<String>>("lesion_prompt_box")
                    .map_err(|error| error.to_string())?,
                JsonValue::Null,
            ) {
                JsonValue::Null => None,
                value => Some(value),
            },
            uploaded_at: row
                .get::<_, Option<String>>("uploaded_at")
                .map_err(|error| error.to_string())?
                .unwrap_or_default(),
            quality_scores: match parse_json_value(
                row.get::<_, Option<String>>("quality_scores")
                    .map_err(|error| error.to_string())?,
                JsonValue::Null,
            ) {
                JsonValue::Null => None,
                value => Some(value),
            },
        },
        warm_preview_job,
    ))
}

fn get_patient(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
) -> Result<Option<PatientRecord>, String> {
    let sql = "
      select patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at
      from patients
      where site_id = ? and patient_id = ?
    ";
    conn.query_row(sql, params![site_id, patient_id], patient_record_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

fn get_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Option<VisitRecord>, String> {
    let sql = "
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
      where site_id = ? and patient_id = ? and visit_date = ?
    ";
    conn.query_row(
        sql,
        params![site_id, patient_id, visit_date],
        visit_record_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn query_images(
    conn: &Connection,
    site_id: &str,
    patient_id: Option<&str>,
    visit_date: Option<&str>,
    preview_max_side: Option<u32>,
) -> Result<Vec<DesktopImageRecord>, String> {
    let mut sql = "
      select
        image_id,
        visit_id,
        patient_id,
        visit_date,
        view,
        image_path,
        is_representative,
        lesion_prompt_box,
        uploaded_at,
        quality_scores
      from images
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(value) = patient_id {
        sql.push_str(" and patient_id = ?");
        params.push(Value::Text(value.to_string()));
    }
    if let Some(value) = visit_date {
        sql.push_str(" and visit_date = ?");
        params.push(Value::Text(value.to_string()));
    }
    sql.push_str(" order by patient_id asc, visit_date asc, uploaded_at asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut images = Vec::new();
    let mut warm_preview_jobs = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let (image, warm_preview_job) =
            desktop_image_record_from_row(row, site_id, preview_max_side)?;
        if let Some(job) = warm_preview_job {
            warm_preview_jobs.push(job);
        }
        images.push(image);
    }
    queue_preview_generation_batch(warm_preview_jobs);
    Ok(images)
}

fn list_images_for_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Vec<DesktopImageRecord>, String> {
    query_images(conn, site_id, Some(patient_id), Some(visit_date), Some(640))
}

fn query_case_summaries(
    conn: &Connection,
    site_id: &str,
    created_by_user_id: Option<&str>,
) -> Result<Vec<CaseSummaryRecord>, String> {
    let mut sql = "
      with image_stats as (
        select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
        from images
        where site_id = ?
        group by visit_id
      ),
      representative_images as (
        select visit_id, image_id as representative_image_id, view as representative_view
        from images
        where site_id = ? and is_representative = 1
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
        representative_images.representative_view
      from visits v
      join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
      left join image_stats on v.visit_id = image_stats.visit_id
      left join representative_images on v.visit_id = representative_images.visit_id
      where v.site_id = ?
    "
    .to_string();
    let mut params = vec![
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
    ];
    if let Some(user_id) = created_by_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and p.created_by_user_id = ?");
        params.push(Value::Text(user_id.to_string()));
    }
    sql.push_str(" order by coalesce(v.visit_index, 0) desc, image_stats.latest_image_uploaded_at desc, v.created_at desc");

    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        items.push(case_summary_from_row(row).map_err(|error| error.to_string())?);
    }
    Ok(items)
}

fn json_string_field(value: &JsonValue, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn json_i64_field(value: &JsonValue, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| {
        item.as_i64()
            .or_else(|| item.as_u64().map(|raw| raw as i64))
    })
}

fn json_f64_field(value: &JsonValue, key: &str) -> Option<f64> {
    value.get(key).and_then(|item| item.as_f64())
}

fn is_pending_model_update_status(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "pending" | "pending_review" | "pending_upload"
    )
}

fn empty_contribution_leaderboard(site_id: &str) -> ContributionLeaderboard {
    ContributionLeaderboard {
        scope: "site".to_string(),
        site_id: Some(site_id.to_string()),
        leaderboard: Vec::new(),
        current_user: None,
    }
}

fn empty_site_activity_response(site_id: &str) -> SiteActivityResponse {
    SiteActivityResponse {
        pending_updates: 0,
        recent_validations: Vec::new(),
        recent_contributions: Vec::new(),
        contribution_leaderboard: Some(empty_contribution_leaderboard(site_id)),
    }
}

fn lookup_public_aliases(
    conn: &Connection,
    user_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let normalized = user_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(normalized.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "select user_id, public_alias from users where user_id in ({placeholders}) and public_alias is not null"
    );
    let params = normalized
        .iter()
        .cloned()
        .map(Value::Text)
        .collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut aliases = HashMap::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let user_id = row
            .get::<_, String>(0)
            .map_err(|error| error.to_string())?
            .trim()
            .to_string();
        let alias = row
            .get::<_, Option<String>>(1)
            .map_err(|error| error.to_string())?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if !user_id.is_empty() {
            if let Some(public_alias) = alias {
                aliases.insert(user_id, public_alias);
            }
        }
    }
    Ok(aliases)
}

fn local_api_error_detail(body: &str, status_code: u16) -> String {
    if let Ok(payload) = serde_json::from_str::<JsonValue>(body) {
        if let Some(detail) = payload.get("detail") {
            if let Some(text) = detail.as_str() {
                let normalized = text.trim();
                if !normalized.is_empty() {
                    return normalized.to_string();
                }
            }
            if detail.is_array() || detail.is_object() {
                return detail.to_string();
            }
        }
    }
    let normalized = body.trim();
    if normalized.is_empty() {
        format!("Local API request failed ({status_code}).")
    } else {
        normalized.to_string()
    }
}

fn normalize_http_method(method: Option<&str>) -> Result<HttpMethod, String> {
    let normalized = method.unwrap_or("GET").trim().to_ascii_uppercase();
    match normalized.as_str() {
        "GET" => Ok(HttpMethod::GET),
        "POST" => Ok(HttpMethod::POST),
        "PATCH" => Ok(HttpMethod::PATCH),
        "PUT" => Ok(HttpMethod::PUT),
        "DELETE" => Ok(HttpMethod::DELETE),
        _ => Err(format!("Unsupported local API method: {normalized}")),
    }
}

fn normalize_local_api_query(query: Option<Vec<LocalApiQueryParam>>) -> Vec<(String, String)> {
    query
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let name = item.name.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some((name, item.value))
        })
        .collect()
}

fn request_local_api_json_owned(
    method: HttpMethod,
    path: &str,
    token: &str,
    query: Vec<(String, String)>,
    body: Option<JsonValue>,
) -> Result<JsonValue, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Local API path is required.".to_string());
    }
    if local_backend_should_be_managed(&local_node_api_base_url()) {
        ensure_local_backend_ready_internal()?;
    }
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("{}{}", local_node_api_base_url(), normalized_path);
    let client = HttpClient::builder()
        .build()
        .map_err(|error| format!("Failed to initialize local API bridge: {error}"))?;
    let mut request = client.request(method, &url);
    let normalized_token = token.trim();
    if !normalized_token.is_empty() {
        request = request.bearer_auth(normalized_token);
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request
        .send()
        .map_err(|_| "Local API server is unavailable.".to_string())?;
    let status = response.status();
    let body_text = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(local_api_error_detail(&body_text, status.as_u16()));
    }
    serde_json::from_str::<JsonValue>(&body_text)
        .map_err(|error| format!("Invalid JSON response from local API: {error}"))
}

fn request_local_api_json(
    method: HttpMethod,
    path: &str,
    token: &str,
    query: Vec<(&str, String)>,
    body: Option<JsonValue>,
) -> Result<JsonValue, String> {
    request_local_api_json_owned(
        method,
        path,
        token,
        query
            .into_iter()
            .map(|(name, value)| (name.to_string(), value))
            .collect(),
        body,
    )
}

fn request_local_api_binary_owned(
    method: HttpMethod,
    path: &str,
    token: &str,
    query: Vec<(String, String)>,
    body: Option<JsonValue>,
) -> Result<ImageBinaryResponse, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Local API path is required.".to_string());
    }
    if local_backend_should_be_managed(&local_node_api_base_url()) {
        ensure_local_backend_ready_internal()?;
    }
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("{}{}", local_node_api_base_url(), normalized_path);
    let client = HttpClient::builder()
        .build()
        .map_err(|error| format!("Failed to initialize local API bridge: {error}"))?;
    let mut request = client.request(method, &url);
    let normalized_token = token.trim();
    if !normalized_token.is_empty() {
        request = request.bearer_auth(normalized_token);
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    if let Some(json_body) = body {
        request = request.json(&json_body);
    }

    let response = request
        .send()
        .map_err(|_| "Local API server is unavailable.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().unwrap_or_default();
        return Err(local_api_error_detail(&body_text, status.as_u16()));
    }
    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = response
        .bytes()
        .map_err(|error| format!("Failed to read binary response from local API: {error}"))?
        .to_vec();
    Ok(ImageBinaryResponse {
        data: BASE64_STANDARD.encode(&bytes),
        media_type,
    })
}

fn request_local_api_multipart(
    path: &str,
    token: &str,
    query: Vec<(String, String)>,
    fields: Vec<LocalApiMultipartField>,
    files: Vec<LocalApiMultipartFile>,
) -> Result<JsonValue, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Local API path is required.".to_string());
    }
    if local_backend_should_be_managed(&local_node_api_base_url()) {
        ensure_local_backend_ready_internal()?;
    }
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("{}{}", local_node_api_base_url(), normalized_path);
    let client = HttpClient::builder()
        .build()
        .map_err(|error| format!("Failed to initialize local API bridge: {error}"))?;
    let mut form = MultipartForm::new();
    for field in fields {
        let name = field.name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        form = form.text(name, field.value);
    }
    for file in files {
        let field_name = file.field_name.trim().to_string();
        let file_name = file.file_name.trim().to_string();
        if field_name.is_empty() || file_name.is_empty() {
            continue;
        }
        let file_bytes = BASE64_STANDARD
            .decode(&file.data)
            .map_err(|error| format!("Invalid base64 file data for {file_name}: {error}"))?;
        let mut part = MultipartPart::bytes(file_bytes).file_name(file_name.clone());
        let content_type = file
            .content_type
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| mime_type_for_path(Path::new(&file_name)));
        part = part
            .mime_str(&content_type)
            .map_err(|error| format!("Invalid multipart content type: {error}"))?;
        form = form.part(field_name, part);
    }
    let mut request = client.post(&url);
    let normalized_token = token.trim();
    if !normalized_token.is_empty() {
        request = request.bearer_auth(normalized_token);
    }
    if !query.is_empty() {
        request = request.query(&query);
    }
    let response = request
        .multipart(form)
        .send()
        .map_err(|_| "Local API server is unavailable.".to_string())?;
    let status = response.status();
    let body_text = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(local_api_error_detail(&body_text, status.as_u16()));
    }
    serde_json::from_str::<JsonValue>(&body_text)
        .map_err(|error| format!("Invalid JSON response from local API: {error}"))
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
fn request_local_json(payload: LocalApiJsonCommandRequest) -> Result<JsonValue, String> {
    request_local_api_json_owned(
        normalize_http_method(payload.method.as_deref())?,
        &payload.path,
        payload.token.as_deref().unwrap_or(""),
        normalize_local_api_query(payload.query),
        payload.body,
    )
}

#[tauri::command]
fn request_local_binary(
    payload: LocalApiJsonCommandRequest,
) -> Result<ImageBinaryResponse, String> {
    request_local_api_binary_owned(
        normalize_http_method(payload.method.as_deref())?,
        &payload.path,
        payload.token.as_deref().unwrap_or(""),
        normalize_local_api_query(payload.query),
        payload.body,
    )
}

#[tauri::command]
fn request_local_multipart(payload: LocalApiMultipartCommandRequest) -> Result<JsonValue, String> {
    request_local_api_multipart(
        &payload.path,
        payload.token.as_deref().unwrap_or(""),
        normalize_local_api_query(payload.query),
        payload.fields.unwrap_or_default(),
        payload.files,
    )
}

fn read_binary_path(path: &Path) -> Result<ImageBinaryResponse, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(ImageBinaryResponse {
        data: BASE64_STANDARD.encode(&bytes),
        media_type: mime_type_for_path(path),
    })
}

fn ensure_path_within_site(site_id: &str, path: &Path) -> Result<PathBuf, String> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        site_dir(site_id)?.join(path)
    };
    let site_root = site_dir(site_id)?;
    let resolved_site_root = site_root.canonicalize().unwrap_or(site_root);
    if !candidate.exists() {
        return Err("Artifact file not found on disk.".to_string());
    }
    let resolved_candidate = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.clone());
    if !resolved_candidate.starts_with(&resolved_site_root) {
        return Err("Artifact is outside the site workspace.".to_string());
    }
    Ok(resolved_candidate)
}

#[tauri::command]
fn run_case_validation(payload: CaseValidationCommandRequest) -> Result<JsonValue, String> {
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
        "generate_gradcam": payload.generate_gradcam.unwrap_or(true),
        "generate_medsam": payload.generate_medsam.unwrap_or(true),
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
}

#[tauri::command]
fn run_case_validation_compare(
    payload: CaseValidationCompareCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "patient_id": payload.patient_id,
        "visit_date": payload.visit_date,
        "model_version_ids": payload.model_version_ids,
        "execution_mode": payload.execution_mode.unwrap_or_else(|| "auto".to_string()),
        "generate_gradcam": payload.generate_gradcam.unwrap_or(false),
        "generate_medsam": payload.generate_medsam.unwrap_or(false),
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
}

#[tauri::command]
fn run_case_ai_clinic(payload: CaseAiClinicCommandRequest) -> Result<JsonValue, String> {
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
        "top_k": payload.top_k.unwrap_or(3),
        "retrieval_backend": payload.retrieval_backend.unwrap_or_else(|| "standard".to_string()),
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

fn is_active_site_job_status(status: &str) -> bool {
    matches!(
        status.trim().to_lowercase().as_str(),
        "queued" | "running" | "cancelling"
    )
}

fn fetch_site_job_response(site_id: &str, token: &str, job_id: &str) -> Result<JsonValue, String> {
    let request_payload = json!({
        "site_id": site_id,
        "token": token,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_site_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/jobs/{job_id}"),
        token,
        Vec::new(),
        None,
    )
}

fn fetch_live_lesion_preview_job_response(
    site_id: &str,
    token: &str,
    image_id: &str,
    job_id: &str,
) -> Result<JsonValue, String> {
    let request_payload = json!({
        "site_id": site_id,
        "token": token,
        "image_id": image_id,
        "job_id": job_id,
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("fetch_live_lesion_preview_job", request_payload);
    }
    request_local_api_json(
        HttpMethod::GET,
        &format!("/api/sites/{site_id}/images/{image_id}/lesion-live-preview/jobs/{job_id}"),
        token,
        Vec::new(),
        None,
    )
}

fn emit_site_job_update(
    app: &AppHandle,
    site_id: &str,
    job_id: &str,
    job: Option<JsonValue>,
    terminal: bool,
    error: Option<String>,
) {
    let status = job
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let _ = app.emit(
        SITE_JOB_UPDATE_EVENT,
        SiteJobUpdateEvent {
            site_id: site_id.to_string(),
            job_id: job_id.to_string(),
            job,
            status,
            terminal,
            error,
        },
    );
}

fn emit_live_lesion_preview_update(
    app: &AppHandle,
    site_id: &str,
    image_id: &str,
    job_id: &str,
    job: Option<JsonValue>,
    terminal: bool,
    error: Option<String>,
) {
    let status = job
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let _ = app.emit(
        LIVE_LESION_PREVIEW_UPDATE_EVENT,
        LiveLesionPreviewUpdateEvent {
            site_id: site_id.to_string(),
            image_id: image_id.to_string(),
            job_id: job_id.to_string(),
            job,
            status,
            terminal,
            error,
        },
    );
}

#[tauri::command]
fn fetch_site_job(payload: SiteJobCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    fetch_site_job_response(&site_id, &payload.token, &job_id)
}

#[tauri::command]
fn start_site_job_event_stream(
    app: AppHandle,
    payload: SiteJobCommandRequest,
) -> Result<(), String> {
    let site_id = payload.site_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    let token = payload.token;
    if site_id.is_empty() || job_id.is_empty() {
        return Err("site_id and job_id are required.".to_string());
    }
    std::thread::spawn(move || loop {
        match fetch_site_job_response(&site_id, &token, &job_id) {
            Ok(job) => {
                let status = job
                    .get("status")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string();
                let terminal = !is_active_site_job_status(&status);
                emit_site_job_update(&app, &site_id, &job_id, Some(job), terminal, None);
                if terminal {
                    break;
                }
            }
            Err(error) => {
                emit_site_job_update(&app, &site_id, &job_id, None, true, Some(error));
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(800));
    });
    Ok(())
}

#[tauri::command]
fn fetch_case_roi_preview(payload: CasePreviewCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "patient_id": payload.patient_id,
        "visit_date": payload.visit_date,
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
}

#[tauri::command]
fn fetch_case_lesion_preview(payload: CasePreviewCommandRequest) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let request_payload = json!({
        "site_id": site_id.clone(),
        "token": payload.token,
        "patient_id": payload.patient_id,
        "visit_date": payload.visit_date,
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
}

#[tauri::command]
fn start_live_lesion_preview(
    payload: LiveLesionPreviewStartCommandRequest,
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
    });
    if ml_sidecar_should_be_used() {
        return request_ml_sidecar_json("start_live_lesion_preview", request_payload);
    }
    request_local_api_json(
        HttpMethod::POST,
        &format!(
            "/api/sites/{}/images/{}/lesion-live-preview",
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
        Vec::new(),
        None,
    )
}

#[tauri::command]
fn fetch_live_lesion_preview_job(
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<JsonValue, String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    if site_id.is_empty() || image_id.is_empty() || job_id.is_empty() {
        return Err("site_id, image_id, and job_id are required.".to_string());
    }
    fetch_live_lesion_preview_job_response(&site_id, &payload.token, &image_id, &job_id)
}

#[tauri::command]
fn start_live_lesion_preview_event_stream(
    app: AppHandle,
    payload: LiveLesionPreviewJobCommandRequest,
) -> Result<(), String> {
    let site_id = payload.site_id.trim().to_string();
    let image_id = payload.image_id.trim().to_string();
    let job_id = payload.job_id.trim().to_string();
    let token = payload.token;
    if site_id.is_empty() || image_id.is_empty() || job_id.is_empty() {
        return Err("site_id, image_id, and job_id are required.".to_string());
    }
    std::thread::spawn(move || loop {
        match fetch_live_lesion_preview_job_response(&site_id, &token, &image_id, &job_id) {
            Ok(job) => {
                let terminal = !matches!(
                    job.get("status").and_then(|value| value.as_str()),
                    Some("running")
                );
                emit_live_lesion_preview_update(
                    &app,
                    &site_id,
                    &image_id,
                    &job_id,
                    Some(job),
                    terminal,
                    None,
                );
                if terminal {
                    break;
                }
            }
            Err(error) => {
                emit_live_lesion_preview_update(
                    &app,
                    &site_id,
                    &image_id,
                    &job_id,
                    None,
                    true,
                    Some(error),
                );
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(600));
    });
    Ok(())
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

fn find_visit_image_record(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
    image_id: &str,
) -> Result<DesktopImageRecord, String> {
    let images = query_images(conn, site_id, Some(patient_id), Some(visit_date), None)?;
    images
        .into_iter()
        .find(|item| item.image_id == image_id)
        .ok_or_else(|| "Image not found for this case.".to_string())
}

fn validation_artifact_path(
    site_id: &str,
    validation_id: &str,
    patient_id: &str,
    visit_date: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_key = match artifact_kind.trim() {
        "gradcam" => "gradcam_path",
        "gradcam_cornea" => "gradcam_cornea_path",
        "gradcam_lesion" => "gradcam_lesion_path",
        "roi_crop" => "roi_crop_path",
        "medsam_mask" => "medsam_mask_path",
        "lesion_crop" => "lesion_crop_path",
        "lesion_mask" => "lesion_mask_path",
        _ => return Err("Unknown validation artifact.".to_string()),
    };

    let case_path = control_plane_case_dir()?.join(format!("{}.json", validation_id.trim()));
    if !case_path.exists() {
        return Err("Validation case prediction not found.".to_string());
    }
    let raw = fs::read_to_string(&case_path).map_err(|error| error.to_string())?;
    let payload = serde_json::from_str::<JsonValue>(&raw).map_err(|error| error.to_string())?;
    let items = payload
        .as_array()
        .ok_or_else(|| "Validation case prediction file is invalid.".to_string())?;
    let prediction = items.iter().find(|item| {
        json_string_field(item, "patient_id").as_deref() == Some(patient_id)
            && json_string_field(item, "visit_date").as_deref() == Some(visit_date)
    });
    let prediction =
        prediction.ok_or_else(|| "Validation case prediction not found.".to_string())?;
    let artifact_path_value = json_string_field(prediction, artifact_key)
        .ok_or_else(|| "Requested artifact is not available.".to_string())?;
    ensure_path_within_site(site_id, &PathBuf::from(artifact_path_value))
}

fn roi_preview_artifact_path(
    site_id: &str,
    image_path: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_name = Path::new(image_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Image path is invalid.".to_string())?;
    let relative = match artifact_kind.trim() {
        "roi_crop" => PathBuf::from("artifacts")
            .join("roi_crops")
            .join(format!("{artifact_name}_crop.png")),
        "medsam_mask" => PathBuf::from("artifacts")
            .join("medsam_masks")
            .join(format!("{artifact_name}_mask.png")),
        _ => return Err("Unknown ROI preview artifact.".to_string()),
    };
    ensure_path_within_site(site_id, &site_dir(site_id)?.join(relative))
}

fn lesion_preview_artifact_path(
    site_id: &str,
    image_path: &str,
    artifact_kind: &str,
) -> Result<PathBuf, String> {
    let artifact_name = Path::new(image_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Image path is invalid.".to_string())?;
    let relative = match artifact_kind.trim() {
        "lesion_crop" => PathBuf::from("artifacts")
            .join("lesion_crops")
            .join(format!("{artifact_name}_crop.png")),
        "lesion_mask" => PathBuf::from("artifacts")
            .join("lesion_masks")
            .join(format!("{artifact_name}_mask.png")),
        _ => return Err("Unknown lesion preview artifact.".to_string()),
    };
    ensure_path_within_site(site_id, &site_dir(site_id)?.join(relative))
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
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let current_user_id = payload
        .current_user_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let conn = match open_control_plane_db() {
        Ok(connection) => connection,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };

    let mut validation_rows = match conn.prepare(
        "
        select summary_json
        from validation_runs
        where site_id = ?
        order by run_date desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let validation_payloads = validation_rows
        .query_map(params![site_id.clone()], |row| {
            row.get::<_, Option<String>>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let recent_validations = validation_payloads
        .into_iter()
        .take(5)
        .map(|raw| {
            let payload = parse_json_value(raw, json!({}));
            SiteActivityValidationRecord {
                validation_id: json_string_field(&payload, "validation_id").unwrap_or_default(),
                run_date: json_string_field(&payload, "run_date").unwrap_or_default(),
                model_version: json_string_field(&payload, "model_version").unwrap_or_default(),
                model_architecture: json_string_field(&payload, "model_architecture")
                    .unwrap_or_default(),
                n_cases: json_i64_field(&payload, "n_cases").unwrap_or(0),
                n_images: json_i64_field(&payload, "n_images").unwrap_or(0),
                accuracy: json_f64_field(&payload, "accuracy"),
                auroc: json_f64_field(&payload, "AUROC"),
                site_id: json_string_field(&payload, "site_id").unwrap_or_else(|| site_id.clone()),
            }
        })
        .collect::<Vec<_>>();

    let mut update_stmt = match conn.prepare(
        "
        select payload_json, update_id, status
        from model_updates
        where site_id = ?
        order by created_at desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let update_rows = update_stmt
        .query_map(params![site_id.clone()], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut updates_by_id = HashMap::new();
    for (raw_payload, update_id, status) in update_rows {
        let payload = parse_json_value(raw_payload, json!({}));
        let normalized_update_id = json_string_field(&payload, "update_id")
            .or(update_id)
            .unwrap_or_default();
        if normalized_update_id.is_empty() {
            continue;
        }
        let normalized_status = json_string_field(&payload, "status")
            .or(status)
            .unwrap_or_default();
        updates_by_id.insert(normalized_update_id, (payload, normalized_status));
    }
    let pending_updates = updates_by_id
        .values()
        .filter(|(_, status)| is_pending_model_update_status(status))
        .count() as i64;

    let mut contribution_stmt = match conn.prepare(
        "
        select payload_json, contribution_id, user_id, created_at
        from contributions
        where site_id = ?
        order by created_at desc
        ",
    ) {
        Ok(statement) => statement,
        Err(_) => return Ok(empty_site_activity_response(&site_id)),
    };
    let contribution_rows = contribution_stmt
        .query_map(params![site_id.clone()], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let contribution_payloads = contribution_rows
        .into_iter()
        .map(|(raw_payload, contribution_id, user_id, created_at)| {
            let mut payload = parse_json_value(raw_payload, json!({}));
            if let JsonValue::Object(ref mut map) = payload {
                if !map.contains_key("contribution_id") {
                    if let Some(value) = contribution_id {
                        map.insert("contribution_id".to_string(), JsonValue::String(value));
                    }
                }
                if !map.contains_key("user_id") {
                    if let Some(value) = user_id {
                        map.insert("user_id".to_string(), JsonValue::String(value));
                    }
                }
                if !map.contains_key("created_at") {
                    if let Some(value) = created_at {
                        map.insert("created_at".to_string(), JsonValue::String(value));
                    }
                }
            }
            payload
        })
        .collect::<Vec<_>>();

    let contributor_user_ids = contribution_payloads
        .iter()
        .filter_map(|payload| json_string_field(payload, "user_id"))
        .collect::<Vec<_>>();
    let alias_map = lookup_public_aliases(&conn, &contributor_user_ids).unwrap_or_default();

    let recent_contributions = contribution_payloads
        .iter()
        .take(5)
        .map(|payload| {
            let user_id = json_string_field(payload, "user_id").unwrap_or_default();
            let update_id = json_string_field(payload, "update_id").unwrap_or_default();
            let public_alias = json_string_field(payload, "public_alias")
                .or_else(|| alias_map.get(&user_id).cloned());
            let update = updates_by_id.get(&update_id);
            SiteActivityContributionRecord {
                contribution_id: json_string_field(payload, "contribution_id").unwrap_or_default(),
                contribution_group_id: json_string_field(payload, "contribution_group_id"),
                created_at: json_string_field(payload, "created_at").unwrap_or_default(),
                user_id,
                public_alias,
                case_reference_id: json_string_field(payload, "case_reference_id"),
                update_id,
                update_status: update.map(|(item, status)| {
                    json_string_field(item, "status").unwrap_or_else(|| status.clone())
                }),
                upload_type: update.and_then(|(item, _)| json_string_field(item, "upload_type")),
            }
        })
        .collect::<Vec<_>>();

    let mut contributor_counts: HashMap<String, (i64, Option<String>, Option<String>)> =
        HashMap::new();
    for payload in &contribution_payloads {
        let Some(user_id) = json_string_field(payload, "user_id") else {
            continue;
        };
        let created_at = json_string_field(payload, "created_at");
        let payload_alias = json_string_field(payload, "public_alias");
        let entry = contributor_counts.entry(user_id).or_insert((0, None, None));
        entry.0 += 1;
        if let Some(alias) = payload_alias {
            entry.2 = Some(alias);
        }
        if let Some(created_at_value) = created_at {
            if entry
                .1
                .as_ref()
                .map(|current| created_at_value > *current)
                .unwrap_or(true)
            {
                entry.1 = Some(created_at_value);
            }
        }
    }

    let mut ranked = contributor_counts
        .into_iter()
        .map(
            |(user_id, (contribution_count, last_contribution_at, payload_alias))| {
                let public_alias = payload_alias
                    .or_else(|| alias_map.get(&user_id).cloned())
                    .unwrap_or_else(|| "Anonymous member".to_string());
                (
                    user_id,
                    contribution_count,
                    last_contribution_at,
                    public_alias,
                )
            },
        )
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| {
                right
                    .2
                    .clone()
                    .unwrap_or_default()
                    .cmp(&left.2.clone().unwrap_or_default())
            })
            .then_with(|| right.0.cmp(&left.0))
    });

    let mut leaderboard = Vec::new();
    let mut current_user_entry = None;
    for (index, (user_id, contribution_count, last_contribution_at, public_alias)) in
        ranked.into_iter().enumerate()
    {
        let entry = ContributionLeaderboardEntry {
            rank: (index + 1) as i64,
            user_id: user_id.clone(),
            public_alias,
            contribution_count,
            last_contribution_at,
            is_current_user: current_user_id
                .as_deref()
                .map(|current| current == user_id)
                .unwrap_or(false),
        };
        if entry.rank <= 5 {
            leaderboard.push(entry.clone());
        }
        if entry.is_current_user {
            current_user_entry = Some(entry);
        }
    }

    Ok(SiteActivityResponse {
        pending_updates,
        recent_validations,
        recent_contributions,
        contribution_leaderboard: Some(ContributionLeaderboard {
            scope: "site".to_string(),
            site_id: Some(site_id),
            leaderboard,
            current_user: current_user_entry,
        }),
    })
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

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn score_from_band(value: f64, low: f64, ideal_low: f64, ideal_high: f64, high: f64) -> f64 {
    if value <= low || value >= high {
        return 0.0;
    }
    if (ideal_low..=ideal_high).contains(&value) {
        return 1.0;
    }
    if value < ideal_low {
        return clamp01((value - low) / (ideal_low - low).max(1e-6));
    }
    clamp01((high - value) / (high - ideal_high).max(1e-6))
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10f64.powi(digits);
    (value * factor).round() / factor
}

fn score_slit_lamp_image(image_path: &Path, view: &str) -> Result<JsonValue, String> {
    let rgb = image::open(image_path)
        .map_err(|error| error.to_string())?
        .to_rgb8();
    let (width, height) = rgb.dimensions();
    let width_usize = width as usize;
    let height_usize = height as usize;
    let mut gray = vec![0.0_f64; width_usize * height_usize];
    let mut gray_sum = 0.0_f64;
    let mut red_sum = 0.0_f64;
    let mut green_sum = 0.0_f64;
    let mut blue_sum = 0.0_f64;
    let mut saturation_sum = 0.0_f64;

    for (index, pixel) in rgb.pixels().enumerate() {
        let [r, g, b] = pixel.0;
        let r_f = f64::from(r);
        let g_f = f64::from(g);
        let b_f = f64::from(b);
        let gray_value = 0.299 * r_f + 0.587 * g_f + 0.114 * b_f;
        gray[index] = gray_value;
        gray_sum += gray_value;
        red_sum += r_f;
        green_sum += g_f;
        blue_sum += b_f;
        let max_channel = r_f.max(g_f).max(b_f);
        let min_channel = r_f.min(g_f).min(b_f);
        saturation_sum += (max_channel - min_channel) / 255.0;
    }

    let pixel_count = (width_usize * height_usize).max(1) as f64;
    let brightness = gray_sum / pixel_count;
    let contrast = (gray
        .iter()
        .map(|value| {
            let delta = *value - brightness;
            delta * delta
        })
        .sum::<f64>()
        / pixel_count)
        .sqrt();

    let blur_variance = if width_usize >= 3 && height_usize >= 3 {
        let mut laplacians = Vec::with_capacity((width_usize - 2) * (height_usize - 2));
        for y in 1..(height_usize - 1) {
            for x in 1..(width_usize - 1) {
                let center = gray[y * width_usize + x] / 255.0;
                let up = gray[(y - 1) * width_usize + x] / 255.0;
                let down = gray[(y + 1) * width_usize + x] / 255.0;
                let left = gray[y * width_usize + (x - 1)] / 255.0;
                let right = gray[y * width_usize + (x + 1)] / 255.0;
                laplacians.push(-4.0 * center + up + down + left + right);
            }
        }
        let mean = laplacians.iter().sum::<f64>() / (laplacians.len().max(1) as f64);
        laplacians
            .iter()
            .map(|value| {
                let delta = *value - mean;
                delta * delta
            })
            .sum::<f64>()
            / (laplacians.len().max(1) as f64)
    } else {
        0.0
    };

    let min_side = f64::from(width.min(height));
    let blur_score = clamp01((1.0 + blur_variance * 10000.0).ln() / 4.5);
    let exposure_score = score_from_band(brightness, 20.0, 55.0, 190.0, 245.0);
    let contrast_score = score_from_band(contrast, 8.0, 24.0, 88.0, 120.0);
    let size_score = clamp01(min_side / 768.0);

    let red_mean = red_sum / pixel_count;
    let green_mean = green_sum / pixel_count;
    let blue_mean = blue_sum / pixel_count;
    let channel_total = (red_mean + green_mean + blue_mean).max(1e-6);
    let green_ratio = green_mean / channel_total;
    let saturation = saturation_sum / pixel_count;

    let normalized_view = view.trim().to_ascii_lowercase();
    let view_score = if normalized_view == "fluorescein" {
        let green_score = score_from_band(green_ratio, 0.22, 0.34, 0.48, 0.58);
        let saturation_score = score_from_band(saturation, 0.05, 0.18, 0.65, 0.9);
        0.6 * green_score + 0.4 * saturation_score
    } else {
        let green_penalty = clamp01((green_ratio - 0.333).abs() / 0.16);
        let saturation_score = score_from_band(saturation, 0.02, 0.08, 0.45, 0.85);
        0.55 * (1.0 - green_penalty) + 0.45 * saturation_score
    };

    let overall = 0.35 * blur_score
        + 0.25 * exposure_score
        + 0.20 * contrast_score
        + 0.10 * size_score
        + 0.10 * view_score;

    Ok(json!({
        "quality_score": round_to(overall * 100.0, 1),
        "view_score": round_to(view_score * 100.0, 1),
        "component_scores": {
            "blur": round_to(blur_score * 100.0, 1),
            "exposure": round_to(exposure_score * 100.0, 1),
            "contrast": round_to(contrast_score * 100.0, 1),
            "resolution": round_to(size_score * 100.0, 1),
            "view_consistency": round_to(view_score * 100.0, 1),
        },
        "image_stats": {
            "width": i64::from(width),
            "height": i64::from(height),
            "brightness_mean": round_to(brightness, 2),
            "contrast_std": round_to(contrast, 2),
            "blur_variance": round_to(blur_variance, 6),
            "green_ratio": round_to(green_ratio, 4),
            "saturation_mean": round_to(saturation, 4),
        }
    }))
}

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

    let mut count_params = vec![Value::Text(site_id.clone()), Value::Text(site_id.clone())];
    let mine_clause = if let Some(created_by_user_id) = mine_user_id.as_ref() {
        count_params.push(Value::Text(created_by_user_id.clone()));
        " and p.created_by_user_id = ? ".to_string()
    } else {
        String::new()
    };
    let search_clause = build_search_clause(&payload.search, &mut count_params);
    let count_sql = format!(
        "
        select count(distinct v.patient_id)
        from visits v
        join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
        where v.site_id = ? and p.site_id = ?
        {mine_clause}
        {search_clause}
        "
    );

    let total_count = conn
        .query_row(&count_sql, params_from_iter(count_params), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?
        .max(0) as u32;
    let total_pages = total_count.max(1).div_ceil(page_size);
    let safe_page = page.min(total_pages.max(1));
    let offset = (safe_page.saturating_sub(1) * page_size) as i64;

    // params: p.site_id, v.site_id, [user_id?], [search×7?], images.site_id, page_size, offset
    let mut ids_params = vec![
        Value::Text(site_id.clone()),
        Value::Text(site_id.clone()),
    ];
    if let Some(created_by_user_id) = mine_user_id.as_ref() {
        ids_params.push(Value::Text(created_by_user_id.clone()));
    }
    let search_clause = build_search_clause(&payload.search, &mut ids_params);
    ids_params.push(Value::Text(site_id.clone())); // image_stats: site_id (after search params)
    ids_params.push(Value::Integer(page_size as i64));
    ids_params.push(Value::Integer(offset));

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
        )
        select
          fv.patient_id,
          count(fv.visit_id) as case_count,
          max(coalesce(image_stats.latest_image_uploaded_at, '')) as max_upload,
          max(coalesce(fv.created_at, '')) as max_created,
          max(coalesce(fv.visit_index, 0)) as max_visit_index
        from filtered_visits fv
        left join image_stats on fv.visit_id = image_stats.visit_id
        group by fv.patient_id
        order by max_upload desc, max_created desc, max_visit_index desc
        limit ? offset ?
        "
    );

    let mut patient_ids = Vec::new();
    let mut case_counts = HashMap::new();
    {
        let mut stmt = conn.prepare(&ids_sql).map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(ids_params), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (patient_id, case_count) = row.map_err(|error| error.to_string())?;
            case_counts.insert(patient_id.clone(), case_count);
            patient_ids.push(patient_id);
        }
    }

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
            pick_desktop_directory,
            request_local_json,
            request_local_binary,
            request_local_multipart,
            run_case_validation,
            run_case_validation_compare,
            run_case_ai_clinic,
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
            read_image_blob
        ])
        .run(tauri::generate_context!())
        .expect("error while running K-ERA desktop shell");
}
