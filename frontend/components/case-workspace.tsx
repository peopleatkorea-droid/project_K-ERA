"use client";

import {
  startTransition,
  type Dispatch,
  type SetStateAction,
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
  translateRole,
  useI18n,
  type Locale,
} from "../lib/i18n";
import { useCaseWorkspaceCaseSaveDelete } from "./case-workspace/use-case-workspace-case-save-delete";
import { CaseWorkspaceHeader } from "./case-workspace/case-workspace-header";
import { CaseWorkspaceLeftRail } from "./case-workspace/case-workspace-left-rail";
import {
  CaseWorkspaceDraftView,
  CaseWorkspacePatientListView,
  CaseWorkspaceSavedCaseView,
  CaseWorkspaceSiteAccessPrompt,
} from "./case-workspace/case-workspace-main-content";
import { CaseWorkspaceResearchRegistryModal } from "./case-workspace/case-workspace-research-registry-modal";
import {
  CaseWorkspaceAnalysisSection,
  CaseWorkspaceContributionSection,
} from "./case-workspace/case-workspace-review-sections";
import { useCaseWorkspacePatientListArtifacts } from "./case-workspace/use-case-workspace-patient-list-artifacts";
import { CaseWorkspaceReviewPanel } from "./case-workspace/case-workspace-review-panel";
import { useCaseWorkspaceResearchRegistryActions } from "./case-workspace/use-case-workspace-research-registry-actions";
import { CaseWorkspaceShell } from "./case-workspace/case-workspace-shell";
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
  isResearchRegistryIncluded,
  isSelectableCompareModelVersion,
  mergeRailSummaryCategoryCounts,
  sortCompareModelVersions,
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
import { useCaseWorkspaceReviewActions } from "./case-workspace/use-case-workspace-review-actions";
import { formatSemanticScore } from "./case-workspace/case-workspace-review-formatters";
import { useCaseWorkspaceSavedCaseActions } from "./case-workspace/use-case-workspace-saved-case-actions";
import { useCaseWorkspaceSiteData } from "./case-workspace/use-case-workspace-site-data";
import {
  buildDraftViewProps,
  buildSavedCaseViewProps,
} from "./case-workspace/case-workspace-main-content-props";
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
import { type DesktopControlPlaneProbe } from "../lib/desktop-control-plane-status";
import { formatPublicAlias } from "../lib/public-alias";
import {
  type CaseHistoryResponse,
  type CaseContributionResponse,
  type CaseValidationCompareResponse,
  type OrganismRecord,
  fetchPatientIdLookup,
  fetchSiteSummaryCounts,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  invalidateDesktopCaseWorkspaceCaches,
  type AuthUser,
  type CaseSummaryRecord,
  type LiveLesionPreviewJobResponse,
  type PatientIdLookupResponse,
  type SemanticPromptInputMode,
  type SiteRecord,
  type SiteSummary,
  type VisitRecord,
  mergeSiteSummaryCounts,
} from "../lib/api";

const SEX_OPTIONS = ["male", "female", "unknown"];
const CONTACT_LENS_OPTIONS = [
  "none",
  "soft contact lens",
  "rigid gas permeable",
  "orthokeratology",
  "unknown",
];
const PREDISPOSING_FACTOR_OPTIONS = [
  "trauma",
  "ocular surface disease",
  "topical steroid use",
  "post surgery",
  "neurotrophic",
  "unknown",
];
const VISIT_STATUS_OPTIONS = ["active", "improving", "scar"];
const CULTURE_STATUS_OPTIONS = [
  "positive",
  "negative",
  "not_done",
  "unknown",
];
const WORKSPACE_TIMING_LOGS =
  process.env.NEXT_PUBLIC_KERA_WORKSPACE_TIMING_LOGS === "1" ||
  process.env.NEXT_PUBLIC_KERA_BOOTSTRAP_TIMING_LOGS === "1";
const CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Staphylococcus hominis",
    "Coagulase-negative Staphylococcus",
    "Other Staphylococcus species",
    "Streptococcus pneumoniae",
    "Streptococcus viridans group",
    "Other Streptococcus species",
    "Enterococcus faecalis",
    "Gemella species",
    "Granulicatella species",
    "Pseudomonas aeruginosa",
    "Moraxella",
    "Corynebacterium",
    "Rothia",
    "Serratia marcescens",
    "Bacillus",
    "Other Gram-positive rods",
    "Other Gram-negative rods",
    "Haemophilus influenzae",
    "Klebsiella pneumoniae",
    "Enterobacter",
    "Citrobacter",
    "Burkholderia",
    "Pandoraea species",
    "Stenotrophomonas",
    "Achromobacter",
    "Nocardia",
    "Other",
  ],
  fungal: [
    // Common molds first, then the remaining named molds, then yeasts, then catch-alls.
    "Fusarium",
    "Aspergillus",
    "Acremonium",
    "Alternaria",
    "Australiasca species",
    "Beauveria bassiana",
    "Bipolaris",
    "Cladophialophora",
    "Cladosporium",
    "Colletotrichum",
    "Curvularia",
    "Exserohilum",
    "Lasiodiplodia",
    "Paecilomyces",
    "Penicillium",
    "Scedosporium",
    "Other Molds",
    "Candida",
    "Other Yeasts",
    "Other",
  ],
};

type ValidationArtifactKind =
  | "gradcam"
  | "gradcam_cornea"
  | "gradcam_lesion"
  | "roi_crop"
  | "medsam_mask"
  | "lesion_crop"
  | "lesion_mask";

type ValidationArtifactPreviews = Partial<
  Record<ValidationArtifactKind, string | null>
>;

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
  culture_status: string;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  visit_status: string;
  is_initial_visit: boolean;
  predisposing_factor: string[];
  other_history: string;
  intake_completed: boolean;
};

type PersistedDraft = {
  draft: DraftState;
  updated_at: string;
};

type CompletionState = {
  kind: "saved" | "contributed";
  patient_id: string;
  visit_date: string;
  timestamp: string;
  stats?: {
    user_contributions: number;
    total_contributions: number;
    user_contribution_pct: number;
  };
  update_id?: string;
  update_count?: number;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type ToastLogEntry = {
  id: string;
  tone: "success" | "error";
  message: string;
  created_at: string;
};

type CaseWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  canOpenOperations: boolean;
  theme: "dark" | "light";
  controlPlaneStatus?: DesktopControlPlaneProbe | null;
  controlPlaneStatusBusy?: boolean;
  onSelectSite: (siteId: string) => void;
  onExportManifest: () => void;
  onLogout: () => void;
  onOpenOperations: (
    section?: "management" | "dashboard" | "training" | "cross_validation",
  ) => void;
  onOpenHospitalAccessRequest?: () => void;
  onOpenDesktopSettings?: () => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onToggleTheme: () => void;
};

function formatDateTime(
  value: string | null | undefined,
  localeTag: string,
  emptyLabel: string,
): string {
  if (!value) {
    return emptyLabel;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(localeTag, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function executionModeFromDevice(
  device: string | undefined,
): "auto" | "cpu" | "gpu" {
  if (device === "cuda") {
    return "gpu";
  }
  if (device === "cpu") {
    return "cpu";
  }
  return "auto";
}

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
    useState<CompletionState | null>(null);
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
  const [toast, setToastState] = useState<ToastState>(null);
  const [toastHistory, setToastHistory] = useState<ToastLogEntry[]>([]);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [caseImageCacheVersion, setCaseImageCacheVersion] = useState(0);
  const alertsPanelRef = useRef<HTMLDivElement | null>(null);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const workspaceOpenedAtRef = useRef<number | null>(null);
  const siteLabelLoggedRef = useRef<string | null>(null);
  const caseOpenStartedAtRef = useRef<number | null>(null);
  const caseOpenCaseIdRef = useRef<string | null>(null);
  const caseImagesLoggedCaseIdRef = useRef<string | null>(null);
  const desktopFastMode = canUseDesktopTransport();
  const researchRegistryJoinReady =
    researchRegistryExplanationConfirmed && researchRegistryUsageConsented;
  const setToast = useCallback<Dispatch<SetStateAction<ToastState>>>(
    (nextValue) => {
      setToastState((current) => {
        const resolved =
          typeof nextValue === "function" ? nextValue(current) : nextValue;
        if (resolved) {
          setToastHistory((existing) =>
            [
              {
                id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                tone: resolved.tone,
                message: resolved.message,
                created_at: new Date().toISOString(),
              },
              ...existing,
            ].slice(0, 8),
          );
        }
        return resolved;
      });
    },
    [],
  );
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
    workspaceTimingLogs: WORKSPACE_TIMING_LOGS,
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
  const clearToastHistory = useCallback(() => {
    setToastHistory([]);
  }, []);
  useEffect(() => {
    if (!alertsPanelOpen) {
      return;
    }

    function handleDocumentPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (alertsPanelRef.current?.contains(target)) {
        return;
      }
      setAlertsPanelOpen(false);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAlertsPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [alertsPanelOpen]);
  const copy = {
    recoveredDraft: pick(
      locale,
      "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.",
      "??蹂묒썝??留덉?留?珥덉븞 ?띿꽦??蹂듦뎄?덉뒿?덈떎. ??????대?吏 ?뚯씪? ?ㅼ떆 泥⑤???二쇱꽭??",
    ),
    recoveredDraftWithAssets: pick(
      locale,
      "Recovered the last saved draft for this hospital, including local images.",
      "이 병원의 마지막 초안을 로컬 이미지까지 포함해 복구했습니다.",
    ),
    unableLoadRecentCases: pick(
      locale,
      "Unable to load recent cases.",
      "理쒓렐 耳?댁뒪瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadSiteActivity: pick(
      locale,
      "Unable to load hospital activity.",
      "蹂묒썝 ?쒕룞??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadSiteValidationHistory: pick(
      locale,
      "Unable to load hospital validation history.",
      "蹂묒썝 寃利??대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadCaseHistory: pick(
      locale,
      "Unable to load case history.",
      "耳?댁뒪 ?대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    selectSavedCaseForRoi: pick(
      locale,
      "Select a saved case before running cornea preview.",
      "媛곷쭑 crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Cornea preview generated for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 媛곷쭑 crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`,
      ),
    roiPreviewFailed: pick(
      locale,
      "Cornea preview failed.",
      "媛곷쭑 crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSiteForValidation: pick(
      locale,
      "Select a hospital before running hospital validation.",
      "蹂묒썝 寃利앹쓣 ?ㅽ뻾?섎젮硫?蹂묒썝???좏깮?섏꽭??",
    ),
    siteValidationSaved: (validationId: string) =>
      pick(
        locale,
        `Hospital validation saved as ${validationId}.`,
        `蹂묒썝 寃利앹씠 ${validationId}濡???λ릺?덉뒿?덈떎.`,
      ),
    siteValidationFailed: pick(
      locale,
      "Hospital validation failed.",
      "蹂묒썝 寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSavedCaseForValidation: pick(
      locale,
      "Select a saved case before running validation.",
      "寃利앹쓣 ?ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    validationSaved: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Validation saved for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 寃利앹씠 ??λ릺?덉뒿?덈떎.`,
      ),
    validationFailed: pick(
      locale,
      "Validation failed.",
      "寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    selectValidationBeforeAiClinic: pick(
      locale,
      "Run validation before opening AI Clinic retrieval.",
      "AI Clinic 寃?됱쓣 ?닿린 ?꾩뿉 癒쇱? 寃利앹쓣 ?ㅽ뻾?섏꽭??",
    ),
    aiClinicReady: (count: number) =>
      pick(
        locale,
        `AI Clinic found ${count} similar patient case(s).`,
        `AI Clinic???좎궗 ?섏옄 耳?댁뒪 ${count}嫄댁쓣 李얠븯?듬땲??`,
      ),
    aiClinicExpandedReady: pick(
      locale,
      "AI Clinic evidence and workflow are ready.",
      "AI Clinic 근거와 workflow가 준비되었습니다.",
    ),
    aiClinicFailed: pick(
      locale,
      "AI Clinic retrieval failed.",
      "AI Clinic 寃?됱뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    aiClinicExpandFirst: pick(
      locale,
      "Load similar-patient retrieval before expanding AI Clinic.",
      "AI Clinic 확장 전에 먼저 유사 환자 검색을 불러오세요.",
    ),
    aiClinicTextUnavailable: pick(
      locale,
      "BiomedCLIP text retrieval is currently unavailable in this runtime.",
      "?꾩옱 ?ㅽ뻾 ?섍꼍?먯꽌??BiomedCLIP ?띿뒪??寃?됱쓣 ?ъ슜?????놁뒿?덈떎.",
    ),
    selectSavedCaseForContribution: pick(
      locale,
      "Select a saved case before contributing.",
      "湲곗뿬瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    activeOnly: pick(
      locale,
      "Only active visits are enabled for contribution under the current policy.",
      "?꾩옱 ?뺤콉?먯꽌??active 諛⑸Ц留?湲곗뿬?????덉뒿?덈떎.",
    ),
    contributionQueued: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Contribution queued for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 湲곗뿬媛 ?湲곗뿴???깅줉?섏뿀?듬땲??`,
      ),
    contributionFailed: pick(
      locale,
      "Contribution failed.",
      "湲곗뿬???ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSiteForCase: pick(
      locale,
      "Select a hospital before creating a case.",
      "耳?댁뒪瑜??앹꽦?섎젮硫?蹂묒썝???좏깮?섏꽭??",
    ),
    patientIdRequired: pick(
      locale,
      "Patient ID is required.",
      "?섏옄 ID???꾩닔?낅땲??",
    ),
    visitDateRequired: pick(
      locale,
      "Visit reference is required.",
      "諛⑸Ц 湲곗?媛믪? ?꾩닔?낅땲??",
    ),
    cultureSpeciesRequired: pick(
      locale,
      "Select the primary organism.",
      "???洹좎쥌???좏깮?섏꽭??",
    ),
    imageRequired: pick(
      locale,
      "Add at least one slit-lamp image to save this case.",
      "耳?댁뒪瑜???ν븯?ㅻ㈃ ?멸레???대?吏瑜??섎굹 ?댁긽 異붽??섏꽭??",
    ),
    lesionBoxesRequired: pick(
      locale,
      "Draw a lesion box on every image before saving this case.",
      "케이스를 저장하기 전에 모든 이미지에 병변 박스를 그려 주세요.",
    ),
    patientCreationFailed: pick(
      locale,
      "Patient creation failed.",
      "?섏옄 ?앹꽦???ㅽ뙣?덉뒿?덈떎.",
    ),
    caseSaved: (patientId: string, visitDate: string, siteLabel: string) =>
      pick(
        locale,
        `Case ${patientId} / ${visitDate} saved to ${siteLabel}.`,
        `${patientId} / ${visitDate} 케이스가 ${siteLabel}에 저장되었습니다.`,
      ),
    caseSaveFailed: pick(
      locale,
      "Case save failed.",
      "耳?댁뒪 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    organismAdded: pick(
      locale,
      "Organism added to this visit.",
      "??諛⑸Ц??洹좎쥌??異붽??덉뒿?덈떎.",
    ),
    organismDuplicate: pick(
      locale,
      "That organism is already attached to this visit.",
      "?대? ??諛⑸Ц??異붽???洹좎쥌?낅땲??",
    ),
    intakeComplete: pick(
      locale,
      "Core case intake is marked complete.",
      "湲곕낯 耳?댁뒪 ?낅젰???꾨즺濡??쒖떆?덉뒿?덈떎.",
    ),
    intakeStepRequired: pick(
      locale,
      "Complete the intake section before saving this case.",
      "케이스 저장 전에 intake 섹션을 먼저 완료해 주세요.",
    ),
    intakeOrganismRequired: pick(
      locale,
      "Select the primary organism first.",
      "먼저 대표 균종을 선택해 주세요.",
    ),
    draftAutosaved: (time: string) =>
      pick(locale, `Draft autosaved ${time}`, `${time}에 초안 자동 저장`),
    draftUnsaved: pick(
      locale,
      "Draft changes live only in this tab",
      "초안 변경 내용은 현재 탭에만 유지됩니다.",
    ),
    recentAlerts: pick(locale, "Recent alerts", "최근 알림"),
    recentAlertsCopy: pick(
      locale,
      "Transient toasts stay here for this session.",
      "짧게 사라지는 토스트도 현재 세션에서는 여기 남겨둡니다.",
    ),
    noAlertsYet: pick(
      locale,
      "No alerts yet in this session.",
      "현재 세션에는 아직 알림이 없습니다.",
    ),
    clearAlerts: pick(locale, "Clear alerts", "알림 비우기"),
    alertsKept: pick(locale, "kept", "보관"),
    patientIdLookupFailed: pick(
      locale,
      "Unable to verify duplicate patient IDs right now.",
      "현재는 중복 환자 ID를 확인할 수 없습니다.",
    ),
    unableLoadPatientList: pick(
      locale,
      "Unable to load the patient list.",
      "환자 목록을 불러오지 못했습니다.",
    ),
    patients: pick(locale, "patients", "?섏옄"),
    savedCases: pick(locale, "saved cases", "??λ맂 耳?댁뒪"),
    loadingSavedCases: pick(
      locale,
      "Loading saved cases...",
      "??λ맂 耳?댁뒪瑜?遺덈윭?ㅻ뒗 以?..",
    ),
    noSavedCases: pick(
      locale,
      "No saved cases for this hospital yet.",
      "??蹂묒썝?먮뒗 ?꾩쭅 ??λ맂 耳?댁뒪媛 ?놁뒿?덈떎.",
    ),
    allRecords: pick(locale, "All records", "?꾩껜"),
    myPatientsOnly: pick(locale, "My patients", "???섏옄"),
    patientScopeAll: (count: number) =>
      pick(
        locale,
        `Showing all hospital patients (${count}).`,
        `蹂묒썝 ?꾩껜 ?섏옄 ${count}紐낆쓣 ?쒖떆?⑸땲??`,
      ),
    patientScopeMine: (count: number) =>
      pick(
        locale,
        `Showing only patients registered by you (${count}).`,
        `?닿? ?깅줉???섏옄 ${count}紐낅쭔 ?쒖떆?⑸땲??`,
      ),
    favoriteAdded: pick(
      locale,
      "Case added to favorites.",
      "耳?댁뒪瑜?利먭꺼李얘린??異붽??덉뒿?덈떎.",
    ),
    favoriteRemoved: pick(
      locale,
      "Case removed from favorites.",
      "耳?댁뒪 利먭꺼李얘린瑜??댁젣?덉뒿?덈떎.",
    ),
    visitDeleted: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Deleted ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 諛⑸Ц????젣?덉뒿?덈떎.`,
      ),
    patientDeleted: (patientId: string) =>
      pick(
        locale,
        `Deleted patient ${patientId}.`,
        `${patientId} ?섏옄瑜???젣?덉뒿?덈떎.`,
      ),
    deleteVisitFailed: pick(
      locale,
      "Unable to delete the visit.",
      "諛⑸Ц ??젣???ㅽ뙣?덉뒿?덈떎.",
    ),
    representativeUpdated: pick(
      locale,
      "Representative image updated.",
      "????대?吏瑜?蹂寃쏀뻽?듬땲??",
    ),
    representativeUpdateFailed: pick(
      locale,
      "Unable to update the representative image.",
      "????대?吏 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    listViewHeaderCopy: pick(
      locale,
      "Browse saved patients and open the latest case.",
      "????섏옄瑜?蹂닿퀬 理쒖떊 耳?댁뒪瑜??쎈땲??",
    ),
    caseAuthoringHeaderCopy: pick(
      locale,
      "Create, review, and contribute cases from this workspace.",
      "???묒뾽怨듦컙?먯꽌 利앸? ?묒꽦, 寃?? 湲곗뿬瑜?吏꾪뻾?????덉뒿?덈떎.",
    ),
  };
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
    cultureSpecies: CULTURE_SPECIES,
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
    if (WORKSPACE_TIMING_LOGS) {
      console.info("[kera-fast-path] workspace-open", {
        site_id: selectedSiteId,
      });
    }
  }, [desktopFastMode, selectedSiteId]);

  useEffect(() => {
    if (
      !desktopFastMode ||
      !WORKSPACE_TIMING_LOGS ||
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
    cultureSpecies: CULTURE_SPECIES,
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
    workspaceTimingLogs: WORKSPACE_TIMING_LOGS,
    caseOpenStartedAtRef,
    caseOpenCaseIdRef,
    caseImagesLoggedCaseIdRef,
    setCases,
    setSelectedCase,
    setSelectedPatientCases,
    setPanelOpen,
    setRailView,
    buildKnownPatientTimeline,
    cultureSpecies: CULTURE_SPECIES,
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
      culture_species: CULTURE_SPECIES.bacterial[0],
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
      !WORKSPACE_TIMING_LOGS ||
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

  const canRunValidation = ["admin", "site_admin", "researcher"].includes(
    user.role,
  );
  const isAuthoringCanvas = railView !== "patients" && !selectedCase;
  const newCaseModeActive = isAuthoringCanvas;
  const listModeActive = railView === "patients" || Boolean(selectedCase);
  const canRunRoiPreview = canRunValidation;
  const canRunAiClinic =
    canRunValidation && Boolean(validationResult) && Boolean(selectedCase);

  useEffect(() => {
    if (canUseDesktopTransport()) {
      return;
    }
    if (!selectedSiteId || railView === "patients" || !selectedCase) {
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void ensureSiteValidationRunsLoaded(selectedSiteId, controller.signal);
    }, 120);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [ensureSiteValidationRunsLoaded, railView, selectedCase, selectedSiteId]);

  useEffect(() => {
    if (canUseDesktopTransport()) {
      return;
    }
    if (
      !selectedSiteId ||
      railView === "patients" ||
      !selectedCase ||
      !canRunValidation
    ) {
      return;
    }
    const controller = new AbortController();
    void ensureSiteModelVersionsLoaded(selectedSiteId, controller.signal);
    return () => {
      controller.abort();
    };
  }, [
    canRunValidation,
    ensureSiteModelVersionsLoaded,
    railView,
    selectedCase,
    selectedSiteId,
  ]);

  const compareModelCandidates = useMemo(
    () =>
      sortCompareModelVersions(
        siteModelVersions.filter(isSelectableCompareModelVersion),
      ),
    [siteModelVersions],
  );
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
  const latestSiteValidation = siteValidationRuns[0] ?? null;
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
    hasSelectedCase: Boolean(selectedCase),
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
  const userRoleLabel = canOpenOperations
    ? null
    : translateRole(locale, user.role);
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
        formatDateTime,
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
    sexOptions: SEX_OPTIONS,
    contactLensOptions: CONTACT_LENS_OPTIONS,
    predisposingFactorOptions: PREDISPOSING_FACTOR_OPTIONS,
    visitStatusOptions: VISIT_STATUS_OPTIONS,
    cultureStatusOptions: CULTURE_STATUS_OPTIONS,
    cultureSpecies: CULTURE_SPECIES,
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
  const analysisSectionContent = (
    <CaseWorkspaceAnalysisSection
      locale={locale}
      token={token}
      selectedSiteId={selectedSiteId}
      mounted={analysisSectionMounted}
      analysisEyebrow={pick(
        locale,
        "Validation and AI Clinic",
        "寃利?諛?AI Clinic",
      )}
      analysisTitle={pick(
        locale,
        "Validation, artifacts, and retrieval support",
        "검증, 아티팩트, 검색 지원",
      )}
      analysisDescription={pick(
        locale,
        "Review model validation, artifacts, similar-patient retrieval, and differential support in a wider layout.",
        "紐⑤뜽 寃利? ?꾪떚?⑺듃, ?좎궗 ?섏옄 寃?? differential support瑜??볦? ?덉씠?꾩썐?먯꽌 ?뺤씤?⑸땲??",
      )}
      imageCountLabel={pick(locale, "images", "?대?吏")}
      commonLoading={common.loading}
      commonNotAvailable={common.notAvailable}
      hasSelectedCase={Boolean(selectedCase)}
      canRunRoiPreview={canRunRoiPreview}
      canRunValidation={canRunValidation}
      canRunAiClinic={canRunAiClinic}
      selectedCaseImageCount={selectedCaseImages.length}
      representativePreviewUrl={representativeSavedImage?.preview_url}
      selectedCompareModelVersionIds={selectedCompareModelVersionIds}
      compareModelCandidates={compareModelCandidates}
      validationBusy={validationBusy}
      validationResult={validationResult}
      validationArtifacts={validationArtifacts}
      modelCompareBusy={modelCompareBusy}
      modelCompareResult={modelCompareResult}
      aiClinicBusy={aiClinicBusy}
      aiClinicExpandedBusy={aiClinicExpandedBusy}
      aiClinicResult={aiClinicResult}
      aiClinicPreviewBusy={aiClinicPreviewBusy}
      hasAnySavedLesionBox={hasAnySavedLesionBox}
      roiPreviewBusy={roiPreviewBusy}
      lesionPreviewBusy={lesionPreviewBusy}
      roiPreviewItems={roiPreviewItems}
      lesionPreviewItems={lesionPreviewItems}
      pickLabel={pick}
      translateOption={translateOption}
      setToast={setToast}
      setSelectedCompareModelVersionIds={setSelectedCompareModelVersionIds}
      onRunValidation={() => void handleRunValidation()}
      onRunModelCompare={() => void handleRunModelCompare()}
      onRunAiClinic={() => void handleRunAiClinic()}
      onExpandAiClinic={() => void handleExpandAiClinic()}
      onRunRoiPreview={handleRunRoiPreview}
      onRunLesionPreview={handleRunLesionPreview}
      displayVisitReference={(visitReference) =>
        displayVisitReference(locale, visitReference)
      }
      aiClinicTextUnavailableLabel={copy.aiClinicTextUnavailable}
    />
  );
  const selectedCasePanelContent = (
    <CaseWorkspaceContributionSection
      locale={locale}
      selectedCase={selectedCase}
      completionState={completionState}
      hospitalValidationCount={summary?.n_validation_runs ?? 0}
      canRunValidation={canRunValidation}
      canContributeSelectedCase={canContributeSelectedCase}
      hasValidationResult={Boolean(validationResult)}
      researchRegistryEnabled={researchRegistryEnabled}
      researchRegistryUserEnrolled={researchRegistryUserEnrolled}
      researchRegistryBusy={researchRegistryBusy}
      contributionBusy={contributionBusy}
      contributionResult={contributionResult}
      currentUserPublicAlias={
        user.public_alias ?? contributionResult?.stats.user_public_alias ?? null
      }
      contributionLeaderboard={
        siteActivity?.contribution_leaderboard ??
        contributionResult?.stats.leaderboard ??
        null
      }
      historyBusy={historyBusy}
      caseHistory={caseHistory}
      notAvailableLabel={common.notAvailable}
      formatDateTime={(value, emptyLabel) =>
        formatDateTime(value, localeTag, emptyLabel)
      }
      onJoinResearchRegistry={() => openResearchRegistryModal(false)}
      onIncludeResearchCase={() => void handleIncludeResearchCase()}
      onExcludeResearchCase={() => void handleExcludeResearchCase()}
      onContributeCase={() => void handleContributeCase()}
    />
  );

  return (
    <CaseWorkspaceShell
      theme={theme}
      toast={toast}
      savedLabel={common.saved}
      actionNeededLabel={common.actionNeeded}
    >
        <CaseWorkspaceLeftRail
          locale={locale}
          visibleSites={visibleSites}
          selectedSiteId={selectedSiteId}
          allowCaseCreation={Boolean(selectedSiteId)}
          summary={effectiveRailSummary}
          fastMode={desktopFastMode}
        newCaseModeActive={newCaseModeActive}
        listModeActive={listModeActive}
        isAuthoringCanvas={isAuthoringCanvas}
        draftCompletionPercent={draftCompletionPercent}
        draftImagesCount={draftImages.length}
        draftRepresentativeCount={draftRepresentativeCount}
        resolvedVisitReferenceLabel={resolvedVisitReferenceLabel}
        draftStatusLabel={draftStatusLabel}
        latestSiteValidation={latestSiteValidation}
        siteValidationRuns={siteValidationRuns}
        deferValidationHistory={railView === "patients"}
        siteValidationBusy={siteValidationBusy}
        canRunValidation={canRunValidation}
        commonNotAvailable={common.notAvailable}
        formatDateTime={(value) =>
          formatDateTime(value, localeTag, common.notAvailable)
        }
        latestAutosavedDraft={latestAutosavedDraft}
        onStartNewCase={startNewCaseDraft}
        onOpenPatientList={handleOpenPatientList}
        onOpenLatestAutosavedDraft={handleOpenLatestAutosavedDraft}
        onSelectSite={onSelectSite}
        onRunSiteValidation={() => void handleRunSiteValidation()}
      />

      <section className={workspaceMainClass}>
        <CaseWorkspaceHeader
          locale={locale}
          localeTag={localeTag}
          title={mainHeaderTitle}
          subtitle={mainHeaderCopy}
          theme={theme}
          selectedSiteId={selectedSiteId}
          controlPlaneStatus={controlPlaneStatus}
          controlPlaneStatusBusy={controlPlaneStatusBusy}
          userRoleLabel={userRoleLabel}
          alertsPanelRef={alertsPanelRef}
          alertsPanelOpen={alertsPanelOpen}
          alerts={toastHistory}
          recentAlertsLabel={copy.recentAlerts}
          recentAlertsCopy={copy.recentAlertsCopy}
          alertsKeptLabel={copy.alertsKept}
          clearAlertsLabel={copy.clearAlerts}
          noAlertsYetLabel={copy.noAlertsYet}
          savedLabel={common.saved}
          actionNeededLabel={common.actionNeeded}
          onToggleAlerts={() => setAlertsPanelOpen((current) => !current)}
          onClearAlerts={clearToastHistory}
          onToggleTheme={onToggleTheme}
          onOpenHospitalAccessRequest={onOpenHospitalAccessRequest}
          onOpenOperations={canOpenOperations ? () => onOpenOperations() : undefined}
          onOpenDesktopSettings={onOpenDesktopSettings}
          onExportManifest={onExportManifest}
          onLogout={onLogout}
        />

        <div className={mainLayoutClass}>
          {railView === "patients" ? (
            <CaseWorkspacePatientListView
              boardProps={{
                locale,
                localeTag,
                commonNotAvailable: common.notAvailable,
                siteId: selectedSiteId,
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
                formatDateTime,
                onSearchChange: handlePatientListSearchChange,
                onShowOnlyMineChange: handlePatientScopeChange,
                onPageChange: handlePatientListPageChange,
                onOpenSavedCase: openSavedCase,
                onOpenImageTextSearchResult: handleOpenImageTextSearchResult,
                onPrefetchCase: (caseRecord) => {
                  if (selectedSiteId) {
                    prefetchDesktopVisitImages(
                      selectedSiteId,
                      caseRecord.patient_id,
                      caseRecord.visit_date,
                    );
                  }
                },
                medsamArtifactActiveStatus,
                medsamArtifactScope,
                medsamArtifactItems,
                medsamArtifactItemsBusy,
                medsamArtifactPage,
                medsamArtifactTotalCount,
                medsamArtifactTotalPages,
                onCloseMedsamArtifactBacklog: handleCloseMedsamArtifactBacklog,
                onMedsamArtifactScopeChange: handleMedsamArtifactScopeChange,
                onMedsamArtifactPageChange: handleMedsamArtifactPageChange,
              }}
              backlogProps={{
                locale,
                pick,
                medsamArtifactPanelEnabled,
                medsamArtifactStatus,
                medsamArtifactStatusBusy,
                medsamArtifactBackfillBusy,
                medsamArtifactActiveStatus,
                canBackfillMedsamArtifacts: canRunValidation,
                onEnableMedsamArtifactPanel: () =>
                  void handleEnableMedsamArtifactPanel(),
                onDisableMedsamArtifactPanel: handleDisableMedsamArtifactPanel,
                onRefreshMedsamArtifactStatus: () =>
                  void handleRefreshMedsamArtifactStatus(true),
                onOpenMedsamArtifactBacklog: handleOpenMedsamArtifactBacklog,
                onCloseMedsamArtifactBacklog: handleCloseMedsamArtifactBacklog,
                onBackfillMedsamArtifacts: () =>
                  void handleBackfillMedsamArtifacts(),
              }}
            />
          ) : selectedCase ? (
            <CaseWorkspaceSavedCaseView
              overviewProps={savedCaseViewProps!.overviewProps}
              imageBoardProps={savedCaseViewProps!.imageBoardProps}
              analysisSectionContent={analysisSectionContent}
              sidebarProps={savedCaseViewProps!.sidebarProps}
            />
          ) : !selectedSiteId ? (
            <CaseWorkspaceSiteAccessPrompt
              locale={locale}
              onOpenHospitalAccessRequest={onOpenHospitalAccessRequest}
            />
          ) : (
            <CaseWorkspaceDraftView
              canvasProps={draftViewProps.canvasProps}
              patientVisitFormProps={draftViewProps.patientVisitFormProps}
              imageManagerPanelProps={draftViewProps.imageManagerPanelProps}
            />
          )}

          {showSecondaryPanel ? (
            <CaseWorkspaceReviewPanel
              locale={locale}
              selectedCasePanelContent={selectedCasePanelContent}
              isAuthoringCanvas={isAuthoringCanvas}
              draftStatusLabel={draftStatusLabel}
              selectedSiteLabel={selectedSiteLabel}
              draftCompletionCount={draftCompletionCount}
              draftImagesCount={draftImages.length}
              draftRepresentativeCount={draftRepresentativeCount}
              draftCompletionPercent={draftCompletionPercent}
              draftPendingItems={draftPendingItems}
            />
          ) : null}
        </div>
      </section>

      {researchRegistryModalOpen ? (
        <CaseWorkspaceResearchRegistryModal
          locale={locale}
          busy={researchRegistryBusy}
          explanationConfirmed={researchRegistryExplanationConfirmed}
          usageConsented={researchRegistryUsageConsented}
          joinReady={researchRegistryJoinReady}
          onClose={closeResearchRegistryModal}
          onExplanationConfirmedChange={setResearchRegistryExplanationConfirmed}
          onUsageConsentedChange={setResearchRegistryUsageConsented}
          onJoin={() => void handleJoinResearchRegistry()}
        />
      ) : null}
    </CaseWorkspaceShell>
  );
}
