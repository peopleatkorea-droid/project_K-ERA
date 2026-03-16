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

  const patientVisitGalleryUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of patientVisitGalleryUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

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

    async function loadRecords() {
      setCasesLoading(true);
      try {
        const nextCases = await fetchCases(currentSiteId, token, { mine: showOnlyMine });
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
        const nextActivity = await fetchSiteActivity(currentSiteId, token);
        if (!cancelled) {
          setSiteActivity(nextActivity);
        }
      } catch (nextError) {
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
        const nextRuns = await fetchSiteValidations(currentSiteId, token);
        if (!cancelled) {
          setSiteValidationRuns(nextRuns);
        }
      } catch (nextError) {
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
        const nextVersions = await fetchSiteModelVersions(currentSiteId, token);
        if (!cancelled) {
          setSiteModelVersions(nextVersions);
          setSelectedCompareModelVersionIds((current) =>
            current.length > 0 ? current : defaultModelCompareSelection(nextVersions)
          );
        }
      } catch {
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
    };
  }, [selectedSiteId, showOnlyMine, token, unableLoadRecentCases, unableLoadSiteActivity, unableLoadSiteValidationHistory]);

  useEffect(() => {
    for (const url of patientVisitGalleryUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    patientVisitGalleryUrlsRef.current = [];
    setCaseHistory(null);
    if (!selectedSiteId || !selectedCase) {
      setSelectedCaseImages([]);
      setPatientVisitGallery({});
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    const currentPatientCases = [...cases]
      .filter((item) => item.patient_id === currentCase.patient_id)
      .sort((left, right) => caseTimestamp(right) - caseTimestamp(left));
    let cancelled = false;
    const createdUrls: string[] = [];

    async function loadSelectedCaseImages() {
      setPanelBusy(true);
      try {
        const imageRecords = await fetchImages(currentSiteId, token, currentCase.patient_id, currentCase.visit_date);
        const nextImages = await Promise.all(
          imageRecords.map(async (record) => {
            try {
              const blob = await fetchImageBlob(currentSiteId, record.image_id, token);
              const previewUrl = URL.createObjectURL(blob);
              createdUrls.push(previewUrl);
              return { ...record, preview_url: previewUrl };
            } catch {
              return { ...record, preview_url: null };
            }
          })
        );
        if (!cancelled) {
          setSelectedCaseImages(nextImages);
        }
      } catch (nextError) {
        if (!cancelled) {
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
        const nextEntries = await Promise.all(
          currentPatientCases.map(async (caseItem) => {
            const imageRecords = await fetchImages(currentSiteId, token, caseItem.patient_id, caseItem.visit_date);
            const images = await Promise.all(
              imageRecords.map(async (record) => {
                try {
                  const blob = await fetchImageBlob(currentSiteId, record.image_id, token);
                  const previewUrl = URL.createObjectURL(blob);
                  createdUrls.push(previewUrl);
                  return { ...record, preview_url: previewUrl };
                } catch {
                  return { ...record, preview_url: null };
                }
              })
            );
            return [caseItem.case_id, images] as const;
          })
        );
        if (!cancelled) {
          const nextGallery = Object.fromEntries(nextEntries);
          patientVisitGalleryUrlsRef.current = createdUrls;
          setPatientVisitGallery(nextGallery);
        }
      } catch (nextError) {
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
        const nextHistory = await fetchCaseHistory(currentSiteId, currentCase.patient_id, currentCase.visit_date, token);
        if (!cancelled) {
          setCaseHistory(nextHistory);
        }
      } catch (nextError) {
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
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [cases, selectedCase, selectedSiteId, token]);

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
