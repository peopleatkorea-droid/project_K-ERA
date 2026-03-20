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
  fetchImagePreviewBlob,
  fetchImages,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
} from "../../lib/api";

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

const CASE_IMAGE_PREVIEW_MAX_SIDE = 640;

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  selectedSiteId: string | null;
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
  selectedSiteId,
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

  const previewCacheSiteIdRef = useRef<string | null>(null);
  const selectedCaseImageCaseIdRef = useRef<string | null>(null);
  const imagePreviewCacheRef = useRef<Map<string, string>>(new Map());
  const imagePreviewPromiseCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const caseImageRecordCacheRef = useRef<Map<string, ImageRecord[]>>(new Map());
  const caseImageRecordPromiseCacheRef = useRef<Map<string, Promise<ImageRecord[]>>>(new Map());
  const caseImageCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);

  function revokeObjectUrls(urls: string[]) {
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  }

  function clearImagePreviewCache() {
    revokeObjectUrls(Array.from(imagePreviewCacheRef.current.values()));
    imagePreviewCacheRef.current.clear();
    imagePreviewPromiseCacheRef.current.clear();
    caseImageRecordCacheRef.current.clear();
    caseImageRecordPromiseCacheRef.current.clear();
    caseImageCacheRef.current.clear();
    selectedCaseImageCaseIdRef.current = null;
  }

  function isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }

  async function loadImagePreviewUrl(siteId: string, imageId: string, signal?: AbortSignal): Promise<string | null> {
    const cachedUrl = imagePreviewCacheRef.current.get(imageId);
    if (cachedUrl) {
      return cachedUrl;
    }
    const pending = imagePreviewPromiseCacheRef.current.get(imageId);
    if (pending) {
      return pending;
    }
    const nextRequest = (async () => {
      try {
        const blob = await fetchImagePreviewBlob(siteId, imageId, token, {
          maxSide: CASE_IMAGE_PREVIEW_MAX_SIDE,
          signal,
        });
        const previewUrl = URL.createObjectURL(blob);
        imagePreviewCacheRef.current.set(imageId, previewUrl);
        return previewUrl;
      } catch {
        return null;
      } finally {
        imagePreviewPromiseCacheRef.current.delete(imageId);
      }
    })();
    imagePreviewPromiseCacheRef.current.set(imageId, nextRequest);
    return nextRequest;
  }

  useEffect(() => {
    return () => {
      clearImagePreviewCache();
    };
  }, []);

  useEffect(() => {
    if (previewCacheSiteIdRef.current === selectedSiteId) {
      return;
    }
    clearImagePreviewCache();
    previewCacheSiteIdRef.current = selectedSiteId;
  }, [selectedSiteId]);

  useEffect(() => {
    siteActivityLoadedSiteIdRef.current = null;
    siteValidationLoadedSiteIdRef.current = null;
    siteModelVersionsLoadedSiteIdRef.current = null;
    setActivityBusy(false);
    setSiteActivity(null);
    setSiteValidationBusy(false);
    setSiteValidationRuns([]);
    setSiteModelVersions([]);
    setSelectedCompareModelVersionIds([]);
  }, [selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) {
      setCases([]);
      setSelectedCase(null);
      setSelectedCaseImages([]);
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
  }, [selectedSiteId, showOnlyMine, token, unableLoadRecentCases]);

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
    const patientCases = cases.filter((item) => item.patient_id === currentCase.patient_id);
    let cancelled = false;
    const controller = new AbortController();

    const cachedSelectedCaseImages = caseImageCacheRef.current.get(currentCase.case_id);
    const cachedPatientVisitGallery = Object.fromEntries(
      patientCases.flatMap((caseItem) => {
        const cachedImages = caseImageCacheRef.current.get(caseItem.case_id);
        return cachedImages ? [[caseItem.case_id, cachedImages]] : [];
      }),
    ) as Record<string, SavedImagePreview[]>;
    if (cachedSelectedCaseImages) {
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

    function buildCaseImagePlaceholders(imageRecords: ImageRecord[]): SavedImagePreview[] {
      return imageRecords.map((record) => ({
        ...record,
        preview_url: imagePreviewCacheRef.current.get(record.image_id) ?? null,
      }));
    }

    function mergePreviewUrlsIntoImages(
      images: SavedImagePreview[],
      previewUrls: Map<string, string>,
    ): SavedImagePreview[] {
      if (previewUrls.size === 0) {
        return images;
      }
      return images.map((item) => {
        const previewUrl = previewUrls.get(item.image_id);
        return previewUrl ? { ...item, preview_url: previewUrl } : item;
      });
    }

    function preserveCachedPreviewUrls(caseId: string, images: SavedImagePreview[]): SavedImagePreview[] {
      const cachedImages = caseImageCacheRef.current.get(caseId) ?? [];
      const cachedPreviewUrls = new Map<string, string>();
      for (const item of cachedImages) {
        if (item.preview_url) {
          cachedPreviewUrls.set(item.image_id, item.preview_url);
        }
      }
      return mergePreviewUrlsIntoImages(images, cachedPreviewUrls);
    }

    function commitCaseImages(caseId: string, images: SavedImagePreview[]) {
      const nextImages = preserveCachedPreviewUrls(caseId, images);
      caseImageCacheRef.current.set(caseId, nextImages);
      setPatientVisitGallery((current) => ({
        ...current,
        [caseId]: nextImages,
      }));
      if (selectedCaseImageCaseIdRef.current === caseId) {
        setSelectedCaseImages(nextImages);
      }
    }

    function applyPreviewUpdates(caseId: string, previewUrls: Map<string, string>) {
      if (previewUrls.size === 0) {
        return;
      }
      setPatientVisitGallery((current) => {
        const baseImages = current[caseId] ?? caseImageCacheRef.current.get(caseId) ?? [];
        const nextImages = mergePreviewUrlsIntoImages(baseImages, previewUrls);
        caseImageCacheRef.current.set(caseId, nextImages);
        return {
          ...current,
          [caseId]: nextImages,
        };
      });
      if (selectedCaseImageCaseIdRef.current === caseId) {
        setSelectedCaseImages((current) => {
          const baseImages = current.length > 0 ? current : caseImageCacheRef.current.get(caseId) ?? [];
          const nextImages = mergePreviewUrlsIntoImages(baseImages, previewUrls);
          caseImageCacheRef.current.set(caseId, nextImages);
          return nextImages;
        });
      }
    }

    async function loadCaseImageRecords(caseItem: CaseSummaryRecord): Promise<ImageRecord[]> {
      const cachedRecords = caseImageRecordCacheRef.current.get(caseItem.case_id);
      if (cachedRecords) {
        return cachedRecords;
      }
      const pendingRequest = caseImageRecordPromiseCacheRef.current.get(caseItem.case_id);
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchImages(
        currentSiteId,
        token,
        caseItem.patient_id,
        caseItem.visit_date,
        controller.signal
      )
        .then((imageRecords) => {
          caseImageRecordCacheRef.current.set(caseItem.case_id, imageRecords);
          return imageRecords;
        })
        .finally(() => {
          caseImageRecordPromiseCacheRef.current.delete(caseItem.case_id);
        });
      caseImageRecordPromiseCacheRef.current.set(caseItem.case_id, nextRequest);
      return nextRequest;
    }

    async function loadSelectedCaseImages(): Promise<void> {
      setPanelBusy(!cachedSelectedCaseImages);
      try {
        const imageRecords = await loadCaseImageRecords(currentCase);
        if (cancelled) {
          return;
        }

        const placeholders = preserveCachedPreviewUrls(currentCase.case_id, buildCaseImagePlaceholders(imageRecords));
        selectedCaseImageCaseIdRef.current = currentCase.case_id;
        commitCaseImages(currentCase.case_id, placeholders);

        const prioritized = [...placeholders].sort((left, right) => {
          if (left.is_representative === right.is_representative) {
            return 0;
          }
          return left.is_representative ? -1 : 1;
        });
        const pendingImages = prioritized.filter((image) => !image.preview_url);
        if (pendingImages.length === 0) {
          return;
        }

        const [priorityImage, ...remainingImages] = pendingImages;
        if (priorityImage) {
          const previewUrl = await loadImagePreviewUrl(currentSiteId, priorityImage.image_id, controller.signal);
          if (cancelled) {
            return;
          }
          if (previewUrl) {
            applyPreviewUpdates(currentCase.case_id, new Map([[priorityImage.image_id, previewUrl]]));
          }
        }

        if (remainingImages.length === 0) {
          return;
        }

        const resolvedEntries = await Promise.allSettled(
          remainingImages.map(async (image) => {
            const previewUrl = await loadImagePreviewUrl(currentSiteId, image.image_id, controller.signal);
            return previewUrl ? ([image.image_id, previewUrl] as const) : null;
          })
        );
        if (cancelled) {
          return;
        }

        const resolvedPreviewUrls = new Map<string, string>();
        for (const entry of resolvedEntries) {
          if (entry.status === "fulfilled" && entry.value) {
            resolvedPreviewUrls.set(entry.value[0], entry.value[1]);
          }
        }
        applyPreviewUpdates(currentCase.case_id, resolvedPreviewUrls);
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          selectedCaseImageCaseIdRef.current = currentCase.case_id;
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(locale, "Unable to load case images.", "耳?댁뒪 ?대?吏瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??")
            ),
          });
          commitCaseImages(currentCase.case_id, []);
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }

    async function loadPatientVisitGalleries() {
      if (patientCases.length === 0) {
        setPatientVisitGalleryBusy(false);
        return;
      }
      const hasUncachedVisit = patientCases.some((caseItem) => !caseImageCacheRef.current.has(caseItem.case_id));
      setPatientVisitGalleryBusy(hasUncachedVisit);
      try {
        const visitEntries = await Promise.all(
          patientCases.map(async (caseItem) => {
            const cachedImages = caseImageCacheRef.current.get(caseItem.case_id);
            if (cachedImages) {
              return [caseItem.case_id, cachedImages] as const;
            }
            const imageRecords = await loadCaseImageRecords(caseItem);
            const placeholders = preserveCachedPreviewUrls(caseItem.case_id, buildCaseImagePlaceholders(imageRecords));
            return [caseItem.case_id, placeholders] as const;
          }),
        );
        if (cancelled) {
          return;
        }
        const nextGallery: Record<string, SavedImagePreview[]> = {};
        for (const [caseId, images] of visitEntries) {
          const nextImages = preserveCachedPreviewUrls(caseId, images);
          caseImageCacheRef.current.set(caseId, nextImages);
          nextGallery[caseId] = nextImages;
        }
        setPatientVisitGallery(nextGallery);

        for (const caseItem of patientCases) {
          if (cancelled || caseItem.case_id === currentCase.case_id) {
            continue;
          }
          const cachedImages = caseImageCacheRef.current.get(caseItem.case_id) ?? [];
          const missingImages = cachedImages.filter((image) => !image.preview_url);
          if (missingImages.length === 0) {
            continue;
          }
          const resolvedEntries = await Promise.allSettled(
            missingImages.map(async (image) => {
              const previewUrl = await loadImagePreviewUrl(currentSiteId, image.image_id, controller.signal);
              return previewUrl ? ([image.image_id, previewUrl] as const) : null;
            }),
          );
          if (cancelled) {
            return;
          }
          const resolvedPreviewUrls = new Map<string, string>();
          for (const entry of resolvedEntries) {
            if (entry.status === "fulfilled" && entry.value) {
              resolvedPreviewUrls.set(entry.value[0], entry.value[1]);
            }
          }
          applyPreviewUpdates(caseItem.case_id, resolvedPreviewUrls);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(locale, "Unable to load this patient's visit gallery.", "이 환자의 방문 이미지 갤러리를 불러오지 못했습니다."),
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
    void loadPatientVisitGalleries();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cases, describeError, locale, pick, selectedCase, selectedSiteId, token, unableLoadCaseHistory]);

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

  async function loadCaseHistory(siteId: string, patientId: string, visitDate: string) {
    setHistoryBusy(true);
    try {
      const nextHistory = await fetchCaseHistory(siteId, patientId, visitDate, token);
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
