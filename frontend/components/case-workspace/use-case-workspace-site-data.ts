"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CaseHistoryResponse,
  type CaseSummaryRecord,
  type ModelVersionRecord,
} from "../../lib/api";
import type { SavedImagePreview } from "./shared";
import { useCaseWorkspaceCaseIndex } from "./use-case-workspace-case-index";
import { useCaseWorkspaceImageCache } from "./use-case-workspace-image-cache";
import { useCaseWorkspaceSelectedCaseReview } from "./use-case-workspace-selected-case-review";
import { useCaseWorkspaceSiteOverview } from "./use-case-workspace-site-overview";

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
  defaultValidationModelVersionSelection: (
    modelVersions: ModelVersionRecord[],
  ) => string | null;
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
  defaultValidationModelVersionSelection,
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
  const [historyBusy, setHistoryBusy] = useState(false);
  const [caseHistory, setCaseHistory] = useState<CaseHistoryResponse | null>(null);

  const patientCaseTimelineCacheRef = useRef<Map<string, CaseSummaryRecord[]>>(new Map());
  const patientCaseTimelinePromiseCacheRef = useRef<Map<string, Promise<CaseSummaryRecord[]>>>(new Map());
  const patientCaseTimelineReadyRef = useRef<Map<string, boolean>>(new Map());
  const caseHistoryCacheRef = useRef<Map<string, CaseHistoryResponse>>(new Map());
  const {
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
    selectedValidationModelVersionId,
    setSelectedValidationModelVersionId,
    loadSiteActivity,
    loadSiteValidationRuns,
    loadSiteModelVersions,
    ensureSiteActivityLoaded,
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  } = useCaseWorkspaceSiteOverview({
    selectedSiteId,
    token,
    unableLoadSiteActivity,
    unableLoadSiteValidationHistory,
    defaultModelCompareSelection,
    defaultValidationModelVersionSelection,
    describeError,
    setToast,
  });

  function clearPatientCaseTimelineCache() {
    patientCaseTimelineCacheRef.current.clear();
    patientCaseTimelinePromiseCacheRef.current.clear();
    patientCaseTimelineReadyRef.current.clear();
  }

  const replaceSelectedCaseImages = useCallback((
    caseId: string | null,
    images: SavedImagePreview[],
  ) => {
    setSelectedCaseImagesOwnerCaseId(caseId);
    setSelectedCaseImagesState(images);
  }, []);

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

  const {
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
  } = useCaseWorkspaceImageCache({
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
  });

  const { loadCaseHistory } = useCaseWorkspaceSelectedCaseReview({
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
    warmDesktopVisitImagePreviews,
    commitCaseImages,
    selectedCaseImageCaseIdRef,
    caseImageCacheRef,
    caseHistoryCacheRef,
  });

  useEffect(() => {
    clearCaseImageCache();
    clearPatientCaseTimelineCache();
    setCases([]);
    setCasesLoading(false);
    setSelectedCase(null);
    setSelectedPatientCases([]);
    caseHistoryCacheRef.current.clear();
  }, [selectedSiteId]);

  useEffect(() => {
    clearCaseImageCache();
    clearPatientCaseTimelineCache();
  }, [caseImageCacheVersion]);

  useEffect(() => {
    clearPatientCaseTimelineCache();
  }, [showOnlyMine]);

  useCaseWorkspaceCaseIndex({
    caseImageCacheVersion,
    selectedSiteId,
    railView,
    token,
    showOnlyMine,
    locale,
    unableLoadRecentCases,
    describeError,
    pick,
    setToast,
    cases,
    selectedCase,
    selectedPatientCases,
    setCases,
    setCasesLoading,
    setSelectedCase,
    setSelectedPatientCases,
    patientCaseTimelineCacheRef,
    patientCaseTimelinePromiseCacheRef,
    patientCaseTimelineReadyRef,
  });

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
    selectedValidationModelVersionId,
    setSelectedValidationModelVersionId,
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
