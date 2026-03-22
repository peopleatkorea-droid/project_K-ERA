"use client";

import type {
  CaseSummaryRecord,
  CaseHistoryResponse,
  ImageRecord,
  OrganismRecord,
  PatientIdLookupResponse,
  PatientRecord,
  SiteActivityResponse,
  VisitRecord,
} from "./types";
import {
  clearDesktopFileSrcCache,
  convertDesktopFilePath,
  hasDesktopRuntime,
  invokeDesktop,
  throwIfAborted,
} from "./desktop-ipc";
import { clearDesktopTransportCaches } from "./desktop-transport";
import { readUserIdFromToken, readUserRoleFromToken } from "./token-payload";

type DesktopImageRecord = ImageRecord & {
  preview_url?: string | null;
  preview_path?: string | null;
  content_path?: string | null;
};

type DesktopImageBinaryResponse = {
  data: string;
  media_type?: string | null;
};

function desktopAuth(token: string) {
  return {
    user_id: readUserIdFromToken(token),
    user_role: readUserRoleFromToken(token),
  };
}

async function normalizeDesktopImage(image: DesktopImageRecord): Promise<DesktopImageRecord> {
  const contentUrl =
    image.content_url ??
    (await convertDesktopFilePath(image.content_path ?? image.image_path ?? null));
  const previewUrl =
    image.preview_url ??
    (await convertDesktopFilePath(image.preview_path ?? null)) ??
    contentUrl;
  return {
    ...image,
    content_url: contentUrl,
    preview_url: previewUrl,
  };
}

async function normalizeDesktopImages(images: DesktopImageRecord[]): Promise<DesktopImageRecord[]> {
  return Promise.all(images.map((image) => normalizeDesktopImage(image)));
}

export function canUseDesktopWorkspaceTransport(): boolean {
  return hasDesktopRuntime();
}

export function clearDesktopWorkspaceCaches() {
  clearDesktopFileSrcCache();
  clearDesktopTransportCaches();
}

export async function fetchDesktopCases(
  siteId: string,
  token: string,
  options: { mine?: boolean; signal?: AbortSignal } = {},
) {
  return invokeDesktop<CaseSummaryRecord[]>(
    "list_cases",
    {
      payload: {
        site_id: siteId,
        created_by_user_id: options.mine ? readUserIdFromToken(token) : null,
      },
    },
    options.signal,
  );
}

export async function fetchDesktopSiteActivity(
  siteId: string,
  token: string,
  options: { signal?: AbortSignal } = {},
) {
  return invokeDesktop<SiteActivityResponse>(
    "get_site_activity",
    {
      payload: {
        site_id: siteId,
        current_user_id: readUserIdFromToken(token),
      },
    },
    options.signal,
  );
}

export async function fetchDesktopPatients(siteId: string, token: string, options?: { mine?: boolean }) {
  return invokeDesktop<PatientRecord[]>("list_patients", {
    payload: {
      site_id: siteId,
      created_by_user_id: options?.mine ? readUserIdFromToken(token) : null,
    },
  });
}

export async function fetchDesktopPatientIdLookup(
  siteId: string,
  patientId: string,
  options: { signal?: AbortSignal } = {},
) {
  return invokeDesktop<PatientIdLookupResponse>(
    "lookup_patient_id",
    {
      payload: {
        site_id: siteId,
        patient_id: patientId,
      },
    },
    options.signal,
  );
}

export async function fetchDesktopVisits(
  siteId: string,
  patientId?: string,
  options: { signal?: AbortSignal } = {},
) {
  return invokeDesktop<VisitRecord[]>(
    "list_visits",
    {
      payload: {
        site_id: siteId,
        patient_id: patientId ?? null,
      },
    },
    options.signal,
  );
}

export async function fetchDesktopImages(
  siteId: string,
  patientId?: string,
  visitDate?: string,
  options: { signal?: AbortSignal } = {},
) {
  const images = await invokeDesktop<DesktopImageRecord[]>(
    "list_images",
    {
      payload: {
        site_id: siteId,
        patient_id: patientId ?? null,
        visit_date: visitDate ?? null,
      },
    },
    options.signal,
  );
  return normalizeDesktopImages(images);
}

export async function fetchDesktopCaseHistory(
  siteId: string,
  patientId: string,
  visitDate: string,
  options: { signal?: AbortSignal } = {},
) {
  return invokeDesktop<CaseHistoryResponse>(
    "get_case_history",
    {
      payload: {
        site_id: siteId,
        patient_id: patientId,
        visit_date: visitDate,
      },
    },
    options.signal,
  );
}

export async function createDesktopPatient(
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
  const response = await invokeDesktop<PatientRecord>("create_patient", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      ...payload,
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function updateDesktopPatient(
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
  const response = await invokeDesktop<PatientRecord>("update_patient", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      patient_id: patientId,
      ...payload,
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function createDesktopVisit(
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
  const response = await invokeDesktop<VisitRecord>("create_visit", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
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
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function updateDesktopVisit(
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
  const response = await invokeDesktop<VisitRecord>("update_visit", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      target_patient_id: payload.patient_id,
      target_visit_date: payload.visit_date,
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
      patient_id: patientId,
      visit_date: visitDate,
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function deleteDesktopVisit(
  siteId: string,
  token: string,
  patientId: string,
  visitDate: string,
) {
  const response = await invokeDesktop<{
    patient_id: string;
    visit_date: string;
    deleted_images: number;
    deleted_patient: boolean;
    remaining_visit_count: number;
  }>("delete_visit", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      patient_id: patientId,
      visit_date: visitDate,
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function uploadDesktopImage(
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
  const buffer = await payload.file.arrayBuffer();
  const response = await invokeDesktop<DesktopImageRecord>("upload_image", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      patient_id: payload.patient_id,
      visit_date: payload.visit_date,
      view: payload.view,
      is_representative: Boolean(payload.is_representative),
      file_name: payload.file.name || "upload.bin",
      bytes: Array.from(new Uint8Array(buffer)),
    },
  });
  clearDesktopWorkspaceCaches();
  return normalizeDesktopImage(response);
}

export async function deleteDesktopVisitImages(
  siteId: string,
  token: string,
  patientId: string,
  visitDate: string,
) {
  const response = await invokeDesktop<{ deleted_count: number }>("delete_visit_images", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      patient_id: patientId,
      visit_date: visitDate,
    },
  });
  clearDesktopWorkspaceCaches();
  return response;
}

export async function setDesktopRepresentativeImage(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    visit_date: string;
    representative_image_id: string;
  },
) {
  const response = await invokeDesktop<{ images: DesktopImageRecord[] }>("set_representative_image", {
    payload: {
      site_id: siteId,
      ...desktopAuth(token),
      ...payload,
    },
  });
  clearDesktopWorkspaceCaches();
  return {
    images: await normalizeDesktopImages(response.images),
  };
}

export async function readDesktopImageBlob(
  siteId: string,
  imageId: string,
  options: { signal?: AbortSignal } = {},
) {
  throwIfAborted(options.signal);
  const response = await invokeDesktop<DesktopImageBinaryResponse>(
    "read_image_blob",
    {
      payload: {
        site_id: siteId,
        image_id: imageId,
      },
    },
    options.signal,
  );
  throwIfAborted(options.signal);
  const binary = atob(response.data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], {
    type: response.media_type?.trim() || "application/octet-stream",
  });
}
