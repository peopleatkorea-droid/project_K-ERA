import { request } from "./api-core";
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
  OrganismRecord,
  PatientListPageResponse,
  PatientRecord,
  ResearchRegistrySettingsResponse,
  RoiPreviewRecord,
  SemanticPromptInputMode,
  SemanticPromptReviewResponse,
  SiteActivityResponse,
  SiteSummary,
  VisitRecord,
} from "./types";

export async function fetchSiteSummary(siteId: string, token: string) {
  return request<SiteSummary>(`/api/sites/${siteId}/summary`, {}, token);
}

export async function fetchSiteActivity(siteId: string, token: string, signal?: AbortSignal) {
  return request<SiteActivityResponse>(`/api/sites/${siteId}/activity`, { signal }, token);
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
  },
) {
  return request<PatientRecord>(
    `/api/sites/${siteId}/patients`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchCases(siteId: string, token: string, options?: { mine?: boolean; signal?: AbortSignal }) {
  const params = new URLSearchParams();
  if (options?.mine) {
    params.set("mine", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<CaseSummaryRecord[]>(`/api/sites/${siteId}/cases${suffix}`, { signal: options?.signal }, token);
}

export async function fetchPatientListPage(
  siteId: string,
  token: string,
  options: {
    mine?: boolean;
    page?: number;
    page_size?: number;
    search?: string;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams();
  if (options.mine) {
    params.set("mine", "true");
  }
  if (typeof options.page === "number") {
    params.set("page", String(options.page));
  }
  if (typeof options.page_size === "number") {
    params.set("page_size", String(options.page_size));
  }
  if (options.search?.trim()) {
    params.set("q", options.search.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<PatientListPageResponse>(`/api/sites/${siteId}/patients/list-board${suffix}`, { signal: options.signal }, token);
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
  },
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
    token,
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
  },
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
    token,
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

export async function fetchImages(
  siteId: string,
  token: string,
  patientId?: string,
  visitDate?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (patientId) {
    params.set("patient_id", patientId);
  }
  if (visitDate) {
    params.set("visit_date", visitDate);
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ImageRecord[]>(`/api/sites/${siteId}/images${suffix}`, { signal }, token);
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
    token,
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
  },
) {
  return request<{ images: ImageRecord[] }>(
    `/api/sites/${siteId}/images/representative`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function runBulkImport(
  siteId: string,
  token: string,
  payload: {
    csvFile: File;
    files: File[];
  },
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
  const params = new URLSearchParams();
  params.set("top_k", String(options.top_k ?? 3));
  params.set("input_mode", options.input_mode ?? "source");
  return request<SemanticPromptReviewResponse>(
    `/api/sites/${siteId}/images/${imageId}/semantic-prompts?${params.toString()}`,
    {},
    token,
  );
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
  return request<CaseContributionResponse>(
    `/api/sites/${siteId}/cases/contribute`,
    {
      method: "POST",
      body: JSON.stringify({
        execution_mode: "auto",
        ...payload,
      }),
    },
    token,
  );
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

export async function fetchStoredCaseLesionPreview(siteId: string, patientId: string, visitDate: string, token: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<LesionPreviewRecord[]>(`/api/sites/${siteId}/cases/lesion-preview/stored?${params.toString()}`, {}, token);
}

export async function startLiveLesionPreview(siteId: string, imageId: string, token: string) {
  return request<LiveLesionPreviewJobResponse>(
    `/api/sites/${siteId}/images/${imageId}/lesion-live-preview`,
    {
      method: "POST",
    },
    token,
  );
}

export async function fetchLiveLesionPreviewJob(siteId: string, imageId: string, jobId: string, token: string) {
  return request<LiveLesionPreviewJobResponse>(
    `/api/sites/${siteId}/images/${imageId}/lesion-live-preview/jobs/${jobId}`,
    {},
    token,
  );
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
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<CaseHistoryResponse>(`/api/sites/${siteId}/cases/history?${params.toString()}`, { signal }, token);
}
