import { request } from "./api-core";
import { requestMainControlPlane } from "./main-control-plane-client";
import type {
  AccessRequestRecord,
  AdminOverviewResponse,
  AggregationRecord,
  AggregationRunResponse,
  InstitutionDirectorySyncResponse,
  ManagedSiteRecord,
  ManagedUserRecord,
  ModelUpdateRecord,
  ModelVersionRecord,
  ProjectRecord,
  ResearchRegistrySettingsResponse,
  SiteComparisonRecord,
  StorageSettingsRecord,
} from "./types";

export async function fetchAccessRequests(token: string, statusFilter = "pending") {
  const suffix = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : "";
  return requestMainControlPlane<AccessRequestRecord[]>(`/admin/access-requests${suffix}`, {}, token);
}

export async function fetchAdminOverview(token: string) {
  return requestMainControlPlane<AdminOverviewResponse>("/admin/overview", {}, token);
}

export async function fetchInstitutionDirectoryStatus(token: string) {
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
  return request<InstitutionDirectorySyncResponse>(
    `/api/admin/institutions/sync${suffix}`,
    { method: "POST" },
    token,
  );
}

export async function fetchStorageSettings(token: string) {
  return request<StorageSettingsRecord>("/api/admin/storage-settings", {}, token);
}

export async function updateStorageSettings(token: string, payload: { storage_root: string }) {
  return request<StorageSettingsRecord>(
    "/api/admin/storage-settings",
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchProjects(token: string) {
  return requestMainControlPlane<ProjectRecord[]>("/admin/projects", {}, token);
}

export async function createProject(token: string, payload: { name: string; description?: string }) {
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
  return requestMainControlPlane<ManagedSiteRecord[]>(`/admin/sites${suffix}`, {}, token);
}

export async function createAdminSite(
  token: string,
  payload: {
    project_id: string;
    site_code: string;
    display_name: string;
    hospital_name?: string;
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
) {
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
    display_name: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
  },
) {
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
  return request<ManagedSiteRecord>(
    `/api/admin/sites/${siteId}/storage-root/migrate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
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

export async function reviewAccessRequest(
  requestId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    create_site_if_missing?: boolean;
    project_id?: string;
    site_code?: string;
    display_name?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
    reviewer_notes?: string;
  },
) {
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
  return requestMainControlPlane<ModelVersionRecord[]>("/admin/model-versions", {}, token);
}

export async function deleteModelVersion(versionId: string, token: string) {
  return requestMainControlPlane<{ model_version: ModelVersionRecord }>(
    `/admin/model-versions/${versionId}`,
    { method: "DELETE" },
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
  return requestMainControlPlane<AggregationRecord[]>("/admin/aggregations", {}, token);
}

export async function fetchSiteComparison(token: string) {
  return request<SiteComparisonRecord[]>("/api/admin/site-comparison", {}, token);
}

export async function runFederatedAggregation(
  token: string,
  payload: {
    update_ids?: string[];
    new_version_name?: string;
  } = {},
) {
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
