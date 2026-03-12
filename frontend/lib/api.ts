export type AuthState = "approved" | "pending" | "rejected" | "application_required";

export type SiteRecord = {
  site_id: string;
  display_name: string;
  hospital_name: string;
};

export type ProjectRecord = {
  project_id: string;
  name: string;
  description: string;
  owner_user_id: string;
  site_ids: string[];
  created_at: string;
};

export type ManagedSiteRecord = SiteRecord & {
  project_id: string;
  local_storage_root?: string;
  created_at?: string;
};

export type StorageSettingsRecord = {
  storage_root: string;
  default_storage_root: string;
  uses_custom_root: boolean;
};

export type AccessRequestRecord = {
  request_id: string;
  user_id: string;
  email: string;
  requested_site_id: string;
  requested_role: string;
  message: string;
  status: AuthState;
  reviewed_by: string | null;
  reviewer_notes: string;
  created_at: string;
  reviewed_at: string | null;
};

export type AuthUser = {
  user_id: string;
  username: string;
  full_name: string;
  role: string;
  site_ids: string[] | null;
  approval_status: AuthState;
  latest_access_request?: AccessRequestRecord | null;
};

export type ManagedUserRecord = AuthUser & {
  site_ids: string[] | null;
};

export type PatientRecord = {
  patient_id: string;
  created_by_user_id?: string | null;
  sex: string;
  age: number;
  chart_alias?: string;
  local_case_code?: string;
  created_at?: string;
};

export type OrganismRecord = {
  culture_category: string;
  culture_species: string;
};

export type VisitRecord = {
  visit_id: string;
  patient_id: string;
  created_by_user_id?: string | null;
  visit_date: string;
  actual_visit_date?: string | null;
  culture_confirmed: boolean;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  predisposing_factor: string[];
  other_history: string;
  visit_status: string;
  active_stage: boolean;
  is_initial_visit: boolean;
  smear_result: string;
  polymicrobial: boolean;
  created_at: string;
};

export type ImageRecord = {
  image_id: string;
  visit_id: string;
  patient_id: string;
  visit_date: string;
  view: string;
  image_path: string;
  is_representative: boolean;
  lesion_prompt_box?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null;
  uploaded_at: string;
};

export type CaseSummaryRecord = {
  case_id: string;
  visit_id: string;
  patient_id: string;
  created_by_user_id?: string | null;
  visit_date: string;
  actual_visit_date?: string | null;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: number | null;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  visit_status: string;
  is_initial_visit: boolean;
  smear_result: string;
  polymicrobial: boolean;
  image_count: number;
  representative_image_id: string | null;
  representative_view: string | null;
  created_at: string | null;
  latest_image_uploaded_at: string | null;
};

export type SiteSummary = {
  site_id: string;
  n_patients: number;
  n_visits: number;
  n_images: number;
  n_active_visits: number;
  n_validation_runs: number;
  latest_validation?: Record<string, unknown> | null;
};

export type CaseValidationSummary = {
  validation_id: string;
  project_id: string;
  site_id: string;
  model_version: string;
  model_version_id: string;
  model_architecture: string;
  run_date: string;
  patient_id: string;
  visit_date: string;
  n_images: number;
  predicted_label: string;
  true_label: string;
  is_correct: boolean;
  prediction_probability: number;
};

export type CaseValidationPrediction = {
  validation_id: string;
  patient_id: string;
  visit_date: string;
  true_label: string;
  predicted_label: string;
  prediction_probability: number;
  is_correct: boolean;
  crop_mode?: "automated" | "manual" | "both";
  gradcam_path?: string | null;
  medsam_mask_path?: string | null;
  roi_crop_path?: string | null;
  lesion_mask_path?: string | null;
  lesion_crop_path?: string | null;
  ensemble_weights?: Record<string, number> | null;
  ensemble_component_predictions?: Array<Record<string, unknown>> | null;
};

export type CaseValidationResponse = {
  summary: CaseValidationSummary;
  case_prediction: CaseValidationPrediction | null;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
    requires_medsam_crop: boolean;
    crop_mode?: "automated" | "manual" | "both";
    ensemble_mode?: string | null;
  };
  execution_device: string;
  artifact_availability: {
    gradcam: boolean;
    roi_crop: boolean;
    medsam_mask: boolean;
    lesion_crop: boolean;
    lesion_mask: boolean;
  };
};

export type ContributionStats = {
  total_contributions: number;
  user_contributions: number;
  user_contribution_pct: number;
  current_model_version: string;
};

export type CaseContributionResponse = {
  update: {
    update_id: string;
    site_id: string;
    base_model_version_id: string;
    architecture: string;
    upload_type: string;
    execution_device: string;
    artifact_path: string;
    n_cases: number;
    contributed_by: string;
    case_reference_id?: string | null;
    created_at: string;
    training_input_policy: string;
    training_summary: Record<string, unknown>;
    status: string;
  };
  visit_status: string;
  execution_device: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
  };
  stats: ContributionStats;
};

export type RoiPreviewRecord = {
  patient_id: string;
  visit_date: string;
  image_id: string | null;
  view: string;
  is_representative: boolean;
  source_image_path: string;
  has_roi_crop: boolean;
  has_medsam_mask: boolean;
  backend: string;
};

export type LesionPreviewRecord = {
  patient_id: string;
  visit_date: string;
  image_id: string | null;
  view: string;
  is_representative: boolean;
  source_image_path: string;
  has_lesion_crop: boolean;
  has_lesion_mask: boolean;
  backend: string;
  lesion_prompt_box?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null;
};

export type CaseHistoryValidationRecord = {
  validation_id: string;
  run_date: string;
  model_version: string;
  model_version_id: string;
  model_architecture: string;
  run_scope: string;
  predicted_label: string;
  true_label: string;
  prediction_probability: number;
  is_correct: boolean;
};

export type CaseHistoryContributionRecord = {
  contribution_id: string;
  created_at: string;
  user_id: string;
  case_reference_id?: string | null;
  update_id: string;
  update_status: string | null;
  upload_type: string | null;
  architecture: string | null;
  execution_device: string | null;
  base_model_version_id: string | null;
};

export type CaseHistoryResponse = {
  validations: CaseHistoryValidationRecord[];
  contributions: CaseHistoryContributionRecord[];
};

export type SiteActivityValidationRecord = {
  validation_id: string;
  run_date: string;
  model_version: string;
  model_architecture: string;
  n_cases: number;
  n_images: number;
  accuracy?: number | null;
  AUROC?: number | null;
  site_id: string;
};

export type SiteActivityContributionRecord = {
  contribution_id: string;
  created_at: string;
  user_id: string;
  case_reference_id?: string | null;
  update_id: string;
  update_status: string | null;
  upload_type: string | null;
};

export type SiteActivityResponse = {
  pending_updates: number;
  recent_validations: SiteActivityValidationRecord[];
  recent_contributions: SiteActivityContributionRecord[];
};

export type SiteValidationRunRecord = {
  validation_id: string;
  project_id: string;
  site_id: string;
  model_version: string;
  model_version_id: string;
  model_architecture: string;
  run_date: string;
  n_patients: number;
  n_cases: number;
  n_images: number;
  AUROC?: number | null;
  accuracy?: number | null;
  sensitivity?: number | null;
  specificity?: number | null;
  F1?: number | null;
};

export type SiteValidationRunResponse = {
  summary: SiteValidationRunRecord;
  execution_device: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
  };
};

export type AdminOverviewResponse = {
  site_count: number;
  model_version_count: number;
  pending_access_requests: number;
  pending_model_updates: number;
  current_model_version?: string | null;
  aggregation_count?: number;
};

export type ModelVersionRecord = {
  version_id: string;
  version_name: string;
  architecture: string;
  stage?: string | null;
  created_at?: string | null;
  ready?: boolean;
  is_current?: boolean;
  notes?: string;
  notes_ko?: string;
  notes_en?: string;
  model_path?: string;
  aggregation_id?: string | null;
  base_version_id?: string | null;
  requires_medsam_crop?: boolean;
  training_input_policy?: string;
  crop_mode?: "automated" | "manual" | "both";
  ensemble_mode?: string | null;
  component_model_version_ids?: string[];
  ensemble_weights?: Record<string, number> | null;
  decision_threshold?: number | null;
  threshold_selection_metric?: string | null;
  threshold_selection_metrics?: Record<string, unknown> | null;
};

export type ModelUpdateRecord = {
  update_id: string;
  site_id?: string | null;
  base_model_version_id?: string | null;
  architecture?: string | null;
  upload_type?: string | null;
  execution_device?: string | null;
  artifact_path?: string | null;
  central_artifact_path?: string | null;
  central_artifact_name?: string | null;
  central_artifact_size_bytes?: number | null;
  central_artifact_sha256?: string | null;
  artifact_storage?: string | null;
  n_cases?: number | null;
  contributed_by?: string | null;
  case_reference_id?: string | null;
  created_at?: string | null;
  training_input_policy?: string | null;
  training_summary?: Record<string, unknown>;
  status?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reviewer_notes?: string | null;
  approval_report_path?: string | null;
  approval_report?: {
    report_id?: string;
    update_id?: string;
    site_id?: string;
    case_reference_id?: string;
    generated_at?: string;
    case_summary?: {
      image_count?: number;
      representative_view?: string | null;
      views?: string[];
      culture_category?: string | null;
      culture_species?: string | null;
      is_single_case_delta?: boolean;
    };
    qa_metrics?: {
      source?: Record<string, number>;
      roi_crop?: Record<string, number>;
      medsam_mask?: Record<string, number>;
      roi_area_ratio?: number | null;
    };
    privacy_controls?: {
      source_thumbnail_max_side_px?: number;
      derived_thumbnail_max_side_px?: number;
      upload_exif_removed?: boolean;
      stored_filename_policy?: string;
      review_media_policy?: string;
    };
    artifacts?: {
      source_thumbnail?: {
        media_type?: string;
        encoding?: string;
        bytes_b64?: string;
      } | null;
      roi_thumbnail?: {
        media_type?: string;
        encoding?: string;
        bytes_b64?: string;
      } | null;
      mask_thumbnail?: {
        media_type?: string;
        encoding?: string;
        bytes_b64?: string;
      } | null;
      source_thumbnail_path?: string | null;
      roi_thumbnail_path?: string | null;
      mask_thumbnail_path?: string | null;
    };
  };
  quality_summary?: {
    quality_score?: number | null;
    recommendation?: string | null;
    image_quality?: {
      score?: number | null;
      status?: string | null;
      flags?: string[];
      mean_brightness?: number | null;
      contrast_stddev?: number | null;
      edge_density?: number | null;
    };
    crop_quality?: {
      score?: number | null;
      status?: string | null;
      flags?: string[];
      roi_area_ratio?: number | null;
    };
    delta_quality?: {
      score?: number | null;
      status?: string | null;
      flags?: string[];
      l2_norm?: number | null;
      parameter_count?: number | null;
      message?: string | null;
    };
    validation_consistency?: {
      score?: number | null;
      status?: string | null;
      flags?: string[];
      predicted_label?: string | null;
      true_label?: string | null;
      prediction_probability?: number | null;
      decision_threshold?: number | null;
      is_correct?: boolean | null;
    };
    policy_checks?: {
      score?: number | null;
      status?: string | null;
      flags?: string[];
      has_additional_organisms?: boolean | null;
      training_policy?: string | null;
    };
    risk_flags?: string[];
    strengths?: string[];
  } | null;
};

export type AggregationRecord = {
  aggregation_id: string;
  base_model_version_id?: string | null;
  new_version_name: string;
  architecture?: string | null;
  site_weights?: Record<string, number>;
  total_cases?: number | null;
  created_at?: string | null;
};

export type InitialTrainingResult = {
  training_id: string;
  version_name: string;
  output_model_path: string;
  n_train: number;
  n_val: number;
  n_test: number;
  n_train_patients: number;
  n_val_patients: number;
  n_test_patients: number;
  best_val_acc: number;
  use_pretrained: boolean;
  patient_split?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  val_metrics?: Record<string, number | null>;
  test_metrics?: Record<string, number | null>;
  model_version?: ModelVersionRecord;
  crop_mode?: "automated" | "manual" | "both";
  component_results?: Array<Record<string, unknown>>;
  model_versions?: ModelVersionRecord[];
};

export type InitialTrainingResponse = {
  site_id: string;
  execution_device: string;
  result: InitialTrainingResult;
  model_version?: ModelVersionRecord;
};

export type TrainingJobProgress = {
  stage?: string | null;
  message?: string | null;
  percent?: number | null;
  crop_mode?: "automated" | "manual" | "both" | string | null;
  component_crop_mode?: "automated" | "manual" | string | null;
  component_index?: number | null;
  component_count?: number | null;
  fold_index?: number | null;
  num_folds?: number | null;
  epoch?: number | null;
  epochs?: number | null;
  train_loss?: number | null;
  val_acc?: number | null;
};

export type SiteJobRecord = {
  job_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result?: {
    progress?: TrainingJobProgress | null;
    response?: InitialTrainingResponse | CrossValidationRunResponse | null;
    error?: string | null;
  } | null;
  created_at: string;
  updated_at?: string | null;
};

export type InitialTrainingJobResponse = {
  site_id: string;
  execution_device: string;
  job: SiteJobRecord;
};

export type CrossValidationJobResponse = {
  site_id: string;
  execution_device: string;
  job: SiteJobRecord;
};

export type CrossValidationMetricSummary = {
  mean?: number | null;
  std?: number | null;
};

export type ConfusionMatrixRecord = {
  labels?: string[];
  matrix?: number[][];
};

export type CrossValidationFoldRecord = {
  fold_index: number;
  output_model_path?: string;
  n_train_patients: number;
  n_val_patients: number;
  n_test_patients: number;
  n_train: number;
  n_val: number;
  n_test: number;
  best_val_acc?: number;
  val_metrics?: Record<string, number | null | ConfusionMatrixRecord>;
  test_metrics?: Record<string, number | null | ConfusionMatrixRecord>;
  patient_split?: Record<string, unknown>;
};

export type CrossValidationReport = {
  cross_validation_id: string;
  site_id: string;
  architecture: string;
  execution_device?: string | null;
  created_at?: string | null;
  num_folds: number;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  val_split: number;
  use_pretrained: boolean;
  aggregate_metrics: Record<string, CrossValidationMetricSummary>;
  fold_results: CrossValidationFoldRecord[];
  report_path?: string;
  training_input_policy?: string;
};

export type CrossValidationRunResponse = {
  site_id: string;
  execution_device: string;
  report: CrossValidationReport;
};

export type AggregationRunResponse = {
  aggregation: AggregationRecord;
  model_version?: ModelVersionRecord | null;
  aggregated_update_ids: string[];
};

export type BulkImportResponse = {
  site_id: string;
  rows_received: number;
  files_received: number;
  created_patients: number;
  created_visits: number;
  imported_images: number;
  skipped_images: number;
  errors: string[];
  file_sources: Record<string, string>;
};

export type SiteComparisonRecord = {
  site_id: string;
  display_name: string;
  hospital_name: string;
  run_count: number;
  accuracy?: number | null;
  sensitivity?: number | null;
  specificity?: number | null;
  F1?: number | null;
  AUROC?: number | null;
  latest_validation_id?: string | null;
  latest_run_date?: string | null;
};

export type ValidationCasePredictionRecord = {
  validation_id: string;
  patient_id: string;
  visit_date: string;
  true_label: string;
  predicted_label: string;
  prediction_probability: number;
  is_correct: boolean;
  roi_crop_available: boolean;
  gradcam_available: boolean;
  medsam_mask_available: boolean;
  representative_image_id?: string | null;
  representative_view?: string | null;
};

export type AuthResponse = {
  auth_state: AuthState;
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function stringifyApiDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as { loc?: unknown; msg?: unknown };
          const location = Array.isArray(record.loc) ? record.loc.map((part) => String(part)).join(".") : "";
          const message = typeof record.msg === "string" ? record.msg : JSON.stringify(item);
          return location ? `${location}: ${message}` : message;
        }
        return String(item);
      })
      .join(" | ");
  }
  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }
  return String(detail);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: unknown };
      throw new Error(stringifyApiDetail(payload.detail) || `Request failed: ${response.status}`);
    }
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function googleLogin(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
}

export async function fetchMe(token: string) {
  return request<AuthUser>("/api/auth/me", {}, token);
}

export async function fetchSites(token: string) {
  return request<SiteRecord[]>("/api/sites", {}, token);
}

export async function fetchPublicSites() {
  return request<SiteRecord[]>("/api/public/sites");
}

export async function fetchSiteSummary(siteId: string, token: string) {
  return request<SiteSummary>(`/api/sites/${siteId}/summary`, {}, token);
}

export async function fetchSiteActivity(siteId: string, token: string) {
  return request<SiteActivityResponse>(`/api/sites/${siteId}/activity`, {}, token);
}

export async function fetchSiteValidations(siteId: string, token: string) {
  return request<SiteValidationRunRecord[]>(`/api/sites/${siteId}/validations`, {}, token);
}

export async function fetchValidationCases(
  siteId: string,
  validationId: string,
  token: string,
  options: {
    misclassified_only?: boolean;
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.misclassified_only) {
    params.set("misclassified_only", "true");
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ValidationCasePredictionRecord[]>(
    `/api/sites/${siteId}/validations/${validationId}/cases${suffix}`,
    {},
    token
  );
}

export async function fetchPatients(siteId: string, token: string, options?: { mine?: boolean }) {
  const params = new URLSearchParams();
  if (options?.mine) {
    params.set("mine", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<PatientRecord[]>(`/api/sites/${siteId}/patients${suffix}`, {}, token);
}

export async function createPatient(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    sex: string;
    age: number;
    chart_alias?: string;
    local_case_code?: string;
  }
) {
  return request<PatientRecord>(
    `/api/sites/${siteId}/patients`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function downloadManifest(siteId: string, token: string) {
  const response = await fetch(buildApiUrl(`/api/sites/${siteId}/manifest.csv`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Manifest export failed: ${response.status}`);
  }
  return response.blob();
}

export async function fetchMyAccessRequests(token: string) {
  return request<AccessRequestRecord[]>("/api/auth/access-requests", {}, token);
}

export async function submitAccessRequest(
  token: string,
  payload: {
    requested_site_id: string;
    requested_role: string;
    message?: string;
  }
) {
  return request<{ request: AccessRequestRecord; auth_state: AuthState; user: AuthUser }>(
    "/api/auth/request-access",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchAccessRequests(token: string, statusFilter = "pending") {
  const suffix = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : "";
  return request<AccessRequestRecord[]>(`/api/admin/access-requests${suffix}`, {}, token);
}

export async function fetchAdminOverview(token: string) {
  return request<AdminOverviewResponse>("/api/admin/overview", {}, token);
}

export async function fetchStorageSettings(token: string) {
  return request<StorageSettingsRecord>("/api/admin/storage-settings", {}, token);
}

export async function updateStorageSettings(
  token: string,
  payload: {
    storage_root: string;
  }
) {
  return request<StorageSettingsRecord>(
    "/api/admin/storage-settings",
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchProjects(token: string) {
  return request<ProjectRecord[]>("/api/admin/projects", {}, token);
}

export async function createProject(
  token: string,
  payload: {
    name: string;
    description?: string;
  }
) {
  return request<ProjectRecord>(
    "/api/admin/projects",
    {
      method: "POST",
      body: JSON.stringify({
        description: "",
        ...payload,
      }),
    },
    token
  );
}

export async function fetchAdminSites(token: string, projectId?: string) {
  const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return request<ManagedSiteRecord[]>(`/api/admin/sites${suffix}`, {}, token);
}

export async function createAdminSite(
  token: string,
  payload: {
    project_id: string;
    site_code: string;
    display_name: string;
    hospital_name?: string;
  }
) {
  return request<ManagedSiteRecord>(
    "/api/admin/sites",
    {
      method: "POST",
      body: JSON.stringify({
        hospital_name: "",
        ...payload,
      }),
    },
    token
  );
}

export async function updateAdminSite(
  siteId: string,
  token: string,
  payload: {
    display_name: string;
    hospital_name?: string;
  }
) {
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        hospital_name: "",
        ...payload,
      }),
    },
    token
  );
}

export async function fetchUsers(token: string) {
  return request<ManagedUserRecord[]>("/api/admin/users", {}, token);
}

export async function upsertManagedUser(
  token: string,
  payload: {
    user_id?: string;
    username: string;
    full_name?: string;
    password?: string;
    role: string;
    site_ids?: string[];
  }
) {
  return request<ManagedUserRecord>(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        full_name: "",
        password: "",
        site_ids: [],
        ...payload,
      }),
    },
    token
  );
}

export async function reviewAccessRequest(
  requestId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    reviewer_notes?: string;
  }
) {
  return request<{ request: AccessRequestRecord }>(
    `/api/admin/access-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchModelVersions(token: string) {
  return request<ModelVersionRecord[]>("/api/admin/model-versions", {}, token);
}

export async function deleteModelVersion(versionId: string, token: string) {
  return request<{ model_version: ModelVersionRecord }>(`/api/admin/model-versions/${versionId}`, { method: "DELETE" }, token);
}

export async function fetchModelUpdates(
  token: string,
  options: {
    site_id?: string;
    status_filter?: string;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.site_id) {
    params.set("site_id", options.site_id);
  }
  if (options.status_filter) {
    params.set("status_filter", options.status_filter);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ModelUpdateRecord[]>(`/api/admin/model-updates${suffix}`, {}, token);
}

export async function reviewModelUpdate(
  updateId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    reviewer_notes?: string;
  }
) {
  return request<{ update: ModelUpdateRecord }>(
    `/api/admin/model-updates/${updateId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchModelUpdateArtifactBlob(
  updateId: string,
  artifactKind: "source_thumbnail" | "roi_thumbnail" | "mask_thumbnail",
  token: string
) {
  const response = await fetch(buildApiUrl(`/api/admin/model-updates/${updateId}/artifacts/${artifactKind}`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `Artifact fetch failed: ${response.status}`);
    }
    const detail = await response.text();
    throw new Error(detail || `Artifact fetch failed: ${response.status}`);
  }
  return response.blob();
}

export async function fetchAggregations(token: string) {
  return request<AggregationRecord[]>("/api/admin/aggregations", {}, token);
}

export async function fetchSiteComparison(token: string) {
  return request<SiteComparisonRecord[]>("/api/admin/site-comparison", {}, token);
}

export async function runFederatedAggregation(
  token: string,
  payload: {
    update_ids?: string[];
    new_version_name?: string;
  } = {}
) {
  return request<AggregationRunResponse>(
    "/api/admin/aggregations/run",
    {
      method: "POST",
      body: JSON.stringify({
        update_ids: [],
        ...payload,
      }),
    },
    token
  );
}

export async function fetchCases(siteId: string, token: string, options?: { mine?: boolean }) {
  const params = new URLSearchParams();
  if (options?.mine) {
    params.set("mine", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<CaseSummaryRecord[]>(`/api/sites/${siteId}/cases${suffix}`, {}, token);
}

export async function fetchVisits(siteId: string, token: string, patientId?: string) {
  const suffix = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : "";
  return request<VisitRecord[]>(`/api/sites/${siteId}/visits${suffix}`, {}, token);
}

export async function createVisit(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    actual_visit_date?: string | null;
    culture_confirmed?: boolean;
    culture_category: string;
    culture_species: string;
    additional_organisms?: OrganismRecord[];
    contact_lens_use: string;
    predisposing_factor?: string[];
    other_history?: string;
    visit_status?: string;
    is_initial_visit?: boolean;
    smear_result?: string;
    polymicrobial?: boolean;
  }
) {
  return request<VisitRecord>(
    `/api/sites/${siteId}/visits`,
    {
      method: "POST",
      body: JSON.stringify({
        culture_confirmed: true,
        actual_visit_date: null,
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        smear_result: "not done",
        additional_organisms: [],
        polymicrobial: false,
        ...payload,
      }),
    },
    token
  );
}

export async function updateAdminSiteStorageRoot(
  siteId: string,
  token: string,
  payload: {
    storage_root: string;
  }
) {
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}/storage-root`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function migrateAdminSiteStorageRoot(
  siteId: string,
  token: string,
  payload: {
    storage_root: string;
  }
) {
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}/storage-root/migrate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function updateVisit(
  siteId: string,
  token: string,
  patientId: string,
  visitDate: string,
  payload: {
    patient_id: string;
    visit_date: string;
    actual_visit_date?: string | null;
    culture_confirmed?: boolean;
    culture_category: string;
    culture_species: string;
    additional_organisms?: OrganismRecord[];
    contact_lens_use: string;
    predisposing_factor?: string[];
    other_history?: string;
    visit_status?: string;
    is_initial_visit?: boolean;
    smear_result?: string;
    polymicrobial?: boolean;
  }
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<VisitRecord>(
    `/api/sites/${siteId}/visits?${params.toString()}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        culture_confirmed: true,
        actual_visit_date: null,
        predisposing_factor: [],
        other_history: "",
        visit_status: "active",
        is_initial_visit: false,
        smear_result: "not done",
        additional_organisms: [],
        polymicrobial: false,
        ...payload,
      }),
    },
    token
  );
}

export async function deleteVisit(siteId: string, token: string, patientId: string, visitDate: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<{
    patient_id: string;
    visit_date: string;
    deleted_images: number;
    deleted_patient: boolean;
    remaining_visit_count: number;
  }>(`/api/sites/${siteId}/visits?${params.toString()}`, { method: "DELETE" }, token);
}

export async function fetchImages(siteId: string, token: string, patientId?: string, visitDate?: string) {
  const params = new URLSearchParams();
  if (patientId) {
    params.set("patient_id", patientId);
  }
  if (visitDate) {
    params.set("visit_date", visitDate);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ImageRecord[]>(`/api/sites/${siteId}/images${suffix}`, {}, token);
}

export async function uploadImage(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    view: string;
    is_representative?: boolean;
    file: File;
  }
) {
  const form = new FormData();
  form.set("patient_id", payload.patient_id);
  form.set("visit_date", payload.visit_date);
  form.set("view", payload.view);
  form.set("is_representative", String(Boolean(payload.is_representative)));
  form.set("file", payload.file);
  return request<ImageRecord>(
    `/api/sites/${siteId}/images`,
    {
      method: "POST",
      body: form,
    },
    token
  );
}

export async function deleteVisitImages(siteId: string, token: string, patientId: string, visitDate: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<{ deleted_count: number }>(`/api/sites/${siteId}/images?${params.toString()}`, { method: "DELETE" }, token);
}

export async function setRepresentativeImage(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    representative_image_id: string;
  }
) {
  return request<{ images: ImageRecord[] }>(
    `/api/sites/${siteId}/images/representative`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchImageBlob(siteId: string, imageId: string, token: string) {
  const response = await fetch(buildApiUrl(`/api/sites/${siteId}/images/${imageId}/content`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `Image fetch failed: ${response.status}`);
    }
    throw new Error(`Image fetch failed: ${response.status}`);
  }
  return response.blob();
}

export async function downloadImportTemplate(siteId: string, token: string) {
  const response = await fetch(buildApiUrl(`/api/sites/${siteId}/import/template.csv`), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Import template download failed: ${response.status}`);
  }
  return response.blob();
}

export async function runBulkImport(
  siteId: string,
  token: string,
  payload: {
    csvFile: File;
    files: File[];
  }
) {
  const form = new FormData();
  form.set("csv_file", payload.csvFile);
  for (const file of payload.files) {
    form.append("files", file);
  }
  return request<BulkImportResponse>(
    `/api/sites/${siteId}/import/bulk`,
    {
      method: "POST",
      body: form,
    },
    token
  );
}

export async function runCaseValidation(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
  }
) {
  return request<CaseValidationResponse>(
    `/api/sites/${siteId}/cases/validate`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        generate_gradcam: true,
        generate_medsam: true,
        ...payload,
      }),
    },
    token
  );
}

export async function fetchValidationArtifactBlob(
  siteId: string,
  validationId: string,
  patientId: string,
  visitDate: string,
  artifactKind: "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask",
  token: string
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  const response = await fetch(
    buildApiUrl(`/api/sites/${siteId}/validations/${validationId}/artifacts/${artifactKind}?${params.toString()}`),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `Artifact fetch failed: ${response.status}`);
    }
    throw new Error(`Artifact fetch failed: ${response.status}`);
  }
  return response.blob();
}

export async function runCaseContribution(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
  }
) {
  return request<CaseContributionResponse>(
    `/api/sites/${siteId}/cases/contribute`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        ...payload,
      }),
    },
    token
  );
}

export async function fetchCaseRoiPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<RoiPreviewRecord[]>(`/api/sites/${siteId}/cases/roi-preview?${params.toString()}`, {}, token);
}

export async function fetchCaseLesionPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<LesionPreviewRecord[]>(`/api/sites/${siteId}/cases/lesion-preview?${params.toString()}`, {}, token);
}

export async function fetchCaseRoiPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  const response = await fetch(
    buildApiUrl(`/api/sites/${siteId}/cases/roi-preview/artifacts/${artifactKind}?${params.toString()}`),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `ROI preview fetch failed: ${response.status}`);
    }
    throw new Error(`ROI preview fetch failed: ${response.status}`);
  }
  return response.blob();
}

export async function fetchCaseLesionPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  const response = await fetch(
    buildApiUrl(`/api/sites/${siteId}/cases/lesion-preview/artifacts/${artifactKind}?${params.toString()}`),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `Lesion preview fetch failed: ${response.status}`);
    }
    throw new Error(`Lesion preview fetch failed: ${response.status}`);
  }
  return response.blob();
}

export async function updateImageLesionBox(
  siteId: string,
  imageId: string,
  token: string,
  payload: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
) {
  return request<ImageRecord>(
    `/api/sites/${siteId}/images/${imageId}/lesion-box`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function clearImageLesionBox(
  siteId: string,
  imageId: string,
  token: string
) {
  return request<ImageRecord>(
    `/api/sites/${siteId}/images/${imageId}/lesion-box`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function fetchCaseHistory(siteId: string, patientId: string, visitDate: string, token: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<CaseHistoryResponse>(`/api/sites/${siteId}/cases/history?${params.toString()}`, {}, token);
}

export async function runSiteValidation(
  siteId: string,
  token: string,
  payload: {
    execution_mode?: "auto" | "cpu" | "gpu";
    generate_gradcam?: boolean;
    generate_medsam?: boolean;
    model_version_id?: string;
  } = {}
) {
  return request<SiteValidationRunResponse>(
    `/api/sites/${siteId}/validations/run`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        generate_gradcam: true,
        generate_medsam: true,
        ...payload,
      }),
    },
    token
  );
}

export async function runInitialTraining(
  siteId: string,
  token: string,
  payload: {
    architecture?: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual" | "both";
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    test_split?: number;
    use_pretrained?: boolean;
    regenerate_split?: boolean;
  } = {}
) {
  return request<InitialTrainingJobResponse>(
    `/api/sites/${siteId}/training/initial`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        epochs: 30,
        learning_rate: 1e-4,
        batch_size: 16,
        val_split: 0.2,
        test_split: 0.2,
        use_pretrained: true,
        regenerate_split: false,
        ...payload,
      }),
    },
    token
  );
}

export async function fetchSiteJob(siteId: string, jobId: string, token: string) {
  return request<SiteJobRecord>(`/api/sites/${siteId}/jobs/${jobId}`, {}, token);
}

export async function fetchCrossValidationReports(siteId: string, token: string) {
  return request<CrossValidationReport[]>(`/api/sites/${siteId}/training/cross-validation`, {}, token);
}

export async function runCrossValidation(
  siteId: string,
  token: string,
  payload: {
    architecture?: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    crop_mode?: "automated" | "manual";
    num_folds?: number;
    epochs?: number;
    learning_rate?: number;
    batch_size?: number;
    val_split?: number;
    use_pretrained?: boolean;
  } = {}
) {
  return request<CrossValidationJobResponse>(
    `/api/sites/${siteId}/training/cross-validation`,
    {
      method: "POST",
      body: JSON.stringify({
        architecture: "convnext_tiny",
        execution_mode: "auto",
        crop_mode: "automated",
        num_folds: 5,
        epochs: 10,
        learning_rate: 1e-4,
        batch_size: 16,
        val_split: 0.2,
        use_pretrained: true,
        ...payload,
      }),
    },
    token
  );
}
