"use client";

import type { LiveLesionPreviewMap, LesionPreviewCard, RoiPreviewCard, SavedImagePreview } from "./shared";

type PreviewWithImageId = {
  image_id?: string | null;
};

type RoiPreviewFlags = {
  image_id?: string | null;
  has_roi_crop?: boolean;
  has_medsam_mask?: boolean;
};

type LesionPreviewFlags = {
  image_id?: string | null;
  has_lesion_crop?: boolean;
  has_lesion_mask?: boolean;
};

export type ResolvedPreviewEntry = readonly [string, string | null];

export function revokeObjectUrls(urls: string[]) {
  for (const url of urls) {
    if (String(url).startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

export function buildPreviewByImageId<T extends PreviewWithImageId>(
  previews: T[],
): Map<string, T> {
  return new Map(
    previews
      .filter((item) => item.image_id)
      .map((item) => [String(item.image_id), item] as const),
  );
}

export function collectResolvedPreviewUrls(entries: ResolvedPreviewEntry[]): string[] {
  return entries
    .map(([, url]) => url)
    .filter((url): url is string => Boolean(url));
}

export function mergeResolvedPreviewUrls(
  current: Record<string, string | null>,
  entries: ResolvedPreviewEntry[],
): Record<string, string | null> {
  return {
    ...current,
    ...Object.fromEntries(entries),
  };
}

export function selectUnresolvedRoiCropImages(
  images: SavedImagePreview[],
  savedImageRoiCropUrls: Record<string, string | null>,
): SavedImagePreview[] {
  return images.filter(
    (image) =>
      !Object.prototype.hasOwnProperty.call(savedImageRoiCropUrls, image.image_id),
  );
}

export function selectUnresolvedLesionCropImages(
  images: SavedImagePreview[],
  liveLesionPreviews: LiveLesionPreviewMap,
  savedImageLesionCropUrls: Record<string, string | null>,
): SavedImagePreview[] {
  return images.filter(
    (image) =>
      !liveLesionPreviews[image.image_id]?.lesion_crop_url &&
      !Object.prototype.hasOwnProperty.call(savedImageLesionCropUrls, image.image_id),
  );
}

export function applyRoiPreviewFlags(
  images: SavedImagePreview[],
  previewByImageId: Map<string, RoiPreviewFlags>,
): SavedImagePreview[] {
  return images.map((image) => {
    const preview = previewByImageId.get(image.image_id);
    if (!preview) {
      return image;
    }
    return {
      ...image,
      has_roi_crop: preview.has_roi_crop,
      has_medsam_mask: preview.has_medsam_mask,
    };
  });
}

export function applyLesionPreviewFlags(
  images: SavedImagePreview[],
  previewByImageId: Map<string, LesionPreviewFlags>,
): SavedImagePreview[] {
  return images.map((image) => {
    const preview = previewByImageId.get(image.image_id);
    if (!preview) {
      return image;
    }
    return {
      ...image,
      has_lesion_crop: preview.has_lesion_crop,
      has_lesion_mask: preview.has_lesion_mask,
    };
  });
}

export async function resolvePreviewArtifactEntries<TImage extends { image_id: string }>(args: {
  images: TImage[];
  canResolve: (image: TImage) => boolean;
  fetchUrl: (image: TImage) => Promise<string | null>;
}): Promise<ResolvedPreviewEntry[]> {
  const { images, canResolve, fetchUrl } = args;
  return Promise.all(
    images.map(async (image) => {
      if (!canResolve(image)) {
        return [image.image_id, null] as const;
      }
      try {
        const url = await fetchUrl(image);
        return [image.image_id, url] as const;
      } catch {
        return [image.image_id, null] as const;
      }
    }),
  );
}

export async function buildRoiPreviewCards<TItem extends {
  image_id?: string | null;
  has_roi_crop?: boolean;
  has_medsam_mask?: boolean;
}>(args: {
  items: TItem[];
  fetchSourcePreviewUrl: (imageId: string) => Promise<string | null>;
  fetchRoiCropUrl: (imageId: string) => Promise<string | null>;
  fetchMedsamMaskUrl: (imageId: string) => Promise<string | null>;
}): Promise<{ cards: RoiPreviewCard[]; urls: string[] }> {
  const urls: string[] = [];
  const cards = await Promise.all(
    args.items.map(async (item) => {
      const nextCard: RoiPreviewCard = {
        ...(item as RoiPreviewCard),
        source_preview_url: null,
        roi_crop_url: null,
        medsam_mask_url: null,
      };
      if (!item.image_id) {
        return nextCard;
      }
      try {
        const sourceUrl = await args.fetchSourcePreviewUrl(item.image_id);
        if (sourceUrl) {
          urls.push(sourceUrl);
        }
        nextCard.source_preview_url = sourceUrl;
      } catch {
        nextCard.source_preview_url = null;
      }
      if (item.has_roi_crop) {
        try {
          const roiUrl = await args.fetchRoiCropUrl(item.image_id);
          if (roiUrl) {
            urls.push(roiUrl);
          }
          nextCard.roi_crop_url = roiUrl;
        } catch {
          nextCard.roi_crop_url = null;
        }
      }
      if (item.has_medsam_mask) {
        try {
          const maskUrl = await args.fetchMedsamMaskUrl(item.image_id);
          if (maskUrl) {
            urls.push(maskUrl);
          }
          nextCard.medsam_mask_url = maskUrl;
        } catch {
          nextCard.medsam_mask_url = null;
        }
      }
      return nextCard;
    }),
  );
  return { cards, urls };
}

export async function buildLesionPreviewCards<TItem extends {
  image_id?: string | null;
  has_lesion_crop?: boolean;
  has_lesion_mask?: boolean;
}>(args: {
  items: TItem[];
  fetchSourcePreviewUrl: (imageId: string) => Promise<string | null>;
  fetchLesionCropUrl: (imageId: string) => Promise<string | null>;
  fetchLesionMaskUrl: (imageId: string) => Promise<string | null>;
}): Promise<{ cards: LesionPreviewCard[]; urls: string[] }> {
  const urls: string[] = [];
  const cards = await Promise.all(
    args.items.map(async (item) => {
      const nextCard: LesionPreviewCard = {
        ...(item as LesionPreviewCard),
        source_preview_url: null,
        lesion_crop_url: null,
        lesion_mask_url: null,
      };
      if (!item.image_id) {
        return nextCard;
      }
      try {
        const sourceUrl = await args.fetchSourcePreviewUrl(item.image_id);
        if (sourceUrl) {
          urls.push(sourceUrl);
        }
        nextCard.source_preview_url = sourceUrl;
      } catch {
        nextCard.source_preview_url = null;
      }
      if (item.has_lesion_crop) {
        try {
          const cropUrl = await args.fetchLesionCropUrl(item.image_id);
          if (cropUrl) {
            urls.push(cropUrl);
          }
          nextCard.lesion_crop_url = cropUrl;
        } catch {
          nextCard.lesion_crop_url = null;
        }
      }
      if (item.has_lesion_mask) {
        try {
          const maskUrl = await args.fetchLesionMaskUrl(item.image_id);
          if (maskUrl) {
            urls.push(maskUrl);
          }
          nextCard.lesion_mask_url = maskUrl;
        } catch {
          nextCard.lesion_mask_url = null;
        }
      }
      return nextCard;
    }),
  );
  return { cards, urls };
}
