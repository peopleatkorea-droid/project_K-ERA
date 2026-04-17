"use client";

import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  fetchCaseHistory,
} from "../../lib/api";
import { canUseDesktopTransport } from "../../lib/desktop-transport";
import {
  buildCaseHistoryCacheKey,
  buildVisitImageCacheKey,
  hasSettledCaseImageCache,
  scheduleDeferredBrowserTask,
} from "./case-workspace-site-data-helpers";
import type { SavedImagePreview } from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Setter<T> = Dispatch<SetStateAction<T>>;

type Args = {
  caseImageCacheVersion: number;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  selectedPatientCases: CaseSummaryRecord[];
  selectedCaseImages: SavedImagePreview[];
  selectedCaseImagesOwnerCaseId: string | null;
  token: string;
  locale: "en" | "ko";
  unableLoadCaseHistory: string;
  describeError: (error: unknown, fallback: string) => string;
  pick: (locale: "en" | "ko", en: string, ko: string) => string;
  setToast: (toast: ToastState) => void;
  setPatientVisitGallery: Setter<Record<string, SavedImagePreview[]>>;
  setPatientVisitGalleryLoadingCaseIds: Setter<Record<string, boolean>>;
  setPatientVisitGalleryErrorCaseIds: Setter<Record<string, boolean>>;
  setPanelBusy: Setter<boolean>;
  setPatientVisitGalleryBusy: Setter<boolean>;
  setHistoryBusy: Setter<boolean>;
  setCaseHistory: Setter<CaseHistoryResponse | null>;
  replaceSelectedCaseImages: (
    caseId: string | null,
    images: SavedImagePreview[],
  ) => void;
  markPatientVisitGalleryLoading: (caseId: string, loading: boolean) => void;
  markPatientVisitGalleryError: (caseId: string, failed: boolean) => void;
  ensurePatientVisitImagesLoaded: (
    siteId: string,
    caseRecord: CaseSummaryRecord,
    options?: {
      signal?: AbortSignal;
      toastOnError?: boolean;
    },
  ) => Promise<SavedImagePreview[]>;
  loadPatientImageRecords: (
    siteId: string,
    patientId: string,
    signal?: AbortSignal,
  ) => Promise<Map<string, SavedImagePreview[]>>;
  commitCaseImages: (caseId: string, images: SavedImagePreview[]) => void;
  selectedCaseImageCaseIdRef: MutableRefObject<string | null>;
  caseImageCacheRef: MutableRefObject<Map<string, SavedImagePreview[]>>;
  caseHistoryCacheRef: MutableRefObject<Map<string, CaseHistoryResponse>>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useCaseWorkspaceSelectedCaseReview({
  caseImageCacheVersion,
  selectedSiteId,
  selectedCase,
  selectedPatientCases,
  selectedCaseImages,
  selectedCaseImagesOwnerCaseId,
  token,
  locale,
  unableLoadCaseHistory,
  describeError,
  pick,
  setToast,
  setPatientVisitGallery,
  setPatientVisitGalleryLoadingCaseIds,
  setPatientVisitGalleryErrorCaseIds,
  setPanelBusy,
  setPatientVisitGalleryBusy,
  setHistoryBusy,
  setCaseHistory,
  replaceSelectedCaseImages,
  markPatientVisitGalleryLoading,
  markPatientVisitGalleryError,
  ensurePatientVisitImagesLoaded,
  loadPatientImageRecords,
  commitCaseImages,
  selectedCaseImageCaseIdRef,
  caseImageCacheRef,
  caseHistoryCacheRef,
}: Args) {
  useEffect(() => {
    replaceSelectedCaseImages(null, []);
    setPatientVisitGallery({});
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
    setPanelBusy(false);
    setPatientVisitGalleryBusy(false);
    setHistoryBusy(false);
    setCaseHistory(null);
  }, [selectedSiteId]);

  useEffect(() => {
    replaceSelectedCaseImages(null, []);
    setPatientVisitGallery({});
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
  }, [caseImageCacheVersion]);

  useEffect(() => {
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
  }, [
    selectedCase?.case_id,
    setPatientVisitGalleryErrorCaseIds,
    setPatientVisitGalleryLoadingCaseIds,
  ]);

  useEffect(() => {
    setCaseHistory(null);
    setPatientVisitGallery({});
    setPatientVisitGalleryBusy(false);
    if (!selectedSiteId || !selectedCase) {
      selectedCaseImageCaseIdRef.current = null;
      replaceSelectedCaseImages(null, []);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const patientCases =
      selectedPatientCases.length > 0 &&
      selectedPatientCases.every(
        (item) => item.patient_id === currentCase.patient_id,
      )
        ? selectedPatientCases
        : [currentCase];
    let cancelled = false;
    const controller = new AbortController();

    const cachedSelectedCaseImages = caseImageCacheRef.current.get(
      currentCase.case_id,
    );
    const hasCachedSelectedCaseImages = hasSettledCaseImageCache(
      currentCase,
      cachedSelectedCaseImages,
    );
    const cachedPatientVisitGallery = Object.fromEntries(
      patientCases.flatMap((caseItem) => {
        const cachedImages = caseImageCacheRef.current.get(caseItem.case_id);
        return hasSettledCaseImageCache(caseItem, cachedImages)
          ? [[caseItem.case_id, cachedImages]]
          : [];
      }),
    ) as Record<string, SavedImagePreview[]>;
    if (hasCachedSelectedCaseImages) {
      selectedCaseImageCaseIdRef.current = currentCase.case_id;
      replaceSelectedCaseImages(currentCase.case_id, cachedSelectedCaseImages);
      setPatientVisitGallery(
        Object.keys(cachedPatientVisitGallery).length > 0
          ? cachedPatientVisitGallery
          : { [currentCase.case_id]: cachedSelectedCaseImages },
      );
    } else {
      selectedCaseImageCaseIdRef.current = currentCase.case_id;
      replaceSelectedCaseImages(null, []);
      setPatientVisitGallery(
        Object.keys(cachedPatientVisitGallery).length > 0
          ? cachedPatientVisitGallery
          : { [currentCase.case_id]: [] },
      );
    }

    async function loadSelectedCaseImages(): Promise<void> {
      const selectedCaseNeedsLoading = !hasCachedSelectedCaseImages;
      setPanelBusy(selectedCaseNeedsLoading);
      if (!selectedCaseNeedsLoading) {
        return;
      }
      try {
        const visitImages = await ensurePatientVisitImagesLoaded(
          currentSiteId,
          currentCase,
          {
            signal: controller.signal,
            toastOnError: true,
          },
        );
        if (cancelled) {
          return;
        }
        selectedCaseImageCaseIdRef.current = currentCase.case_id;
        commitCaseImages(currentCase.case_id, visitImages);
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          selectedCaseImageCaseIdRef.current = currentCase.case_id;
          commitCaseImages(currentCase.case_id, []);
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }

    async function loadPatientCaseGallery(): Promise<void> {
      if (patientCases.length === 0) {
        setPatientVisitGalleryBusy(false);
        return;
      }

      const hasUncachedVisit = patientCases.some(
        (caseItem) =>
          !hasSettledCaseImageCache(
            caseItem,
            caseImageCacheRef.current.get(caseItem.case_id),
          ),
      );
      setPatientVisitGalleryBusy(hasUncachedVisit);
      if (patientCases.length === 1) {
        if (!hasCachedSelectedCaseImages) {
          setPatientVisitGallery((current) => ({
            ...current,
            [currentCase.case_id]: current[currentCase.case_id] ?? [],
          }));
        }
        setPatientVisitGalleryBusy(false);
        return;
      }

      try {
        patientCases.forEach((caseItem) => {
          if (
            !hasSettledCaseImageCache(
              caseItem,
              caseImageCacheRef.current.get(caseItem.case_id),
            )
          ) {
            markPatientVisitGalleryError(caseItem.case_id, false);
            markPatientVisitGalleryLoading(caseItem.case_id, true);
          }
        });
        const imagesByVisit = await loadPatientImageRecords(
          currentSiteId,
          currentCase.patient_id,
          controller.signal,
        );
        if (cancelled) {
          return;
        }
        for (const caseItem of patientCases) {
          const visitImages =
            imagesByVisit.get(
              buildVisitImageCacheKey(caseItem.patient_id, caseItem.visit_date),
            ) ?? [];
          commitCaseImages(caseItem.case_id, visitImages);
          markPatientVisitGalleryError(caseItem.case_id, false);
          markPatientVisitGalleryLoading(caseItem.case_id, false);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          patientCases.forEach((caseItem) => {
            if (
              !hasSettledCaseImageCache(
                caseItem,
                caseImageCacheRef.current.get(caseItem.case_id),
              )
            ) {
              markPatientVisitGalleryError(caseItem.case_id, true);
              markPatientVisitGalleryLoading(caseItem.case_id, false);
            }
          });
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(locale, "Unable to load case images.", "케이스 이미지를 불러오지 못했습니다."),
            ),
          });
        }
      } finally {
        if (!cancelled) {
          setPatientVisitGalleryBusy(false);
        }
      }
    }

    async function loadSelectedCaseHistory() {
      const historyKey = buildCaseHistoryCacheKey(
        currentCase.patient_id,
        currentCase.visit_date,
      );
      const cachedHistory = caseHistoryCacheRef.current.get(historyKey);
      if (cachedHistory) {
        setCaseHistory(cachedHistory);
        return;
      }
      setHistoryBusy(true);
      try {
        const nextHistory = await fetchCaseHistory(
          currentSiteId,
          currentCase.patient_id,
          currentCase.visit_date,
          token,
          controller.signal,
        );
        if (!cancelled) {
          caseHistoryCacheRef.current.set(historyKey, nextHistory);
          setCaseHistory(nextHistory);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setCaseHistory(null);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadCaseHistory),
          });
        }
      } finally {
        if (!cancelled) {
          setHistoryBusy(false);
        }
      }
    }

    let cancelDeferredHistory: () => void = () => {};
    const shouldLoadPatientTimelineImmediately =
      canUseDesktopTransport() || patientCases.length > 1;
    const deferredHistoryDelayMs = canUseDesktopTransport() ? 12000 : 1600;
    if (shouldLoadPatientTimelineImmediately) {
      void loadPatientCaseGallery();
    }
    void loadSelectedCaseImages().finally(() => {
      if (cancelled) {
        return;
      }
      if (!shouldLoadPatientTimelineImmediately) {
        void loadPatientCaseGallery();
      }
      cancelDeferredHistory = scheduleDeferredBrowserTask(() => {
        void loadSelectedCaseHistory();
      }, deferredHistoryDelayMs);
    });
    return () => {
      cancelled = true;
      controller.abort();
      cancelDeferredHistory();
    };
  }, [
    caseImageCacheVersion,
    describeError,
    ensurePatientVisitImagesLoaded,
    locale,
    pick,
    selectedCase,
    selectedPatientCases,
    selectedSiteId,
    setToast,
    token,
    unableLoadCaseHistory,
  ]);

  useEffect(() => {
    if (!selectedCase || selectedCaseImagesOwnerCaseId !== selectedCase.case_id) {
      return;
    }
    caseImageCacheRef.current.set(selectedCase.case_id, selectedCaseImages);
    setPatientVisitGallery((current) => ({
      ...current,
      [selectedCase.case_id]: selectedCaseImages,
    }));
  }, [
    caseImageCacheRef,
    selectedCase,
    selectedCaseImages,
    selectedCaseImagesOwnerCaseId,
    setPatientVisitGallery,
  ]);

  const loadCaseHistory = useCallback(
    async (
      siteId: string,
      patientId: string,
      visitDate: string,
      options?: { forceRefresh?: boolean },
    ) => {
      const historyKey = buildCaseHistoryCacheKey(patientId, visitDate);
      const cachedHistory = !options?.forceRefresh
        ? caseHistoryCacheRef.current.get(historyKey)
        : null;
      if (cachedHistory) {
        setCaseHistory(cachedHistory);
        return;
      }
      setHistoryBusy(true);
      try {
        const nextHistory = await fetchCaseHistory(siteId, patientId, visitDate, token);
        caseHistoryCacheRef.current.set(historyKey, nextHistory);
        setCaseHistory(nextHistory);
      } catch (nextError) {
        setCaseHistory(null);
        setToast({
          tone: "error",
          message: describeError(nextError, unableLoadCaseHistory),
        });
      } finally {
        setHistoryBusy(false);
      }
    },
    [
      caseHistoryCacheRef,
      describeError,
      setCaseHistory,
      setHistoryBusy,
      setToast,
      token,
      unableLoadCaseHistory,
    ],
  );

  return {
    loadCaseHistory,
  };
}
