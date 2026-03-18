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
  source_institution_id: string | null;
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
  status: ControlPlaneNodeStatus;
  last_seen_at: string | null;
  created_at: string;
};

export type ControlPlaneReleaseManifest = {
  version_id: string;
  version_name: string;
  architecture: string;
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
