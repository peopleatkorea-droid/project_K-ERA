export type AuthState = "approved" | "pending" | "rejected" | "application_required";

export type SiteRecord = {
  site_id: string;
  display_name: string;
  hospital_name: string;
  site_alias?: string | null;
  source_institution_name?: string | null;
};

export type PublicInstitutionRecord = {
  institution_id: string;
  source: string;
  name: string;
  institution_type_code: string;
  institution_type_name: string;
  address: string;
  phone: string;
  homepage: string;
  sido_code: string;
  sggu_code: string;
  emdong_name: string;
  postal_code: string;
  x_pos: string;
  y_pos: string;
  ophthalmology_available: boolean;
  open_status: string;
  synced_at: string;
};

export type InstitutionDirectorySyncResponse = {
  source: string;
  pages_synced?: number | null;
  total_count?: number | null;
  institutions_synced: number;
  synced_at?: string | null;
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
  source_institution_id?: string | null;
  source_institution_name?: string | null;
  source_institution_address?: string | null;
  local_storage_root?: string;
  created_at?: string;
  research_registry_enabled?: boolean;
};

export type StorageSettingsRecord = {
  storage_root: string;
  default_storage_root: string;
  effective_default_storage_root: string;
  storage_root_source: "built_in_default" | "environment_default" | "custom";
  uses_custom_root: boolean;
  selected_site_id?: string | null;
  selected_site_storage_root?: string | null;
};

export type SiteMetadataRecoveryResponse = {
  site_id: string;
  site_dir: string;
  manifest_path: string;
  metadata_backup_path: string;
  source: "backup" | "manifest";
  restored_patients: number;
  restored_visits: number;
  restored_images: number;
};

export type AdminWorkspaceBootstrapResponse = {
  overview: AdminOverviewResponse;
  pending_requests: AccessRequestRecord[];
  approved_requests: AccessRequestRecord[];
  model_versions: ModelVersionRecord[];
  model_updates: ModelUpdateRecord[];
  aggregations: AggregationRecord[];
  projects: ProjectRecord[];
  managed_sites: ManagedSiteRecord[];
  managed_users: ManagedUserRecord[];
  institution_sync_status: InstitutionDirectorySyncResponse;
};

export type AccessRequestRecord = {
  request_id: string;
  user_id: string;
  email: string;
  requested_site_id: string;
  requested_site_label?: string;
  requested_site_source?: string;
  resolved_site_id?: string | null;
  resolved_site_label?: string | null;
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
  public_alias?: string | null;
  role: string;
  site_ids: string[] | null;
  approval_status: AuthState;
  latest_access_request?: AccessRequestRecord | null;
  registry_consents?: Record<string, { enrolled_at: string; version?: string }>;
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

export type PatientIdLookupResponse = {
  requested_patient_id: string;
  normalized_patient_id: string;
  exists: boolean;
  patient: PatientRecord | null;
  visit_count: number;
  image_count: number;
  latest_visit_date: string | null;
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
  content_url?: string | null;
  has_lesion_box?: boolean;
  has_roi_crop?: boolean;
  has_medsam_mask?: boolean;
  has_lesion_crop?: boolean;
  has_lesion_mask?: boolean;
  artifact_status_updated_at?: string | null;
  lesion_prompt_box?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null;
  uploaded_at: string;
  quality_scores?: {
    quality_score: number;
    view_score: number;
    component_scores?: {
      blur?: number | null;
      exposure?: number | null;
      contrast?: number | null;
      resolution?: number | null;
      view_consistency?: number | null;
    } | null;
    image_stats?: {
      width?: number | null;
      height?: number | null;
      brightness_mean?: number | null;
      contrast_std?: number | null;
      blur_variance?: number | null;
      green_ratio?: number | null;
      saturation_mean?: number | null;
    } | null;
  } | null;
};

export type ImagePreviewBatchItemRecord = {
  image_id: string;
  max_side: number;
  ready: boolean;
  cache_status: "hit" | "generated" | "missing" | "error";
  preview_url: string;
  error?: string | null;
};

export type ImagePreviewBatchResponse = {
  max_side: number;
  requested_count: number;
  ready_count: number;
  items: ImagePreviewBatchItemRecord[];
};

export type SemanticPromptMatch = {
  prompt_id: string;
  label: string;
  prompt: string;
  layer_id: string;
  layer_label: string;
  score: number;
};

export type SemanticPromptLayerResult = {
  layer_id: string;
  layer_label: string;
  matches: SemanticPromptMatch[];
};

export type SemanticPromptInputMode = "source" | "roi_crop" | "lesion_crop";

export type SemanticPromptReviewResponse = {
  image_id: string;
  image_path: string;
  view: string;
  input_mode: SemanticPromptInputMode;
  dictionary_name: string;
  model_name: string;
  model_id: string;
  top_k: number;
  overall_top_matches: SemanticPromptMatch[];
  layers: SemanticPromptLayerResult[];
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
  predisposing_factor?: string[];
  other_history?: string;
  visit_status: string;
  active_stage?: boolean;
  is_initial_visit: boolean;
  smear_result: string;
  polymicrobial: boolean;
  research_registry_status?: "analysis_only" | "candidate" | "included" | "excluded";
  research_registry_updated_at?: string | null;
  research_registry_updated_by?: string | null;
  research_registry_source?: string | null;
  image_count: number;
  representative_image_id: string | null;
  representative_view: string | null;
  created_at: string | null;
  latest_image_uploaded_at: string | null;
};

export type PatientListThumbnailRecord = {
  case_id: string;
  image_id: string;
  view: string | null;
  preview_url: string | null;
  fallback_url?: string | null;
};

export type PatientListRowRecord = {
  patient_id: string;
  latest_case: CaseSummaryRecord;
  case_count: number;
  representative_thumbnail_count?: number;
  organism_summary: string;
  representative_thumbnails: PatientListThumbnailRecord[];
};

export type PatientListPageResponse = {
  items: PatientListRowRecord[];
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
};

export type MedsamArtifactStatusKey =
  | "missing_lesion_box"
  | "missing_roi"
  | "missing_lesion_crop"
  | "medsam_backfill_ready";

export type ArtifactScopeCounts = {
  patients: number;
  visits: number;
  images: number;
};

export type MedsamArtifactStatusSummary = {
  site_id: string;
  total: ArtifactScopeCounts;
  statuses: Record<MedsamArtifactStatusKey, ArtifactScopeCounts>;
  active_job: Record<string, unknown> | null;
  last_synced_at: string | null;
};

export type MedsamArtifactListItem = {
  scope: "patient" | "visit" | "image";
  patient_id: string;
  visit_date?: string | null;
  image_id?: string | null;
  view?: string | null;
  uploaded_at?: string | null;
  is_representative?: boolean;
  has_lesion_box?: boolean;
  has_roi_crop?: boolean;
  has_medsam_mask?: boolean;
  has_lesion_crop?: boolean;
  has_lesion_mask?: boolean;
  image_count?: number;
  visit_count?: number;
  missing_lesion_box_count?: number;
  missing_roi_count?: number;
  missing_lesion_crop_count?: number;
  medsam_backfill_ready_count?: number;
  case_summary?: CaseSummaryRecord | null;
};

export type MedsamArtifactItemsResponse = {
  scope: "patient" | "visit" | "image";
  status: MedsamArtifactStatusKey;
  items: MedsamArtifactListItem[];
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
};

export type SiteSummary = {
  site_id: string;
  n_patients: number;
  n_visits: number;
  n_images: number;
  n_active_visits: number;
  n_validation_runs: number;
  latest_validation?: Record<string, unknown> | null;
  research_registry?: {
    site_enabled: boolean;
    user_enrolled: boolean;
    user_enrolled_at?: string | null;
    included_cases: number;
    excluded_cases: number;
  };
};

export type SiteSummaryCounts = Pick<
  SiteSummary,
  "site_id" | "n_patients" | "n_visits" | "n_images" | "n_active_visits"
>;

export type CaseValidationSummary = {
  validation_id: string;
  project_id: string;
  site_id: string;
  model_version: string;
  model_version_id: string;
  model_architecture: string;
  case_aggregation?: string | null;
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
  decision_threshold?: number | null;
  crop_mode?: "automated" | "manual" | "both" | "paired";
  case_aggregation?: string | null;
  gradcam_path?: string | null;
  gradcam_heatmap_path?: string | null;
  gradcam_cornea_path?: string | null;
  gradcam_cornea_heatmap_path?: string | null;
  gradcam_lesion_path?: string | null;
  gradcam_lesion_heatmap_path?: string | null;
  medsam_mask_path?: string | null;
  roi_crop_path?: string | null;
  lesion_mask_path?: string | null;
  lesion_crop_path?: string | null;
  ensemble_weights?: Record<string, number> | null;
  ensemble_component_predictions?: Array<Record<string, unknown>> | null;
  quality_weights?: number[] | null;
  model_representative_source_image_path?: string | null;
  model_representative_image_path?: string | null;
  model_representative_index?: number | null;
  instance_attention_scores?: Array<{
    image_path: string;
    source_image_path: string;
    view?: string | null;
    attention: number;
  }> | null;
  prediction_snapshot?: PredictionPostMortemSnapshot | null;
  post_mortem?: PredictionPostMortem | null;
};

export type CaseValidationResponse = {
  summary: CaseValidationSummary;
  case_prediction: CaseValidationPrediction | null;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
    requires_medsam_crop: boolean;
    crop_mode?: "automated" | "manual" | "both" | "paired";
    case_aggregation?: string | null;
    bag_level?: boolean | null;
    ensemble_mode?: string | null;
    component_model_version_ids?: string[];
  };
  execution_device: string;
  artifact_availability: {
    gradcam: boolean;
    gradcam_cornea: boolean;
    gradcam_lesion: boolean;
    roi_crop: boolean;
    medsam_mask: boolean;
    lesion_crop: boolean;
    lesion_mask: boolean;
  };
  post_mortem?: PredictionPostMortem | null;
};

export type PredictionPostMortem = {
  mode: string;
  model?: string | null;
  generated_at?: string | null;
  outcome: string;
  summary: string;
  likely_causes: string[];
  supporting_evidence: string[];
  contradictory_evidence: string[];
  follow_up_actions: string[];
  learning_signal: string;
  uncertainty: string;
  disclaimer: string;
  structured_analysis?: PredictionPostMortemStructuredAnalysis | null;
  llm_error?: string | null;
};

export type PredictionPostMortemSnapshot = {
  patient_id?: string;
  visit_date?: string;
  model_version_id?: string | null;
  model_version_name?: string | null;
  model_architecture?: string | null;
  execution_device?: string | null;
  crop_mode?: string | null;
  decision_threshold?: number | null;
  predicted_label?: string | null;
  prediction_probability?: number | null;
  predicted_confidence?: number | null;
  representative_image_id?: string | null;
  representative_source_image_path?: string | null;
  representative_view?: string | null;
  representative_quality_score?: number | null;
  representative_view_score?: number | null;
  contact_lens_use?: string | null;
  predisposing_factor?: string[];
  smear_result?: string | null;
  polymicrobial?: boolean | null;
  additional_organisms?: string[];
  gradcam_path?: string | null;
  gradcam_heatmap_path?: string | null;
  gradcam_cornea_path?: string | null;
  gradcam_cornea_heatmap_path?: string | null;
  gradcam_lesion_path?: string | null;
  gradcam_lesion_heatmap_path?: string | null;
  medsam_mask_path?: string | null;
  roi_crop_path?: string | null;
  lesion_mask_path?: string | null;
  lesion_crop_path?: string | null;
  n_source_images?: number | null;
  n_model_inputs?: number | null;
  classifier_embedding?: {
    backend?: string | null;
    embedding_id?: string | null;
    signature?: string | null;
    vector_path?: string | null;
    metadata_path?: string | null;
    cached?: boolean | null;
    error?: string | null;
  } | null;
  dinov2_embedding?: {
    backend?: string | null;
    embedding_id?: string | null;
    signature?: string | null;
    vector_path?: string | null;
    metadata_path?: string | null;
    cached?: boolean | null;
    error?: string | null;
  } | null;
  peer_model_consensus?: PredictionPostMortemPeerConsensus | null;
  error?: string | null;
};

export type PredictionPostMortemPeerPrediction = {
  model_version_id?: string | null;
  model_version_name?: string | null;
  architecture?: string | null;
  predicted_label?: string | null;
  prediction_probability?: number | null;
  predicted_confidence?: number | null;
  crop_mode?: string | null;
  error?: string | null;
};

export type PredictionPostMortemPeerConsensus = {
  models_evaluated?: number | null;
  models_requested?: number | null;
  leading_label?: string | null;
  agreement_rate?: number | null;
  disagreement_score?: number | null;
  vote_entropy?: number | null;
  peer_predictions?: PredictionPostMortemPeerPrediction[];
  error?: string | null;
};

export type PredictionPostMortemStructuredAnalysis = {
  outcome?: string | null;
  prediction_confidence?: number | null;
  learning_signal?: string | null;
  root_cause_tags: string[];
  action_tags: string[];
  scores: {
    cam_overlap_score?: number | null;
    cam_peak_inside_score?: number | null;
    cam_hotspot_ratio?: number | null;
    cam_cornea_overlap_score?: number | null;
    cam_cornea_peak_inside_score?: number | null;
    cam_cornea_hotspot_ratio?: number | null;
    cam_lesion_overlap_score?: number | null;
    cam_lesion_peak_inside_score?: number | null;
    cam_lesion_hotspot_ratio?: number | null;
    dino_neighbor_count?: number | null;
    dino_true_label_purity?: number | null;
    dino_predicted_label_purity?: number | null;
    dino_mean_similarity?: number | null;
    dino_mean_distance?: number | null;
    multi_model_agreement?: number | null;
    multi_model_disagreement?: number | null;
    multi_model_vote_entropy?: number | null;
    image_quality_score?: number | null;
    image_view_score?: number | null;
    support_density?: number | null;
    similar_case_count?: number | null;
    text_evidence_count?: number | null;
    site_recent_case_count?: number | null;
    site_recent_miss_rate?: number | null;
    site_error_concentration?: number | null;
  };
  peer_model_consensus?: PredictionPostMortemPeerConsensus | null;
  prediction_snapshot?: PredictionPostMortemSnapshot | null;
};

export type CaseValidationCompareItem = {
  summary?: CaseValidationSummary | null;
  case_prediction?: CaseValidationPrediction | null;
  model_version?: CaseValidationResponse["model_version"] | null;
  artifact_availability?: CaseValidationResponse["artifact_availability"] | null;
  error?: string | null;
  model_version_id?: string | null;
};

export type CaseValidationCompareResponse = {
  patient_id: string;
  visit_date: string;
  execution_device: string;
  comparisons: CaseValidationCompareItem[];
};

export type AiClinicSimilarCaseRecord = {
  patient_id: string;
  visit_date: string;
  case_id: string;
  representative_image_id: string | null;
  representative_view?: string | null;
  chart_alias?: string;
  local_case_code?: string;
  sex?: string | null;
  age?: number | null;
  culture_category: string;
  culture_species: string;
  image_count: number;
  visit_status?: string;
  active_stage?: boolean | null;
  contact_lens_use?: string | null;
  predisposing_factor?: string[];
  smear_result?: string | null;
  polymicrobial?: boolean | null;
  quality_score?: number | null;
  view_score?: number | null;
  base_similarity?: number | null;
  metadata_reranking?: {
    adjustment?: number | null;
    details?: Record<string, number>;
    alignment?: {
      matched_fields?: string[];
      conflicted_fields?: string[];
    };
  } | null;
  similarity: number;
  classifier_similarity?: number | null;
  dinov2_similarity?: number | null;
};

export type AiClinicTextEvidenceRecord = {
  case_id: string;
  patient_id: string;
  visit_date: string;
  culture_category: string;
  culture_species: string;
  local_case_code?: string;
  chart_alias?: string;
  text: string;
  similarity: number;
};

export type AiClinicWorkflowRecommendation = {
  mode: string;
  provider_label?: string | null;
  model?: string | null;
  generated_at?: string | null;
  summary: string;
  recommended_steps: string[];
  flags_to_review: string[];
  rationale: string;
  uncertainty: string;
  disclaimer: string;
  llm_error?: string | null;
};

export type AiClinicDifferentialItem = {
  label: string;
  score: number;
  confidence_band: string;
  component_scores: {
    classifier: number;
    retrieval: number;
    text: number;
    metadata: number;
    quality_penalty: number;
  };
  supporting_evidence: string[];
  conflicting_evidence: string[];
};

export type AiClinicDifferential = {
  engine: string;
  generated_at?: string | null;
  overall_uncertainty: string;
  top_label?: string | null;
  differential: AiClinicDifferentialItem[];
};

export type AiClinicResponse = {
  analysis_stage?: "similar_cases" | "expanded" | null;
  query_case: {
    patient_id: string;
    visit_date: string;
    case_id: string;
    sex?: string | null;
    age?: number | null;
    representative_view?: string | null;
    visit_status?: string | null;
    active_stage?: boolean | null;
    is_initial_visit?: boolean | null;
    contact_lens_use?: string | null;
    predisposing_factor?: string[];
    smear_result?: string | null;
    polymicrobial?: boolean | null;
    image_count?: number | null;
    quality_score?: number | null;
    view_score?: number | null;
  };
  model_version: {
    version_id?: string | null;
    version_name?: string | null;
    architecture?: string | null;
    crop_mode?: string | null;
  };
  ai_clinic_profile?: {
    profile_id: string;
    label: string;
    description: string;
    effective_retrieval_backend?: string | null;
    workflow_guidance_provider?: string | null;
  } | null;
  technical_details?: {
    similar_case_engine?: {
      mode?: string | null;
      vector_index_mode?: string | null;
      backends_used?: string[];
      metadata_reranking?: string | null;
      warning?: string | null;
    } | null;
    narrative_evidence_engine?: {
      mode?: string | null;
      model?: string | null;
      error?: string | null;
    } | null;
    workflow_guidance_engine?: {
      mode?: string | null;
      provider_label?: string | null;
      model?: string | null;
      llm_error?: string | null;
    } | null;
  } | null;
  execution_device: string;
  retrieval_mode: string;
  vector_index_mode?: string | null;
  metadata_reranking?: string | null;
  retrieval_backends_used?: string[];
  retrieval_warning?: string | null;
  top_k: number;
  eligible_candidate_count: number;
  similar_cases: AiClinicSimilarCaseRecord[];
  text_retrieval_mode?: string | null;
  text_embedding_model?: string | null;
  eligible_text_count?: number;
  text_evidence: AiClinicTextEvidenceRecord[];
  text_retrieval_error?: string | null;
  classification_context?: {
    validation_id?: string | null;
    run_date?: string | null;
    model_version_id?: string | null;
    model_version?: string | null;
    predicted_label?: string | null;
    true_label?: string | null;
    prediction_probability?: number | null;
    is_correct?: boolean | null;
  } | null;
  differential?: AiClinicDifferential | null;
  workflow_recommendation?: AiClinicWorkflowRecommendation | null;
};

export type ContributionStats = {
  total_contributions: number;
  user_contributions: number;
  user_contribution_pct: number;
  current_model_version: string;
  user_public_alias?: string | null;
  user_rank?: number | null;
  leaderboard?: ContributionLeaderboard | null;
};

export type ContributionLeaderboardEntry = {
  rank: number;
  user_id: string;
  public_alias: string;
  contribution_count: number;
  last_contribution_at?: string | null;
  is_current_user?: boolean;
};

export type ContributionLeaderboard = {
  scope: "global" | "site";
  site_id?: string | null;
  leaderboard: ContributionLeaderboardEntry[];
  current_user?: ContributionLeaderboardEntry | null;
};

export type CaseContributionResponse = {
  update: {
    update_id: string;
    contribution_group_id?: string | null;
    site_id: string;
    base_model_version_id: string;
    architecture: string;
    upload_type: string;
    execution_device: string;
    artifact_path?: string | null;
    central_artifact_key?: string | null;
    artifact_download_url?: string | null;
    artifact_distribution_status?: string | null;
    n_cases: number;
    contributed_by: string;
    case_reference_id?: string | null;
    created_at: string;
    training_input_policy: string;
    training_summary: Record<string, unknown>;
    status: string;
  };
  updates: Array<{
    update_id: string;
    contribution_group_id?: string | null;
    site_id: string;
    base_model_version_id: string;
    architecture: string;
    upload_type: string;
    execution_device: string;
    artifact_path?: string | null;
    central_artifact_key?: string | null;
    artifact_download_url?: string | null;
    artifact_distribution_status?: string | null;
    n_cases: number;
    contributed_by: string;
    case_reference_id?: string | null;
    created_at: string;
    training_input_policy: string;
    training_summary: Record<string, unknown>;
    status: string;
    crop_mode?: string | null;
  }>;
  update_count: number;
  contribution_group_id?: string | null;
  visit_status: string;
  execution_device: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
  };
  model_versions: Array<{
    version_id: string;
    version_name: string;
    architecture: string;
    crop_mode?: string | null;
    ensemble_mode?: string | null;
  }>;
  failures?: Array<{
    model_version_id?: string | null;
    version_name?: string | null;
    architecture?: string | null;
    error: string;
  }>;
  stats: ContributionStats;
};

export type CaseResearchRegistryResponse = {
  patient_id: string;
  visit_date: string;
  research_registry_status: "analysis_only" | "candidate" | "included" | "excluded";
  research_registry_updated_at?: string | null;
  research_registry_updated_by?: string | null;
  research_registry_source?: string | null;
};

export type ResearchRegistrySettingsResponse = {
  site_id: string;
  research_registry_enabled: boolean;
  user_enrolled?: boolean;
  user_enrolled_at?: string | null;
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

export type LiveLesionPreviewJobResponse = {
  job_id: string;
  site_id: string;
  image_id: string;
  patient_id: string;
  visit_date: string;
  status: "running" | "done" | "failed";
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  prompt_signature?: string | null;
  backend?: string | null;
  has_lesion_crop?: boolean;
  has_lesion_mask?: boolean;
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
  prediction_snapshot?: PredictionPostMortemSnapshot | null;
  post_mortem?: PredictionPostMortem | null;
};

export type CaseHistoryContributionRecord = {
  contribution_id: string;
  contribution_group_id?: string | null;
  created_at: string;
  user_id: string;
  public_alias?: string | null;
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
  contribution_group_id?: string | null;
  created_at: string;
  user_id: string;
  public_alias?: string | null;
  case_reference_id?: string | null;
  update_id: string;
  update_status: string | null;
  upload_type: string | null;
};

export type SiteActivityResponse = {
  pending_updates: number;
  recent_validations: SiteActivityValidationRecord[];
  recent_contributions: SiteActivityContributionRecord[];
  contribution_leaderboard?: ContributionLeaderboard | null;
};

export type RocCurveRecord = {
  fpr?: number[] | null;
  tpr?: number[] | null;
  thresholds?: Array<number | null> | null;
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
  roc_curve?: RocCurveRecord | null;
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

export type SiteValidationJobResponse = {
  site_id: string;
  execution_device: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
  };
  job: SiteJobRecord;
};

export type AdminOverviewResponse = {
  site_count: number;
  model_version_count: number;
  pending_access_requests: number;
  auto_approved_access_requests?: number;
  pending_model_updates: number;
  current_model_version?: string | null;
  aggregation_count?: number;
  federation_setup?: {
    control_plane_split_enabled: boolean;
    control_plane_backend: string;
    data_plane_backend: string;
    control_plane_artifact_dir: string;
    uses_default_control_plane_artifact_dir: boolean;
    model_distribution_mode: string;
    onedrive_auto_publish_enabled?: boolean;
    onedrive_root_path?: string;
    onedrive_missing_settings?: string[];
  };
};

export type ModelVersionRecord = {
  version_id: string;
  version_name: string;
  architecture: string;
  stage?: string | null;
  created_at?: string | null;
  ready?: boolean;
  is_current?: boolean;
  publish_required?: boolean;
  distribution_status?: string | null;
  download_url?: string | null;
  source_provider?: string | null;
  filename?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  notes?: string;
  notes_ko?: string;
  notes_en?: string;
  model_path?: string;
  aggregation_id?: string | null;
  base_version_id?: string | null;
  requires_medsam_crop?: boolean;
  training_input_policy?: string;
  crop_mode?: "automated" | "manual" | "both" | "paired";
  case_aggregation?: string | null;
  bag_level?: boolean | null;
  ensemble_mode?: string | null;
  component_model_version_ids?: string[];
  ensemble_weights?: Record<string, number> | null;
  decision_threshold?: number | null;
  threshold_selection_metric?: string | null;
  threshold_selection_metrics?: Record<string, unknown> | null;
};

export type ModelUpdateRecord = {
  update_id: string;
  contribution_group_id?: string | null;
  site_id?: string | null;
  base_model_version_id?: string | null;
  architecture?: string | null;
  upload_type?: string | null;
  execution_device?: string | null;
  artifact_path?: string | null;
  central_artifact_key?: string | null;
  central_artifact_path?: string | null;
  central_artifact_name?: string | null;
  central_artifact_size_bytes?: number | null;
  central_artifact_sha256?: string | null;
  artifact_download_url?: string | null;
  artifact_distribution_status?: string | null;
  artifact_source_provider?: string | null;
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

export type InitialTrainingPredictionRecord = {
  sample_key: string;
  sample_kind: "image" | "visit" | string;
  patient_id: string;
  visit_date: string;
  true_label: string;
  true_label_index: number;
  predicted_label: string;
  predicted_label_index: number;
  positive_probability: number;
  is_correct: boolean;
  source_image_path?: string | null;
  prepared_image_path?: string | null;
  cornea_image_path?: string | null;
  lesion_image_path?: string | null;
  source_image_paths?: string[];
  prepared_image_paths?: string[];
  view?: string | null;
  views?: string[];
};

export type InitialTrainingCalibrationRecord = {
  n_bins?: number | null;
  bins?: Array<{
    bin_start?: number | null;
    bin_end?: number | null;
    count?: number | null;
    mean_confidence?: number | null;
    positive_rate?: number | null;
  }> | null;
};

export type InitialTrainingMetricsRecord = {
  AUROC?: number | null;
  accuracy?: number | null;
  sensitivity?: number | null;
  specificity?: number | null;
  balanced_accuracy?: number | null;
  F1?: number | null;
  brier_score?: number | null;
  ece?: number | null;
  decision_threshold?: number | null;
  n_samples?: number | null;
  confusion_matrix?: ConfusionMatrixRecord | null;
  roc_curve?: RocCurveRecord | null;
  calibration?: InitialTrainingCalibrationRecord | null;
  [key: string]: unknown;
};

export type InitialTrainingResult = {
  training_id: string;
  version_name: string;
  output_model_path: string;
  n_train: number;
  n_val: number;
  n_test: number;
  n_train_cases?: number;
  n_val_cases?: number;
  n_test_cases?: number;
  n_train_patients: number;
  n_val_patients: number;
  n_test_patients: number;
  best_val_acc: number;
  use_pretrained: boolean;
  patient_split?: Record<string, unknown>;
  history?: Array<Record<string, unknown>>;
  val_metrics?: InitialTrainingMetricsRecord | null;
  test_metrics?: InitialTrainingMetricsRecord | null;
  val_predictions?: InitialTrainingPredictionRecord[] | null;
  test_predictions?: InitialTrainingPredictionRecord[] | null;
  model_version?: ModelVersionRecord;
  crop_mode?: "automated" | "manual" | "both" | "paired";
  case_aggregation?: string | null;
  bag_level?: boolean | null;
  backbone_frozen?: boolean | null;
  component_results?: Array<Record<string, unknown>>;
  model_versions?: ModelVersionRecord[];
};

export type InitialTrainingResponse = {
  site_id: string;
  execution_device: string;
  result: InitialTrainingResult;
  model_version?: ModelVersionRecord;
};

export type InitialTrainingBenchmarkEntry = {
  architecture: string;
  status: string;
  result?: InitialTrainingResult | null;
  model_version?: ModelVersionRecord | null;
  error?: string | null;
};

export type InitialTrainingBenchmarkResponse = {
  site_id: string;
  execution_device: string;
  architectures: string[];
  results: InitialTrainingBenchmarkEntry[];
  failures: Array<{
    architecture: string;
    status: string;
    error: string;
  }>;
  best_architecture?: string | null;
  best_model_version?: ModelVersionRecord | null;
  completed_architectures?: string[] | null;
  remaining_architectures?: string[] | null;
};

export type TrainingJobProgress = {
  stage?: string | null;
  message?: string | null;
  percent?: number | null;
  architecture?: string | null;
  init_mode?: string | null;
  method?: string | null;
  archive_base_dir?: string | null;
  run_id?: string | null;
  architecture_index?: number | null;
  architecture_count?: number | null;
  crop_mode?: "automated" | "manual" | "both" | string | null;
  case_aggregation?: string | null;
  component_crop_mode?: "automated" | "manual" | string | null;
  component_index?: number | null;
  component_count?: number | null;
  fold_index?: number | null;
  num_folds?: number | null;
  epoch?: number | null;
  epochs?: number | null;
  current_step_in_epoch?: number | null;
  steps_per_epoch?: number | null;
  global_step?: number | null;
  train_loss?: number | null;
  val_acc?: number | null;
  last_loss?: number | null;
  batch_size?: number | null;
  learning_rate?: number | null;
  records_count?: number | null;
  manifest_total_images?: number | null;
  manifest_clean_images?: number | null;
  manifest_anomaly_images?: number | null;
  clean_manifest_path?: string | null;
  anomaly_manifest_path?: string | null;
  manifest_summary_path?: string | null;
  output_dir?: string | null;
  checkpoint_path?: string | null;
  encoder_latest_path?: string | null;
  summary_path?: string | null;
  completed_architectures?: string[] | null;
  remaining_architectures?: string[] | null;
  failed_architectures?: string[] | null;
};

export type SslPretrainingManifestRecord = {
  base_dir?: string | null;
  generated_at?: string | null;
  total_supported_images?: number | null;
  clean_images?: number | null;
  anomaly_images?: number | null;
  extension_counts?: Record<string, number> | null;
  patient_quality_counts?: Record<string, number> | null;
  anomaly_reason_counts?: Record<string, number> | null;
  capture_year_counts?: Record<string, number> | null;
  clean_manifest_path?: string | null;
  anomaly_manifest_path?: string | null;
  summary_path?: string | null;
};

export type SslPretrainingTrainingSummary = {
  status: string;
  config: Record<string, unknown>;
  device: string;
  records_count: number;
  history: Array<Record<string, unknown>>;
  checkpoint_path: string;
  encoder_latest_path: string;
  log_path: string;
  summary_path: string;
};

export type SslPretrainingResponse = {
  site_id: string;
  execution_device: string;
  run: {
    run_id: string;
    archive_base_dir: string;
    manifest: SslPretrainingManifestRecord;
    training: SslPretrainingTrainingSummary;
  };
};

export type SiteJobRecord = {
  job_id: string;
  job_type: string;
  site_id?: string;
  queue_name?: string;
  priority?: number;
  status: string;
  payload: Record<string, unknown>;
  attempt_count?: number;
  max_attempts?: number;
  claimed_by?: string | null;
  claimed_at?: string | null;
  heartbeat_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  result?: {
    progress?: TrainingJobProgress | null;
    response?:
      | InitialTrainingResponse
      | InitialTrainingBenchmarkResponse
      | CrossValidationRunResponse
      | SiteValidationRunResponse
      | SslPretrainingResponse
      | null;
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

export type InitialTrainingBenchmarkJobResponse = {
  site_id: string;
  execution_device: string;
  job: SiteJobRecord;
};

export type CrossValidationJobResponse = {
  site_id: string;
  execution_device: string;
  job: SiteJobRecord;
};

export type SslPretrainingJobResponse = {
  site_id: string;
  execution_device: string;
  job: SiteJobRecord;
};

export type EmbeddingBackfillJobResponse = {
  site_id: string;
  execution_device: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture?: string | null;
  };
  job: SiteJobRecord;
};

export type AiClinicEmbeddingStatusResponse = {
  site_id: string;
  model_version: {
    version_id: string;
    version_name: string;
    architecture: string;
  };
  total_cases: number;
  total_images: number;
  missing_case_count: number;
  missing_image_count: number;
  needs_backfill: boolean;
  vector_index: {
    classifier_available: boolean;
    dinov2_embedding_available: boolean;
    dinov2_index_available: boolean;
  };
  active_job: SiteJobRecord | null;
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
  root_cause_tags?: string[];
  action_tags?: string[];
  learning_signal?: string | null;
  representative_image_id?: string | null;
  representative_view?: string | null;
};

export type AuthResponse = {
  auth_state: AuthState;
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

export type MainBootstrapResponse = AuthResponse & {
  sites: SiteRecord[];
  my_access_requests: AccessRequestRecord[];
};

export type PublicStatistics = {
  site_count: number;
  total_cases: number;
  total_images: number;
  current_model_version: string | null;
  last_updated: string;
};
