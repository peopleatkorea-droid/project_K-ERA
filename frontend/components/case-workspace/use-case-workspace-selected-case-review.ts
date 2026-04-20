"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
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
  sameSavedImagePreviewLists,
} from "./case-workspace-site-data-helpers";
import {
  logCaseOpenGalleryReadySla,
  type CaseOpenSlaSession,
} from "./case-workspace-sla-logging";
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
  workspaceTimingLogs: boolean;
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
  markPatientVisitGalleryLoadingBatch: (
    caseIds: string[],
    loading: boolean,
  ) => void;
  markPatientVisitGalleryError: (caseId: string, failed: boolean) => void;
  markPatientVisitGalleryErrorBatch: (
    caseIds: string[],
    failed: boolean,
  ) => void;
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
  commitPatientVisitGalleryBatch: (
    entries: Record<string, SavedImagePreview[]>,
  ) => void;
  selectedCaseImageCaseIdRef: MutableRefObject<string | null>;
  caseImageCacheRef: MutableRefObject<Map<string, SavedImagePreview[]>>;
  caseHistoryCacheRef: MutableRefObject<Map<string, CaseHistoryResponse>>;
  caseOpenSlaSessionRef: MutableRefObject<CaseOpenSlaSession | null>;
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
  workspaceTimingLogs,
  setPatientVisitGallery,
  setPatientVisitGalleryLoadingCaseIds,
  setPatientVisitGalleryErrorCaseIds,
  setPanelBusy,
  setPatientVisitGalleryBusy,
  setHistoryBusy,
  setCaseHistory,
  replaceSelectedCaseImages,
  markPatientVisitGalleryLoading,
  markPatientVisitGalleryLoadingBatch,
  markPatientVisitGalleryError,
  markPatientVisitGalleryErrorBatch,
  ensurePatientVisitImagesLoaded,
  loadPatientImageRecords,
  commitCaseImages,
  commitPatientVisitGalleryBatch,
  selectedCaseImageCaseIdRef,
  caseImageCacheRef,
  caseHistoryCacheRef,
  caseOpenSlaSessionRef,
}: Args) {
  const caseHistoryPromiseRef = useRef<
    Map<string, Promise<CaseHistoryResponse | null>>
  >(new Map());

  useEffect(() => {
    caseHistoryPromiseRef.current.clear();
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
    if (!selectedSiteId || !selectedCase) {
      selectedCaseImageCaseIdRef.current = null;
      startTransition(() => {
        setCaseHistory(null);
        setPatientVisitGallery({});
        setPatientVisitGalleryBusy(false);
        replaceSelectedCaseImages(null, []);
      });
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
    const nextInitialGallery =
      Object.keys(cachedPatientVisitGallery).length > 0
        ? cachedPatientVisitGallery
        : {
            [currentCase.case_id]: hasCachedSelectedCaseImages
              ? cachedSelectedCaseImages
              : [],
          };
    const uncachedVisitCount = patientCases.filter(
      (caseItem) =>
        !hasSettledCaseImageCache(
          caseItem,
          caseImageCacheRef.current.get(caseItem.case_id),
        ),
    ).length;
    selectedCaseImageCaseIdRef.current = currentCase.case_id;
    startTransition(() => {
      setCaseHistory(null);
      setPatientVisitGalleryBusy(false);
      if (hasCachedSelectedCaseImages) {
        replaceSelectedCaseImages(currentCase.case_id, cachedSelectedCaseImages);
      } else {
        replaceSelectedCaseImages(null, []);
      }
      setPatientVisitGallery(nextInitialGallery);
    });
    if (workspaceTimingLogs && uncachedVisitCount === 0) {
      logCaseOpenGalleryReadySla(caseOpenSlaSessionRef, currentCase.case_id, {
        visitCount: patientCases.length,
        uncachedVisitCount: 0,
        source: "cache",
      });
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
      const uncachedCaseIds = patientCases
        .filter(
          (caseItem) =>
            !hasSettledCaseImageCache(
              caseItem,
              caseImageCacheRef.current.get(caseItem.case_id),
            ),
        )
        .map((caseItem) => caseItem.case_id);
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
        markPatientVisitGalleryErrorBatch(uncachedCaseIds, false);
        markPatientVisitGalleryLoadingBatch(uncachedCaseIds, true);
        const imagesByVisit = await loadPatientImageRecords(
          currentSiteId,
          currentCase.patient_id,
          controller.signal,
        );
        if (cancelled) {
          return;
        }
        const galleryEntries: Record<string, SavedImagePreview[]> = {};
        for (const caseItem of patientCases) {
          galleryEntries[caseItem.case_id] =
            imagesByVisit.get(
              buildVisitImageCacheKey(caseItem.patient_id, caseItem.visit_date),
            ) ?? [];
        }
        commitPatientVisitGalleryBatch(galleryEntries);
        markPatientVisitGalleryErrorBatch(uncachedCaseIds, false);
        markPatientVisitGalleryLoadingBatch(uncachedCaseIds, false);
        if (workspaceTimingLogs) {
          logCaseOpenGalleryReadySla(caseOpenSlaSessionRef, currentCase.case_id, {
            visitCount: patientCases.length,
            uncachedVisitCount: uncachedCaseIds.length,
            source: "fetch",
          });
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          markPatientVisitGalleryErrorBatch(uncachedCaseIds, true);
          markPatientVisitGalleryLoadingBatch(uncachedCaseIds, false);
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
      if (workspaceTimingLogs && patientCases.length === 1) {
        logCaseOpenGalleryReadySla(caseOpenSlaSessionRef, currentCase.case_id, {
          visitCount: 1,
          uncachedVisitCount: hasCachedSelectedCaseImages ? 0 : 1,
          source: hasCachedSelectedCaseImages ? "cache" : "fetch",
        });
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
    markPatientVisitGalleryErrorBatch,
    markPatientVisitGalleryLoadingBatch,
    pick,
    commitPatientVisitGalleryBatch,
    selectedCase,
    selectedPatientCases,
    selectedSiteId,
    setToast,
    token,
    unableLoadCaseHistory,
    workspaceTimingLogs,
  ]);

  useEffect(() => {
    if (!selectedCase || selectedCaseImagesOwnerCaseId !== selectedCase.case_id) {
      return;
    }
    caseImageCacheRef.current.set(selectedCase.case_id, selectedCaseImages);
    setPatientVisitGallery((current) =>
      sameSavedImagePreviewLists(
        current[selectedCase.case_id],
        selectedCaseImages,
      )
        ? current
        : {
            ...current,
            [selectedCase.case_id]: selectedCaseImages,
          },
    );
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
      const cachedHistory =
        options?.forceRefresh === true
          ? null
          : caseHistoryCacheRef.current.get(historyKey);
      if (cachedHistory) {
        setCaseHistory(cachedHistory);
        return;
      }
      const pendingHistory = caseHistoryPromiseRef.current.get(historyKey);
      if (pendingHistory) {
        setHistoryBusy(true);
        try {
          const nextHistory = await pendingHistory;
          if (nextHistory) {
            setCaseHistory(nextHistory);
          }
        } finally {
          setHistoryBusy(false);
        }
        return;
      }
      setHistoryBusy(true);
      try {
        const nextRequest = fetchCaseHistory(siteId, patientId, visitDate, token)
          .then((nextHistory) => {
            caseHistoryCacheRef.current.set(historyKey, nextHistory);
            return nextHistory;
          })
          .catch((nextError) => {
            setCaseHistory(null);
            setToast({
              tone: "error",
              message: describeError(nextError, unableLoadCaseHistory),
            });
            return null;
          })
          .finally(() => {
            caseHistoryPromiseRef.current.delete(historyKey);
          });
        caseHistoryPromiseRef.current.set(historyKey, nextRequest);
        const nextHistory = await nextRequest;
        if (nextHistory) {
          setCaseHistory(nextHistory);
        }
      } catch (nextError) {
        if (!isAbortError(nextError)) {
          setCaseHistory(null);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadCaseHistory),
          });
        }
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
