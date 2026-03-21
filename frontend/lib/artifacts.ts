import { buildApiUrl, request, requestBlob } from "./api-core";
import type { ImagePreviewBatchResponse } from "./types";

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

export async function fetchImageBlob(siteId: string, imageId: string, token: string, signal?: AbortSignal) {
  return requestBlob(`/api/sites/${siteId}/images/${imageId}/content`, token, "Image fetch failed", { signal });
}

export async function fetchImagePreviewBlob(
  siteId: string,
  imageId: string,
  token: string,
  options: {
    maxSide?: number;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams();
  if (typeof options.maxSide === "number" && Number.isFinite(options.maxSide)) {
    params.set("max_side", String(Math.round(options.maxSide)));
  }
  const path = params.size > 0
    ? `/api/sites/${siteId}/images/${imageId}/preview?${params.toString()}`
    : `/api/sites/${siteId}/images/${imageId}/preview`;
  return requestBlob(path, token, "Image preview fetch failed", { signal: options.signal });
}

export async function fetchImagePreviewBatch(
  siteId: string,
  token: string,
  options: {
    imageIds: string[];
    maxSide?: number;
    signal?: AbortSignal;
  },
) {
  const imageIds = Array.from(
    new Set(options.imageIds.map((imageId) => String(imageId ?? "").trim()).filter(Boolean)),
  );
  return request<ImagePreviewBatchResponse>(
    `/api/sites/${siteId}/images/previews`,
    {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        image_ids: imageIds,
        max_side: options.maxSide,
      }),
    },
    token,
  );
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

export async function fetchModelUpdateArtifactBlob(
  updateId: string,
  artifactKind: "source_thumbnail" | "roi_thumbnail" | "mask_thumbnail",
  token: string,
) {
  return requestBlob(`/api/admin/model-updates/${updateId}/artifacts/${artifactKind}`, token, "Artifact fetch failed");
}

export async function fetchValidationArtifactBlob(
  siteId: string,
  validationId: string,
  patientId: string,
  visitDate: string,
  artifactKind: "gradcam" | "gradcam_cornea" | "gradcam_lesion" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask",
  token: string,
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
  });
  return requestBlob(
    `/api/sites/${siteId}/validations/${validationId}/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "Artifact fetch failed",
  );
}

export async function fetchCaseRoiPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string,
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  return requestBlob(
    `/api/sites/${siteId}/cases/roi-preview/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "ROI preview fetch failed",
  );
}

export async function fetchCaseLesionPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string,
) {
  const params = new URLSearchParams({
    patient_id: patientId,
    visit_date: visitDate,
    image_id: imageId,
  });
  return requestBlob(
    `/api/sites/${siteId}/cases/lesion-preview/artifacts/${artifactKind}?${params.toString()}`,
    token,
    "Lesion preview fetch failed",
  );
}
