"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type ImageRecord,
  type ModelVersionRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  fetchCaseHistory,
  fetchCases,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
  fetchVisitImagesWithPreviews,
} from "../../lib/api";

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

function normalizeVisitMatchKey(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (/^(initial|초진)$/i.test(normalized)) {
    return "initial";
  }
  const followUpMatch = normalized.match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
  if (followUpMatch) {
    return `fu:${String(Number(followUpMatch[1]) || 0)}`;
  }
  return normalized.toLowerCase().replace(/\s+/g, " ");
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
  const [selectedCaseImages, setSelectedCaseImages] = useState<SavedImagePreview[]>([]);
  const [patientVisitGallery, setPatientVisitGallery] = useState<Record<string, SavedImagePreview[]>>({});
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
  const caseImageCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const caseHistoryCacheRef = useRef<Map<string, CaseHistoryResponse>>(new Map());
  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);

  function clearCaseImageCache() {
    visitImageRecordCacheRef.current.clear();
    visitImageRecordPromiseCacheRef.current.clear();
    caseImageCacheRef.current.clear();
    selectedCaseImageCaseIdRef.current = null;
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

  useEffect(() => {
    siteActivityLoadedSiteIdRef.current = null;
    siteValidationLoadedSiteIdRef.current = null;
    siteModelVersionsLoadedSiteIdRef.current = null;
    clearCaseImageCache();
    setCases([]);
    setCasesLoading(false);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPatientVisitGallery({});
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
    setSelectedCaseImages([]);
    setPatientVisitGallery({});
  }, [caseImageCacheVersion]);

  useEffect(() => {
    if (!selectedSiteId) {
      setCases([]);
      setSelectedCase(null);
      setSelectedCaseImages([]);
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
      try {
        const nextCases = await fetchCases(currentSiteId, token, { mine: showOnlyMine, signal: controller.signal });
        if (cancelled) {
          return;
        }
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
    setCaseHistory(null);
    setPatientVisitGallery({});
    setPatientVisitGalleryBusy(false);
    if (!selectedSiteId || !selectedCase) {
      selectedCaseImageCaseIdRef.current = null;
      setSelectedCaseImages([]);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const matchedPatientCases = cases.filter((item) => item.patient_id === currentCase.patient_id);
    const patientCases = matchedPatientCases.length > 0 ? matchedPatientCases : [currentCase];
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
      setSelectedCaseImages(cachedSelectedCaseImages);
      setPatientVisitGallery(
        Object.keys(cachedPatientVisitGallery).length > 0
          ? cachedPatientVisitGallery
          : { [currentCase.case_id]: cachedSelectedCaseImages },
      );
    } else {
      selectedCaseImageCaseIdRef.current = currentCase.case_id;
      setSelectedCaseImages([]);
      setPatientVisitGallery(Object.keys(cachedPatientVisitGallery).length > 0 ? cachedPatientVisitGallery : { [currentCase.case_id]: [] });
    }

    function commitCaseImages(caseId: string, images: SavedImagePreview[]) {
      caseImageCacheRef.current.set(caseId, images);
      setPatientVisitGallery((current) => ({
        ...current,
        [caseId]: images,
      }));
      if (selectedCaseImageCaseIdRef.current === caseId) {
        setSelectedCaseImages(images);
      }
    }

    async function loadVisitImageRecords(patientId: string, visitDate: string): Promise<SavedImagePreview[]> {
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
        currentSiteId,
        token,
        patientId,
        visitDate,
        { signal: controller.signal },
      )
        .then((imageRecords) => {
          visitImageRecordCacheRef.current.set(cacheKey, imageRecords);
          return imageRecords;
        })
        .finally(() => {
          visitImageRecordPromiseCacheRef.current.delete(cacheKey);
        });
      visitImageRecordPromiseCacheRef.current.set(cacheKey, nextRequest);
      return nextRequest;
    }

    async function loadSelectedCaseImages(): Promise<void> {
      const selectedCaseNeedsLoading = !hasCachedSelectedCaseImages;
      setPanelBusy(selectedCaseNeedsLoading);
      if (!selectedCaseNeedsLoading) {
        return;
      }
      try {
        const visitImages = await loadVisitImageRecords(currentCase.patient_id, currentCase.visit_date);
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
          setToast({
            tone: "error",
            message: describeError(nextError, pick(locale, "Unable to load case images.", "耳?댁뒪 ?대?吏瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??")),
          });
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
        const nextGallery: Record<string, SavedImagePreview[]> = {};
        const galleryEntries = await Promise.all(
          patientCases.map(async (caseItem) => {
            const cachedImages = caseImageCacheRef.current.get(caseItem.case_id);
            if (hasSettledCaseImageCache(caseItem, cachedImages)) {
              return [caseItem.case_id, cachedImages] as const;
            }
            const visitImages = await loadVisitImageRecords(caseItem.patient_id, caseItem.visit_date);
            return [caseItem.case_id, visitImages] as const;
          }),
        );
        for (const [caseId, images] of galleryEntries) {
          caseImageCacheRef.current.set(caseId, images);
          nextGallery[caseId] = images;
        }

        if (cancelled) {
          return;
        }

        const selectedImages = nextGallery[currentCase.case_id] ?? caseImageCacheRef.current.get(currentCase.case_id) ?? [];
        selectedCaseImageCaseIdRef.current = currentCase.case_id;
        setSelectedCaseImages(selectedImages);
        setPatientVisitGallery((current) => ({
          ...current,
          ...nextGallery,
        }));
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
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

    void loadSelectedCaseImages();
    void loadPatientCaseGallery();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [caseImageCacheVersion, cases, describeError, locale, pick, selectedCase, selectedSiteId, token, unableLoadCaseHistory]);

  useEffect(() => {
    if (!selectedCase || selectedCaseImageCaseIdRef.current !== selectedCase.case_id) {
      return;
    }
    caseImageCacheRef.current.set(selectedCase.case_id, selectedCaseImages);
    setPatientVisitGallery((current) => ({
      ...current,
      [selectedCase.case_id]: selectedCaseImages,
    }));
  }, [selectedCase, selectedCaseImages]);

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
    selectedCaseImages,
    setSelectedCaseImages,
    patientVisitGallery,
    setPatientVisitGallery,
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
    loadSiteActivity,
    loadSiteValidationRuns,
    loadSiteModelVersions,
    ensureSiteActivityLoaded,
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  };
}
