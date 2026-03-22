import { buildApiUrl, request, requestBlob } from "./api-core";
import {
  fetchAnalysisCaseLesionPreviewArtifactBlob as fetchCaseLesionPreviewArtifactBlobRuntime,
  fetchAnalysisCaseLesionPreviewArtifactUrl as fetchCaseLesionPreviewArtifactUrlRuntime,
  fetchAnalysisCaseRoiPreviewArtifactBlob as fetchCaseRoiPreviewArtifactBlobRuntime,
  fetchAnalysisCaseRoiPreviewArtifactUrl as fetchCaseRoiPreviewArtifactUrlRuntime,
  fetchAnalysisValidationArtifactBlob as fetchValidationArtifactBlobRuntime,
  fetchAnalysisValidationArtifactUrl as fetchValidationArtifactUrlRuntime,
} from "./analysis-runtime";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiBinary } from "./desktop-local-api";
import { canUseDesktopTransport, ensureDesktopImagePreviews } from "./desktop-transport";
import { canUseDesktopWorkspaceTransport, readDesktopImageBlob } from "./desktop-workspace";
import type { ImagePreviewBatchResponse } from "./types";

export async function downloadManifest(siteId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiBinary(`/api/sites/${siteId}/manifest.csv`, token);
  }
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
  if (canUseDesktopWorkspaceTransport()) {
    return readDesktopImageBlob(siteId, imageId, { signal });
  }
  return requestBlob(`/api/sites/${siteId}/images/${imageId}/content`, token, "Image fetch failed", { signal });
}

export async function fetchImagePreviewUrl(
  siteId: string,
  imageId: string,
  token: string,
  options: {
    maxSide?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (canUseDesktopTransport()) {
    const previewUrls = await ensureDesktopImagePreviews(siteId, [imageId], {
      maxSide: options.maxSide,
      signal: options.signal,
    });
    return previewUrls.get(imageId) ?? null;
  }
  return buildImagePreviewUrl(siteId, imageId, token, { maxSide: options.maxSide });
}

export async function ensureImagePreviews(
  siteId: string,
  imageIds: string[],
  token: string,
  options: {
    maxSide?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (canUseDesktopTransport()) {
    await ensureDesktopImagePreviews(siteId, imageIds, {
      maxSide: options.maxSide,
      signal: options.signal,
    });
    return null;
  }
  const normalizedIds = Array.from(
    new Set(
      imageIds
        .map((imageId) => String(imageId ?? "").trim())
        .filter((imageId) => imageId.length > 0),
    ),
  );
  if (normalizedIds.length === 0) {
    return null;
  }
  return request<ImagePreviewBatchResponse>(
    `/api/sites/${siteId}/images/previews`,
    {
      method: "POST",
      body: JSON.stringify({
        image_ids: normalizedIds,
        max_side: options.maxSide,
      }),
      signal: options.signal,
    },
    token,
  );
}

export function buildImageContentUrl(siteId: string, imageId: string, token: string) {
  const params = new URLSearchParams({ token });
  return buildApiUrl(`/api/sites/${siteId}/images/${imageId}/content?${params.toString()}`);
}

export function buildImagePreviewUrl(
  siteId: string,
  imageId: string,
  token: string,
  options: {
    maxSide?: number;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("token", token);
  if (typeof options.maxSide === "number" && Number.isFinite(options.maxSide)) {
    params.set("max_side", String(Math.round(options.maxSide)));
  }
  const path = params.size > 0
    ? `/api/sites/${siteId}/images/${imageId}/preview?${params.toString()}`
    : `/api/sites/${siteId}/images/${imageId}/preview`;
  return buildApiUrl(path);
}

export async function downloadImportTemplate(siteId: string, token: string) {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiBinary(`/api/sites/${siteId}/import/template.csv`, token);
  }
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
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiBinary(`/api/admin/model-updates/${updateId}/artifacts/${artifactKind}`, token);
  }
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
  return fetchValidationArtifactBlobRuntime(siteId, validationId, patientId, visitDate, artifactKind, token);
}

export async function fetchValidationArtifactUrl(
  siteId: string,
  validationId: string,
  patientId: string,
  visitDate: string,
  artifactKind: "gradcam" | "gradcam_cornea" | "gradcam_lesion" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask",
  token: string,
) {
  return fetchValidationArtifactUrlRuntime(siteId, validationId, patientId, visitDate, artifactKind, token);
}

export async function fetchCaseRoiPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string,
) {
  return fetchCaseRoiPreviewArtifactBlobRuntime(siteId, patientId, visitDate, imageId, artifactKind, token);
}

export async function fetchCaseRoiPreviewArtifactUrl(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "roi_crop" | "medsam_mask",
  token: string,
) {
  return fetchCaseRoiPreviewArtifactUrlRuntime(siteId, patientId, visitDate, imageId, artifactKind, token);
}

export async function fetchCaseLesionPreviewArtifactBlob(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string,
) {
  return fetchCaseLesionPreviewArtifactBlobRuntime(siteId, patientId, visitDate, imageId, artifactKind, token);
}

export async function fetchCaseLesionPreviewArtifactUrl(
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_crop" | "lesion_mask",
  token: string,
) {
  return fetchCaseLesionPreviewArtifactUrlRuntime(siteId, patientId, visitDate, imageId, artifactKind, token);
}
