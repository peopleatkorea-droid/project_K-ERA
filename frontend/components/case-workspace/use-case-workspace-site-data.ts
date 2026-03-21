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
  fetchImagePreviewBlob,
  fetchImagePreviewBatch,
  fetchCases,
  fetchImages,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
} from "../../lib/api";

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

const CASE_IMAGE_PREVIEW_MAX_SIDE = 640;

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

  const previewCacheSiteIdRef = useRef<string | null>(null);
  const selectedCaseImageCaseIdRef = useRef<string | null>(null);
  const imagePreviewCacheRef = useRef<Map<string, string>>(new Map());
  const imagePreviewPromiseCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const imagePreviewReadyRef = useRef<Set<string>>(new Set());
  const imagePreviewReadyPromiseCacheRef = useRef<Map<string, Promise<void>>>(new Map());
  const patientImageRecordCacheRef = useRef<Map<string, ImageRecord[]>>(new Map());
  const patientImageRecordPromiseCacheRef = useRef<Map<string, Promise<ImageRecord[]>>>(new Map());
  const visitImageRecordCacheRef = useRef<Map<string, ImageRecord[]>>(new Map());
  const visitImageRecordPromiseCacheRef = useRef<Map<string, Promise<ImageRecord[]>>>(new Map());
  const caseImageCacheRef = useRef<Map<string, SavedImagePreview[]>>(new Map());
  const caseHistoryCacheRef = useRef<Map<string, CaseHistoryResponse>>(new Map());
  const siteActivityLoadedSiteIdRef = useRef<string | null>(null);
  const siteValidationLoadedSiteIdRef = useRef<string | null>(null);
  const siteModelVersionsLoadedSiteIdRef = useRef<string | null>(null);

  function revokeObjectUrls(urls: Iterable<string>) {
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  }

  function clearImagePreviewCache() {
    revokeObjectUrls(imagePreviewCacheRef.current.values());
    imagePreviewCacheRef.current.clear();
    imagePreviewPromiseCacheRef.current.clear();
    imagePreviewReadyRef.current.clear();
    imagePreviewReadyPromiseCacheRef.current.clear();
    patientImageRecordCacheRef.current.clear();
    patientImageRecordPromiseCacheRef.current.clear();
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

  function buildImagePreviewReadyKey(imageId: string, maxSide: number): string {
    return `${maxSide}::${imageId}`;
  }

  async function ensureImagePreviewsReady(
    siteId: string,
    imageIds: string[],
    maxSide: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const normalizedMaxSide = Math.min(Math.max(Math.round(maxSide || CASE_IMAGE_PREVIEW_MAX_SIDE), 96), 1024);
    const uniqueImageIds = Array.from(new Set(imageIds.map((imageId) => String(imageId ?? "").trim()).filter(Boolean)));
    if (uniqueImageIds.length === 0) {
      return;
    }

    const pendingRequests: Promise<void>[] = [];
    const imageIdsToRequest: string[] = [];
    for (const imageId of uniqueImageIds) {
      const cacheKey = buildImagePreviewReadyKey(imageId, normalizedMaxSide);
      if (imagePreviewCacheRef.current.has(imageId)) {
        imagePreviewReadyRef.current.add(cacheKey);
        continue;
      }
      if (imagePreviewReadyRef.current.has(cacheKey)) {
        continue;
      }
      const pending = imagePreviewReadyPromiseCacheRef.current.get(cacheKey);
      if (pending) {
        pendingRequests.push(pending);
        continue;
      }
      imageIdsToRequest.push(imageId);
    }

    if (imageIdsToRequest.length > 0) {
      const requestPromise = fetchImagePreviewBatch(siteId, token, {
        imageIds: imageIdsToRequest,
        maxSide: normalizedMaxSide,
        signal,
      })
        .then((response) => {
          for (const item of response.items) {
            if (!item.ready) {
              continue;
            }
            imagePreviewReadyRef.current.add(buildImagePreviewReadyKey(item.image_id, normalizedMaxSide));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          for (const imageId of imageIdsToRequest) {
            imagePreviewReadyPromiseCacheRef.current.delete(buildImagePreviewReadyKey(imageId, normalizedMaxSide));
          }
        });
      for (const imageId of imageIdsToRequest) {
        imagePreviewReadyPromiseCacheRef.current.set(
          buildImagePreviewReadyKey(imageId, normalizedMaxSide),
          requestPromise,
        );
      }
      pendingRequests.push(requestPromise);
    }

    if (pendingRequests.length > 0) {
      await Promise.allSettled(pendingRequests);
    }
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

    async function loadPatientImageRecords(patientId: string): Promise<ImageRecord[]> {
      const cachedRecords = patientImageRecordCacheRef.current.get(patientId);
      if (cachedRecords) {
        return cachedRecords;
      }
      const pendingRequest = patientImageRecordPromiseCacheRef.current.get(patientId);
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchImages(
        currentSiteId,
        token,
        patientId,
        undefined,
        controller.signal,
      )
        .then((imageRecords) => {
          patientImageRecordCacheRef.current.set(patientId, imageRecords);
          return imageRecords;
        })
        .finally(() => {
          patientImageRecordPromiseCacheRef.current.delete(patientId);
        });
      patientImageRecordPromiseCacheRef.current.set(patientId, nextRequest);
      return nextRequest;
    }

    async function loadVisitImageRecords(patientId: string, visitDate: string): Promise<ImageRecord[]> {
      const cacheKey = buildVisitImageCacheKey(patientId, visitDate);
      const cachedRecords = visitImageRecordCacheRef.current.get(cacheKey);
      if (cachedRecords) {
        return cachedRecords;
      }
      const pendingRequest = visitImageRecordPromiseCacheRef.current.get(cacheKey);
      if (pendingRequest) {
        return pendingRequest;
      }
      const nextRequest = fetchImages(
        currentSiteId,
        token,
        patientId,
        visitDate,
        controller.signal,
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

    async function loadCasePreviewUrls(
      caseId: string,
      images: SavedImagePreview[],
      options?: { prioritizeRepresentative?: boolean },
    ) {
      const pendingImages = [...images]
        .filter((image) => !image.preview_url)
        .sort((left, right) => {
          if (left.is_representative === right.is_representative) {
            return 0;
          }
          return left.is_representative ? -1 : 1;
        });
      if (pendingImages.length === 0) {
        return;
      }

      await ensureImagePreviewsReady(
        currentSiteId,
        pendingImages.map((image) => image.image_id),
        CASE_IMAGE_PREVIEW_MAX_SIDE,
        controller.signal,
      );
      if (cancelled) {
        return;
      }

      const previewRequests = pendingImages.map((image) => ({
        imageId: image.image_id,
        request: loadImagePreviewUrl(currentSiteId, image.image_id, controller.signal),
      }));
      const priorityRequest = options?.prioritizeRepresentative ? previewRequests[0] ?? null : null;
      if (priorityRequest) {
        void priorityRequest.request.then((previewUrl) => {
          if (cancelled || !previewUrl) {
            return;
          }
          applyPreviewUpdates(caseId, new Map([[priorityRequest.imageId, previewUrl]]));
        });
      }

      const resolvedEntries = await Promise.allSettled(
        previewRequests.map(async ({ imageId, request }) => {
          const previewUrl = await request;
          return previewUrl ? ([imageId, previewUrl] as const) : null;
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
      applyPreviewUpdates(caseId, resolvedPreviewUrls);
    }

    async function loadSelectedCaseImages(): Promise<void> {
      const selectedCaseNeedsLoading =
        !cachedSelectedCaseImages || cachedSelectedCaseImages.some((image) => !image.preview_url);
      setPanelBusy(selectedCaseNeedsLoading);
      if (!selectedCaseNeedsLoading) {
        return;
      }
      try {
        const visitImages =
          cachedSelectedCaseImages?.length
            ? cachedSelectedCaseImages
            : preserveCachedPreviewUrls(
                currentCase.case_id,
                buildCaseImagePlaceholders(
                  await loadVisitImageRecords(currentCase.patient_id, currentCase.visit_date),
                ),
              );
        if (cancelled) {
          return;
        }
        selectedCaseImageCaseIdRef.current = currentCase.case_id;
        commitCaseImages(currentCase.case_id, visitImages);
        await loadCasePreviewUrls(currentCase.case_id, visitImages, { prioritizeRepresentative: true });
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

      const hasUncachedVisit = patientCases.some((caseItem) => !caseImageCacheRef.current.has(caseItem.case_id));
      setPatientVisitGalleryBusy(hasUncachedVisit);
      if (patientCases.length === 1) {
        if (!cachedSelectedCaseImages) {
          setPatientVisitGallery((current) => ({
            ...current,
            [currentCase.case_id]: current[currentCase.case_id] ?? [],
          }));
        }
        setPatientVisitGalleryBusy(false);
        return;
      }

      try {
        const allImages = await loadPatientImageRecords(currentCase.patient_id);
        if (cancelled) {
          return;
        }

        const imagesByVisitId = new Map<string, ImageRecord[]>();
        const imagesByVisitLabel = new Map<string, ImageRecord[]>();
        for (const image of allImages) {
          const visitIdKey = String(image.visit_id ?? "").trim();
          if (visitIdKey) {
            const list = imagesByVisitId.get(visitIdKey) ?? [];
            list.push(image);
            imagesByVisitId.set(visitIdKey, list);
          }
          const visitLabelKey = normalizeVisitMatchKey(image.visit_date);
          if (visitLabelKey) {
            const list = imagesByVisitLabel.get(visitLabelKey) ?? [];
            list.push(image);
            imagesByVisitLabel.set(visitLabelKey, list);
          }
        }

        const nextGallery: Record<string, SavedImagePreview[]> = {};
        for (const caseItem of patientCases) {
          const imageRecords =
            imagesByVisitId.get(String(caseItem.visit_id ?? "").trim()) ??
            imagesByVisitLabel.get(normalizeVisitMatchKey(caseItem.visit_date)) ??
            [];
          const placeholders = preserveCachedPreviewUrls(caseItem.case_id, buildCaseImagePlaceholders(imageRecords));
          caseImageCacheRef.current.set(caseItem.case_id, placeholders);
          nextGallery[caseItem.case_id] = placeholders;
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

        const galleryCases = patientCases.filter((caseItem) => caseItem.case_id !== currentCase.case_id);
        // Batch all gallery image IDs into a single PIL warmup request instead of N separate calls.
        const allGalleryImageIds = galleryCases.flatMap(
          (caseItem) => (nextGallery[caseItem.case_id] ?? []).map((img) => img.image_id),
        );
        if (allGalleryImageIds.length > 0) {
          await ensureImagePreviewsReady(currentSiteId, allGalleryImageIds, CASE_IMAGE_PREVIEW_MAX_SIDE, controller.signal);
        }
        if (cancelled) {
          return;
        }
        const galleryPreviewUpdates: Array<[string, Map<string, string>]> = [];
        for (const caseItem of galleryCases) {
          const images = nextGallery[caseItem.case_id] ?? [];
          const urlMap = new Map<string, string>();
          for (const img of images) {
            if (!img.preview_url) {
              const previewUrl = await loadImagePreviewUrl(currentSiteId, img.image_id, controller.signal);
              if (previewUrl) {
                urlMap.set(img.image_id, previewUrl);
              }
            }
          }
          if (urlMap.size > 0) {
            galleryPreviewUpdates.push([caseItem.case_id, urlMap]);
          }
        }
        for (const [caseId, urlMap] of galleryPreviewUpdates) {
          applyPreviewUpdates(caseId, urlMap);
        }
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


