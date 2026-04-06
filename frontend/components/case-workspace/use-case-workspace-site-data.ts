"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import {
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type ImageRecord,
  type ModelVersionRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  fetchCaseHistory,
  fetchCases,
  fetchImages,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
  fetchVisitImagesWithPreviews,
} from "../../lib/api";
import { canUseDesktopTransport, ensureDesktopImagePreviews } from "../../lib/desktop-transport";

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

const FOLLOW_UP_VISIT_PATTERN = /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i;

function normalizeVisitMatchKey(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (/^(initial|초진)$/i.test(normalized)) {
    return "initial";
  }
  const followUpMatch = normalized.match(FOLLOW_UP_VISIT_PATTERN);
  if (followUpMatch) {
    return `fu:${String(Number(followUpMatch[1]) || 0)}`;
  }
  return normalized.toLowerCase().replace(/\s+/g, " ");
}

function scheduleDeferredBrowserTask(task: () => void, timeoutMs = 180) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), { timeout: timeoutMs });
    return () => window.cancelIdleCallback(idleId);
  }
  const timerId = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(timerId);
}

function caseSummaryTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue = caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function sortCaseTimelineRecords(records: CaseSummaryRecord[]): CaseSummaryRecord[] {
  return [...records].sort((left, right) => caseSummaryTimestamp(right) - caseSummaryTimestamp(left));
}

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  caseImageCacheVersion: number;
  selectedSiteId: string | null;
  railView: "cases" | "patients";
  token: string;
  showOnlyMine: boolean;
  locale: "en" | "ko";
  unableLoadRecentCases: string;
  unableLoadSiteActivity: string;
  unableLoadSiteValidationHistory: string;
  unableLoadCaseHistory: string;
  defaultModelCompareSelection: (modelVersions: ModelVersionRecord[]) => string[];
  describeError: (error: unknown, fallback: string) => string;
  pick: (locale: "en" | "ko", en: string, ko: string) => string;
  setToast: (toast: ToastState) => void;
};

export function useCaseWorkspaceSiteData({
  caseImageCacheVersion,
  selectedSiteId,
  railView,
  token,
  showOnlyMine,
  locale,
  unableLoadRecentCases,
  unableLoadSiteActivity,
  unableLoadSiteValidationHistory,
  unableLoadCaseHistory,
  defaultModelCompareSelection,
  describeError,
  pick,
  setToast,
}: Args) {
  const [cases, setCases] = useState<CaseSummaryRecord[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseSummaryRecord | null>(null);
  const [selectedPatientCases, setSelectedPatientCases] = useState<CaseSummaryRecord[]>([]);
  const [selectedCaseImages, setSelectedCaseImagesState] = useState<SavedImagePreview[]>([]);
  const [selectedCaseImagesOwnerCaseId, setSelectedCaseImagesOwnerCaseId] = useState<string | null>(null);
  const [patientVisitGallery, setPatientVisitGallery] = useState<Record<string, SavedImagePreview[]>>({});
  const [patientVisitGalleryLoadingCaseIds, setPatientVisitGalleryLoadingCaseIds] = useState<Record<string, boolean>>({});
  const [patientVisitGalleryErrorCaseIds, setPatientVisitGalleryErrorCaseIds] = useState<Record<string, boolean>>({});
  const [panelBusy, setPanelBusy] = useState(false);
  const [patientVisitGalleryBusy, setPatientVisitGalleryBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [siteActivity, setSiteActivity] = useState<SiteActivityResponse | null>(null);
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [siteValidationRuns, setSiteValidationRuns] = useState<SiteValidationRunRecord[]>([]);
  const [siteModelVersions, setSiteModelVersions] = useState<ModelVersionRecord[]>([]);
  const [selectedCompareModelVersionIds, setSelectedCompareModelVersionIds] = useState<string[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [caseHistory, setCaseHistory] = useState<CaseHistoryResponse | null>(null);

  const selectedCaseImageCaseIdRef = useRef<string | null>(null);
  const visitImageRecordCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const visitImageRecordPromiseCacheRef = useRef<Map<string, Promise<SavedImagePreview[]>>>(new Map());
  const visitImagePreviewWarmPromiseCacheRef = useRef<Map<string, Promise<void>>>(new Map());
  const patientImageRecordCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const patientImageRecordPromiseCacheRef = useRef<Map<string, Promise<SavedImagePreview[]>>>(new Map());
  const patientCaseTimelineCacheRef = useRef<Map<string, CaseSummaryRecord[]>>(new Map());
  const patientCaseTimelinePromiseCacheRef = useRef<Map<string, Promise<CaseSummaryRecord[]>>>(new Map());
  const patientCaseTimelineReadyRef = useRef<Map<string, boolean>>(new Map());
  const caseImageCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const caseHistoryCacheRef = useRef<Map<string, CaseHistoryResponse>>(new Map());
  const siteCasesLoadedRef = useRef(false);
  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);

  function clearCaseImageCache() {
    visitImageRecordCacheRef.current.clear();
    visitImageRecordPromiseCacheRef.current.clear();
    visitImagePreviewWarmPromiseCacheRef.current.clear();
    patientImageRecordCacheRef.current.clear();
    patientImageRecordPromiseCacheRef.current.clear();
    caseImageCacheRef.current.clear();
    selectedCaseImageCaseIdRef.current = null;
  }

  function clearPatientCaseTimelineCache() {
    patientCaseTimelineCacheRef.current.clear();
    patientCaseTimelinePromiseCacheRef.current.clear();
    patientCaseTimelineReadyRef.current.clear();
  }

  function isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }

  function buildCaseHistoryCacheKey(patientId: string, visitDate: string): string {
    return `${patientId}::${visitDate}`;
  }

  function buildVisitImageCacheKey(patientId: string, visitDate: string): string {
    return `${patientId}::${normalizeVisitMatchKey(visitDate)}`;
  }

  function buildPatientImageCacheKey(siteId: string, patientId: string): string {
    return `${siteId.trim()}::${patientId.trim()}`;
  }

function buildPatientCaseTimelineCacheKey(siteId: string, showOnlyMine: boolean, patientId: string): string {
  return `${siteId.trim()}::${showOnlyMine ? "mine" : "all"}::${patientId.trim()}`;
}

function mergeCaseTimelineRecords(...groups: CaseSummaryRecord[][]): CaseSummaryRecord[] {
  const byCaseId = new Map<string, CaseSummaryRecord>();
  for (const group of groups) {
    for (const item of group) {
      const caseId = String(item.case_id ?? "").trim();
      if (!caseId) {
        continue;
      }
      byCaseId.set(caseId, item);
    }
  }
  return sortCaseTimelineRecords(Array.from(byCaseId.values()));
}

  function hasSettledCaseImageCache(
    caseRecord: CaseSummaryRecord,
    cachedImages: SavedImagePreview[] | undefined,
  ): cachedImages is SavedImagePreview[] {
    if (!cachedImages) {
      return false;
    }
    if (cachedImages.length > 0) {
      return true;
    }
    return Number(caseRecord.image_count || 0) <= 0;
  }

  function markPatientVisitGalleryLoading(caseId: string, loading: boolean) {
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
  }

  function markPatientVisitGalleryError(caseId: string, failed: boolean) {
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
  }

  function replaceSelectedCaseImages(caseId: string | null, images: SavedImagePreview[]) {
    setSelectedCaseImagesOwnerCaseId(caseId);
    setSelectedCaseImagesState(images);
  }

  const setSelectedCaseImages = useCallback((
    next:
      | SavedImagePreview[]
      | ((current: SavedImagePreview[]) => SavedImagePreview[]),
  ) => {
    setSelectedCaseImagesState((current) => (
      typeof next === "function"
        ? next(current)
        : next
    ));
  }, []);

  function commitCaseImages(caseId: string, images: SavedImagePreview[]) {
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
  }

  function primeCaseImageCache(caseRecord: CaseSummaryRecord, images: SavedImagePreview[]) {
    const visitCacheKey = buildVisitImageCacheKey(caseRecord.patient_id, caseRecord.visit_date);
    visitImageRecordPromiseCacheRef.current.delete(visitCacheKey);
    visitImageRecordCacheRef.current.set(visitCacheKey, images);
    if (selectedSiteId) {
      const patientCacheKey = buildPatientImageCacheKey(selectedSiteId, caseRecord.patient_id);
      const cachedPatientImages = patientImageRecordCacheRef.current.get(patientCacheKey) ?? [];
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
  }

  async function warmDesktopVisitImagePreviews(
    siteId: string,
    caseRecord: CaseSummaryRecord,
    images: SavedImagePreview[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (!canUseDesktopTransport()) {
      return;
    }
    const imageIds = images
      .map((image) => String(image.image_id ?? "").trim())
      .filter((imageId) => imageId.length > 0);
    if (!imageIds.length) {
      return;
    }
    const cacheKey = buildVisitImageCacheKey(caseRecord.patient_id, caseRecord.visit_date);
    const pendingWarm = visitImagePreviewWarmPromiseCacheRef.current.get(cacheKey);
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
        const cachedImages = visitImageRecordCacheRef.current.get(cacheKey) ?? images;
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
  }

  async function loadVisitImageRecords(
    siteId: string,
    patientId: string,
    visitDate: string,
    signal?: AbortSignal,
  ): Promise<SavedImagePreview[]> {
    const cacheKey = buildVisitImageCacheKey(patientId, visitDate);
    const cachedRecords = visitImageRecordCacheRef.current.get(cacheKey);
    if (cachedRecords) {
      return cachedRecords;
    }
    const pendingRequest = visitImageRecordPromiseCacheRef.current.get(cacheKey);
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
  }

  function groupPatientImageRecordsByVisit(
    imageRecords: SavedImagePreview[],
  ): Map<string, SavedImagePreview[]> {
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
  }

  function storePatientImageRecords(
    siteId: string,
    patientId: string,
    imageRecords: SavedImagePreview[],
  ): Map<string, SavedImagePreview[]> {
    const patientCacheKey = buildPatientImageCacheKey(siteId, patientId);
    patientImageRecordCacheRef.current.set(patientCacheKey, imageRecords);
    const grouped = groupPatientImageRecordsByVisit(imageRecords);
    for (const [visitCacheKey, visitImages] of grouped.entries()) {
      visitImageRecordPromiseCacheRef.current.delete(visitCacheKey);
      visitImageRecordCacheRef.current.set(visitCacheKey, visitImages);
    }
    return grouped;
  }

  async function loadPatientImageRecords(
    siteId: string,
    patientId: string,
    signal?: AbortSignal,
  ): Promise<Map<string, SavedImagePreview[]>> {
    const cacheKey = buildPatientImageCacheKey(siteId, patientId);
    const cachedRecords = patientImageRecordCacheRef.current.get(cacheKey);
    if (cachedRecords) {
      return groupPatientImageRecordsByVisit(cachedRecords);
    }
    const pendingRequest = patientImageRecordPromiseCacheRef.current.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest.then((records) => groupPatientImageRecordsByVisit(records));
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
    return nextRequest.then((records) => groupPatientImageRecordsByVisit(records));
  }

  const ensurePatientVisitImagesLoaded = useCallback(async (
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
      void warmDesktopVisitImagePreviews(siteId, caseRecord, images, options.signal);
      return images;
    } catch (nextError) {
      if (!isAbortError(nextError)) {
        markPatientVisitGalleryError(caseRecord.case_id, true);
        if (options.toastOnError) {
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load case images.", "케이스 이미지를 불러오지 못했습니다.")),
          });
        }
      }
      throw nextError;
    } finally {
      if (!options.signal?.aborted) {
        markPatientVisitGalleryLoading(caseRecord.case_id, false);
      }
    }
  }, [describeError, locale, pick, setToast, token]);

  useEffect(() => {
    siteActivityLoadedSiteIdRef.current = null;
    siteValidationLoadedSiteIdRef.current = null;
    siteModelVersionsLoadedSiteIdRef.current = null;
    siteCasesLoadedRef.current = false;
    clearCaseImageCache();
    clearPatientCaseTimelineCache();
    setCases([]);
    setCasesLoading(false);
    setSelectedCase(null);
    setSelectedPatientCases([]);
    replaceSelectedCaseImages(null, []);
    setPatientVisitGallery({});
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
    setPanelBusy(false);
    setPatientVisitGalleryBusy(false);
    caseHistoryCacheRef.current.clear();
    setActivityBusy(false);
    setSiteActivity(null);
    setSiteValidationBusy(false);
    setSiteValidationRuns([]);
    setSiteModelVersions([]);
    setSelectedCompareModelVersionIds([]);
    setHistoryBusy(false);
    setCaseHistory(null);
  }, [selectedSiteId]);

  useEffect(() => {
    clearCaseImageCache();
    clearPatientCaseTimelineCache();
    replaceSelectedCaseImages(null, []);
    setPatientVisitGallery({});
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
  }, [caseImageCacheVersion]);

  useEffect(() => {
    setPatientVisitGalleryLoadingCaseIds({});
    setPatientVisitGalleryErrorCaseIds({});
  }, [selectedCase?.case_id]);

  useEffect(() => {
    clearPatientCaseTimelineCache();
    siteCasesLoadedRef.current = false;
  }, [showOnlyMine]);

  useEffect(() => {
    if (!selectedSiteId || selectedPatientCases.length === 0) {
      return;
    }
    const patientId = selectedPatientCases[0]?.patient_id?.trim();
    if (!patientId) {
      return;
    }
    const cacheKey = buildPatientCaseTimelineCacheKey(selectedSiteId, showOnlyMine, patientId);
    if (!patientCaseTimelineReadyRef.current.get(cacheKey)) {
      return;
    }
    patientCaseTimelineCacheRef.current.set(
      cacheKey,
      sortCaseTimelineRecords(selectedPatientCases),
    );
  }, [selectedPatientCases, selectedSiteId, showOnlyMine]);

  useEffect(() => {
    if (!selectedSiteId) {
      setCases([]);
      setSelectedCase(null);
      replaceSelectedCaseImages(null, []);
      return;
    }
    if (railView === "patients") {
      setCasesLoading(false);
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const controller = new AbortController();

    async function loadRecords() {
      setCasesLoading(true);
      siteCasesLoadedRef.current = false;
      try {
        const nextCases = await fetchCases(currentSiteId, token, { mine: showOnlyMine, signal: controller.signal });
        if (cancelled) {
          return;
        }
        siteCasesLoadedRef.current = true;
        setCases(nextCases);
        setSelectedCase((current) => {
          if (!current) {
            return null;
          }
          return nextCases.find((item) => item.case_id === current.case_id) ?? null;
        });
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadRecentCases),
          });
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
        }
      }
    }

    void loadRecords();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [describeError, railView, selectedSiteId, setToast, showOnlyMine, token, unableLoadRecentCases]);

  useEffect(() => {
    if (!selectedSiteId || !selectedCase) {
      setSelectedPatientCases([]);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const cacheKey = buildPatientCaseTimelineCacheKey(currentSiteId, showOnlyMine, currentCase.patient_id);
    let cancelled = false;
    const controller = new AbortController();

    function syncSelectedCaseFromTimeline(timeline: CaseSummaryRecord[]) {
      const refreshedCase =
        timeline.find((item) => item.case_id === currentCase.case_id) ??
        timeline.find(
          (item) =>
            item.patient_id === currentCase.patient_id &&
            item.visit_date === currentCase.visit_date,
        ) ??
        null;
      if (!refreshedCase) {
        return;
      }
      setSelectedCase((active) => {
        if (!active) {
          return active;
        }
        if (
          active.patient_id !== currentCase.patient_id ||
          active.visit_date !== currentCase.visit_date
        ) {
          return active;
        }
        return refreshedCase;
      });
    }

    async function loadPatientCaseTimeline(patientId: string): Promise<CaseSummaryRecord[]> {
      const patientTimelineCacheKey = buildPatientCaseTimelineCacheKey(currentSiteId, showOnlyMine, patientId);
      const cachedTimeline = patientCaseTimelineCacheRef.current.get(patientTimelineCacheKey);
      if (cachedTimeline && patientCaseTimelineReadyRef.current.get(patientTimelineCacheKey)) {
        return cachedTimeline;
      }
      const pendingRequest = patientCaseTimelinePromiseCacheRef.current.get(patientTimelineCacheKey);
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchCases(currentSiteId, token, {
        mine: showOnlyMine,
        patientId,
        signal: controller.signal,
      })
        .then((items) => {
          const sortedItems = sortCaseTimelineRecords(items);
          patientCaseTimelineReadyRef.current.set(patientTimelineCacheKey, true);
          patientCaseTimelineCacheRef.current.set(patientTimelineCacheKey, sortedItems);
          return sortedItems;
        })
        .finally(() => {
          patientCaseTimelinePromiseCacheRef.current.delete(patientTimelineCacheKey);
        });
      patientCaseTimelinePromiseCacheRef.current.set(patientTimelineCacheKey, nextRequest);
      return nextRequest;
    }

    const cachedTimeline = patientCaseTimelineCacheRef.current.get(cacheKey);
    if (
      cachedTimeline &&
      patientCaseTimelineReadyRef.current.get(cacheKey) &&
      cachedTimeline.some((item) => item.case_id === currentCase.case_id)
    ) {
      setSelectedPatientCases(cachedTimeline);
      syncSelectedCaseFromTimeline(cachedTimeline);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    // Protected UX: a locally seeded selected case is never treated as authoritative
    // patient history. Use any known visits immediately, then reconcile with a
    // patient-scoped fetch so older visits do not disappear from the timeline.
    const optimisticTimeline = mergeCaseTimelineRecords(
      selectedPatientCases.filter((item) => item.patient_id === currentCase.patient_id),
      cases.filter((item) => item.patient_id === currentCase.patient_id),
      [currentCase],
    );
    if (optimisticTimeline.length > 0) {
      setSelectedPatientCases(optimisticTimeline);
      syncSelectedCaseFromTimeline(optimisticTimeline);
    } else {
      setSelectedPatientCases([currentCase]);
    }

    void loadPatientCaseTimeline(currentCase.patient_id)
      .then((timeline) => {
        if (cancelled) {
          return;
        }
        setSelectedPatientCases(timeline);
        syncSelectedCaseFromTimeline(timeline);
      })
      .catch((nextError) => {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Unable to load this patient's visit timeline.",
                "이 환자의 방문 타임라인을 불러오지 못했습니다.",
              ),
            ),
          });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [caseImageCacheVersion, cases, describeError, locale, pick, selectedCase, selectedSiteId, setToast, showOnlyMine, token]);

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
      selectedPatientCases.every((item) => item.patient_id === currentCase.patient_id)
        ? selectedPatientCases
        : [currentCase];
    let cancelled = false;
    const controller = new AbortController();

    const cachedSelectedCaseImages = caseImageCacheRef.current.get(currentCase.case_id);
    const hasCachedSelectedCaseImages = hasSettledCaseImageCache(currentCase, cachedSelectedCaseImages);
    const cachedPatientVisitGallery = Object.fromEntries(
      patientCases.flatMap((caseItem) => {
        const cachedImages = caseImageCacheRef.current.get(caseItem.case_id);
        return hasSettledCaseImageCache(caseItem, cachedImages) ? [[caseItem.case_id, cachedImages]] : [];
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
      setPatientVisitGallery(Object.keys(cachedPatientVisitGallery).length > 0 ? cachedPatientVisitGallery : { [currentCase.case_id]: [] });
    }
    // Preview warming is fire-and-forget, never blocks list rendering
    if (hasCachedSelectedCaseImages) {
      setTimeout(() => {
        void warmDesktopVisitImagePreviews(
          currentSiteId,
          currentCase,
          cachedSelectedCaseImages,
          controller.signal,
        );
      }, 500);
    }

    async function loadSelectedCaseImages(): Promise<void> {
      const selectedCaseNeedsLoading = !hasCachedSelectedCaseImages;
      setPanelBusy(selectedCaseNeedsLoading);
      if (!selectedCaseNeedsLoading) {
        return;
      }
      try {
        const visitImages = await ensurePatientVisitImagesLoaded(currentSiteId, currentCase, {
          signal: controller.signal,
          toastOnError: true,
        });
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
        (caseItem) => !hasSettledCaseImageCache(caseItem, caseImageCacheRef.current.get(caseItem.case_id)),
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
          if (!hasSettledCaseImageCache(caseItem, caseImageCacheRef.current.get(caseItem.case_id))) {
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
          void warmDesktopVisitImagePreviews(
            currentSiteId,
            caseItem,
            visitImages,
            controller.signal,
          );
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          patientCases.forEach((caseItem) => {
            if (!hasSettledCaseImageCache(caseItem, caseImageCacheRef.current.get(caseItem.case_id))) {
              markPatientVisitGalleryError(caseItem.case_id, true);
              markPatientVisitGalleryLoading(caseItem.case_id, false);
            }
          });
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load case images.", "耳?댁뒪 ?대?吏瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??")),
          });
        }
      } finally {
        if (!cancelled) {
          setPatientVisitGalleryBusy(false);
        }
      }
    }

    async function loadSelectedCaseHistory() {
      const historyKey = buildCaseHistoryCacheKey(currentCase.patient_id, currentCase.visit_date);
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
    // Keep selected-visit rendering responsive, but start patient-wide gallery
    // hydration immediately when multiple visits are already known.
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
  }, [caseImageCacheVersion, describeError, ensurePatientVisitImagesLoaded, locale, pick, selectedCase, selectedPatientCases, selectedSiteId, unableLoadCaseHistory]);

  useEffect(() => {
    if (!selectedCase || selectedCaseImagesOwnerCaseId !== selectedCase.case_id) {
      return;
    }
    caseImageCacheRef.current.set(selectedCase.case_id, selectedCaseImages);
    setPatientVisitGallery((current) => ({
      ...current,
      [selectedCase.case_id]: selectedCaseImages,
    }));
  }, [selectedCase, selectedCaseImages, selectedCaseImagesOwnerCaseId]);

  async function loadCaseHistory(siteId: string, patientId: string, visitDate: string, options?: { forceRefresh?: boolean }) {
    const historyKey = buildCaseHistoryCacheKey(patientId, visitDate);
    const cachedHistory = !options?.forceRefresh ? caseHistoryCacheRef.current.get(historyKey) : null;
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
  }

  const loadSiteActivity = useCallback(async (siteId: string, signal?: AbortSignal) => {
    setActivityBusy(true);
    try {
      const nextActivity = await fetchSiteActivity(siteId, token, signal);
      setSiteActivity(nextActivity);
      siteActivityLoadedSiteIdRef.current = siteId;
      return nextActivity;
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return null;
      }
      setSiteActivity(null);
      setToast({
        tone: "error",
        message: describeError(nextError, unableLoadSiteActivity),
      });
      return null;
    } finally {
      setActivityBusy(false);
    }
  }, [describeError, setToast, token, unableLoadSiteActivity]);

  const ensureSiteActivityLoaded = useCallback(async (siteId: string, signal?: AbortSignal) => {
    if (siteActivityLoadedSiteIdRef.current === siteId) {
      return siteActivity;
    }
    return loadSiteActivity(siteId, signal);
  }, [loadSiteActivity, siteActivity]);

  const loadSiteValidationRuns = useCallback(async (siteId: string, signal?: AbortSignal) => {
    setSiteValidationBusy(true);
    try {
      const nextRuns = await fetchSiteValidations(siteId, token, signal);
      setSiteValidationRuns(nextRuns);
      siteValidationLoadedSiteIdRef.current = siteId;
      return nextRuns;
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return [];
      }
      setSiteValidationRuns([]);
      setToast({
        tone: "error",
        message: describeError(nextError, unableLoadSiteValidationHistory),
      });
      return [];
    } finally {
      setSiteValidationBusy(false);
    }
  }, [describeError, setToast, token, unableLoadSiteValidationHistory]);

  const ensureSiteValidationRunsLoaded = useCallback(async (siteId: string, signal?: AbortSignal) => {
    if (siteValidationLoadedSiteIdRef.current === siteId) {
      return siteValidationRuns;
    }
    return loadSiteValidationRuns(siteId, signal);
  }, [loadSiteValidationRuns, siteValidationRuns]);

  const loadSiteModelVersions = useCallback(async (siteId: string, signal?: AbortSignal) => {
    try {
      const nextVersions = await fetchSiteModelVersions(siteId, token, signal);
      setSiteModelVersions(nextVersions);
      siteModelVersionsLoadedSiteIdRef.current = siteId;
      setSelectedCompareModelVersionIds((current) => {
        const availableVersionIds = new Set(nextVersions.map((item) => item.version_id));
        const retained = current.filter((versionId) => availableVersionIds.has(versionId));
        return retained.length > 0 ? retained : defaultModelCompareSelection(nextVersions);
      });
      return nextVersions;
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return [];
      }
      setSiteModelVersions([]);
      setSelectedCompareModelVersionIds([]);
      return [];
    }
  }, [defaultModelCompareSelection, token]);

  const ensureSiteModelVersionsLoaded = useCallback(async (siteId: string, signal?: AbortSignal) => {
    if (siteModelVersionsLoadedSiteIdRef.current === siteId) {
      return siteModelVersions;
    }
    return loadSiteModelVersions(siteId, signal);
  }, [loadSiteModelVersions, siteModelVersions]);

  return {
    cases,
    setCases,
    casesLoading,
    selectedCase,
    setSelectedCase,
    selectedPatientCases,
    setSelectedPatientCases,
    selectedCaseImages,
    setSelectedCaseImages,
    patientVisitGallery,
    setPatientVisitGallery,
    patientVisitGalleryLoadingCaseIds,
    patientVisitGalleryErrorCaseIds,
    panelBusy,
    patientVisitGalleryBusy,
    activityBusy,
    siteActivity,
    setSiteActivity,
    siteValidationBusy,
    setSiteValidationBusy,
    siteValidationRuns,
    setSiteValidationRuns,
    siteModelVersions,
    setSiteModelVersions,
    selectedCompareModelVersionIds,
    setSelectedCompareModelVersionIds,
    historyBusy,
    caseHistory,
    setCaseHistory,
    loadCaseHistory,
    ensurePatientVisitImagesLoaded,
    primeCaseImageCache,
    loadSiteActivity,
    loadSiteValidationRuns,
    loadSiteModelVersions,
    ensureSiteActivityLoaded,
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  };
}
