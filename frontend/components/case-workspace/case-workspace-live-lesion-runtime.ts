"use client";

import {
  buildDoneLiveLesionPreviewState,
  resolveLiveLesionArtifactUrls,
} from "./case-workspace-live-lesion-helpers";
import type {
  LiveLesionPreviewMap,
  LiveLesionPreviewState,
  SavedImagePreview,
} from "./shared";

type StoredLesionPreviewRecord = {
  image_id?: string | null;
  has_lesion_mask?: boolean;
  has_lesion_crop?: boolean;
  backend?: string | null;
};

type LiveLesionPreviewJobLike = {
  job_id: string | null;
  patient_id: string;
  visit_date: string;
  has_lesion_mask?: boolean;
  has_lesion_crop?: boolean;
  backend?: string | null;
  prompt_signature?: string | null;
};

type StoredLesionPreviewGroup = {
  patientId: string;
  visitDate: string;
  images: SavedImagePreview[];
};

type FetchStoredCaseLesionPreview = (
  siteId: string,
  patientId: string,
  visitDate: string,
  token: string,
) => Promise<StoredLesionPreviewRecord[]>;

type FetchCaseLesionPreviewArtifactUrl = (
  siteId: string,
  patientId: string,
  visitDate: string,
  imageId: string,
  artifactKind: "lesion_mask" | "lesion_crop",
  token: string,
) => Promise<string | null>;

type RevokeObjectUrls = (urls: string[]) => void;

export function mergeSelectedCaseImageUpdate(
  currentImages: SavedImagePreview[],
  updatedImage: Partial<SavedImagePreview> & { image_id: string },
): SavedImagePreview[] {
  return currentImages.map((image) =>
    image.image_id === updatedImage.image_id
      ? { ...image, ...updatedImage, preview_url: image.preview_url }
      : image,
  );
}

export async function hydrateStoredCaseLesionPreviewGroups(args: {
  siteId: string;
  token: string;
  groups: StoredLesionPreviewGroup[];
  fetchStoredCaseLesionPreview: FetchStoredCaseLesionPreview;
  fetchCaseLesionPreviewArtifactUrl: FetchCaseLesionPreviewArtifactUrl;
  revokeObjectUrls: RevokeObjectUrls;
  shouldCancel: () => boolean;
  getCurrentPreview: (imageId: string) => LiveLesionPreviewState | undefined;
  getCurrentUrls: (imageId: string) => string[];
  setCurrentUrls: (imageId: string, urls: string[]) => void;
  onHydratedPreview: (
    imageId: string,
    nextState: LiveLesionPreviewState,
  ) => void;
}) {
  const {
    siteId,
    token,
    groups,
    fetchStoredCaseLesionPreview,
    fetchCaseLesionPreviewArtifactUrl,
    revokeObjectUrls,
    shouldCancel,
    getCurrentPreview,
    getCurrentUrls,
    setCurrentUrls,
    onHydratedPreview,
  } = args;

  for (const { patientId, visitDate, images } of groups) {
    let previews: StoredLesionPreviewRecord[];
    try {
      previews = await fetchStoredCaseLesionPreview(
        siteId,
        patientId,
        visitDate,
        token,
      );
    } catch {
      continue;
    }
    if (shouldCancel()) {
      return;
    }

    const previewByImageId = new Map(
      previews
        .filter((item) => item.image_id)
        .map((item) => [String(item.image_id), item] as const),
    );

    for (const image of images) {
      const preview = previewByImageId.get(image.image_id);
      const existing = getCurrentPreview(image.image_id);
      if (
        !preview?.has_lesion_mask ||
        (existing?.status === "done" && existing.lesion_mask_url)
      ) {
        continue;
      }

      try {
        const { lesionMaskUrl, lesionCropUrl, urls } =
          await resolveLiveLesionArtifactUrls({
            hasLesionMask: preview.has_lesion_mask,
            hasLesionCrop: preview.has_lesion_crop,
            fetchLesionMaskUrl: () =>
              fetchCaseLesionPreviewArtifactUrl(
                siteId,
                patientId,
                visitDate,
                image.image_id,
                "lesion_mask",
                token,
              ),
            fetchLesionCropUrl: () =>
              fetchCaseLesionPreviewArtifactUrl(
                siteId,
                patientId,
                visitDate,
                image.image_id,
                "lesion_crop",
                token,
              ),
          });

        if (shouldCancel()) {
          revokeObjectUrls(urls);
          return;
        }

        revokeObjectUrls(getCurrentUrls(image.image_id));
        setCurrentUrls(image.image_id, urls);
        onHydratedPreview(
          image.image_id,
          buildDoneLiveLesionPreviewState(getCurrentPreview(image.image_id), {
            job_id: getCurrentPreview(image.image_id)?.job_id ?? null,
            backend: preview.backend ?? null,
            prompt_signature:
              getCurrentPreview(image.image_id)?.prompt_signature ?? null,
          }, {
            lesionMaskUrl,
            lesionCropUrl,
          }),
        );
      } catch {
        // Ignore individual preview artifacts that cannot be resolved.
      }
    }
  }
}

export async function hydrateLiveLesionPreviewArtifacts(args: {
  siteId: string;
  token: string;
  imageId: string;
  job: LiveLesionPreviewJobLike;
  requestVersion: number;
  fetchCaseLesionPreviewArtifactUrl: FetchCaseLesionPreviewArtifactUrl;
  revokeObjectUrls: RevokeObjectUrls;
  getCurrentRequestVersion: (imageId: string) => number | undefined;
  getCurrentPreview: (imageId: string) => LiveLesionPreviewState | undefined;
  getCurrentUrls: (imageId: string) => string[];
  setCurrentUrls: (imageId: string, urls: string[]) => void;
  onHydratedPreview: (
    imageId: string,
    nextState: LiveLesionPreviewState,
  ) => void;
}) {
  const {
    siteId,
    token,
    imageId,
    job,
    requestVersion,
    fetchCaseLesionPreviewArtifactUrl,
    revokeObjectUrls,
    getCurrentRequestVersion,
    getCurrentPreview,
    getCurrentUrls,
    setCurrentUrls,
    onHydratedPreview,
  } = args;

  if (getCurrentRequestVersion(imageId) !== requestVersion) {
    return;
  }

  const { lesionMaskUrl, lesionCropUrl, urls } =
    await resolveLiveLesionArtifactUrls({
      hasLesionMask: job.has_lesion_mask,
      hasLesionCrop: job.has_lesion_crop,
      fetchLesionMaskUrl: () =>
        fetchCaseLesionPreviewArtifactUrl(
          siteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_mask",
          token,
        ),
      fetchLesionCropUrl: () =>
        fetchCaseLesionPreviewArtifactUrl(
          siteId,
          job.patient_id,
          job.visit_date,
          imageId,
          "lesion_crop",
          token,
        ),
    });

  if (getCurrentRequestVersion(imageId) !== requestVersion) {
    revokeObjectUrls(urls);
    return;
  }

  revokeObjectUrls(getCurrentUrls(imageId));
  setCurrentUrls(imageId, urls);
  onHydratedPreview(
    imageId,
    buildDoneLiveLesionPreviewState(getCurrentPreview(imageId), job, {
      lesionMaskUrl,
      lesionCropUrl,
    }),
  );
}

export function getLiveLesionPreviewState(
  previews: LiveLesionPreviewMap,
  imageId: string,
) {
  return previews[imageId];
}
