import { request } from "./api-core";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiJson } from "./desktop-local-api";
import { requestMainControlPlane } from "./main-control-plane-client";
import type {
  AccessRequestRecord,
  AdminOverviewResponse,
  AdminWorkspaceBootstrapResponse,
  AggregationRecord,
  DesktopReleaseRecord,
  AggregationRunResponse,
  FederationMonitoringSummaryResponse,
  InstitutionDirectorySyncResponse,
  ManagedSiteRecord,
  ManagedUserRecord,
  ModelUpdateRecord,
  ModelVersionRecord,
  ProjectRecord,
  RetainedCaseArchiveRecord,
  RetainedCaseRestoreResponse,
  ReleaseRolloutRecord,
  ResearchRegistrySettingsResponse,
  SiteComparisonRecord,
  SiteMetadataRecoveryResponse,
  StorageSettingsRecord,
} from "./types";
import { filterVisibleSites } from "./site-labels";

const LOCAL_CONTROL_PLANE_OWNER = "local" as const;

type DesktopAdminJsonOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

function requestDesktopLocalAdminJson<T>(
  path: string,
  token: string,
  options: DesktopAdminJsonOptions = {},
) {
  return requestDesktopLocalApiJson<T>(path, token, {
    ...options,
    controlPlaneOwner: LOCAL_CONTROL_PLANE_OWNER,
  });
}

function emptyInstitutionDirectoryStatus(): InstitutionDirectorySyncResponse {
  return {
    source: "hira",
    institutions_synced: 0,
    total_count: 0,
    synced_at: null,
  };
}

export async function fetchAccessRequests(token: string, statusFilter = "pending") {
  const suffix = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : "";
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<AccessRequestRecord[]>(`/api/admin/access-requests${suffix}`, token);
  }
  return requestMainControlPlane<AccessRequestRecord[]>(`/admin/access-requests${suffix}`, {}, token);
}

export async function fetchAdminOverview(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<AdminOverviewResponse>("/api/admin/overview", token);
  }
  return requestMainControlPlane<AdminOverviewResponse>("/admin/overview", {}, token);
}

export async function fetchAdminDesktopReleases(token: string) {
  return requestMainControlPlane<DesktopReleaseRecord[]>("/admin/desktop-releases", {}, token);
}

export async function saveAdminDesktopRelease(
  token: string,
  payload: {
    release_id?: string;
    channel?: string;
    label?: string;
    version?: string;
    platform?: string;
    installer_type?: string;
    download_url?: string;
    folder_url?: string | null;
    sha256?: string | null;
    size_bytes?: number | null;
    notes?: string | null;
    active?: boolean;
  },
) {
  return requestMainControlPlane<DesktopReleaseRecord>(
    "/admin/desktop-releases",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function activateAdminDesktopRelease(token: string, releaseId: string) {
  return requestMainControlPlane<DesktopReleaseRecord>(
    `/admin/desktop-releases/${encodeURIComponent(releaseId)}/activate`,
    {
      method: "POST",
    },
    token,
  );
}

export async function fetchAdminWorkspaceBootstrap(
  token: string,
  options: {
    site_id?: string;
    scope?: "full" | "initial";
  } = {},
) {
  const params = new URLSearchParams();
  if (options.site_id) {
    params.set("site_id", options.site_id);
  }
  if (options.scope && options.scope !== "full") {
    params.set("scope", options.scope);
  }
  if (!canUseDesktopLocalApiTransport()) {
    const suffix = params.size ? `?${params.toString()}` : "";
    return requestMainControlPlane<AdminWorkspaceBootstrapResponse>(`/admin/workspace-bootstrap${suffix}`, {}, token);
  }
  const scope = options.scope === "initial" ? "initial" : "full";
  if (scope === "initial") {
    const [overview, projects, managedSites] = await Promise.all([
      fetchAdminOverview(token),
      fetchProjects(token),
      fetchAdminSites(token),
    ]);
    return {
      overview,
      pending_requests: [],
      approved_requests: [],
      model_versions: [],
      model_updates: [],
      aggregations: [],
      projects,
      managed_sites: managedSites,
      managed_users: [],
      institution_sync_status: emptyInstitutionDirectoryStatus(),
    };
  }
  const [
    overview,
    pendingRequests,
    approvedRequests,
    modelVersions,
    modelUpdates,
    aggregations,
    projects,
    managedSites,
    managedUsers,
    institutionSyncStatus,
  ] = await Promise.all([
    fetchAdminOverview(token),
    fetchAccessRequests(token, "pending"),
    fetchAccessRequests(token, "approved"),
    fetchModelVersions(token),
    fetchModelUpdates(token, { site_id: options.site_id }),
    fetchAggregations(token).catch(() => []),
    fetchProjects(token),
    fetchAdminSites(token),
    fetchUsers(token).catch(() => []),
    fetchInstitutionDirectoryStatus(token).catch(() => emptyInstitutionDirectoryStatus()),
  ]);
  return {
    overview,
    pending_requests: pendingRequests,
    approved_requests: approvedRequests,
    model_versions: modelVersions,
    model_updates: modelUpdates,
    aggregations,
    projects,
    managed_sites: managedSites,
    managed_users: managedUsers,
    institution_sync_status: institutionSyncStatus,
  };
}

export async function fetchInstitutionDirectoryStatus(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<InstitutionDirectorySyncResponse>("/api/admin/institutions/status", token);
  }
  return requestMainControlPlane<InstitutionDirectorySyncResponse>("/admin/institutions/status", {}, token);
}

export async function syncInstitutionDirectory(
  token: string,
  payload: {
    page_size?: number;
    max_pages?: number;
  } = {},
) {
  const params = new URLSearchParams();
  if (typeof payload.page_size === "number") {
    params.set("page_size", String(payload.page_size));
  }
  if (typeof payload.max_pages === "number") {
    params.set("max_pages", String(payload.max_pages));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<InstitutionDirectorySyncResponse>(`/api/admin/institutions/sync${suffix}`, token, {
      method: "POST",
    });
  }
  return requestMainControlPlane<InstitutionDirectorySyncResponse>(`/admin/institutions/sync${suffix}`, { method: "POST" }, token);
}

export async function fetchStorageSettings(token: string, siteId?: string | null) {
  const params = new URLSearchParams();
  if (siteId) {
    params.set("site_id", siteId);
  }
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<StorageSettingsRecord>("/api/admin/storage-settings", token, {
      query: params,
    });
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<StorageSettingsRecord>(`/api/admin/storage-settings${suffix}`, {}, token);
}

export async function updateStorageSettings(
  token: string,
  payload: { storage_root: string },
  siteId?: string | null,
) {
  const params = new URLSearchParams();
  if (siteId) {
    params.set("site_id", siteId);
  }
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<StorageSettingsRecord>("/api/admin/storage-settings", token, {
      method: "PATCH",
      query: params,
      body: payload,
    });
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<StorageSettingsRecord>(
    `/api/admin/storage-settings${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchProjects(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ProjectRecord[]>("/api/admin/projects", token);
  }
  return requestMainControlPlane<ProjectRecord[]>("/admin/projects", {}, token);
}

export async function createProject(token: string, payload: { name: string; description?: string }) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ProjectRecord>(
      "/api/admin/projects",
      token,
      {
        method: "POST",
        body: {
          description: "",
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<ProjectRecord>(
    "/admin/projects",
    {
      method: "POST",
      body: JSON.stringify({
        description: "",
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchAdminSites(token: string, projectId?: string) {
  const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  if (canUseDesktopLocalApiTransport()) {
    return filterVisibleSites(
      await requestDesktopLocalAdminJson<ManagedSiteRecord[]>(`/api/admin/sites${suffix}`, token),
    );
  }
  return filterVisibleSites(await requestMainControlPlane<ManagedSiteRecord[]>(`/admin/sites${suffix}`, {}, token));
}

export async function createAdminSite(
  token: string,
  payload: {
    project_id: string;
    hospital_name?: string;
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ManagedSiteRecord>(
      "/api/admin/sites",
      token,
      {
        method: "POST",
        body: {
          hospital_name: "",
          research_registry_enabled: true,
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<ManagedSiteRecord>(
    "/admin/sites",
    {
      method: "POST",
      body: JSON.stringify({
        hospital_name: "",
        research_registry_enabled: true,
        ...payload,
      }),
    },
    token,
  );
}

export async function updateAdminSite(
  siteId: string,
  token: string,
  payload: {
    hospital_name?: string;
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ManagedSiteRecord>(
      `/api/admin/sites/${siteId}`,
      token,
      {
        method: "PATCH",
        body: {
          hospital_name: "",
          research_registry_enabled: true,
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<ManagedSiteRecord>(
    `/admin/sites/${siteId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        hospital_name: "",
        research_registry_enabled: true,
        ...payload,
      }),
    },
    token,
  );
}

export async function updateAdminSiteStorageRoot(siteId: string, token: string, payload: { storage_root: string }) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ManagedSiteRecord>(`/api/admin/sites/${siteId}/storage-root`, token, {
      method: "PATCH",
      body: payload,
    });
  }
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}/storage-root`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function migrateAdminSiteStorageRoot(siteId: string, token: string, payload: { storage_root: string }) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ManagedSiteRecord>(`/api/admin/sites/${siteId}/storage-root/migrate`, token, {
      method: "POST",
      body: payload,
    });
  }
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}/storage-root/migrate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function recoverAdminSiteMetadata(
  siteId: string,
  token: string,
  payload: {
    source?: "auto" | "backup" | "manifest";
    force_replace?: boolean;
    backup_path?: string | null;
  } = {},
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<SiteMetadataRecoveryResponse>(`/api/admin/sites/${siteId}/metadata/recover`, token, {
      method: "POST",
      body: {
        source: "auto",
        force_replace: true,
        ...payload,
      },
    });
  }
  return request<SiteMetadataRecoveryResponse>(
    `/api/admin/sites/${siteId}/metadata/recover`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "auto",
        force_replace: true,
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchRetainedCaseArchive(siteId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<RetainedCaseArchiveRecord[]>(`/api/admin/sites/${siteId}/retained-cases`, token);
  }
  return request<RetainedCaseArchiveRecord[]>(`/api/admin/sites/${siteId}/retained-cases`, {}, token);
}

export async function restoreRetainedCase(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    mode?: "visit" | "images";
  },
) {
  const body = {
    mode: "visit" as const,
    ...payload,
  };
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<RetainedCaseRestoreResponse>(`/api/admin/sites/${siteId}/retained-cases/restore`, token, {
      method: "POST",
      body,
    });
  }
  return request<RetainedCaseRestoreResponse>(
    `/api/admin/sites/${siteId}/retained-cases/restore`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function updateResearchRegistrySettings(
  siteId: string,
  token: string,
  payload: { research_registry_enabled: boolean },
) {
  const site = await requestMainControlPlane<ManagedSiteRecord>(
    `/admin/sites/${siteId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
  return {
    site_id: site.site_id,
    research_registry_enabled: Boolean(site.research_registry_enabled),
  } satisfies ResearchRegistrySettingsResponse;
}

export async function fetchUsers(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ManagedUserRecord[]>("/api/admin/users", token);
  }
  return requestMainControlPlane<ManagedUserRecord[]>("/admin/users", {}, token);
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
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ManagedUserRecord>(
      "/api/admin/users",
      token,
      {
        method: "POST",
        body: {
          full_name: "",
          password: "",
          site_ids: [],
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<ManagedUserRecord>(
    "/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        full_name: "",
        password: "",
        site_ids: [],
        ...payload,
      }),
    },
    token,
  );
}

export async function deleteManagedUser(userId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ deleted: boolean; user_id: string }>(
      `/api/admin/users/${userId}`,
      token,
      { method: "DELETE" },
    );
  }
  return requestMainControlPlane<{ deleted: boolean; user_id: string }>(
    `/admin/users/${userId}`,
    { method: "DELETE" },
    token,
  );
}

export async function reviewAccessRequest(
  requestId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    create_site_if_missing?: boolean;
    project_id?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
    reviewer_notes?: string;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ request: AccessRequestRecord; created_site?: ManagedSiteRecord | null }>(
      `/api/admin/access-requests/${requestId}/review`,
      token,
      {
        method: "POST",
        body: payload,
      },
    );
  }
  return requestMainControlPlane<{ request: AccessRequestRecord; created_site?: ManagedSiteRecord | null }>(
    `/admin/access-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchModelVersions(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ModelVersionRecord[]>("/api/admin/model-versions", token);
  }
  return requestMainControlPlane<ModelVersionRecord[]>("/admin/model-versions", {}, token);
}

export async function deleteModelVersion(versionId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ model_version: ModelVersionRecord }>(`/api/admin/model-versions/${versionId}`, token, {
      method: "DELETE",
    });
  }
  return requestMainControlPlane<{ model_version: ModelVersionRecord }>(
    `/admin/model-versions/${versionId}`,
    { method: "DELETE" },
    token,
  );
}

export async function activateLocalModelVersion(versionId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ model_version: ModelVersionRecord }>(
      `/api/admin/model-versions/${versionId}/activate-local`,
      token,
      {
        method: "POST",
      },
    );
  }
  return requestMainControlPlane<{ model_version: ModelVersionRecord }>(
    `/admin/model-versions/${versionId}/activate-local`,
    { method: "POST" },
    token,
  );
}

export async function publishModelVersion(
  versionId: string,
  token: string,
  payload: {
    download_url: string;
    set_current?: boolean;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ model_version: ModelVersionRecord }>(
      `/api/admin/model-versions/${versionId}/publish`,
      token,
      {
        method: "POST",
        body: {
          set_current: false,
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<{ model_version: ModelVersionRecord }>(
    `/admin/model-versions/${versionId}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        set_current: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function autoPublishModelVersion(
  versionId: string,
  token: string,
  payload: {
    set_current?: boolean;
  } = {},
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ model_version: ModelVersionRecord }>(
      `/api/admin/model-versions/${versionId}/auto-publish`,
      token,
      {
        method: "POST",
        body: {
          set_current: false,
          ...payload,
        },
      },
    );
  }
  return requestMainControlPlane<{ model_version: ModelVersionRecord }>(
    `/admin/model-versions/${versionId}/auto-publish`,
    {
      method: "POST",
      body: JSON.stringify({
        set_current: false,
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchModelUpdates(
  token: string,
  options: {
    site_id?: string;
    status_filter?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.site_id) {
    params.set("site_id", options.site_id);
  }
  if (options.status_filter) {
    params.set("status_filter", options.status_filter);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ModelUpdateRecord[]>("/api/admin/model-updates", token, {
      query: params,
    });
  }
  return requestMainControlPlane<ModelUpdateRecord[]>(`/admin/model-updates${suffix}`, {}, token);
}

export async function reviewModelUpdate(
  updateId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    reviewer_notes?: string;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ update: ModelUpdateRecord }>(`/api/admin/model-updates/${updateId}/review`, token, {
      method: "POST",
      body: payload,
    });
  }
  return requestMainControlPlane<{ update: ModelUpdateRecord }>(
    `/admin/model-updates/${updateId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function publishModelUpdate(
  updateId: string,
  token: string,
  payload: {
    download_url: string;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ update: ModelUpdateRecord }>(`/api/admin/model-updates/${updateId}/publish`, token, {
      method: "POST",
      body: payload,
    });
  }
  return requestMainControlPlane<{ update: ModelUpdateRecord }>(
    `/admin/model-updates/${updateId}/publish`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function autoPublishModelUpdate(updateId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ update: ModelUpdateRecord }>(`/api/admin/model-updates/${updateId}/auto-publish`, token, {
      method: "POST",
      body: {},
    });
  }
  return requestMainControlPlane<{ update: ModelUpdateRecord }>(
    `/admin/model-updates/${updateId}/auto-publish`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    token,
  );
}

export async function fetchAggregations(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<AggregationRecord[]>("/api/admin/aggregations", token);
  }
  return requestMainControlPlane<AggregationRecord[]>("/admin/aggregations", {}, token);
}

export async function fetchReleaseRollouts(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<ReleaseRolloutRecord[]>("/api/admin/release-rollouts", token);
  }
  return requestMainControlPlane<ReleaseRolloutRecord[]>("/admin/release-rollouts", {}, token);
}

export async function createReleaseRollout(
  token: string,
  payload: {
    version_id: string;
    stage: "pilot" | "partial" | "full" | "rollback";
    target_site_ids?: string[];
    notes?: string;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<{ rollout: ReleaseRolloutRecord }>("/api/admin/release-rollouts", token, {
      method: "POST",
      body: {
        target_site_ids: [],
        notes: "",
        ...payload,
      },
    });
  }
  return requestMainControlPlane<{ rollout: ReleaseRolloutRecord }>(
    "/admin/release-rollouts",
    {
      method: "POST",
      body: JSON.stringify({
        target_site_ids: [],
        notes: "",
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchFederationMonitoring(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<FederationMonitoringSummaryResponse>("/api/admin/federation/monitoring", token);
  }
  return requestMainControlPlane<FederationMonitoringSummaryResponse>("/admin/federation/monitoring", {}, token);
}

export async function fetchSiteComparison(token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<SiteComparisonRecord[]>("/api/admin/site-comparison", token);
  }
  return request<SiteComparisonRecord[]>("/api/admin/site-comparison", {}, token);
}

export async function runFederatedAggregation(
  token: string,
  payload: {
    update_ids?: string[];
    new_version_name?: string;
  } = {},
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalAdminJson<AggregationRunResponse>("/api/admin/aggregations/run", token, {
      method: "POST",
      body: {
        update_ids: [],
        ...payload,
      },
    });
  }
  return requestMainControlPlane<AggregationRunResponse>(
    "/admin/aggregations/run",
    {
      method: "POST",
      body: JSON.stringify({
        update_ids: [],
        ...payload,
      }),
    },
    token,
  );
}
