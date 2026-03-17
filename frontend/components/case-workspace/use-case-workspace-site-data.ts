"use client";

import { useEffect, useRef, useState } from "react";

import {
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type ImageRecord,
  type ModelVersionRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  fetchCaseHistory,
  fetchCases,
  fetchImageBlob,
  fetchImages,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
} from "../../lib/api";

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

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
  caseTimestamp: (caseRecord: CaseSummaryRecord) => number;
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
  caseTimestamp,
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
  const casesRef = useRef<CaseSummaryRecord[]>(cases);
  casesRef.current = cases;

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
    return error instanceof DOMException && error.name === "AbortError";
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
        const blob = await fetchImageBlob(siteId, imageId, token, signal);
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
    if (!selectedSiteId) {
      setCases([]);
      setSiteActivity(null);
      setSiteValidationRuns([]);
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
            return nextCases[0] ?? null;
          }
          return nextCases.find((item) => item.case_id === current.case_id) ?? nextCases[0] ?? null;
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

    async function loadActivity() {
      setActivityBusy(true);
      try {
        const nextActivity = await fetchSiteActivity(currentSiteId, token, controller.signal);
        if (!cancelled) {
          setSiteActivity(nextActivity);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setSiteActivity(null);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadSiteActivity),
          });
        }
      } finally {
        if (!cancelled) {
          setActivityBusy(false);
        }
      }
    }

    async function loadSiteValidations() {
      setSiteValidationBusy(true);
      try {
        const nextRuns = await fetchSiteValidations(currentSiteId, token, controller.signal);
        if (!cancelled) {
          setSiteValidationRuns(nextRuns);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setSiteValidationRuns([]);
          setToast({
            tone: "error",
            message: describeError(nextError, unableLoadSiteValidationHistory),
          });
        }
      } finally {
        if (!cancelled) {
          setSiteValidationBusy(false);
        }
      }
    }

    async function loadSiteModels() {
      try {
        const nextVersions = await fetchSiteModelVersions(currentSiteId, token, controller.signal);
        if (!cancelled) {
          setSiteModelVersions(nextVersions);
          setSelectedCompareModelVersionIds((current) =>
            current.length > 0 ? current : defaultModelCompareSelection(nextVersions)
          );
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setSiteModelVersions([]);
          setSelectedCompareModelVersionIds([]);
        }
      }
    }

    void loadRecords();
    void loadActivity();
    void loadSiteValidations();
    void loadSiteModels();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedSiteId, showOnlyMine, token, unableLoadRecentCases, unableLoadSiteActivity, unableLoadSiteValidationHistory]);

  useEffect(() => {
    setCaseHistory(null);
    setPatientVisitGallery({});
    if (!selectedSiteId || !selectedCase) {
      selectedCaseImageCaseIdRef.current = null;
      setSelectedCaseImages([]);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const currentPatientCases = [...casesRef.current]
      .filter((item) => item.patient_id === currentCase.patient_id)
      .sort((left, right) => caseTimestamp(right) - caseTimestamp(left));

    let cancelled = false;
    const controller = new AbortController();

    const cachedSelectedCaseImages = caseImageCacheRef.current.get(currentCase.case_id);
    if (cachedSelectedCaseImages) {
      selectedCaseImageCaseIdRef.current = currentCase.case_id;
      setSelectedCaseImages(cachedSelectedCaseImages);
    } else {
      selectedCaseImageCaseIdRef.current = currentCase.case_id;
      setSelectedCaseImages([]);
    }

    function buildCaseImagePlaceholders(imageRecords: ImageRecord[]): SavedImagePreview[] {
      return imageRecords.map((record) => ({
        ...record,
        preview_url: imagePreviewCacheRef.current.get(record.image_id) ?? null,
      }));
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

    async function resolveCaseImages(caseItem: CaseSummaryRecord): Promise<SavedImagePreview[]> {
      const imageRecords = await loadCaseImageRecords(caseItem);
      const placeholders = buildCaseImagePlaceholders(imageRecords);
      const nextImages = await Promise.all(
        placeholders.map(async (record) => {
          if (record.preview_url) {
            return record;
          }
          const previewUrl = await loadImagePreviewUrl(currentSiteId, record.image_id, controller.signal);
          return { ...record, preview_url: previewUrl };
        })
      );
      caseImageCacheRef.current.set(caseItem.case_id, nextImages);
      return nextImages;
    }

    async function loadSelectedCaseImages(): Promise<void> {
      setPanelBusy(!cachedSelectedCaseImages);
      try {
        const imageRecords = await loadCaseImageRecords(currentCase);
        if (cancelled) {
          return;
        }

        const placeholders = buildCaseImagePlaceholders(imageRecords);
        caseImageCacheRef.current.set(currentCase.case_id, placeholders);
        selectedCaseImageCaseIdRef.current = currentCase.case_id;
        setSelectedCaseImages(placeholders);

        const prioritized = [...placeholders].sort((left, right) => {
          if (left.is_representative === right.is_representative) {
            return 0;
          }
          return left.is_representative ? -1 : 1;
        });

        for (const image of prioritized) {
          if (cancelled) {
            return;
          }
          if (image.preview_url) {
            continue;
          }
          const previewUrl = await loadImagePreviewUrl(currentSiteId, image.image_id, controller.signal);
          if (cancelled) {
            return;
          }
          setSelectedCaseImages((current) => {
            if (selectedCaseImageCaseIdRef.current !== currentCase.case_id) {
              return current;
            }
            const nextImages = current.map((item) =>
              item.image_id === image.image_id ? { ...item, preview_url: previewUrl } : item
            );
            caseImageCacheRef.current.set(currentCase.case_id, nextImages);
            return nextImages;
          });
        }
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
          setSelectedCaseImages([]);
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }

    async function loadPatientVisitGallery() {
      setPatientVisitGalleryBusy(true);
      try {
        const nextEntries = await Promise.allSettled(
          currentPatientCases.map(async (caseItem) => {
            const images = caseImageCacheRef.current.get(caseItem.case_id) ?? (await resolveCaseImages(caseItem));
            if (cancelled) {
              return;
            }
            setPatientVisitGallery((current) => ({
              ...current,
              [caseItem.case_id]: images,
            }));
            return [caseItem.case_id, images] as const;
          })
        );
        if (!cancelled && nextEntries.some((entry) => entry.status === "rejected")) {
          setToast({
            tone: "error",
            message: pick(locale, "Some visit images could not be loaded.", "일부 방문 이미지를 불러오지 못했습니다."),
          });
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setPatientVisitGallery({});
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(locale, "Unable to load this patient's visit gallery.", "???섏옄??諛⑸Ц ?대?吏 臾띠쓬??遺덈윭?ㅼ? 紐삵뻽?듬땲??")
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
    void loadPatientVisitGallery();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedCase, selectedSiteId, token]);

  useEffect(() => {
    if (!selectedCase || selectedCaseImageCaseIdRef.current !== selectedCase.case_id) {
      return;
    }
    caseImageCacheRef.current.set(selectedCase.case_id, selectedCaseImages);
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

  async function loadSiteActivity(siteId: string) {
    setActivityBusy(true);
    try {
      const nextActivity = await fetchSiteActivity(siteId, token);
      setSiteActivity(nextActivity);
    } catch (nextError) {
      setSiteActivity(null);
      setToast({
        tone: "error",
        message: describeError(nextError, unableLoadSiteActivity),
      });
    } finally {
      setActivityBusy(false);
    }
  }

  async function loadSiteValidationRuns(siteId: string) {
    setSiteValidationBusy(true);
    try {
      const nextRuns = await fetchSiteValidations(siteId, token);
      setSiteValidationRuns(nextRuns);
    } catch (nextError) {
      setSiteValidationRuns([]);
      setToast({
        tone: "error",
        message: describeError(nextError, unableLoadSiteValidationHistory),
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

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
  };
}
