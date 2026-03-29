"use client";

import { request } from "./api-core";
import {
  canUseDesktopTransport,
  clearDesktopTransportCaches,
  fetchDesktopPatientListPage,
  fetchDesktopVisitImages,
  prewarmDesktopPatientListPage,
} from "./desktop-transport";
import {
  canUseDesktopWorkspaceTransport,
  createDesktopPatient,
  createDesktopVisit,
  deleteDesktopVisit,
  deleteDesktopVisitImages,
  fetchDesktopCases,
  fetchDesktopCaseHistory,
  fetchDesktopImages,
  fetchDesktopPatientIdLookup,
  fetchDesktopPatients,
  fetchDesktopSiteActivity,
  fetchDesktopVisits,
  setDesktopRepresentativeImage,
  updateDesktopPatient,
  updateDesktopVisit,
  uploadDesktopImage,
} from "./desktop-workspace";
import { buildImageContentUrl, buildImagePreviewUrl, ensureImagePreviews } from "./artifacts";
import type {
  CaseHistoryResponse,
  CaseSummaryRecord,
  ImageRecord,
  OrganismRecord,
  PatientIdLookupResponse,
  PatientListPageResponse,
  PatientRecord,
  SiteActivityResponse,
  VisitRecord,
} from "./types";

export type FetchWorkspacePatientListPageOptions = {
  mine?: boolean;
  page?: number;
  page_size?: number;
  search?: string;
  signal?: AbortSignal;
};

const PATIENT_LIST_THUMBNAIL_MAX_SIDE = 160;
const CASE_IMAGE_PREVIEW_MAX_SIDE = 960;
const workspacePatientListPageCache = new Map<string, PatientListPageResponse>();
const workspacePatientListPagePromiseCache = new Map<string, Promise<PatientListPageResponse>>();

function buildWorkspacePatientListPageCacheKey(
  siteId: string,
  token: string,
  options: FetchWorkspacePatientListPageOptions,
): string {
  return JSON.stringify({
    runtime: "web",
    siteId,
    token,
    mine: Boolean(options.mine),
    page: options.page ?? 1,
    page_size: options.page_size ?? 25,
    search: options.search?.trim() ?? "",
  });
}

function throwIfWorkspaceRequestAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function withPatientListPreviewUrls(
  siteId: string,
  token: string,
  response: PatientListPageResponse,
): PatientListPageResponse {
  return {
    ...response,
    items: response.items.map((row) => ({
      ...row,
      representative_thumbnails: row.representative_thumbnails.map((thumbnail) => ({
        ...thumbnail,
        preview_url:
          thumbnail.preview_url ??
          buildImagePreviewUrl(siteId, thumbnail.image_id, token, {
            maxSide: PATIENT_LIST_THUMBNAIL_MAX_SIDE,
          }),
        fallback_url:
          thumbnail.fallback_url ??
          buildImageContentUrl(siteId, thumbnail.image_id, token),
      })),
    })),
  };
}

export async function fetchWorkspaceSiteActivity(siteId: string, token: string, signal?: AbortSignal) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopSiteActivity(siteId, token, { signal });
  }
  return request<SiteActivityResponse>(`/api/sites/${siteId}/activity`, { signal }, token);
}

export async function fetchWorkspacePatients(siteId: string, token: string, options?: { mine?: boolean }) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopPatients(siteId, token, options);
  }
  const params = new URLSearchParams();
  if (options?.mine) {
    params.set("mine", "true");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<PatientRecord[]>(`/api/sites/${siteId}/patients${suffix}`, {}, token);
}

export async function createWorkspacePatient(
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
  if (canUseDesktopWorkspaceTransport()) {
    return createDesktopPatient(siteId, token, payload);
  }
  return request<PatientRecord>(
    `/api/sites/${siteId}/patients`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function updateWorkspacePatient(
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
  if (canUseDesktopWorkspaceTransport()) {
    return updateDesktopPatient(siteId, token, patientId, payload);
  }
  const params = new URLSearchParams({
    patient_id: patientId,
  });
  return request<PatientRecord>(
    `/api/sites/${siteId}/patients?${params.toString()}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        chart_alias: "",
        local_case_code: "",
        ...payload,
      }),
    },
    token,
  );
}

export async function fetchWorkspacePatientIdLookup(
  siteId: string,
  token: string,
  patientId: string,
  options: { signal?: AbortSignal } = {},
) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopPatientIdLookup(siteId, patientId, options);
  }
  const params = new URLSearchParams({
    patient_id: patientId,
  });
  return request<PatientIdLookupResponse>(
    `/api/sites/${siteId}/patients/lookup?${params.toString()}`,
    { signal: options.signal },
    token,
  );
}

export async function fetchWorkspaceCases(
  siteId: string,
  token: string,
  options?: { mine?: boolean; patientId?: string; signal?: AbortSignal },
) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopCases(siteId, token, options);
  }
  const params = new URLSearchParams();
  if (options?.mine) {
    params.set("mine", "true");
  }
  if (options?.patientId?.trim()) {
    params.set("patient_id", options.patientId.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<CaseSummaryRecord[]>(`/api/sites/${siteId}/cases${suffix}`, { signal: options?.signal }, token);
}

export async function fetchWorkspacePatientListPage(
  siteId: string,
  token: string,
  options: FetchWorkspacePatientListPageOptions = {},
) {
  if (canUseDesktopTransport()) {
    return fetchDesktopPatientListPage(siteId, token, options);
  }
  const cacheKey = buildWorkspacePatientListPageCacheKey(siteId, token, options);
  const cached = workspacePatientListPageCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = workspacePatientListPagePromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }
  throwIfWorkspaceRequestAborted(options.signal);
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
  const nextRequest = request<PatientListPageResponse>(
    `/api/sites/${siteId}/patients/list-board${suffix}`,
    { signal: options.signal },
    token,
  )
    .then((response) => {
      const hydratedResponse = withPatientListPreviewUrls(siteId, token, response);
      const thumbnailIds = hydratedResponse.items.flatMap((row) =>
        row.representative_thumbnails
          .map((thumbnail) => String(thumbnail.image_id ?? "").trim())
          .filter((imageId) => imageId.length > 0),
      );
      void ensureImagePreviews(siteId, thumbnailIds, token, {
        maxSide: PATIENT_LIST_THUMBNAIL_MAX_SIDE,
        signal: options.signal,
      }).catch(() => undefined);
      workspacePatientListPageCache.set(cacheKey, hydratedResponse);
      return hydratedResponse;
    })
    .finally(() => {
      workspacePatientListPagePromiseCache.delete(cacheKey);
    });
  workspacePatientListPagePromiseCache.set(cacheKey, nextRequest);
  return nextRequest;
}

export function prewarmWorkspacePatientListPage(
  siteId: string,
  token: string,
  options: FetchWorkspacePatientListPageOptions = {},
) {
  if (canUseDesktopTransport()) {
    prewarmDesktopPatientListPage(siteId, token, options);
    return;
  }
  void fetchWorkspacePatientListPage(siteId, token, options).catch(() => undefined);
}

export function invalidateWorkspaceDesktopCaches() {
  clearDesktopTransportCaches();
  workspacePatientListPageCache.clear();
  workspacePatientListPagePromiseCache.clear();
}

export async function fetchWorkspaceVisits(siteId: string, token: string, patientId?: string) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopVisits(siteId, patientId);
  }
  const suffix = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : "";
  return request<VisitRecord[]>(`/api/sites/${siteId}/visits${suffix}`, {}, token);
}

export async function createWorkspaceVisit(
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
  if (canUseDesktopWorkspaceTransport()) {
    return createDesktopVisit(siteId, token, payload);
  }
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

export async function updateWorkspaceVisit(
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
  if (canUseDesktopWorkspaceTransport()) {
    return updateDesktopVisit(siteId, token, patientId, visitDate, payload);
  }
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

export async function deleteWorkspaceVisit(siteId: string, token: string, patientId: string, visitDate: string) {
  if (canUseDesktopWorkspaceTransport()) {
    return deleteDesktopVisit(siteId, token, patientId, visitDate);
  }
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

export async function fetchWorkspaceImages(
  siteId: string,
  token: string,
  patientId?: string,
  visitDate?: string,
  signal?: AbortSignal,
) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopImages(siteId, patientId, visitDate, { signal });
  }
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

export async function fetchWorkspaceVisitImagesWithPreviews(
  siteId: string,
  token: string,
  patientId: string,
  visitDate: string,
  options: { signal?: AbortSignal } = {},
) {
  if (canUseDesktopTransport()) {
    return fetchDesktopVisitImages(siteId, patientId, visitDate, options);
  }
  const images = await fetchWorkspaceImages(siteId, token, patientId, visitDate, options.signal);
  const previewableImageIds = images
    .map((image) => String(image.image_id ?? "").trim())
    .filter((imageId) => imageId.length > 0);
  void ensureImagePreviews(siteId, previewableImageIds, token, {
    maxSide: CASE_IMAGE_PREVIEW_MAX_SIDE,
    signal: options.signal,
  }).catch(() => undefined);
  return images.map((image) => {
    const contentUrl = buildImageContentUrl(siteId, image.image_id, token);
    const previewUrl = buildImagePreviewUrl(siteId, image.image_id, token, {
      maxSide: CASE_IMAGE_PREVIEW_MAX_SIDE,
    });
    return {
      ...image,
      content_url: contentUrl,
      preview_url: previewUrl,
    };
  });
}

export async function uploadWorkspaceImage(
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
  if (canUseDesktopWorkspaceTransport()) {
    return uploadDesktopImage(siteId, token, payload);
  }
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

export async function deleteWorkspaceVisitImages(siteId: string, token: string, patientId: string, visitDate: string) {
  if (canUseDesktopWorkspaceTransport()) {
    return deleteDesktopVisitImages(siteId, token, patientId, visitDate);
  }
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<{ deleted_count: number }>(
    `/api/sites/${siteId}/images?${params.toString()}`,
    { method: "DELETE" },
    token,
  );
}

export async function setWorkspaceRepresentativeImage(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    representative_image_id: string;
  },
) {
  if (canUseDesktopWorkspaceTransport()) {
    return setDesktopRepresentativeImage(siteId, token, payload);
  }
  return request<{ images: ImageRecord[] }>(
    `/api/sites/${siteId}/images/representative`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function fetchWorkspaceCaseHistory(
  siteId: string,
  patientId: string,
  visitDate: string,
  token: string,
  signal?: AbortSignal,
) {
  if (canUseDesktopWorkspaceTransport()) {
    return fetchDesktopCaseHistory(siteId, patientId, visitDate, { signal });
  }
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return request<CaseHistoryResponse>(`/api/sites/${siteId}/cases/history?${params.toString()}`, { signal }, token);
}
