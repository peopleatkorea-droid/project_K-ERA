"use client";

import { createElement, type ComponentProps, type ReactNode } from "react";

import { pick, type Locale } from "../../lib/i18n";
import { CaseWorkspaceLeftRail } from "./case-workspace-left-rail";
import { CaseWorkspaceReviewPanel } from "./case-workspace-review-panel";
import {
  CaseWorkspaceAnalysisSection,
  CaseWorkspaceContributionSection,
} from "./case-workspace-review-sections";
import {
  isResearchEligibleCase,
  isResearchRegistryIncluded,
  isSelectableCompareModelVersion,
  sortCompareModelVersions,
} from "./case-workspace-core-helpers";

type LeftRailProps = ComponentProps<typeof CaseWorkspaceLeftRail>;
type AnalysisSectionProps = ComponentProps<typeof CaseWorkspaceAnalysisSection>;
type ContributionSectionProps = ComponentProps<
  typeof CaseWorkspaceContributionSection
>;
type ReviewPanelProps = ComponentProps<typeof CaseWorkspaceReviewPanel>;

type FormatDateTimeWithLocale = (
  value: string | null | undefined,
  localeTag: string,
  emptyLabel: string,
) => string;

type VisitReferenceFormatter = (
  locale: Locale,
  visitReference: string,
) => string;

export function buildCaseWorkspaceLeftRailProps(args: {
  locale: LeftRailProps["locale"];
  visibleSites: LeftRailProps["visibleSites"];
  selectedSiteId: string | null;
  summary: LeftRailProps["summary"];
  desktopFastMode: boolean;
  newCaseModeActive: LeftRailProps["newCaseModeActive"];
  listModeActive: LeftRailProps["listModeActive"];
  isAuthoringCanvas: LeftRailProps["isAuthoringCanvas"];
  draftCompletionPercent: LeftRailProps["draftCompletionPercent"];
  draftImagesCount: LeftRailProps["draftImagesCount"];
  draftRepresentativeCount: LeftRailProps["draftRepresentativeCount"];
  resolvedVisitReferenceLabel: LeftRailProps["resolvedVisitReferenceLabel"];
  draftStatusLabel: LeftRailProps["draftStatusLabel"];
  latestSiteValidation: LeftRailProps["latestSiteValidation"];
  siteValidationRuns: LeftRailProps["siteValidationRuns"];
  railView: "cases" | "patients";
  siteValidationBusy: LeftRailProps["siteValidationBusy"];
  canRunValidation: LeftRailProps["canRunValidation"];
  commonNotAvailable: LeftRailProps["commonNotAvailable"];
  localeTag: string;
  formatDateTime: FormatDateTimeWithLocale;
  latestAutosavedDraft: LeftRailProps["latestAutosavedDraft"];
  onStartNewCase: LeftRailProps["onStartNewCase"];
  onOpenPatientList: LeftRailProps["onOpenPatientList"];
  onOpenLatestAutosavedDraft: LeftRailProps["onOpenLatestAutosavedDraft"];
  onSelectSite: LeftRailProps["onSelectSite"];
  onRunSiteValidation: () => void | Promise<void>;
}): LeftRailProps {
  const {
    locale,
    visibleSites,
    selectedSiteId,
    summary,
    desktopFastMode,
    newCaseModeActive,
    listModeActive,
    isAuthoringCanvas,
    draftCompletionPercent,
    draftImagesCount,
    draftRepresentativeCount,
    resolvedVisitReferenceLabel,
    draftStatusLabel,
    latestSiteValidation,
    siteValidationRuns,
    railView,
    siteValidationBusy,
    canRunValidation,
    commonNotAvailable,
    localeTag,
    formatDateTime,
    latestAutosavedDraft,
    onStartNewCase,
    onOpenPatientList,
    onOpenLatestAutosavedDraft,
    onSelectSite,
    onRunSiteValidation,
  } = args;

  return {
    locale,
    visibleSites,
    selectedSiteId,
    allowCaseCreation: Boolean(selectedSiteId),
    summary,
    fastMode: desktopFastMode,
    newCaseModeActive,
    listModeActive,
    isAuthoringCanvas,
    draftCompletionPercent,
    draftImagesCount,
    draftRepresentativeCount,
    resolvedVisitReferenceLabel,
    draftStatusLabel,
    latestSiteValidation,
    siteValidationRuns,
    deferValidationHistory: railView === "patients",
    siteValidationBusy,
    canRunValidation,
    commonNotAvailable,
    formatDateTime: (value) =>
      formatDateTime(value, localeTag, commonNotAvailable),
    latestAutosavedDraft,
    onStartNewCase,
    onOpenPatientList,
    onOpenLatestAutosavedDraft,
    onSelectSite,
    onRunSiteValidation: () => {
      void onRunSiteValidation();
    },
  };
}

export function buildCaseWorkspaceAnalysisSectionProps(args: {
  locale: AnalysisSectionProps["locale"];
  token: AnalysisSectionProps["token"];
  selectedSiteId: AnalysisSectionProps["selectedSiteId"];
  mounted: AnalysisSectionProps["mounted"];
  commonLoading: AnalysisSectionProps["commonLoading"];
  commonNotAvailable: AnalysisSectionProps["commonNotAvailable"];
  hasSelectedCase: AnalysisSectionProps["hasSelectedCase"];
  canRunRoiPreview: AnalysisSectionProps["canRunRoiPreview"];
  canRunValidation: AnalysisSectionProps["canRunValidation"];
  canRunAiClinic: AnalysisSectionProps["canRunAiClinic"];
  selectedCaseImageCount: AnalysisSectionProps["selectedCaseImageCount"];
  representativePreviewUrl: AnalysisSectionProps["representativePreviewUrl"];
  selectedCompareModelVersionIds: AnalysisSectionProps["selectedCompareModelVersionIds"];
  selectedValidationModelVersionId: AnalysisSectionProps["selectedValidationModelVersionId"];
  siteModelVersions: AnalysisSectionProps["compareModelCandidates"];
  validationBusy: AnalysisSectionProps["validationBusy"];
  validationResult: AnalysisSectionProps["validationResult"];
  validationArtifacts: AnalysisSectionProps["validationArtifacts"];
  modelCompareBusy: AnalysisSectionProps["modelCompareBusy"];
  modelCompareResult: AnalysisSectionProps["modelCompareResult"];
  aiClinicBusy: AnalysisSectionProps["aiClinicBusy"];
  aiClinicExpandedBusy: AnalysisSectionProps["aiClinicExpandedBusy"];
  aiClinicResult: AnalysisSectionProps["aiClinicResult"];
  aiClinicPreviewBusy: AnalysisSectionProps["aiClinicPreviewBusy"];
  hasAnySavedLesionBox: AnalysisSectionProps["hasAnySavedLesionBox"];
  roiPreviewBusy: AnalysisSectionProps["roiPreviewBusy"];
  lesionPreviewBusy: AnalysisSectionProps["lesionPreviewBusy"];
  roiPreviewItems: AnalysisSectionProps["roiPreviewItems"];
  lesionPreviewItems: AnalysisSectionProps["lesionPreviewItems"];
  pickLabel: AnalysisSectionProps["pickLabel"];
  translateOption: AnalysisSectionProps["translateOption"];
  setToast: AnalysisSectionProps["setToast"];
  setSelectedCompareModelVersionIds: AnalysisSectionProps["setSelectedCompareModelVersionIds"];
  setSelectedValidationModelVersionId: AnalysisSectionProps["setSelectedValidationModelVersionId"];
  displayVisitReference: VisitReferenceFormatter;
  aiClinicTextUnavailableLabel: AnalysisSectionProps["aiClinicTextUnavailableLabel"];
  onRunValidation: () => void | Promise<void>;
  onRunModelCompare: () => void | Promise<void>;
  onRunAiClinic: () => void | Promise<void>;
  onExpandAiClinic: () => void | Promise<void>;
  onRunRoiPreview: AnalysisSectionProps["onRunRoiPreview"];
  onRunLesionPreview: AnalysisSectionProps["onRunLesionPreview"];
}): AnalysisSectionProps {
  const {
    locale,
    token,
    selectedSiteId,
    mounted,
    commonLoading,
    commonNotAvailable,
    hasSelectedCase,
    canRunRoiPreview,
    canRunValidation,
    canRunAiClinic,
    selectedCaseImageCount,
    representativePreviewUrl,
    selectedCompareModelVersionIds,
    selectedValidationModelVersionId,
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
    pickLabel,
    translateOption,
    setToast,
    setSelectedCompareModelVersionIds,
    setSelectedValidationModelVersionId,
    displayVisitReference,
    aiClinicTextUnavailableLabel,
    onRunValidation,
    onRunModelCompare,
    onRunAiClinic,
    onExpandAiClinic,
    onRunRoiPreview,
    onRunLesionPreview,
  } = args;

  return {
    locale,
    token,
    selectedSiteId,
    mounted,
    analysisEyebrow: pick(locale, "Clinical AI review", "진료용 AI 검토"),
    analysisTitle: pick(
      locale,
      "Single-case judgment, model agreement, and similar-patient review",
      "단일 케이스 판정, 모델 합의 확인, 유사 환자 검토",
    ),
    analysisDescription: pick(
      locale,
      "Use this in order: judge one case, check whether models agree, then review similar patients and optional evidence.",
      "보통 이 순서로 사용합니다: 케이스 하나를 판정하고, 모델 합의를 확인한 뒤, 유사 환자와 필요 시 추가 근거를 검토합니다.",
    ),
    imageCountLabel: pick(locale, "images", "이미지"),
    commonLoading,
    commonNotAvailable,
    hasSelectedCase,
    canRunRoiPreview,
    canRunValidation,
    canRunAiClinic,
    selectedCaseImageCount,
    representativePreviewUrl,
    selectedCompareModelVersionIds,
    selectedValidationModelVersionId,
    compareModelCandidates: sortCompareModelVersions(
      siteModelVersions.filter(isSelectableCompareModelVersion),
    ),
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
    pickLabel,
    translateOption,
    setToast,
    setSelectedCompareModelVersionIds,
    setSelectedValidationModelVersionId,
    onRunValidation: () => {
      void onRunValidation();
    },
    onRunModelCompare: () => {
      void onRunModelCompare();
    },
    onRunAiClinic: () => {
      void onRunAiClinic();
    },
    onExpandAiClinic: () => {
      void onExpandAiClinic();
    },
    onRunRoiPreview,
    onRunLesionPreview,
    displayVisitReference: (visitReference) =>
      displayVisitReference(locale, visitReference),
    aiClinicTextUnavailableLabel,
  };
}

export function buildCaseWorkspaceContributionSectionProps(args: {
  locale: ContributionSectionProps["locale"];
  selectedCase: ContributionSectionProps["selectedCase"];
  completionState: ContributionSectionProps["completionState"];
  summary: {
    n_validation_runs?: number | null;
    research_registry?: {
      site_enabled: boolean;
      user_enrolled: boolean;
    } | null;
  } | null;
  canRunValidation: ContributionSectionProps["canRunValidation"];
  validationResult: unknown;
  researchRegistryBusy: ContributionSectionProps["researchRegistryBusy"];
  contributionBusy: ContributionSectionProps["contributionBusy"];
  contributionResult: ContributionSectionProps["contributionResult"];
  siteContributionLeaderboard: ContributionSectionProps["contributionLeaderboard"];
  historyBusy: ContributionSectionProps["historyBusy"];
  caseHistory: ContributionSectionProps["caseHistory"];
  commonNotAvailable: ContributionSectionProps["notAvailableLabel"];
  localeTag: string;
  formatDateTime: FormatDateTimeWithLocale;
  userPublicAlias: string | null | undefined;
  onJoinResearchRegistry: () => void;
  onIncludeResearchCase: () => void | Promise<void>;
  onExcludeResearchCase: () => void | Promise<void>;
  onContributeCase: () => void | Promise<void>;
}): ContributionSectionProps {
  const {
    locale,
    selectedCase,
    completionState,
    summary,
    canRunValidation,
    validationResult,
    researchRegistryBusy,
    contributionBusy,
    contributionResult,
    siteContributionLeaderboard,
    historyBusy,
    caseHistory,
    commonNotAvailable,
    localeTag,
    formatDateTime,
    userPublicAlias,
    onJoinResearchRegistry,
    onIncludeResearchCase,
    onExcludeResearchCase,
    onContributeCase,
  } = args;

  const researchRegistryEnabled = Boolean(
    summary?.research_registry?.site_enabled,
  );
  const researchRegistryUserEnrolled = Boolean(
    summary?.research_registry?.user_enrolled,
  );
  const canContributeSelectedCase =
    canRunValidation &&
    researchRegistryUserEnrolled &&
    isResearchEligibleCase(selectedCase) &&
    isResearchRegistryIncluded(selectedCase?.research_registry_status);

  return {
    locale,
    selectedCase,
    completionState,
    hospitalValidationCount: summary?.n_validation_runs ?? 0,
    canRunValidation,
    canContributeSelectedCase,
    hasValidationResult: Boolean(validationResult),
    researchRegistryEnabled,
    researchRegistryUserEnrolled,
    researchRegistryBusy,
    contributionBusy,
    contributionResult,
    currentUserPublicAlias:
      userPublicAlias ?? contributionResult?.stats.user_public_alias ?? null,
    contributionLeaderboard:
      siteContributionLeaderboard ??
      contributionResult?.stats.leaderboard ??
      null,
    historyBusy,
    caseHistory,
    notAvailableLabel: commonNotAvailable,
    formatDateTime: (value, emptyLabel) =>
      formatDateTime(value, localeTag, emptyLabel),
    onJoinResearchRegistry,
    onIncludeResearchCase: () => {
      void onIncludeResearchCase();
    },
    onExcludeResearchCase: () => {
      void onExcludeResearchCase();
    },
    onContributeCase: () => {
      void onContributeCase();
    },
  };
}

export function buildCaseWorkspaceReviewPanelProps(args: {
  locale: ReviewPanelProps["locale"];
  selectedCasePanelContent: ReviewPanelProps["selectedCasePanelContent"];
  isAuthoringCanvas: ReviewPanelProps["isAuthoringCanvas"];
  draftStatusLabel: ReviewPanelProps["draftStatusLabel"];
  selectedSiteLabel: ReviewPanelProps["selectedSiteLabel"];
  draftCompletionCount: ReviewPanelProps["draftCompletionCount"];
  draftImagesCount: ReviewPanelProps["draftImagesCount"];
  draftRepresentativeCount: ReviewPanelProps["draftRepresentativeCount"];
  draftCompletionPercent: ReviewPanelProps["draftCompletionPercent"];
  draftPendingItems: ReviewPanelProps["draftPendingItems"];
}): ReviewPanelProps {
  return { ...args };
}

export function buildCaseWorkspaceReviewContentProps(args: {
  analysisSectionProps: AnalysisSectionProps;
  contributionSectionProps: ContributionSectionProps;
  locale: ReviewPanelProps["locale"];
  isAuthoringCanvas: ReviewPanelProps["isAuthoringCanvas"];
  draftStatusLabel: ReviewPanelProps["draftStatusLabel"];
  selectedSiteLabel: ReviewPanelProps["selectedSiteLabel"];
  draftCompletionCount: ReviewPanelProps["draftCompletionCount"];
  draftImagesCount: ReviewPanelProps["draftImagesCount"];
  draftRepresentativeCount: ReviewPanelProps["draftRepresentativeCount"];
  draftCompletionPercent: ReviewPanelProps["draftCompletionPercent"];
  draftPendingItems: ReviewPanelProps["draftPendingItems"];
}): {
  analysisSectionContent: ReactNode;
  reviewPanelProps: ReviewPanelProps;
} {
  const {
    analysisSectionProps,
    contributionSectionProps,
    locale,
    isAuthoringCanvas,
    draftStatusLabel,
    selectedSiteLabel,
    draftCompletionCount,
    draftImagesCount,
    draftRepresentativeCount,
    draftCompletionPercent,
    draftPendingItems,
  } = args;

  const selectedCasePanelContent = createElement(
    CaseWorkspaceContributionSection,
    contributionSectionProps,
  );

  return {
    analysisSectionContent: createElement(
      CaseWorkspaceAnalysisSection,
      analysisSectionProps,
    ),
    reviewPanelProps: buildCaseWorkspaceReviewPanelProps({
      locale,
      selectedCasePanelContent,
      isAuthoringCanvas,
      draftStatusLabel,
      selectedSiteLabel,
      draftCompletionCount,
      draftImagesCount,
      draftRepresentativeCount,
      draftCompletionPercent,
      draftPendingItems,
    }),
  };
}
