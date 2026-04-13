"use client";

import { startTransition, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type CaseSummaryRecord,
  fetchImages,
  fetchVisitImagesWithPreviews,
} from "../../lib/api";
import {
  canUseDesktopTransport,
  ensureDesktopImagePreviews,
} from "../../lib/desktop-transport";
import {
  buildPatientImageCacheKey,
  buildVisitImageCacheKey,
  hasSettledCaseImageCache,
} from "./case-workspace-site-data-helpers";
import type { SavedImagePreview } from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Setter<T> = Dispatch<SetStateAction<T>>;

type Args = {
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  token: string;
  locale: "en" | "ko";
  describeError: (error: unknown, fallback: string) => string;
  pick: (locale: "en" | "ko", en: string, ko: string) => string;
  setToast: (toast: ToastState) => void;
  setPatientVisitGallery: Setter<Record<string, SavedImagePreview[]>>;
  setPatientVisitGalleryLoadingCaseIds: Setter<Record<string, boolean>>;
  setPatientVisitGalleryErrorCaseIds: Setter<Record<string, boolean>>;
  replaceSelectedCaseImages: (
    caseId: string | null,
    images: SavedImagePreview[],
  ) => void;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useCaseWorkspaceImageCache({
  selectedSiteId,
  selectedCase,
  token,
  locale,
  describeError,
  pick,
  setToast,
  setPatientVisitGallery,
  setPatientVisitGalleryLoadingCaseIds,
  setPatientVisitGalleryErrorCaseIds,
  replaceSelectedCaseImages,
}: Args) {
  const selectedCaseImageCaseIdRef = useRef<string | null>(null);
  const visitImageRecordCacheRef = useRef<Map<string, SavedImagePreview[]>>(
    new Map(),
  );
  const visitImageRecordPromiseCacheRef = useRef<
    Map<string, Promise<SavedImagePreview[]>>
  >(new Map());
  const visitImagePreviewWarmPromiseCacheRef = useRef<Map<string, Promise<void>>>(
    new Map(),
  );
  const patientImageRecordCacheRef = useRef<Map<string, SavedImagePreview[]>>(
    new Map(),
  );
  const patientImageRecordPromiseCacheRef = useRef<
    Map<string, Promise<SavedImagePreview[]>>
  >(new Map());
  const caseImageCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());

  const clearCaseImageCache = useCallback(() => {
    visitImageRecordCacheRef.current.clear();
    visitImageRecordPromiseCacheRef.current.clear();
    visitImagePreviewWarmPromiseCacheRef.current.clear();
    patientImageRecordCacheRef.current.clear();
    patientImageRecordPromiseCacheRef.current.clear();
    caseImageCacheRef.current.clear();
    selectedCaseImageCaseIdRef.current = null;
  }, []);

  const markPatientVisitGalleryLoading = useCallback(
    (caseId: string, loading: boolean) => {
      setPatientVisitGalleryLoadingCaseIds((current) => {
        if (loading) {
          if (current[caseId]) {
            return current;
          }
          return {
            ...current,
            [caseId]: true,
          };
        }
        if (!current[caseId]) {
          return current;
        }
        const next = { ...current };
        delete next[caseId];
        return next;
      });
    },
    [setPatientVisitGalleryLoadingCaseIds],
  );

  const markPatientVisitGalleryError = useCallback(
    (caseId: string, failed: boolean) => {
      setPatientVisitGalleryErrorCaseIds((current) => {
        if (failed) {
          if (current[caseId]) {
            return current;
          }
          return {
            ...current,
            [caseId]: true,
          };
        }
        if (!current[caseId]) {
          return current;
        }
        const next = { ...current };
        delete next[caseId];
        return next;
      });
    },
    [setPatientVisitGalleryErrorCaseIds],
  );

  const commitCaseImages = useCallback(
    (caseId: string, images: SavedImagePreview[]) => {
      caseImageCacheRef.current.set(caseId, images);
      startTransition(() => {
        setPatientVisitGallery((current) => ({
          ...current,
          [caseId]: images,
        }));
        if (selectedCaseImageCaseIdRef.current === caseId) {
          replaceSelectedCaseImages(caseId, images);
        }
      });
    },
    [replaceSelectedCaseImages, setPatientVisitGallery],
  );

  const primeCaseImageCache = useCallback(
    (caseRecord: CaseSummaryRecord, images: SavedImagePreview[]) => {
      const visitCacheKey = buildVisitImageCacheKey(
        caseRecord.patient_id,
        caseRecord.visit_date,
      );
      visitImageRecordPromiseCacheRef.current.delete(visitCacheKey);
      visitImageRecordCacheRef.current.set(visitCacheKey, images);
      if (selectedSiteId) {
        const patientCacheKey = buildPatientImageCacheKey(
          selectedSiteId,
          caseRecord.patient_id,
        );
        const cachedPatientImages =
          patientImageRecordCacheRef.current.get(patientCacheKey) ?? [];
        const preservedPatientImages = cachedPatientImages.filter(
          (image) =>
            buildVisitImageCacheKey(
              String(image.patient_id ?? ""),
              String(image.visit_date ?? ""),
            ) !== visitCacheKey,
        );
        patientImageRecordPromiseCacheRef.current.delete(patientCacheKey);
        patientImageRecordCacheRef.current.set(patientCacheKey, [
          ...preservedPatientImages,
          ...images,
        ]);
      }
      caseImageCacheRef.current.set(caseRecord.case_id, images);
      selectedCaseImageCaseIdRef.current = caseRecord.case_id;
      markPatientVisitGalleryLoading(caseRecord.case_id, false);
      markPatientVisitGalleryError(caseRecord.case_id, false);
      startTransition(() => {
        setPatientVisitGallery((current) => ({
          ...current,
          [caseRecord.case_id]: images,
        }));
        if (selectedCase?.case_id === caseRecord.case_id) {
          replaceSelectedCaseImages(caseRecord.case_id, images);
        }
      });
    },
    [
      markPatientVisitGalleryError,
      markPatientVisitGalleryLoading,
      replaceSelectedCaseImages,
      selectedCase?.case_id,
      selectedSiteId,
      setPatientVisitGallery,
    ],
  );

  const warmDesktopVisitImagePreviews = useCallback(
    async (
      siteId: string,
      caseRecord: CaseSummaryRecord,
      images: SavedImagePreview[],
      signal?: AbortSignal,
    ): Promise<void> => {
      if (!canUseDesktopTransport()) {
        return;
      }
      const imageIds = images
        .map((image) => String(image.image_id ?? "").trim())
        .filter((imageId) => imageId.length > 0);
      if (!imageIds.length) {
        return;
      }
      const cacheKey = buildVisitImageCacheKey(
        caseRecord.patient_id,
        caseRecord.visit_date,
      );
      const pendingWarm =
        visitImagePreviewWarmPromiseCacheRef.current.get(cacheKey);
      if (pendingWarm) {
        return pendingWarm;
      }
      const nextWarm = ensureDesktopImagePreviews(siteId, imageIds, {
        maxSide: 640,
        signal,
      })
        .then((previewUrlsById) => {
          if (signal?.aborted || previewUrlsById.size === 0) {
            return;
          }
          const cachedImages =
            visitImageRecordCacheRef.current.get(cacheKey) ?? images;
          let changed = false;
          const nextImages = cachedImages.map((image) => {
            const previewUrl = previewUrlsById.get(image.image_id);
            if (!previewUrl || previewUrl === image.preview_url) {
              return image;
            }
            changed = true;
            return {
              ...image,
              preview_url: previewUrl,
            };
          });
          if (!changed) {
            return;
          }
          visitImageRecordCacheRef.current.set(cacheKey, nextImages);
          commitCaseImages(caseRecord.case_id, nextImages);
        })
        .catch((nextError) => {
          if (!isAbortError(nextError)) {
            console.warn("Desktop image preview warm-up failed", nextError);
          }
        })
        .finally(() => {
          visitImagePreviewWarmPromiseCacheRef.current.delete(cacheKey);
        });
      visitImagePreviewWarmPromiseCacheRef.current.set(cacheKey, nextWarm);
      return nextWarm;
    },
    [commitCaseImages],
  );

  const loadVisitImageRecords = useCallback(
    async (
      siteId: string,
      patientId: string,
      visitDate: string,
      signal?: AbortSignal,
    ): Promise<SavedImagePreview[]> => {
      const cacheKey = buildVisitImageCacheKey(patientId, visitDate);
      const cachedRecords = visitImageRecordCacheRef.current.get(cacheKey);
      if (cachedRecords) {
        return cachedRecords;
      }
      const pendingRequest =
        visitImageRecordPromiseCacheRef.current.get(cacheKey);
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchVisitImagesWithPreviews(
        siteId,
        token,
        patientId,
        visitDate,
        { signal },
      )
        .then((imageRecords) => {
          const savedImages = imageRecords as SavedImagePreview[];
          visitImageRecordCacheRef.current.set(cacheKey, savedImages);
          return savedImages;
        })
        .finally(() => {
          visitImageRecordPromiseCacheRef.current.delete(cacheKey);
        });
      visitImageRecordPromiseCacheRef.current.set(cacheKey, nextRequest);
      return nextRequest;
    },
    [token],
  );

  const groupPatientImageRecordsByVisit = useCallback(
    (imageRecords: SavedImagePreview[]): Map<string, SavedImagePreview[]> => {
      const grouped = new Map<string, SavedImagePreview[]>();
      for (const image of imageRecords) {
        const cacheKey = buildVisitImageCacheKey(
          String(image.patient_id ?? ""),
          String(image.visit_date ?? ""),
        );
        const current = grouped.get(cacheKey);
        if (current) {
          current.push(image);
        } else {
          grouped.set(cacheKey, [image]);
        }
      }
      return grouped;
    },
    [],
  );

  const storePatientImageRecords = useCallback(
    (
      siteId: string,
      patientId: string,
      imageRecords: SavedImagePreview[],
    ): Map<string, SavedImagePreview[]> => {
      const patientCacheKey = buildPatientImageCacheKey(siteId, patientId);
      patientImageRecordCacheRef.current.set(patientCacheKey, imageRecords);
      const grouped = groupPatientImageRecordsByVisit(imageRecords);
      for (const [visitCacheKey, visitImages] of grouped.entries()) {
        visitImageRecordPromiseCacheRef.current.delete(visitCacheKey);
        visitImageRecordCacheRef.current.set(visitCacheKey, visitImages);
      }
      return grouped;
    },
    [groupPatientImageRecordsByVisit],
  );

  const loadPatientImageRecords = useCallback(
    async (
      siteId: string,
      patientId: string,
      signal?: AbortSignal,
    ): Promise<Map<string, SavedImagePreview[]>> => {
      const cacheKey = buildPatientImageCacheKey(siteId, patientId);
      const cachedRecords = patientImageRecordCacheRef.current.get(cacheKey);
      if (cachedRecords) {
        return groupPatientImageRecordsByVisit(cachedRecords);
      }
      const pendingRequest =
        patientImageRecordPromiseCacheRef.current.get(cacheKey);
      if (pendingRequest) {
        return pendingRequest.then((records) =>
          groupPatientImageRecordsByVisit(records),
        );
      }
      const nextRequest = fetchImages(siteId, token, patientId, undefined, signal)
        .then((imageRecords) => {
          const savedImages = imageRecords as SavedImagePreview[];
          storePatientImageRecords(siteId, patientId, savedImages);
          return savedImages;
        })
        .finally(() => {
          patientImageRecordPromiseCacheRef.current.delete(cacheKey);
        });
      patientImageRecordPromiseCacheRef.current.set(cacheKey, nextRequest);
      return nextRequest.then((records) =>
        groupPatientImageRecordsByVisit(records),
      );
    },
    [groupPatientImageRecordsByVisit, storePatientImageRecords, token],
  );

  const ensurePatientVisitImagesLoaded = useCallback(
    async (
      siteId: string,
      caseRecord: CaseSummaryRecord,
      options: {
        signal?: AbortSignal;
        toastOnError?: boolean;
      } = {},
    ): Promise<SavedImagePreview[]> => {
      const cachedImages = caseImageCacheRef.current.get(caseRecord.case_id);
      if (hasSettledCaseImageCache(caseRecord, cachedImages)) {
        commitCaseImages(caseRecord.case_id, cachedImages);
        return cachedImages;
      }

      markPatientVisitGalleryError(caseRecord.case_id, false);
      markPatientVisitGalleryLoading(caseRecord.case_id, true);
      try {
        const images = await loadVisitImageRecords(
          siteId,
          caseRecord.patient_id,
          caseRecord.visit_date,
          options.signal,
        );
        if (options.signal?.aborted) {
          return images;
        }
        commitCaseImages(caseRecord.case_id, images);
        void warmDesktopVisitImagePreviews(
          siteId,
          caseRecord,
          images,
          options.signal,
        );
        return images;
      } catch (nextError) {
        if (!isAbortError(nextError)) {
          markPatientVisitGalleryError(caseRecord.case_id, true);
          if (options.toastOnError) {
            setToast({
              tone: "error",
              message: describeError(
                nextError,
                pick(
                  locale,
                  "Unable to load case images.",
                  "케이스 이미지를 불러오지 못했습니다.",
                ),
              ),
            });
          }
        }
        throw nextError;
      } finally {
        if (!options.signal?.aborted) {
          markPatientVisitGalleryLoading(caseRecord.case_id, false);
        }
      }
    },
    [
      commitCaseImages,
      describeError,
      loadVisitImageRecords,
      locale,
      markPatientVisitGalleryError,
      markPatientVisitGalleryLoading,
      pick,
      setToast,
      warmDesktopVisitImagePreviews,
    ],
  );

  return {
    selectedCaseImageCaseIdRef,
    caseImageCacheRef,
    clearCaseImageCache,
    markPatientVisitGalleryLoading,
    markPatientVisitGalleryError,
    commitCaseImages,
    primeCaseImageCache,
    warmDesktopVisitImagePreviews,
    loadPatientImageRecords,
    ensurePatientVisitImagesLoaded,
  };
}
