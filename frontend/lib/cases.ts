import { request } from "./api-core";
import {
  fetchAnalysisCaseLesionPreview as fetchCaseLesionPreviewRuntime,
  fetchAnalysisCaseRoiPreview as fetchCaseRoiPreviewRuntime,
  fetchAnalysisLiveLesionPreviewJob as fetchLiveLesionPreviewJobRuntime,
  fetchAnalysisSemanticPromptScores as fetchImageSemanticPromptScoresRuntime,
  fetchAnalysisStoredCaseLesionPreview as fetchStoredCaseLesionPreviewRuntime,
  runAnalysisCaseContribution as runCaseContributionRuntime,
  startAnalysisLiveLesionPreview as startLiveLesionPreviewRuntime,
} from "./analysis-runtime";
import {
  createWorkspacePatient as createPatientRuntime,
  createWorkspaceVisit as createVisitRuntime,
  deleteWorkspaceVisit as deleteVisitRuntime,
  deleteWorkspaceVisitImages as deleteVisitImagesRuntime,
  fetchWorkspaceCaseHistory as fetchCaseHistoryRuntime,
  fetchWorkspaceCases as fetchCasesRuntime,
  fetchWorkspaceImages as fetchImagesRuntime,
  fetchWorkspacePatientIdLookup as fetchPatientIdLookupRuntime,
  fetchWorkspacePatientListPage as fetchPatientListPageRuntime,
  fetchWorkspacePatients as fetchPatientsRuntime,
  fetchWorkspaceSiteActivity as fetchSiteActivityRuntime,
  fetchWorkspaceVisitImagesWithPreviews as fetchVisitImagesWithPreviewsRuntime,
  fetchWorkspaceVisits as fetchVisitsRuntime,
  invalidateWorkspaceDesktopCaches as invalidateDesktopCaseWorkspaceCachesRuntime,
  prewarmWorkspacePatientListPage as prewarmPatientListPageRuntime,
  setWorkspaceRepresentativeImage as setRepresentativeImageRuntime,
  updateWorkspacePatient as updatePatientRuntime,
  updateWorkspaceVisit as updateVisitRuntime,
  uploadWorkspaceImage as uploadImageRuntime,
} from "./local-workspace-runtime";
import {
  canUseDesktopLocalApiTransport,
  requestDesktopLocalApiJson,
  requestDesktopLocalApiMultipart,
} from "./desktop-local-api";
import { persistMainAppToken, requestMainControlPlane } from "./main-control-plane-client";
import type {
  BulkImportResponse,
  CaseResearchRegistryResponse,
  CaseContributionResponse,
  CaseHistoryResponse,
  CaseSummaryRecord,
  ImageRecord,
  LesionPreviewRecord,
  LiveLesionPreviewJobResponse,
  MedsamArtifactItemsResponse,
  MedsamArtifactStatusKey,
  MedsamArtifactStatusSummary,
  OrganismRecord,
  PatientIdLookupResponse,
  PatientListPageResponse,
  PatientRecord,
  ResearchRegistrySettingsResponse,
  RoiPreviewRecord,
  SemanticPromptInputMode,
  SemanticPromptReviewResponse,
  SiteActivityResponse,
  SiteSummary,
  SiteSummaryCounts,
  VisitRecord,
} from "./types";

type FetchPatientListPageOptions = {
  mine?: boolean;
  page?: number;
  page_size?: number;
  search?: string;
  signal?: AbortSignal;
};

export async function fetchSiteSummary(siteId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<SiteSummary>(`/api/sites/${siteId}/summary`, token);
  }
  return request<SiteSummary>(`/api/sites/${siteId}/summary`, {}, token);
}

export async function fetchSiteSummaryCounts(siteId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<SiteSummaryCounts>(`/api/sites/${siteId}/summary/counts`, token);
  }
  return request<SiteSummaryCounts>(`/api/sites/${siteId}/summary/counts`, {}, token);
}

export function mergeSiteSummaryCounts(
  currentSummary: SiteSummary | null,
  counts: SiteSummaryCounts,
): SiteSummary {
  const preserveExistingDetails = currentSummary?.site_id === counts.site_id;
  return {
    site_id: counts.site_id,
    n_patients: counts.n_patients,
    n_visits: counts.n_visits,
    n_images: counts.n_images,
    n_active_visits: counts.n_active_visits,
    n_validation_runs: preserveExistingDetails ? currentSummary?.n_validation_runs ?? 0 : 0,
    latest_validation: preserveExistingDetails ? currentSummary?.latest_validation ?? null : null,
    research_registry: preserveExistingDetails ? currentSummary?.research_registry : undefined,
  };
}

export async function fetchSiteActivity(siteId: string, token: string, signal?: AbortSignal) {
  return fetchSiteActivityRuntime(siteId, token, signal);
}

export async function fetchPatients(siteId: string, token: string, options?: { mine?: boolean }) {
  return fetchPatientsRuntime(siteId, token, options);
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
  },
) {
  return createPatientRuntime(siteId, token, payload);
}

export async function updatePatient(
  siteId: string,
  token: string,
  patientId: string,
  payload: {
    sex: string;
    age: number;
    chart_alias?: string;
    local_case_code?: string;
  },
) {
  return updatePatientRuntime(siteId, token, patientId, payload);
}

export async function fetchPatientIdLookup(
  siteId: string,
  token: string,
  patientId: string,
  options: { signal?: AbortSignal } = {},
) {
  return fetchPatientIdLookupRuntime(siteId, token, patientId, options);
}

export async function fetchCases(
  siteId: string,
  token: string,
  options?: { mine?: boolean; patientId?: string; signal?: AbortSignal },
) {
  return fetchCasesRuntime(siteId, token, options);
}

export async function fetchPatientListPage(
  siteId: string,
  token: string,
  options: FetchPatientListPageOptions = {},
) {
  return fetchPatientListPageRuntime(siteId, token, options);
}

export function prewarmPatientListPage(
  siteId: string,
  token: string,
  options: FetchPatientListPageOptions = {},
) {
  prewarmPatientListPageRuntime(siteId, token, options);
}

export function invalidateDesktopCaseWorkspaceCaches() {
  invalidateDesktopCaseWorkspaceCachesRuntime();
}

export async function fetchMedsamArtifactStatus(
  siteId: string,
  token: string,
  options: {
    mine?: boolean;
    refresh?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.mine) {
    params.set("mine", "true");
  }
  if (options.refresh) {
    params.set("refresh", "true");
  }
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<MedsamArtifactStatusSummary>(
      `/api/sites/${siteId}/medsam-artifacts/status`,
      token,
      { query: params, signal: options.signal },
    );
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<MedsamArtifactStatusSummary>(`/api/sites/${siteId}/medsam-artifacts/status${suffix}`, { signal: options.signal }, token);
}

export async function fetchMedsamArtifactItems(
  siteId: string,
  token: string,
  options: {
    scope: "patient" | "visit" | "image";
    status_key: MedsamArtifactStatusKey;
    mine?: boolean;
    refresh?: boolean;
    page?: number;
    page_size?: number;
    signal?: AbortSignal;
  },
) {
  const params = new URLSearchParams({
    scope: options.scope,
    status_key: options.status_key,
  });
  if (options.mine) {
    params.set("mine", "true");
  }
  if (options.refresh) {
    params.set("refresh", "true");
  }
  if (typeof options.page === "number") {
    params.set("page", String(options.page));
  }
  if (typeof options.page_size === "number") {
    params.set("page_size", String(options.page_size));
  }
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<MedsamArtifactItemsResponse>(
      `/api/sites/${siteId}/medsam-artifacts/items`,
      token,
      { query: params, signal: options.signal },
    );
  }
  return request<MedsamArtifactItemsResponse>(
    `/api/sites/${siteId}/medsam-artifacts/items?${params.toString()}`,
    { signal: options.signal },
    token,
  );
}

export async function backfillMedsamArtifacts(
  siteId: string,
  token: string,
  options: {
    mine?: boolean;
    refresh_cache?: boolean;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.mine) {
    params.set("mine", "true");
  }
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<{ site_id: string; job: Record<string, unknown> }>(
      `/api/sites/${siteId}/medsam-artifacts/backfill`,
      token,
      {
        method: "POST",
        query: params,
        body: {
          refresh_cache: options.refresh_cache ?? true,
        },
      },
    );
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ site_id: string; job: Record<string, unknown> }>(
    `/api/sites/${siteId}/medsam-artifacts/backfill${suffix}`,
    {
      method: "POST",
      body: JSON.stringify({
        refresh_cache: options.refresh_cache ?? true,
      }),
    },
    token,
  );
}

export async function fetchVisits(siteId: string, token: string, patientId?: string) {
  return fetchVisitsRuntime(siteId, token, patientId);
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
  },
) {
  return createVisitRuntime(siteId, token, payload);
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
  },
) {
  return updateVisitRuntime(siteId, token, patientId, visitDate, payload);
}

export async function deleteVisit(siteId: string, token: string, patientId: string, visitDate: string) {
  return deleteVisitRuntime(siteId, token, patientId, visitDate);
}

export async function fetchImages(
  siteId: string,
  token: string,
  patientId?: string,
  visitDate?: string,
  signal?: AbortSignal,
) {
  return fetchImagesRuntime(siteId, token, patientId, visitDate, signal);
}

export async function fetchVisitImagesWithPreviews(
  siteId: string,
  token: string,
  patientId: string,
  visitDate: string,
  options: { signal?: AbortSignal } = {},
) {
  return fetchVisitImagesWithPreviewsRuntime(siteId, token, patientId, visitDate, options);
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
  },
) {
  return uploadImageRuntime(siteId, token, payload);
}

export async function deleteVisitImages(siteId: string, token: string, patientId: string, visitDate: string) {
  return deleteVisitImagesRuntime(siteId, token, patientId, visitDate);
}

export async function setRepresentativeImage(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    representative_image_id: string;
  },
) {
  return setRepresentativeImageRuntime(siteId, token, payload);
}

export async function runBulkImport(
  siteId: string,
  token: string,
  payload: {
    csvFile: File;
    files: File[];
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiMultipart<BulkImportResponse>(
      `/api/sites/${siteId}/import/bulk`,
      token,
      {
        files: [
          {
            fieldName: "csv_file",
            file: payload.csvFile,
            fileName: payload.csvFile.name,
            contentType: payload.csvFile.type || "text/csv",
          },
          ...payload.files.map((file) => ({
            fieldName: "files",
            file,
            fileName: file.name,
            contentType: file.type || null,
          })),
        ],
      },
    );
  }
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
    token,
  );
}

export async function fetchImageSemanticPromptScores(
  siteId: string,
  imageId: string,
  token: string,
  options: {
    top_k?: number;
    input_mode?: SemanticPromptInputMode;
  } = {},
) {
  return fetchImageSemanticPromptScoresRuntime(siteId, imageId, token, options);
}

export async function runCaseContribution(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    execution_mode?: "auto" | "cpu" | "gpu";
    model_version_id?: string;
    model_version_ids?: string[];
  },
) {
  return runCaseContributionRuntime(siteId, token, payload);
}

export async function enrollResearchRegistry(siteId: string, token: string, payload?: { version?: string }) {
  const response = await requestMainControlPlane<
    ResearchRegistrySettingsResponse & {
      access_token?: string;
    }
  >(
    `/sites/${siteId}/research-registry/consent`,
    {
      method: "POST",
      body: JSON.stringify({
        version: "v1",
        ...payload,
      }),
    },
    token,
  );
  persistMainAppToken(response.access_token);
  return response;
}

export async function updateCaseResearchRegistry(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    action: "include" | "exclude";
    source?: string;
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<CaseResearchRegistryResponse>(
      `/api/sites/${siteId}/cases/research-registry`,
      token,
      {
        method: "POST",
        body: {
          source: "manual",
          ...payload,
        },
      },
    );
  }
  return request<CaseResearchRegistryResponse>(
    `/api/sites/${siteId}/cases/research-registry`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "manual",
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchCaseRoiPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  return fetchCaseRoiPreviewRuntime(siteId, patientId, visitDate, token);
}

export async function fetchCaseLesionPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  return fetchCaseLesionPreviewRuntime(siteId, patientId, visitDate, token);
}

export async function fetchStoredCaseLesionPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  return fetchStoredCaseLesionPreviewRuntime(siteId, patientId, visitDate, token);
}

export async function startLiveLesionPreview(siteId: string, imageId: string, token: string) {
  return startLiveLesionPreviewRuntime(siteId, imageId, token);
}

export async function fetchLiveLesionPreviewJob(siteId: string, imageId: string, jobId: string, token: string) {
  return fetchLiveLesionPreviewJobRuntime(siteId, imageId, jobId, token);
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
  },
) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ImageRecord>(
      `/api/sites/${siteId}/images/${imageId}/lesion-box`,
      token,
      {
        method: "PATCH",
        body: payload,
      },
    );
  }
  return request<ImageRecord>(
    `/api/sites/${siteId}/images/${imageId}/lesion-box`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function clearImageLesionBox(siteId: string, imageId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ImageRecord>(
      `/api/sites/${siteId}/images/${imageId}/lesion-box`,
      token,
      {
        method: "DELETE",
      },
    );
  }
  return request<ImageRecord>(
    `/api/sites/${siteId}/images/${imageId}/lesion-box`,
    {
      method: "DELETE",
    },
    token,
  );
}

export async function fetchCaseHistory(
  siteId: string,
  patientId: string,
  visitDate: string,
  token: string,
  signal?: AbortSignal,
) {
  return fetchCaseHistoryRuntime(siteId, patientId, visitDate, token, signal);
}
