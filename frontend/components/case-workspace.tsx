"use client";

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  pick,
  translateApiError,
  translateOption,
  useI18n,
  type Locale,
} from "../lib/i18n";
import { useCaseWorkspaceCaseSaveDelete } from "./case-workspace/use-case-workspace-case-save-delete";
import { useCaseWorkspaceAlertsPanel } from "./case-workspace/use-case-workspace-alerts-panel";
import { buildCaseWorkspaceHeaderProps } from "./case-workspace/case-workspace-header-props";
import { buildCaseWorkspaceCopy } from "./case-workspace/case-workspace-copy";
import {
  CASE_WORKSPACE_CONTACT_LENS_OPTIONS,
  CASE_WORKSPACE_CULTURE_SPECIES,
  CASE_WORKSPACE_CULTURE_STATUS_OPTIONS,
  CASE_WORKSPACE_PREDISPOSING_FACTOR_OPTIONS,
  CASE_WORKSPACE_SEX_OPTIONS,
  CASE_WORKSPACE_TIMING_LOGS,
  CASE_WORKSPACE_VISIT_STATUS_OPTIONS,
  executionModeFromDevice,
  formatCaseWorkspaceDateTime,
  type CaseWorkspaceCompletionState,
  type CaseWorkspaceProps,
} from "./case-workspace/case-workspace-definitions";
import { CaseWorkspaceSurface } from "./case-workspace/case-workspace-surface";
import { useCaseWorkspacePatientListArtifacts } from "./case-workspace/use-case-workspace-patient-list-artifacts";
import { useCaseWorkspaceResearchRegistryActions } from "./case-workspace/use-case-workspace-research-registry-actions";
import {
  buildKnownPatientTimeline,
  caseTimestamp,
  patientMatchesListSearch,
  upsertCaseSummaryRecord,
  upsertPatientListRow,
  visitTimestamp,
} from "./case-workspace/case-workspace-records";
import type {
  AiClinicPreviewResponse,
  LesionBoxMap,
  LesionPreviewCard,
  LiveLesionPreviewMap,
  PatientListRow,
  RoiPreviewCard,
  SavedImagePreview,
  SemanticPromptErrorMap,
  SemanticPromptInputOption,
  SemanticPromptReviewMap,
} from "./case-workspace/shared";
import { useCaseWorkspaceAnalysis } from "./case-workspace/use-case-workspace-analysis";
import {
  buildFallbackSiteSummary,
  createDraftId,
  defaultModelCompareSelection,
  formatCaseTitle,
  isAbortError,
  isResearchEligibleCase,
  mergeRailSummaryCategoryCounts,
} from "./case-workspace/case-workspace-core-helpers";
import { useCaseWorkspaceBrowserHistory } from "./case-workspace/use-case-workspace-browser-history";
import { useCaseWorkspaceDraftAuthoring } from "./case-workspace/use-case-workspace-draft-authoring";
import { useCaseWorkspaceDraftState } from "./case-workspace/use-case-workspace-draft";
import {
  displayVisitReference,
  FOLLOW_UP_VISIT_PATTERN,
  normalizeCultureStatus,
  organismSummaryLabel,
  visitPhaseCopy,
} from "./case-workspace/case-workspace-draft-helpers";
import { buildCaseWorkspaceChromeState } from "./case-workspace/case-workspace-chrome";
import { buildCaseWorkspaceModeState } from "./case-workspace/case-workspace-mode-state";
import { buildCaseWorkspaceSurfaceProps } from "./case-workspace/case-workspace-surface-props";
import { useCaseWorkspaceReviewActions } from "./case-workspace/use-case-workspace-review-actions";
import { formatSemanticScore } from "./case-workspace/case-workspace-review-formatters";
import { useCaseWorkspaceSavedCaseActions } from "./case-workspace/use-case-workspace-saved-case-actions";
import { useCaseWorkspaceSiteData } from "./case-workspace/use-case-workspace-site-data";
import { useCaseWorkspaceSiteBackgroundLoads } from "./case-workspace/use-case-workspace-site-background-loads";
import {
  buildDraftViewProps,
  buildPatientListViewProps,
  buildSavedCaseViewProps,
} from "./case-workspace/case-workspace-main-content-props";
import {
  buildCaseWorkspaceAnalysisSectionProps,
  buildCaseWorkspaceContributionSectionProps,
  buildCaseWorkspaceLeftRailProps,
  buildCaseWorkspaceReviewContentProps,
} from "./case-workspace/case-workspace-side-panel-props";
import {
  canvasDocumentClass,
  canvasHeaderClass,
  canvasHeaderContentClass,
  canvasHeaderGlowClass,
  canvasHeaderMetaChipClass,
  canvasHeaderMetaRowClass,
  canvasSidebarCardClass,
  canvasSidebarClass,
  canvasSidebarItemClass,
  canvasSidebarListClass,
  canvasSidebarMetricCardClass,
  canvasSidebarMetricGridClass,
  canvasSidebarMetricLabelClass,
  canvasSidebarMetricValueClass,
  canvasSidebarSectionLabelClass,
  canvasSummaryCardClass,
  canvasSummaryGridClass,
  canvasSummaryLabelClass,
  canvasSummaryValueClass,
  docBadgeRowClass,
  docEyebrowClass,
  docSurfaceClass,
  docTitleMetaClass,
  docTitleRowClass,
  emptySurfaceClass,
  momentumFillClass,
  momentumTrackClass,
  panelImageCardClass,
  panelImageCopyClass,
  panelImageFallbackClass,
  panelImagePreviewClass,
  panelImageStackClass,
  panelMetricGridClass,
  panelPreviewGridClass,
  railCopyClass,
  railLabelClass,
  railMetricGridClass,
  railMetricCardClass,
  railMetricLabelClass,
  railMetricValueClass,
  railRunButtonClass,
  railSectionClass,
  railSectionHeadClass,
  railSiteButtonClass,
  railSiteListClass,
  railSummaryClass,
  railSummaryMetaClass,
  railSummaryValueClass,
  togglePillClass,
  organismChipClass,
  organismChipRowClass,
  organismChipStaticClass,
  validationRailHeadClass,
  workspaceBrandActionsClass,
  workspaceBrandActionButtonClass,
  workspaceBrandClass,
  workspaceBrandCopyClass,
  workspaceBrandTitleClass,
  workspaceMainClass,
  workspaceNoiseClass,
  workspaceRailClass,
  workspaceShellClass,
  workspaceToastClass,
} from "./ui/workspace-patterns";
import { filterVisibleSites, getSiteDisplayName } from "../lib/site-labels";
import {
  canUseDesktopTransport,
  prefetchDesktopVisitImages,
} from "../lib/desktop-transport";
import { formatPublicAlias } from "../lib/public-alias";
import {
  type CaseHistoryResponse,
  type CaseContributionResponse,
  type CaseValidationCompareResponse,
  fetchPatientIdLookup,
  fetchSiteSummaryCounts,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  invalidateDesktopCaseWorkspaceCaches,
  type CaseSummaryRecord,
  type LiveLesionPreviewJobResponse,
  type PatientIdLookupResponse,
  type SemanticPromptInputMode,
  type SiteSummary,
  type VisitRecord,
  mergeSiteSummaryCounts,
} from "../lib/api";

export function CaseWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  canOpenOperations,
  theme,
  controlPlaneStatus = null,
  controlPlaneStatusBusy = false,
  onSelectSite,
  onExportManifest,
  onLogout,
  onOpenOperations,
  onOpenHospitalAccessRequest,
  onOpenDesktopSettings,
  onSiteDataChanged,
  onToggleTheme,
}: CaseWorkspaceProps) {
  const { locale, localeTag, common } = useI18n();
  const visibleSites = filterVisibleSites(sites);
  const describeError = useCallback(
    (nextError: unknown, fallback: string) =>
      nextError instanceof Error
        ? translateApiError(locale, nextError.message)
        : fallback,
    [locale],
  );
  const selectedSiteRecord =
    visibleSites.find((site) => site.site_id === selectedSiteId) ?? null;
  const selectedSiteLabel = selectedSiteId
    ? getSiteDisplayName(selectedSiteRecord, selectedSiteId)
    : null;
  const isAlreadyExistsError = (nextError: unknown) => {
    if (!(nextError instanceof Error)) {
      return false;
    }
    const rawMessage = nextError.message.toLowerCase();
    const translatedMessage = translateApiError(
      locale,
      nextError.message,
    ).toLowerCase();
    return (
      rawMessage.includes("already exists") ||
      rawMessage.includes("이미 존재") ||
      translatedMessage.includes("already exists") ||
      translatedMessage.includes("이미 존재")
    );
  };
  const [saveBusy, setSaveBusy] = useState(false);
  const [editDraftBusy, setEditDraftBusy] = useState(false);
  const [editingCaseContext, setEditingCaseContext] = useState<{
    patient_id: string;
    visit_date: string;
    created_at?: string | null;
    created_by_user_id?: string | null;
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [railView, setRailView] = useState<"cases" | "patients">("patients");
  const [researchRegistryModalOpen, setResearchRegistryModalOpen] =
    useState(false);
  const [
    pendingResearchRegistryAutoInclude,
    setPendingResearchRegistryAutoInclude,
  ] = useState(false);
  const [
    researchRegistryExplanationConfirmed,
    setResearchRegistryExplanationConfirmed,
  ] = useState(false);
  const [researchRegistryUsageConsented, setResearchRegistryUsageConsented] =
    useState(false);
  const [contributionResult, setContributionResult] =
    useState<CaseContributionResponse | null>(null);
  const [completionState, setCompletionState] =
    useState<CaseWorkspaceCompletionState | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [fallbackRailSummary, setFallbackRailSummary] =
    useState<SiteSummary | null>(null);
  const [patientIdLookup, setPatientIdLookup] =
    useState<PatientIdLookupResponse | null>(null);
  const [patientIdLookupBusy, setPatientIdLookupBusy] = useState(false);
  const [patientIdLookupError, setPatientIdLookupError] = useState<
    string | null
  >(null);
  const [caseImageCacheVersion, setCaseImageCacheVersion] = useState(0);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const workspaceOpenedAtRef = useRef<number | null>(null);
  const siteLabelLoggedRef = useRef<string | null>(null);
  const caseOpenStartedAtRef = useRef<number | null>(null);
  const caseOpenCaseIdRef = useRef<string | null>(null);
  const caseImagesLoggedCaseIdRef = useRef<string | null>(null);
  const desktopFastMode = canUseDesktopTransport();
  const researchRegistryJoinReady =
    researchRegistryExplanationConfirmed && researchRegistryUsageConsented;
  const {
    toast,
    alertsPanelOpen,
    alertsPanelRef,
    toastHistory,
    setToast,
    toggleAlertsPanel,
    clearToastHistory,
  } = useCaseWorkspaceAlertsPanel();
  const normalizedPatientListSearch = caseSearch.trim();
  const {
    patientListPage,
    setPatientListPage,
    patientListRows,
    setPatientListRows,
    patientListTotalCount,
    setPatientListTotalCount,
    patientListTotalPages,
    setPatientListTotalPages,
    patientListLoading,
    patientListThumbs,
    safePage,
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    medsamArtifactStatusBusy,
    medsamArtifactBackfillBusy,
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactItems,
    medsamArtifactItemsBusy,
    medsamArtifactPage,
    medsamArtifactTotalCount,
    medsamArtifactTotalPages,
    onArtifactsChanged,
    handleEnableMedsamArtifactPanel,
    handleDisableMedsamArtifactPanel,
    handleRefreshMedsamArtifactStatus,
    handleOpenMedsamArtifactBacklog,
    handleCloseMedsamArtifactBacklog,
    handleMedsamArtifactScopeChange,
    handleMedsamArtifactPageChange,
    handleBackfillMedsamArtifacts,
  } = useCaseWorkspacePatientListArtifacts({
    selectedSiteId,
    token,
    railView,
    showOnlyMine,
    normalizedPatientListSearch,
    desktopFastMode,
    workspaceTimingLogs: CASE_WORKSPACE_TIMING_LOGS,
    workspaceOpenedAtRef,
    describeError,
    pick,
    locale,
    setToast,
  });
  const invalidateCaseWorkspaceImageCaches = useCallback(() => {
    invalidateDesktopCaseWorkspaceCaches();
    setCaseImageCacheVersion((current) => current + 1);
  }, []);
  const closeResearchRegistryModal = useCallback(() => {
    setPendingResearchRegistryAutoInclude(false);
    setResearchRegistryModalOpen(false);
    setResearchRegistryExplanationConfirmed(false);
    setResearchRegistryUsageConsented(false);
  }, []);
  const openResearchRegistryModal = useCallback((autoInclude = false) => {
    setPendingResearchRegistryAutoInclude(autoInclude);
    setResearchRegistryExplanationConfirmed(false);
    setResearchRegistryUsageConsented(false);
    setResearchRegistryModalOpen(true);
  }, []);
  const copy = buildCaseWorkspaceCopy(locale);
  const semanticPromptInputOptions: SemanticPromptInputOption[] = [
    { value: "source", label: pick(locale, "Whole image", "?먮낯 ?대?吏") },
    { value: "roi_crop", label: pick(locale, "Cornea crop", "媛곷쭑 crop") },
    { value: "lesion_crop", label: pick(locale, "Lesion crop", "蹂묐? crop") },
  ];
  const {
    draft,
    setDraft,
    pendingOrganism,
    setPendingOrganism,
    showAdditionalOrganismForm,
    setShowAdditionalOrganismForm,
    draftImages,
    setDraftImages,
    draftLesionPromptBoxes,
    setDraftLesionPromptBoxes,
    draftSavedAt,
    favoriteCaseIds,
    setFavoriteCaseIds,
    replaceDraftImages,
    clearDraftStorage,
  } = useCaseWorkspaceDraftState({
    selectedSiteId,
    userId: user.user_id,
    recoveredDraftMessage: copy.recoveredDraft,
    recoveredDraftWithAssetsMessage: copy.recoveredDraftWithAssets,
    cultureSpecies: CASE_WORKSPACE_CULTURE_SPECIES,
    setToast,
  });
  const deferredDraftPatientId = useDeferredValue(draft.patient_id.trim());
  const {
    cases,
    setCases,
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
    siteActivity,
    siteValidationBusy,
    setSiteValidationBusy,
    siteValidationRuns,
    setSiteValidationRuns,
    siteModelVersions,
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
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  } = useCaseWorkspaceSiteData({
    caseImageCacheVersion,
    selectedSiteId,
    railView,
    token,
    showOnlyMine,
    locale,
    unableLoadRecentCases: copy.unableLoadRecentCases,
    unableLoadSiteActivity: copy.unableLoadSiteActivity,
    unableLoadSiteValidationHistory: copy.unableLoadSiteValidationHistory,
    unableLoadCaseHistory: copy.unableLoadCaseHistory,
    defaultModelCompareSelection,
    describeError,
    pick,
    setToast,
  });
  useEffect(() => {
    if (!selectedSiteId) {
      setFallbackRailSummary(null);
      return;
    }
    const summaryNeedsCategoryHydration = Boolean(
      summary &&
        (typeof summary.n_fungal_visits !== "number" ||
          typeof summary.n_bacterial_visits !== "number"),
    );
    if (summary && !summaryNeedsCategoryHydration) {
      setFallbackRailSummary(null);
      return;
    }
    if (cases.length > 0) {
      setFallbackRailSummary(buildFallbackSiteSummary(selectedSiteId, cases));
      return;
    }
    let cancelled = false;
    void fetchSiteSummaryCounts(selectedSiteId, token)
      .then((nextCounts) => {
        if (cancelled) {
          return;
        }
        setFallbackRailSummary(
          mergeSiteSummaryCounts(summary ?? null, nextCounts),
        );
      })
      .catch((nextError) => {
        if (isAbortError(nextError) || cancelled) {
          return;
        }
        setFallbackRailSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cases, selectedSiteId, summary, token]);
  const caseDerivedRailSummary = useMemo(() => {
    if (!selectedSiteId || cases.length === 0) {
      return null;
    }
    return buildFallbackSiteSummary(selectedSiteId, cases);
  }, [cases, selectedSiteId]);
  const stagedRailSummary = useMemo(
    () => mergeRailSummaryCategoryCounts(summary, fallbackRailSummary),
    [fallbackRailSummary, summary],
  );
  const effectiveRailSummary = useMemo(
    () =>
      mergeRailSummaryCategoryCounts(
        stagedRailSummary,
        caseDerivedRailSummary,
      ),
    [caseDerivedRailSummary, stagedRailSummary],
  );
  const {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicPreviewBusy,
    aiClinicResult,
    roiPreviewBusy,
    roiPreviewItems,
    lesionPreviewBusy,
    lesionPreviewItems,
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    semanticPromptInputMode,
    setSemanticPromptInputMode,
    liveLesionCropEnabled,
    setLiveLesionCropEnabled,
    liveLesionPreviews,
    savedImageRoiCropUrls,
    savedImageRoiCropBusy,
    savedImageLesionCropUrls,
    savedImageLesionCropBusy,
    lesionPromptDrafts,
    lesionPromptSaved,
    lesionBoxBusyImageId,
    representativeBusyImageId,
    representativeSavedImage,
    hasAnySavedLesionBox,
    resetAnalysisState,
    handleRunValidation,
    handleRunModelCompare,
    handleRunAiClinic,
    handleExpandAiClinic,
    handleRunRoiPreview,
    handleRunLesionPreview,
    handleSetSavedRepresentative,
    handleReviewSemanticPrompts,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
    applySavedLesionBoxesAndStartLivePreview,
  } = useCaseWorkspaceAnalysis({
    locale,
    token,
    selectedSiteId,
    selectedCase,
    selectedCaseImages,
    patientVisitGallery,
    selectedCompareModelVersionIds,
    showOnlyMine,
    copy,
    pick,
    executionModeFromDevice,
    describeError,
    setToast,
    setPanelOpen,
    setCases,
    setSelectedCase,
    setSelectedPatientCases,
    setSelectedCaseImages,
    setCaseHistory,
    setContributionResult,
    loadCaseHistory,
    loadSiteActivity,
    onSiteDataChanged,
    onArtifactsChanged,
    onValidationCompleted: async ({ siteId, selectedCase: validatedCase }) => {
      const registry = summary?.research_registry;
      if (!registry?.site_enabled) {
        return;
      }
      if (!isResearchEligibleCase(validatedCase)) {
        return;
      }
      if (
        validatedCase.research_registry_status === "excluded" ||
        validatedCase.research_registry_status === "included"
      ) {
        return;
      }
      if (!registry.user_enrolled) {
        openResearchRegistryModal(true);
        return;
      }
      try {
        await includeCaseInResearchRegistry(
          validatedCase.patient_id,
          validatedCase.visit_date,
          "validation_auto_include",
        );
      } catch {
        // Leave the validation result visible even if registry auto-inclusion fails.
      }
    },
  });
  const hasSavedCase = Boolean(selectedCase);
  const [analysisSectionMounted, setAnalysisSectionMounted] = useState(false);

  useEffect(() => {
    if (hasSavedCase) {
      startTransition(() => setAnalysisSectionMounted(true));
    } else {
      setAnalysisSectionMounted(false);
    }
  }, [hasSavedCase]);

  useEffect(() => {
    invalidateCaseWorkspaceImageCaches();
  }, [invalidateCaseWorkspaceImageCaches, selectedSiteId]);

  useEffect(() => {
    siteLabelLoggedRef.current = null;
    caseOpenStartedAtRef.current = null;
    caseOpenCaseIdRef.current = null;
    caseImagesLoggedCaseIdRef.current = null;
    if (!desktopFastMode || !selectedSiteId) {
      workspaceOpenedAtRef.current = null;
      return;
    }
    workspaceOpenedAtRef.current = performance.now();
    if (CASE_WORKSPACE_TIMING_LOGS) {
      console.info("[kera-fast-path] workspace-open", {
        site_id: selectedSiteId,
      });
    }
  }, [desktopFastMode, selectedSiteId]);

  useEffect(() => {
    if (
      !desktopFastMode ||
      !CASE_WORKSPACE_TIMING_LOGS ||
      !selectedSiteId ||
      !selectedSiteLabel
    ) {
      return;
    }
    if (siteLabelLoggedRef.current === selectedSiteId) {
      return;
    }
    siteLabelLoggedRef.current = selectedSiteId;
    const startedAt = workspaceOpenedAtRef.current ?? performance.now();
    console.info("[kera-fast-path] site-label-ready", {
      site_id: selectedSiteId,
      label: selectedSiteLabel,
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
  }, [desktopFastMode, selectedSiteId, selectedSiteLabel]);

  useEffect(() => {
    if (!selectedSiteId) {
      setPatientIdLookup(null);
      setPatientIdLookupBusy(false);
      setPatientIdLookupError(null);
      return;
    }
    if (!deferredDraftPatientId) {
      setPatientIdLookup(null);
      setPatientIdLookupBusy(false);
      setPatientIdLookupError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPatientIdLookup(null);
    setPatientIdLookupBusy(true);
    setPatientIdLookupError(null);

    void fetchPatientIdLookup(selectedSiteId, token, deferredDraftPatientId, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) {
          setPatientIdLookup(result);
        }
      })
      .catch((nextError) => {
        if (cancelled || isAbortError(nextError)) {
          return;
        }
        setPatientIdLookup(null);
        setPatientIdLookupError(
          describeError(nextError, copy.patientIdLookupFailed),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setPatientIdLookupBusy(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    copy.patientIdLookupFailed,
    deferredDraftPatientId,
    describeError,
    selectedSiteId,
    token,
  ]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  useCaseWorkspaceBrowserHistory({
    cases,
    railView,
    selectedCaseId: selectedCase?.case_id ?? null,
    setPanelOpen,
    setRailView,
    setSelectedCase,
    setSelectedCaseImages,
  });

  useEffect(() => {
    if (railView !== "patients") {
      return;
    }
    railListSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [railView]);

  const {
    whiteFileInputRef,
    fluoresceinFileInputRef,
    speciesOptions,
    pendingSpeciesOptions,
    intakeOrganisms,
    actualVisitDateLabel,
    whiteDraftImages,
    fluoresceinDraftImages,
    draftRepresentativeCount,
    draftCompletionCount,
    draftCompletionPercent,
    draftPendingItems,
    replaceDraftImagesAndBoxes,
    updatePrimaryOrganism,
    addAdditionalOrganism,
    handleCompleteIntake,
    removeAdditionalOrganism,
    openFilePicker,
    appendFiles,
    removeDraftImage,
    setRepresentativeImage,
    handleDraftLesionPointerDown,
    handleDraftLesionPointerMove,
    finishDraftLesionPointer,
    togglePredisposingFactor,
  } = useCaseWorkspaceDraftAuthoring({
    selectedSiteId,
    locale,
    pick,
    notAvailableLabel: common.notAvailable,
    cultureSpecies: CASE_WORKSPACE_CULTURE_SPECIES,
    draft,
    pendingOrganism,
    draftImages,
    setDraft,
    setDraftImages,
    setSelectedCase,
    setSelectedCaseImages,
    setPanelOpen,
    setDraftLesionPromptBoxes,
    replaceDraftImages,
    resetAnalysisState,
    createDraftId,
    setToast,
    copy: {
      organismDuplicate: copy.organismDuplicate,
      organismAdded: copy.organismAdded,
      patientIdRequired: copy.patientIdRequired,
      cultureSpeciesRequired: copy.cultureSpeciesRequired,
      intakeComplete: copy.intakeComplete,
    },
  });

  const {
    openSavedCase,
    startFollowUpDraftFromSelectedCase,
    startEditDraftFromSelectedCase,
    resetDraft,
    startNewCaseDraft,
    handleOpenPatientList,
    handleOpenLatestAutosavedDraft,
    handleOpenImageTextSearchResult,
  } = useCaseWorkspaceSavedCaseActions({
    selectedCase,
    selectedSiteId,
    cases,
    token,
    locale,
    desktopFastMode,
    workspaceTimingLogs: CASE_WORKSPACE_TIMING_LOGS,
    caseOpenStartedAtRef,
    caseOpenCaseIdRef,
    caseImagesLoggedCaseIdRef,
    setCases,
    setSelectedCase,
    setSelectedPatientCases,
    setPanelOpen,
    setRailView,
    buildKnownPatientTimeline,
    cultureSpecies: CASE_WORKSPACE_CULTURE_SPECIES,
    describeError,
    pick,
    setToast,
    setEditingCaseContext,
    replaceDraftImagesAndBoxes,
    setDraftLesionPromptBoxes,
    clearDraftStorage,
    resetAnalysisState,
    setSelectedCaseImages,
    setDraft,
    setPendingOrganism,
    setShowAdditionalOrganismForm,
    visitTimestamp,
    setEditDraftBusy,
    createDraftId,
    setCaseSearch,
    setPatientListPage,
    defaultPendingOrganism: {
      culture_category: "bacterial",
      culture_species: CASE_WORKSPACE_CULTURE_SPECIES.bacterial[0],
    },
    showOnlyMine,
    selectSiteForCaseMessage: copy.selectSiteForCase,
  });

  const {
    includeCaseInResearchRegistry,
    excludeCaseFromResearchRegistry,
  } = useCaseWorkspaceResearchRegistryActions({
    selectedSiteId,
    token,
    onSiteDataChanged,
    setToast,
    setCases,
    setSelectedCase,
    setSelectedPatientCases,
  });

  function handlePatientListSearchChange(value: string) {
    setCaseSearch(value);
    setPatientListPage(1);
  }

  function handlePatientScopeChange(nextValue: boolean) {
    setShowOnlyMine(nextValue);
    setPatientListPage(1);
  }

  function handlePatientListPageChange(nextPage: number) {
    setPatientListPage(nextPage);
  }

  function isFavoriteCase(caseId: string): boolean {
    return favoriteCaseIds.includes(caseId);
  }

  function toggleFavoriteCase(caseId: string) {
    setFavoriteCaseIds((current) => {
      const exists = current.includes(caseId);
      const next = exists
        ? current.filter((item) => item !== caseId)
        : [...current, caseId];
      setToast({
        tone: "success",
        message: exists ? copy.favoriteRemoved : copy.favoriteAdded,
      });
      return next;
    });
  }

  useEffect(() => {
    if (
      !desktopFastMode ||
      !CASE_WORKSPACE_TIMING_LOGS ||
      !selectedCase ||
      panelBusy
    ) {
      return;
    }
    if (caseOpenCaseIdRef.current !== selectedCase.case_id) {
      return;
    }
    if (caseImagesLoggedCaseIdRef.current === selectedCase.case_id) {
      return;
    }
    caseImagesLoggedCaseIdRef.current = selectedCase.case_id;
    const caseStartedAt = caseOpenStartedAtRef.current ?? performance.now();
    const workspaceStartedAt = workspaceOpenedAtRef.current ?? caseStartedAt;
    console.info("[kera-fast-path] case-images-ready", {
      case_id: selectedCase.case_id,
      patient_id: selectedCase.patient_id,
      visit_date: selectedCase.visit_date,
      image_count: selectedCaseImages.length,
      case_elapsed_ms: Math.round(performance.now() - caseStartedAt),
      total_elapsed_ms: Math.round(performance.now() - workspaceStartedAt),
    });
  }, [desktopFastMode, panelBusy, selectedCase, selectedCaseImages]);

  const confirmDeleteSavedCase = useCallback((caseRecord: CaseSummaryRecord) => {
    const samePatientCases = cases.filter(
      (item) => item.patient_id === caseRecord.patient_id,
    );
    const confirmMessage =
      samePatientCases.length <= 1
        ? pick(
            locale,
            `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?\n\nThis is the only visit for the patient, so the patient record will also be removed.`,
            `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 방문을 삭제할까요?\n\n이 환자의 마지막 방문이라 환자 기록도 함께 삭제됩니다.`,
          )
        : pick(
            locale,
            `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?`,
            `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 방문을 삭제할까요?`,
          );
    return window.confirm(confirmMessage);
  }, [cases, displayVisitReference, locale, pick]);

  const {
    contributionBusy,
    researchRegistryBusy,
    handleRunSiteValidation,
    handleContributeCase,
    handleJoinResearchRegistry,
    handleIncludeResearchCase,
    handleExcludeResearchCase,
  } = useCaseWorkspaceReviewActions({
    locale,
    token,
    selectedSiteId,
    selectedCase,
    researchRegistryJoinReady,
    pendingResearchRegistryAutoInclude,
    selectedCompareModelVersionIds,
    validationResult,
    executionModeFromDevice,
    pick,
    describeError,
    setToast,
    setPanelOpen,
    setSiteValidationBusy,
    setCompletionState,
    setContributionResult,
    setPendingResearchRegistryAutoInclude,
    setResearchRegistryModalOpen,
    setResearchRegistryExplanationConfirmed,
    setResearchRegistryUsageConsented,
    onSiteDataChanged,
    loadSiteActivity,
    loadSiteValidationRuns,
    loadCaseHistory,
    includeCaseInResearchRegistry,
    excludeCaseFromResearchRegistry,
    messages: {
      selectSiteForValidation: copy.selectSiteForValidation,
      siteValidationFailed: copy.siteValidationFailed,
      siteValidationSaved: copy.siteValidationSaved,
      selectSavedCaseForContribution: copy.selectSavedCaseForContribution,
      activeOnly: copy.activeOnly,
      contributionQueued: copy.contributionQueued,
      contributionFailed: copy.contributionFailed,
      joinResearchRegistrySuccess: pick(
        locale,
        "Joined the research registry. Future eligible analyses can now flow into the dataset.",
        "연구 레지스트리에 가입했습니다. 이제 적격 분석 케이스가 데이터셋 흐름에 포함될 수 있습니다.",
      ),
      joinResearchRegistryFailed: pick(
        locale,
        "Unable to join the research registry.",
        "연구 레지스트리에 가입할 수 없습니다.",
      ),
      includeResearchSuccess: pick(
        locale,
        "This case is now included in the research registry.",
        "이 케이스가 연구 레지스트리에 포함되었습니다.",
      ),
      includeResearchFailed: pick(
        locale,
        "Unable to include this case in the registry.",
        "이 케이스를 레지스트리에 포함할 수 없습니다.",
      ),
      excludeResearchSuccess: pick(
        locale,
        "This case was excluded from the research registry.",
        "이 케이스를 연구 레지스트리에서 제외했습니다.",
      ),
      excludeResearchFailed: pick(
        locale,
        "Unable to exclude this case from the registry.",
        "이 케이스를 레지스트리에서 제외할 수 없습니다.",
      ),
    },
  });

  const { handleSaveCase, handleDeleteSavedCase } =
    useCaseWorkspaceCaseSaveDelete({
      saveCaseArgs: {
        locale,
        selectedSiteId,
        selectedSiteLabel,
        token,
        user,
        showOnlyMine,
        patientIdLookup,
        draft,
        draftImages,
        draftLesionPromptBoxes,
        editingCaseContext,
        cases,
        patientListRows,
        patientListPage,
        patientListTotalCount,
        normalizedPatientListSearch,
        pick,
        copy,
        describeError,
        isAlreadyExistsError,
        setToast,
        setSaveBusy,
        setCases,
        setPatientListRows,
        setPatientListTotalCount,
        setPatientListTotalPages,
        setPatientListPage,
        setSelectedCase,
        setSelectedPatientCases,
        setPanelOpen,
        setCompletionState,
        clearDraftStorage,
        resetDraft,
        primeCaseImageCache,
        onSiteDataChanged,
        loadSiteActivity,
        upsertCaseSummaryRecord,
        patientMatchesListSearch,
        organismSummaryLabel,
        upsertPatientListRow,
        buildKnownPatientTimeline,
        applySavedLesionBoxesAndStartLivePreview,
      },
      selectedSiteId,
      token,
      showOnlyMine,
      selectedCase,
      confirmDeleteSavedCase,
      describeError,
      deleteVisitFailedMessage: copy.deleteVisitFailed,
      patientDeletedMessage: copy.patientDeleted,
      visitDeletedMessage: copy.visitDeleted,
      setToast,
      setCases,
      setSelectedCase,
      setSelectedPatientCases,
      setSelectedCaseImages,
      setPatientVisitGallery,
      setRailView,
      resetAnalysisState,
      invalidateCaseWorkspaceImageCaches,
      buildKnownPatientTimeline,
      caseTimestamp,
    });

  const hasSelectedCase = Boolean(selectedCase);
  const {
    canRunValidation,
    isAuthoringCanvas,
    newCaseModeActive,
    listModeActive,
    canRunRoiPreview,
    canRunAiClinic,
  } = buildCaseWorkspaceModeState({
    userRole: user.role,
    railView,
    hasSelectedCase,
    hasValidationResult: Boolean(validationResult),
  });

  useCaseWorkspaceSiteBackgroundLoads({
    selectedSiteId,
    railView,
    hasSelectedCase,
    canRunValidation,
    ensureSiteValidationRunsLoaded,
    ensureSiteModelVersionsLoaded,
  });

  const {
    resolvedVisitReferenceLabel,
    draftStatusLabel,
    latestAutosavedDraft,
    mainHeaderTitle,
    mainHeaderCopy,
    showSecondaryPanel,
    mainLayoutClass,
  } = buildCaseWorkspaceChromeState({
    locale,
    localeTag,
    railView,
    hasSelectedCase,
    isAuthoringCanvas,
    desktopFastMode,
    draft,
    draftSavedAt,
    patientIdLookup,
    editingCaseContext,
    listViewHeaderCopy: copy.listViewHeaderCopy,
    draftAutosaved: copy.draftAutosaved,
    draftUnsaved: copy.draftUnsaved,
  });
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const leftRailProps = buildCaseWorkspaceLeftRailProps({
    locale,
    visibleSites,
    selectedSiteId,
    summary: effectiveRailSummary,
    desktopFastMode,
    newCaseModeActive,
    listModeActive,
    isAuthoringCanvas,
    draftCompletionPercent,
    draftImagesCount: draftImages.length,
    draftRepresentativeCount,
    resolvedVisitReferenceLabel,
    draftStatusLabel,
    latestSiteValidation,
    siteValidationRuns,
    railView,
    siteValidationBusy,
    canRunValidation,
    commonNotAvailable: common.notAvailable,
    localeTag,
    formatDateTime: formatCaseWorkspaceDateTime,
    latestAutosavedDraft,
    onStartNewCase: startNewCaseDraft,
    onOpenPatientList: handleOpenPatientList,
    onOpenLatestAutosavedDraft: handleOpenLatestAutosavedDraft,
    onSelectSite,
    onRunSiteValidation: handleRunSiteValidation,
  });
  const patientListViewProps = buildPatientListViewProps({
    locale,
    localeTag,
    commonNotAvailable: common.notAvailable,
    selectedSiteId,
    token,
    selectedSiteLabel,
    selectedPatientId: selectedCase?.patient_id,
    patientListRows,
    patientListTotalCount,
    patientListPage: safePage,
    patientListTotalPages,
    patientListThumbsByPatient: patientListThumbs,
    caseSearch,
    showOnlyMine,
    casesLoading: patientListLoading,
    copyPatients: copy.patients,
    copyAllRecords: copy.allRecords,
    copyMyPatientsOnly: copy.myPatientsOnly,
    copyLoadingSavedCases: copy.loadingSavedCases,
    pick,
    translateOption,
    displayVisitReference,
    formatDateTime: formatCaseWorkspaceDateTime,
    onSearchChange: handlePatientListSearchChange,
    onShowOnlyMineChange: handlePatientScopeChange,
    onPageChange: handlePatientListPageChange,
    onOpenSavedCase: openSavedCase,
    onOpenImageTextSearchResult: handleOpenImageTextSearchResult,
    prefetchDesktopVisitImages,
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactItems,
    medsamArtifactItemsBusy,
    medsamArtifactPage,
    medsamArtifactTotalCount,
    medsamArtifactTotalPages,
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    medsamArtifactStatusBusy,
    medsamArtifactBackfillBusy,
    canBackfillMedsamArtifacts: canRunValidation,
    onEnableMedsamArtifactPanel: handleEnableMedsamArtifactPanel,
    onDisableMedsamArtifactPanel: handleDisableMedsamArtifactPanel,
    onRefreshMedsamArtifactStatus: handleRefreshMedsamArtifactStatus,
    onOpenMedsamArtifactBacklog: handleOpenMedsamArtifactBacklog,
    onCloseMedsamArtifactBacklog: handleCloseMedsamArtifactBacklog,
    onMedsamArtifactScopeChange: handleMedsamArtifactScopeChange,
    onMedsamArtifactPageChange: handleMedsamArtifactPageChange,
    onBackfillMedsamArtifacts: handleBackfillMedsamArtifacts,
  });
  const headerProps = buildCaseWorkspaceHeaderProps({
    locale,
    localeTag,
    title: mainHeaderTitle,
    subtitle: mainHeaderCopy,
    theme,
    selectedSiteId,
    controlPlaneStatus,
    controlPlaneStatusBusy,
    canOpenOperations,
    userRole: user.role,
    alertsPanelRef,
    alertsPanelOpen,
    toastHistory,
    recentAlertsLabel: copy.recentAlerts,
    recentAlertsCopy: copy.recentAlertsCopy,
    alertsKeptLabel: copy.alertsKept,
    clearAlertsLabel: copy.clearAlerts,
    noAlertsYetLabel: copy.noAlertsYet,
    savedLabel: common.saved,
    actionNeededLabel: common.actionNeeded,
    onToggleAlerts: toggleAlertsPanel,
    onClearAlerts: clearToastHistory,
    onToggleTheme,
    onOpenHospitalAccessRequest,
    onOpenOperations,
    onOpenDesktopSettings,
    onExportManifest,
    onLogout,
  });
  const savedCaseViewProps = selectedCase
    ? buildSavedCaseViewProps({
        locale,
        localeTag,
        commonLoading: common.loading,
        commonNotAvailable: common.notAvailable,
        selectedCase,
        selectedPatientCases,
        panelBusy,
        patientVisitGalleryBusy,
        patientVisitGallery,
        patientVisitGalleryLoadingCaseIds,
        patientVisitGalleryErrorCaseIds,
        pick,
        translateOption,
        displayVisitReference,
        formatDateTime: formatCaseWorkspaceDateTime,
        organismSummaryLabel,
        editDraftBusy,
        onStartEditDraft: startEditDraftFromSelectedCase,
        onStartFollowUpDraft: startFollowUpDraftFromSelectedCase,
        onToggleFavorite: toggleFavoriteCase,
        onOpenSavedCase: openSavedCase,
        selectedSiteId,
        ensurePatientVisitImagesLoaded,
        onDeleteSavedCase: handleDeleteSavedCase,
        isFavoriteCase,
        caseTitle: formatCaseTitle(selectedCase),
        selectedCaseImages,
        liveLesionMaskEnabled: liveLesionCropEnabled,
        semanticPromptInputMode,
        semanticPromptInputOptions,
        semanticPromptBusyImageId,
        semanticPromptReviews,
        semanticPromptErrors,
        semanticPromptOpenImageIds,
        liveLesionPreviews,
        savedImageRoiCropUrls,
        savedImageRoiCropBusy,
        savedImageLesionCropUrls,
        savedImageLesionCropBusy,
        lesionPromptDrafts,
        lesionPromptSaved,
        lesionBoxBusyImageId,
        representativeBusyImageId,
        formatSemanticScore,
        onToggleLiveLesionMask: () =>
          setLiveLesionCropEnabled((current) => !current),
        onSemanticPromptInputModeChange: setSemanticPromptInputMode,
        onSetSavedRepresentative: handleSetSavedRepresentative,
        onReviewSemanticPrompts: handleReviewSemanticPrompts,
        onLesionPointerDown: handleLesionPointerDown,
        onLesionPointerMove: handleLesionPointerMove,
        onFinishLesionPointer: finishLesionPointer,
        hasAnySavedLesionBox,
      })
    : null;
  const draftViewProps = buildDraftViewProps({
    locale,
    draft,
    selectedSiteLabel,
    draftStatusLabel,
    resolvedVisitReferenceLabel,
    translateOption,
    organismSummaryLabel,
    actualVisitDateLabel,
    commonNotAvailable: common.notAvailable,
    sexOptions: CASE_WORKSPACE_SEX_OPTIONS,
    contactLensOptions: CASE_WORKSPACE_CONTACT_LENS_OPTIONS,
    predisposingFactorOptions: CASE_WORKSPACE_PREDISPOSING_FACTOR_OPTIONS,
    visitStatusOptions: CASE_WORKSPACE_VISIT_STATUS_OPTIONS,
    cultureStatusOptions: CASE_WORKSPACE_CULTURE_STATUS_OPTIONS,
    cultureSpecies: CASE_WORKSPACE_CULTURE_SPECIES,
    speciesOptions,
    pendingOrganism,
    pendingSpeciesOptions,
    showAdditionalOrganismForm,
    intakeOrganisms,
    patientIdLookup,
    patientIdLookupBusy,
    patientIdLookupError,
    setDraft,
    setPendingOrganism,
    setShowAdditionalOrganismForm,
    togglePredisposingFactor,
    updatePrimaryOrganism,
    addAdditionalOrganism,
    removeAdditionalOrganism,
    onCompleteIntake: handleCompleteIntake,
    whiteDraftImages,
    fluoresceinDraftImages,
    draftLesionPromptBoxes,
    whiteFileInputRef,
    fluoresceinFileInputRef,
    openFilePicker,
    appendFiles,
    handleDraftLesionPointerDown,
    handleDraftLesionPointerMove,
    finishDraftLesionPointer,
    removeDraftImage,
    setRepresentativeImage,
    onSaveCase: () => void handleSaveCase(),
    saveBusy,
    selectedSiteId,
  });
  const analysisSectionProps = buildCaseWorkspaceAnalysisSectionProps({
    locale,
    token,
    selectedSiteId,
    mounted: analysisSectionMounted,
    commonLoading: common.loading,
    commonNotAvailable: common.notAvailable,
    hasSelectedCase,
    canRunRoiPreview,
    canRunValidation,
    canRunAiClinic,
    selectedCaseImageCount: selectedCaseImages.length,
    representativePreviewUrl: representativeSavedImage?.preview_url,
    selectedCompareModelVersionIds,
    siteModelVersions,
    validationBusy,
    validationResult,
    validationArtifacts,
    modelCompareBusy,
    modelCompareResult,
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicResult,
    aiClinicPreviewBusy,
    hasAnySavedLesionBox,
    roiPreviewBusy,
    lesionPreviewBusy,
    roiPreviewItems,
    lesionPreviewItems,
    pickLabel: pick,
    translateOption,
    setToast,
    setSelectedCompareModelVersionIds,
    displayVisitReference,
    aiClinicTextUnavailableLabel: copy.aiClinicTextUnavailable,
    onRunValidation: handleRunValidation,
    onRunModelCompare: handleRunModelCompare,
    onRunAiClinic: handleRunAiClinic,
    onExpandAiClinic: handleExpandAiClinic,
    onRunRoiPreview: handleRunRoiPreview,
    onRunLesionPreview: handleRunLesionPreview,
  });
  const contributionSectionProps = buildCaseWorkspaceContributionSectionProps({
    locale,
    selectedCase,
    completionState,
    summary,
    canRunValidation,
    validationResult,
    researchRegistryBusy,
    contributionBusy,
    contributionResult,
    siteContributionLeaderboard:
      siteActivity?.contribution_leaderboard ?? null,
    historyBusy,
    caseHistory,
    commonNotAvailable: common.notAvailable,
    localeTag,
    formatDateTime: formatCaseWorkspaceDateTime,
    userPublicAlias: user.public_alias,
    onJoinResearchRegistry: () => openResearchRegistryModal(false),
    onIncludeResearchCase: handleIncludeResearchCase,
    onExcludeResearchCase: handleExcludeResearchCase,
    onContributeCase: handleContributeCase,
  });
  const { analysisSectionContent, reviewPanelProps } =
    buildCaseWorkspaceReviewContentProps({
      analysisSectionProps,
      contributionSectionProps,
      locale,
      isAuthoringCanvas,
      draftStatusLabel,
      selectedSiteLabel,
      draftCompletionCount,
      draftImagesCount: draftImages.length,
      draftRepresentativeCount,
      draftCompletionPercent,
      draftPendingItems,
    });

  const surfaceProps = buildCaseWorkspaceSurfaceProps({
    theme,
    toast,
    savedLabel: common.saved,
    actionNeededLabel: common.actionNeeded,
    leftRailProps,
    workspaceMainClass,
    headerProps,
    railView,
    mainLayoutClass,
    patientListViewProps,
    savedCaseViewProps,
    analysisSectionContent,
    selectedSiteId,
    locale,
    draftViewProps,
    showSecondaryPanel,
    reviewPanelProps,
    onOpenHospitalAccessRequest,
    researchRegistryModalOpen,
    researchRegistryBusy,
    researchRegistryExplanationConfirmed,
    researchRegistryUsageConsented,
    researchRegistryJoinReady,
    closeResearchRegistryModal,
    setResearchRegistryExplanationConfirmed,
    setResearchRegistryUsageConsented,
    handleJoinResearchRegistry,
  });

  return <CaseWorkspaceSurface {...surfaceProps} />;
}
