"use client";

import type { ImageRecord, PatientListPageResponse, PatientListThumbnailRecord } from "./types";
import {
  clearDesktopFileSrcCache,
  convertDesktopFilePath,
  hasDesktopRuntime,
  invokeDesktop,
  throwIfAborted,
} from "./desktop-ipc";
import { readUserIdFromToken } from "./token-payload";

type FetchPatientListPageOptions = {
  mine?: boolean;
  page?: number;
  page_size?: number;
  search?: string;
  signal?: AbortSignal;
};

type FetchVisitImagesOptions = {
  signal?: AbortSignal;
};

type DesktopVisitImageRecord = ImageRecord & {
  preview_url: string | null;
};

type DesktopPathBackedThumbnailRecord = PatientListThumbnailRecord & {
  preview_path?: string | null;
  fallback_path?: string | null;
};

type DesktopPathBackedPatientListPageResponse = Omit<PatientListPageResponse, "items"> & {
  items: Array<
    PatientListPageResponse["items"][number] & {
      representative_thumbnails: DesktopPathBackedThumbnailRecord[];
    }
  >;
};

type DesktopPathBackedVisitImageRecord = DesktopVisitImageRecord & {
  preview_path?: string | null;
  content_path?: string | null;
};

type DesktopImagePreviewPathRecord = {
  image_id: string;
  preview_path: string | null;
  fallback_path: string | null;
  ready: boolean;
};

const patientListPageCache = new Map<string, PatientListPageResponse>();
const patientListPagePromiseCache = new Map<string, Promise<PatientListPageResponse>>();
const visitImagesCache = new Map<string, DesktopVisitImageRecord[]>();
const visitImagesPromiseCache = new Map<string, Promise<DesktopVisitImageRecord[]>>();
const imagePreviewPromiseCache = new Map<string, Promise<Map<string, string>>>();

function buildPatientListPageCacheKey(siteId: string, token: string, options: FetchPatientListPageOptions): string {
  return JSON.stringify({
    runtime: hasDesktopRuntime() ? "desktop" : "web",
    siteId,
    mine: Boolean(options.mine),
    createdByUserId: options.mine ? readUserIdFromToken(token) : null,
    page: options.page ?? 1,
    page_size: options.page_size ?? 25,
    search: options.search?.trim() ?? "",
  });
}

function buildVisitImagesCacheKey(siteId: string, patientId: string, visitDate: string): string {
  return JSON.stringify({ runtime: hasDesktopRuntime() ? "desktop" : "web", siteId, patientId, visitDate });
}

function buildImagePreviewCacheKey(siteId: string, imageIds: string[], maxSide: number): string {
  return JSON.stringify({
    runtime: hasDesktopRuntime() ? "desktop" : "web",
    siteId,
    maxSide,
    imageIds: [...imageIds].sort(),
  });
}

export function canUseDesktopTransport(): boolean {
  return hasDesktopRuntime();
}

async function normalizeDesktopThumbnailRecord(thumbnail: DesktopPathBackedThumbnailRecord): Promise<PatientListThumbnailRecord> {
  const [previewConverted, fallbackConverted] = await Promise.all([
    convertDesktopFilePath(thumbnail.preview_path ?? null),
    convertDesktopFilePath(thumbnail.fallback_path ?? null),
  ]);
  const previewUrl = thumbnail.preview_url ?? previewConverted ?? fallbackConverted;
  const fallbackUrl = thumbnail.fallback_url ?? fallbackConverted;
  return {
    ...thumbnail,
    preview_url: previewUrl,
    fallback_url: fallbackUrl,
  };
}

async function normalizeDesktopPatientListPage(
  response: DesktopPathBackedPatientListPageResponse,
): Promise<PatientListPageResponse> {
  return {
    ...response,
    items: await Promise.all(
      response.items.map(async (row) => ({
        ...row,
        representative_thumbnails: await Promise.all(
          row.representative_thumbnails.map((thumbnail) => normalizeDesktopThumbnailRecord(thumbnail)),
        ),
      })),
    ),
  };
}

async function normalizeDesktopVisitImages(
  response: DesktopPathBackedVisitImageRecord[],
): Promise<DesktopVisitImageRecord[]> {
  return Promise.all(
    response.map(async (image) => {
      const [contentConverted, previewConverted] = await Promise.all([
        convertDesktopFilePath(image.content_path ?? image.image_path ?? null),
        convertDesktopFilePath(image.preview_path ?? null),
      ]);
      const contentUrl = image.content_url ?? contentConverted;
      const previewUrl = image.preview_url ?? previewConverted ?? contentUrl;
      return {
        ...image,
        content_url: contentUrl,
        preview_url: previewUrl,
      };
    }),
  );
}

export async function fetchDesktopPatientListPage(
  siteId: string,
  token: string,
  options: FetchPatientListPageOptions = {},
): Promise<PatientListPageResponse> {
  const cacheKey = buildPatientListPageCacheKey(siteId, token, options);
  const cached = patientListPageCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = patientListPagePromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }
  throwIfAborted(options.signal);
  const nextRequest = invokeDesktop<DesktopPathBackedPatientListPageResponse>(
    "list_patient_board",
    {
      payload: {
        site_id: siteId,
        created_by_user_id: options.mine ? readUserIdFromToken(token) : null,
        page: options.page ?? 1,
        page_size: options.page_size ?? 25,
        search: options.search?.trim() || null,
      },
    },
    options.signal,
  )
    .then(normalizeDesktopPatientListPage)
    .then((response) => {
      patientListPageCache.set(cacheKey, response);
      return response;
    })
    .finally(() => {
      patientListPagePromiseCache.delete(cacheKey);
    });
  patientListPagePromiseCache.set(cacheKey, nextRequest);
  return nextRequest;
}

export function prewarmDesktopPatientListPage(siteId: string, token: string, options: FetchPatientListPageOptions = {}) {
  if (!canUseDesktopTransport()) {
    return;
  }
  void fetchDesktopPatientListPage(siteId, token, options).catch(() => undefined);
}

export async function fetchDesktopVisitImages(
  siteId: string,
  patientId: string,
  visitDate: string,
  options: FetchVisitImagesOptions = {},
): Promise<DesktopVisitImageRecord[]> {
  const cacheKey = buildVisitImagesCacheKey(siteId, patientId, visitDate);
  const cached = visitImagesCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = visitImagesPromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }
  throwIfAborted(options.signal);
  const nextRequest = invokeDesktop<DesktopPathBackedVisitImageRecord[]>(
    "get_visit_images",
    {
      payload: {
        site_id: siteId,
        patient_id: patientId,
        visit_date: visitDate,
      },
    },
    options.signal,
  )
    .then(normalizeDesktopVisitImages)
    .then((response) => {
      visitImagesCache.set(cacheKey, response);
      return response;
    })
    .finally(() => {
      visitImagesPromiseCache.delete(cacheKey);
    });
  visitImagesPromiseCache.set(cacheKey, nextRequest);
  return nextRequest;
}

export async function ensureDesktopImagePreviews(
  siteId: string,
  imageIds: string[],
  options: { maxSide?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const normalizedImageIds = Array.from(
    new Set(
      imageIds
        .map((imageId) => String(imageId ?? "").trim())
        .filter((imageId) => imageId.length > 0),
    ),
  );
  if (!normalizedImageIds.length) {
    return new Map();
  }
  const maxSide = Math.min(Math.max(options.maxSide ?? 640, 96), 1024);
  const cacheKey = buildImagePreviewCacheKey(siteId, normalizedImageIds, maxSide);
  const pending = imagePreviewPromiseCache.get(cacheKey);
  if (pending) {
    return pending;
  }
  throwIfAborted(options.signal);
  const nextRequest = invokeDesktop<DesktopImagePreviewPathRecord[]>(
    "ensure_image_previews",
    {
      payload: {
        site_id: siteId,
        image_ids: normalizedImageIds,
        max_side: maxSide,
      },
    },
    options.signal,
  )
    .then(async (records) => {
      const entries = await Promise.all(
        records.map(async (record) => {
          const previewUrl =
            (await convertDesktopFilePath(record.preview_path ?? null)) ??
            (await convertDesktopFilePath(record.fallback_path ?? null));
          return previewUrl ? ([record.image_id, previewUrl] as [string, string]) : null;
        }),
      );
      return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
    })
    .finally(() => {
      imagePreviewPromiseCache.delete(cacheKey);
    });
  imagePreviewPromiseCache.set(cacheKey, nextRequest);
  return nextRequest;
}

export function prefetchDesktopVisitImages(siteId: string, patientId: string, visitDate: string): void {
  if (!canUseDesktopTransport()) return;
  void fetchDesktopVisitImages(siteId, patientId, visitDate)
    .then((images) => {
      const imageIds = images
        .map((img) => String(img.image_id ?? "").trim())
        .filter((id) => id.length > 0);
      if (imageIds.length > 0) {
        void ensureDesktopImagePreviews(siteId, imageIds, { maxSide: 640 });
      }
    })
    .catch(() => undefined);
}

export function clearDesktopTransportCaches() {
  clearDesktopFileSrcCache();
  patientListPageCache.clear();
  patientListPagePromiseCache.clear();
  visitImagesCache.clear();
  visitImagesPromiseCache.clear();
  imagePreviewPromiseCache.clear();
}
