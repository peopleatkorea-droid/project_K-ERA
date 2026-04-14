"use client";

import {
  fetchCaseLesionPreview,
  fetchCaseLesionPreviewArtifactUrl,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactUrl,
} from "../../lib/api";
import type { LiveLesionPreviewMap, SavedImagePreview } from "./shared";
import {
  buildPreviewByImageId,
  collectResolvedPreviewUrls,
  resolvePreviewArtifactEntries,
  selectUnresolvedLesionCropImages,
  selectUnresolvedRoiCropImages,
} from "./case-workspace-preview-artifact-helpers";

type ResolvedPreviewArtifactEntry = Awaited<
  ReturnType<typeof resolvePreviewArtifactEntries>
>[number];

type PreviewByImageId<T> = Map<string, T>;

export async function resolveSavedImageRoiCropArtifacts(args: {
  siteId: string;
  patientId: string;
  visitDate: string;
  token: string;
  images: SavedImagePreview[];
  currentUrls: Record<string, string | null>;
}) {
  const { siteId, patientId, visitDate, token, images, currentUrls } = args;
  const unresolvedImages = selectUnresolvedRoiCropImages(images, currentUrls);
  if (unresolvedImages.length === 0) {
    return {
      previewByImageId: new Map() as PreviewByImageId<
        Awaited<ReturnType<typeof fetchCaseRoiPreview>>[number]
      >,
      entries: [] as ResolvedPreviewArtifactEntry[],
      urls: [] as string[],
    };
  }

  const previews = await fetchCaseRoiPreview(siteId, patientId, visitDate, token);
  const previewByImageId = buildPreviewByImageId(previews);
  const entries = await resolvePreviewArtifactEntries({
    images: unresolvedImages,
    canResolve: (image) =>
      Boolean(previewByImageId.get(image.image_id)?.has_roi_crop),
    fetchUrl: (image) =>
      fetchCaseRoiPreviewArtifactUrl(
        siteId,
        patientId,
        visitDate,
        image.image_id,
        "roi_crop",
        token,
      ),
  });

  return {
    previewByImageId,
    entries,
    urls: collectResolvedPreviewUrls(entries),
  };
}

export async function resolveSavedImageLesionCropArtifacts(args: {
  siteId: string;
  patientId: string;
  visitDate: string;
  token: string;
  images: SavedImagePreview[];
  liveLesionPreviews: LiveLesionPreviewMap;
  currentUrls: Record<string, string | null>;
}) {
  const {
    siteId,
    patientId,
    visitDate,
    token,
    images,
    liveLesionPreviews,
    currentUrls,
  } = args;
  const unresolvedImages = selectUnresolvedLesionCropImages(
    images,
    liveLesionPreviews,
    currentUrls,
  );
  if (unresolvedImages.length === 0) {
    return {
      previewByImageId: new Map() as PreviewByImageId<
        Awaited<ReturnType<typeof fetchCaseLesionPreview>>[number]
      >,
      entries: [] as ResolvedPreviewArtifactEntry[],
      urls: [] as string[],
    };
  }

  const hasAnyStoredLesionBox = images.some(
    (image) =>
      typeof image.lesion_prompt_box === "object" &&
      image.lesion_prompt_box !== null,
  );
  let previewByImageId = new Map() as PreviewByImageId<
    Awaited<ReturnType<typeof fetchCaseLesionPreview>>[number]
  >;
  if (hasAnyStoredLesionBox) {
    const previews = await fetchCaseLesionPreview(
      siteId,
      patientId,
      visitDate,
      token,
    );
    previewByImageId = buildPreviewByImageId(previews);
  }

  const entries = await resolvePreviewArtifactEntries({
    images: unresolvedImages,
    canResolve: (image) =>
      previewByImageId.get(image.image_id)?.has_lesion_crop ??
      Boolean(image.has_lesion_crop),
    fetchUrl: (image) =>
      fetchCaseLesionPreviewArtifactUrl(
        siteId,
        patientId,
        visitDate,
        image.image_id,
        "lesion_crop",
        token,
      ),
  });

  return {
    previewByImageId,
    entries,
    urls: collectResolvedPreviewUrls(entries),
  };
}
