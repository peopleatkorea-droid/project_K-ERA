export type ControlPlaneGlobalRole = "admin" | "member";
export type ControlPlaneSiteRole = "site_admin" | "member" | "viewer";
export type ControlPlaneUserStatus = "active" | "disabled";
export type ControlPlaneMembershipStatus = "approved" | "pending" | "revoked";
export type ControlPlaneNodeStatus = "active" | "revoked";
export type ControlPlaneModelUpdateStatus = "pending" | "approved" | "rejected" | "aggregated";
export type ControlPlaneAggregationStatus = "queued" | "running" | "completed" | "failed";

export type ControlPlaneIdentity = {
  email: string;
  googleSub?: string | null;
  fullName: string;
};

export type ControlPlaneSite = {
  site_id: string;
  display_name: string;
  hospital_name: string;
  site_alias?: string | null;
  source_institution_id: string | null;
  source_institution_name?: string | null;
  status: string;
  created_at: string;
};

export type ControlPlaneMembership = {
  membership_id: string;
  site_id: string;
  role: ControlPlaneSiteRole;
  status: ControlPlaneMembershipStatus;
  approved_at: string | null;
  created_at: string;
  site: ControlPlaneSite | null;
};

export type ControlPlaneUser = {
  user_id: string;
  email: string;
  full_name: string;
  google_sub: string | null;
  global_role: ControlPlaneGlobalRole;
  status: ControlPlaneUserStatus;
  created_at: string;
  memberships: ControlPlaneMembership[];
};

export type ControlPlaneSession = {
  access_token: string;
  token_type: "bearer";
  user: ControlPlaneUser;
};

export type ControlPlaneNode = {
  node_id: string;
  site_id: string;
  registered_by_user_id: string;
  device_name: string;
  os_info: string;
  app_version: string;
  current_model_version_id?: string | null;
  current_model_version_name?: string | null;
  status: ControlPlaneNodeStatus;
  last_seen_at: string | null;
  created_at: string;
};

export type ControlPlaneReleaseManifest = {
  version_id: string;
  version_name: string;
  architecture: string;
  source_provider?: string;
  download_url: string;
  sha256: string;
  size_bytes: number;
  ready: boolean;
  is_current: boolean;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type ControlPlaneModelVersion = ControlPlaneReleaseManifest & {
  source_provider: string;
};

export type ControlPlaneModelUpdate = {
  update_id: string;
  site_id: string | null;
  node_id: string | null;
  base_model_version_id: string | null;
  status: ControlPlaneModelUpdateStatus;
  payload_json: Record<string, unknown>;
  review_thumbnail_url: string | null;
  reviewer_user_id: string | null;
  reviewer_notes: string;
  created_at: string;
  reviewed_at: string | null;
};

export type ControlPlaneValidationRun = {
  validation_id: string;
  site_id: string | null;
  node_id: string | null;
  model_version_id: string | null;
  run_date: string | null;
  summary_json: Record<string, unknown>;
  created_at: string;
};

export type ControlPlaneRetrievalCorpusProfile = {
  profile_id: string;
  retrieval_signature: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ControlPlaneRetrievalCorpusEntry = {
  entry_id: string;
  site_id: string | null;
  node_id: string | null;
  profile_id: string;
  retrieval_signature: string;
  case_reference_id: string;
  culture_category: string;
  culture_species: string;
  embedding_dim: number;
  thumbnail_url: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ControlPlaneRetrievalCorpusSearchHit = ControlPlaneRetrievalCorpusEntry & {
  similarity: number;
  source_site_display_name?: string | null;
  source_site_hospital_name?: string | null;
};

export type ControlPlaneOverview = {
  user_count: number;
  site_count: number;
  node_count: number;
  pending_model_updates: number;
  current_model_version: string | null;
};

export type ControlPlaneAggregation = {
  aggregation_id: string;
  base_model_version_id: string | null;
  new_version_id: string | null;
  status: ControlPlaneAggregationStatus;
  triggered_by_user_id: string | null;
  summary_json: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
};

export type ControlPlaneReleaseRolloutStage = "pilot" | "partial" | "full" | "rollback";
export type ControlPlaneReleaseRolloutStatus = "active" | "superseded";

export type ControlPlaneReleaseRollout = {
  rollout_id: string;
  version_id: string;
  version_name: string;
  architecture: string;
  previous_version_id: string | null;
  previous_version_name: string | null;
  stage: ControlPlaneReleaseRolloutStage;
  status: ControlPlaneReleaseRolloutStatus;
  target_site_ids: string[];
  notes: string;
  created_by_user_id: string | null;
  created_at: string;
  activated_at: string | null;
  superseded_at: string | null;
  metadata_json: Record<string, unknown>;
};

export type ControlPlaneAuditEvent = {
  event_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export type ControlPlaneRolloutSiteAdoption = {
  site_id: string;
  site_display_name: string;
  node_count: number;
  active_node_count: number;
  aligned_node_count: number;
  unknown_node_count: number;
  lagging_node_count: number;
  adoption_ratio: number | null;
  adoption_status: "aligned" | "lagging" | "unknown" | null;
  expected_version_id: string | null;
  expected_version_name: string | null;
  latest_reported_version_id: string | null;
  latest_reported_version_name: string | null;
  validation_alignment_status: "aligned" | "mismatch" | "unknown" | null;
  latest_validation_version_id: string | null;
  latest_validation_version_name: string | null;
  latest_validation_run_date: string | null;
  latest_validation?: {
    validation_id?: string | null;
    model_version_id?: string | null;
    model_version_name?: string | null;
    run_date?: string | null;
    n_cases?: number | null;
    n_images?: number | null;
    accuracy?: number | null;
    sensitivity?: number | null;
    specificity?: number | null;
    F1?: number | null;
    AUROC?: number | null;
  } | null;
  previous_validation?: {
    validation_id?: string | null;
    model_version_id?: string | null;
    model_version_name?: string | null;
    run_date?: string | null;
    n_cases?: number | null;
    n_images?: number | null;
    accuracy?: number | null;
    sensitivity?: number | null;
    specificity?: number | null;
    F1?: number | null;
    AUROC?: number | null;
  } | null;
  validation_delta?: {
    accuracy?: number | null;
    sensitivity?: number | null;
    specificity?: number | null;
    F1?: number | null;
    AUROC?: number | null;
  } | null;
  latest_round?: {
    update_id?: string | null;
    status?: string | null;
    created_at?: string | null;
    federated_round_type?: string | null;
    n_cases?: number | null;
    n_images?: number | null;
    aggregation_weight?: number | null;
    aggregation_weight_unit?: string | null;
    quality_score?: number | null;
    validation_consistency_score?: number | null;
    validation_consistency_status?: string | null;
    risk_flags?: string[] | null;
    outlier_detected?: boolean | null;
    outlier_reasons?: string[] | null;
    lineage?: {
      parent_model_version_id?: string | null;
      policy_version?: string | null;
      training_input_policy?: string | null;
      preprocess_signature?: string | null;
      eligible_snapshot?: {
        round_type?: string | null;
        captured_at?: string | null;
        case_count?: number | null;
        image_count?: number | null;
        case_reference_ids?: string[] | null;
        snapshot_hash?: string | null;
      } | null;
    } | null;
  } | null;
  last_seen_at: string | null;
};

export type ControlPlaneFederationMonitoringSummary = {
  current_release: ControlPlaneReleaseManifest | null;
  active_rollout: ControlPlaneReleaseRollout | null;
  recent_rollouts: ControlPlaneReleaseRollout[];
  recent_audit_events: ControlPlaneAuditEvent[];
  privacy_budget: Record<string, unknown> | null;
  node_summary: {
    total_nodes: number;
    active_nodes: number;
    aligned_nodes: number;
    lagging_nodes: number;
    unknown_nodes: number;
  };
  site_adoption: ControlPlaneRolloutSiteAdoption[];
};

export type ControlPlaneBootstrap = {
  project: {
    project_id: string;
    name: string;
  };
  user: ControlPlaneUser;
  memberships: ControlPlaneMembership[];
  site: ControlPlaneSite;
  node: ControlPlaneNode;
  current_release: ControlPlaneReleaseManifest | null;
  settings: {
    llm_relay_enabled: boolean;
  };
};
