import { buildApiUrl, requestBlob } from "./api-core";

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

export async function fetchImageBlob(siteId: string, imageId: string, token: string) {
  return requestBlob(`/api/sites/${siteId}/images/${imageId}/content`, token, "Image fetch failed");
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
  artifactKind: "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask",
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
