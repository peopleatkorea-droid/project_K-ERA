"use client";

import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocaleToggle, pick, translateApiError, translateOption, translateRole, useI18n, type Locale } from "../lib/i18n";
import { AiClinicPanel } from "./case-workspace/ai-clinic-panel";
import { AiClinicResult } from "./case-workspace/ai-clinic-result";
import { CompletionCard } from "./case-workspace/completion-card";
import { ContributionHistoryPanel } from "./case-workspace/contribution-history-panel";
import { ImageManagerPanel } from "./case-workspace/image-manager-panel";
import { PatientVisitForm } from "./case-workspace/patient-visit-form";
import { PatientListBoard } from "./case-workspace/patient-list-board";
import { SavedCaseImageBoard } from "./case-workspace/saved-case-image-board";
import { SavedCaseOverview } from "./case-workspace/saved-case-overview";
import { SavedCasePreviewPanels } from "./case-workspace/saved-case-preview-panels";
import type {
  AiClinicPreviewResponse,
  LesionBoxMap,
  LesionPreviewCard,
  LiveLesionPreviewMap,
  NormalizedBox,
  PatientListThumbnail,
  RoiPreviewCard,
  SavedImagePreview,
  SemanticPromptErrorMap,
  SemanticPromptInputOption,
  SemanticPromptReviewMap,
} from "./case-workspace/shared";
import { useCaseWorkspaceAnalysis } from "./case-workspace/use-case-workspace-analysis";
import { useCaseWorkspaceDraftState } from "./case-workspace/use-case-workspace-draft";
import { useCaseWorkspaceSiteData } from "./case-workspace/use-case-workspace-site-data";
import { ValidationArtifactStack } from "./case-workspace/validation-artifact-stack";
import { ValidationPanel } from "./case-workspace/validation-panel";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { MetricGrid, MetricItem } from "./ui/metric-grid";
import { SectionHeader } from "./ui/section-header";
import {
  canvasDocumentClass,
  canvasHeaderClass,
  canvasHeaderContentClass,
  canvasHeaderGlowClass,
  canvasHeaderKickerClass,
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
  docSectionClass,
  docSectionHeadClass,
  docSectionLabelClass,
  docSiteBadgeClass,
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
  panelStackClass,
  railActivityItemClass,
  railActivityListClass,
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
  completeIntakeButtonClass,
  organismChipClass,
  organismChipRowClass,
  organismChipStaticClass,
  predisposingChipClass,
  workspaceUserBadgeClass,
  validationRailHeadClass,
  workspaceBrandActionsClass,
  workspaceBrandClass,
  workspaceBrandCopyClass,
  workspaceBrandTitleClass,
  workspaceCenterClass,
  workspaceHeaderClass,
  workspaceKickerClass,
  workspaceMainClass,
  workspaceNoiseClass,
  workspacePanelClass,
  workspaceRailClass,
  workspaceShellClass,
  workspaceTitleCopyClass,
  workspaceTitleRowClass,
  workspaceToastClass,
} from "./ui/workspace-patterns";
import { getSiteDisplayName } from "../lib/site-labels";
import { formatPublicAlias } from "../lib/public-alias";
import {
  type CaseHistoryResponse,
  type CaseValidationCompareResponse,
  type CaseContributionResponse,
  type OrganismRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  createPatient,
  createVisit,
  deleteVisit,
  deleteVisitImages,
  fetchCaseHistory,
  fetchCaseLesionPreview,
  fetchCaseLesionPreviewArtifactBlob,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  clearImageLesionBox,
  enrollResearchRegistry,
  fetchCases,
  fetchImageBlob,
  fetchImagePreviewBlob,
  fetchLiveLesionPreviewJob,
  fetchImageSemanticPromptScores,
  fetchVisits,
  fetchValidationArtifactBlob,
  fetchImages,
  fetchSiteJob,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
  type AuthUser,
  type CaseSummaryRecord,
  type CaseValidationResponse,
  type LiveLesionPreviewJobResponse,
  type ModelVersionRecord,

  type SemanticPromptInputMode,
  type SiteRecord,
  type SiteSummary,
  type VisitRecord,
  runSiteValidation,
  setRepresentativeImage as setRepresentativeImageOnServer,
  startLiveLesionPreview,
  updateVisit,
  runCaseAiClinic,
  runCaseContribution,
  runCaseValidation,
  runCaseValidationCompare,
  updateCaseResearchRegistry,
  updateImageLesionBox,
  uploadImage,
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
const MODEL_COMPARE_ARCHITECTURES = ["vit", "swin", "convnext_tiny", "densenet121", "efficientnet_v2_s"];
const PATIENT_LIST_PAGE_SIZE = 25;
const CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Staphylococcus hominis",
    "Coagulase-negative Staphylococcus",
    "Streptococcus pneumoniae",
    "Streptococcus viridans group",
    "Enterococcus faecalis",
    "Pseudomonas aeruginosa",
    "Moraxella",
    "Corynebacterium",
    "Serratia marcescens",
    "Bacillus",
    "Haemophilus influenzae",
    "Klebsiella pneumoniae",
    "Enterobacter",
    "Burkholderia",
    "Nocardia",
    "Other",
  ],
  fungal: [
    "Fusarium",
    "Aspergillus",
    "Candida",
    "Curvularia",
    "Alternaria",
    "Colletotrichum",
    "Acremonium",
    "Lasiodiplodia",
    "Cladophialophora",
    "Australiasca",
    "Penicillium",
    "Bipolaris",
    "Scedosporium",
    "Paecilomyces",
    "Exserohilum",
    "Cladosporium",
    "Other",
  ],
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask" | "lesion_crop" | "lesion_mask";

type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
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
  onSelectSite: (siteId: string) => void;
  onExportManifest: () => void;
  onLogout: () => void;
  onOpenOperations: (section?: "dashboard" | "training" | "cross_validation") => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onToggleTheme: () => void;
};

type WorkspaceHistoryEntry = {
  scope: "case-workspace";
  version: 1;
  rail_view: "cases" | "patients";
  selected_case_id: string | null;
};

const WORKSPACE_HISTORY_KEY = "__keraWorkspace";

function buildWorkspaceHistoryEntry(
  railView: "cases" | "patients",
  selectedCaseId: string | null
): WorkspaceHistoryEntry {
  return {
    scope: "case-workspace",
    version: 1,
    rail_view: railView,
    selected_case_id: selectedCaseId,
  };
}

function readWorkspaceHistoryEntry(state: unknown): WorkspaceHistoryEntry | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const rawEntry = (state as Record<string, unknown>)[WORKSPACE_HISTORY_KEY];
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }
  const entry = rawEntry as Record<string, unknown>;
  if (entry.scope !== "case-workspace" || entry.version !== 1) {
    return null;
  }
  if (entry.rail_view !== "cases" && entry.rail_view !== "patients") {
    return null;
  }
  if (entry.selected_case_id !== null && typeof entry.selected_case_id !== "string") {
    return null;
  }
  return {
    scope: "case-workspace",
    version: 1,
    rail_view: entry.rail_view,
    selected_case_id: entry.selected_case_id,
  };
}

function isSameWorkspaceHistoryEntry(left: WorkspaceHistoryEntry | null, right: WorkspaceHistoryEntry | null): boolean {
  return left?.rail_view === right?.rail_view && left?.selected_case_id === right?.selected_case_id;
}

function writeWorkspaceHistoryEntry(entry: WorkspaceHistoryEntry, mode: "push" | "replace") {
  if (typeof window === "undefined") {
    return;
  }
  const nextState: Record<string, unknown> =
    window.history.state && typeof window.history.state === "object"
      ? { ...(window.history.state as Record<string, unknown>) }
      : {};
  nextState[WORKSPACE_HISTORY_KEY] = entry;
  if (mode === "push") {
    window.history.pushState(nextState, "");
    return;
  }
  window.history.replaceState(nextState, "");
}

function createDraft(): DraftState {
  return {
    patient_id: "",
    chart_alias: "",
    local_case_code: "",
    sex: "female",
    age: "65",
    actual_visit_date: "",
    follow_up_number: "1",
    culture_category: "",
    culture_species: "",
    additional_organisms: [],
    contact_lens_use: "none",
    visit_status: "active",
    is_initial_visit: true,
    predisposing_factor: [],
    other_history: "",
    intake_completed: false,
  };
}

function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCaseTitle(caseRecord: CaseSummaryRecord): string {
  return caseRecord.local_case_code || caseRecord.patient_id;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeBox(box: NormalizedBox): NormalizedBox {
  return {
    x0: clamp01(Math.min(box.x0, box.x1)),
    y0: clamp01(Math.min(box.y0, box.y1)),
    x1: clamp01(Math.max(box.x0, box.x1)),
    y1: clamp01(Math.max(box.y0, box.y1)),
  };
}

function toNormalizedBox(value: unknown): NormalizedBox | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const box = value as Record<string, unknown>;
  if (["x0", "y0", "x1", "y1"].every((key) => typeof box[key] === "number")) {
    return normalizeBox({
      x0: Number(box.x0),
      y0: Number(box.y0),
      x1: Number(box.x1),
      y1: Number(box.y1),
    });
  }
  return null;
}

function organismKey(organism: Pick<OrganismRecord, "culture_category" | "culture_species">): string {
  return `${organism.culture_category.trim().toLowerCase()}::${organism.culture_species.trim().toLowerCase()}`;
}

function normalizeAdditionalOrganisms(
  primaryCategory: string,
  primarySpecies: string,
  organisms: OrganismRecord[] | undefined
): OrganismRecord[] {
  const primaryKey = organismKey({
    culture_category: primaryCategory,
    culture_species: primarySpecies,
  });
  const seen = new Set<string>([primaryKey]);
  const normalized: OrganismRecord[] = [];
  for (const organism of organisms ?? []) {
    const culture_category = String(organism?.culture_category ?? "").trim().toLowerCase();
    const culture_species = String(organism?.culture_species ?? "").trim();
    if (!culture_category || !culture_species) {
      continue;
    }
    const nextKey = organismKey({ culture_category, culture_species });
    if (seen.has(nextKey)) {
      continue;
    }
    seen.add(nextKey);
    normalized.push({ culture_category, culture_species });
  }
  return normalized;
}

function listOrganisms(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): OrganismRecord[] {
  const primarySpecies = cultureSpecies.trim();
  if (!primarySpecies) {
    return normalizeAdditionalOrganisms(cultureCategory, cultureSpecies, additionalOrganisms);
  }
  return [
    {
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: primarySpecies,
    },
    ...normalizeAdditionalOrganisms(cultureCategory, cultureSpecies, additionalOrganisms),
  ];
}

function organismSummaryLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
  maxVisibleSpecies = 1
): string {
  const organisms = listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms);
  if (!organisms.length) {
    return "";
  }
  if (organisms.length <= maxVisibleSpecies) {
    return organisms.map((organism) => organism.culture_species).join(" / ");
  }
  const visible = organisms.slice(0, Math.max(1, maxVisibleSpecies)).map((organism) => organism.culture_species).join(" / ");
  return `${visible} + ${organisms.length - Math.max(1, maxVisibleSpecies)}`;
}

function organismDetailLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined
): string {
  return listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms)
    .map((organism) => organism.culture_species)
    .join(" / ");
}

function formatProbability(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

function formatSemanticScore(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return value.toFixed(3);
}

function formatImageQualityScore(value: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${value.toFixed(1)}`;
}

function formatAiClinicMetadataField(locale: Locale, field: string): string {
  switch (field) {
    case "representative_view":
      return pick(locale, "view", "view");
    case "visit_status":
      return pick(locale, "status", "status");
    case "active_stage":
      return pick(locale, "active stage", "active stage");
    case "contact_lens_use":
      return pick(locale, "contact lens", "contact lens");
    case "predisposing_factor":
      return pick(locale, "predisposing", "predisposing");
    case "smear_result":
      return pick(locale, "smear", "smear");
    case "polymicrobial":
      return pick(locale, "polymicrobial", "polymicrobial");
    default:
      return field.replaceAll("_", " ");
  }
}

function defaultModelCompareSelection(modelVersions: ModelVersionRecord[]): string[] {
  const selected: string[] = [];
  const sorted = [...modelVersions].reverse();
  for (const architecture of MODEL_COMPARE_ARCHITECTURES) {
    const match = sorted.find(
      (item) => item.ready !== false && String(item.architecture || "").trim().toLowerCase() === architecture
    );
    if (match?.version_id) {
      selected.push(match.version_id);
    }
  }
  return Array.from(new Set(selected));
}

function predictedClassConfidence(predictedLabel: string | null | undefined, probability: number | null | undefined): number | null {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return null;
  }
  if (predictedLabel === "bacterial") {
    return 1 - probability;
  }
  return probability;
}

function formatDateTime(value: string | null | undefined, localeTag: string, emptyLabel: string): string {
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

function confidencePercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function confidenceTone(percent: number): "high" | "medium" | "low" {
  if (percent >= 80) {
    return "high";
  }
  if (percent >= 60) {
    return "medium";
  }
  return "low";
}

function draftStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_draft:${userId}:${siteId}`;
}

function favoriteStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_favorites:${userId}:${siteId}`;
}

function buildVisitReference(draft: DraftState): string {
  if (draft.is_initial_visit) {
    return "Initial";
  }
  return `FU #${String(Number(draft.follow_up_number) || 1)}`;
}

function displayVisitReference(locale: "en" | "ko", visitReference: string): string {
  const normalized = String(visitReference ?? "").trim();
  if (!normalized) {
    return normalized;
  }
  if (/^(initial|초진|珥덉쭊)$/i.test(normalized)) {
    return pick(locale, "Initial", "초진");
  }
  const followUpMatch = normalized.match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
  if (followUpMatch) {
    return `FU #${String(Number(followUpMatch[1]))}`;
  }
  return normalized;
}

function normalizeRecoveredDraft(draft: DraftState): DraftState {
  const recoveredDraft = draft as DraftState & { visit_date?: string };
  const normalizedAdditionalOrganisms = normalizeAdditionalOrganisms(
    draft.culture_category,
    draft.culture_species,
    draft.additional_organisms
  );
  const visitReference = String(recoveredDraft.visit_date ?? "").trim();
  const followUpMatch = visitReference.match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
  if (followUpMatch) {
    return {
      ...draft,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: String(Number(followUpMatch[1]) || 1),
      is_initial_visit: false,
    };
  }
  if (/^(initial|초진|珥덉쭊)$/i.test(visitReference)) {
    return {
      ...draft,
      additional_organisms: normalizedAdditionalOrganisms,
      follow_up_number: draft.follow_up_number || "1",
      is_initial_visit: true,
    };
  }
  return {
    ...draft,
    additional_organisms: normalizedAdditionalOrganisms,
    actual_visit_date:
      String(recoveredDraft.actual_visit_date ?? "").trim() || String(recoveredDraft.visit_date ?? "").trim(),
    follow_up_number: draft.follow_up_number || "1",
    is_initial_visit: draft.is_initial_visit ?? true,
    intake_completed: Boolean(draft.intake_completed),
  };
}

function hasDraftContent(draft: DraftState): boolean {
  const emptyDraft = createDraft();
  return (
    draft.patient_id.trim() !== emptyDraft.patient_id ||
    draft.chart_alias.trim() !== emptyDraft.chart_alias ||
    draft.local_case_code.trim() !== emptyDraft.local_case_code ||
    draft.sex !== emptyDraft.sex ||
    draft.age !== emptyDraft.age ||
    draft.actual_visit_date !== emptyDraft.actual_visit_date ||
    draft.follow_up_number !== emptyDraft.follow_up_number ||
    draft.culture_category !== emptyDraft.culture_category ||
    draft.culture_species !== emptyDraft.culture_species ||
    draft.additional_organisms.length > 0 ||
    draft.contact_lens_use !== emptyDraft.contact_lens_use ||
    draft.visit_status !== emptyDraft.visit_status ||
    draft.is_initial_visit !== emptyDraft.is_initial_visit ||
    draft.predisposing_factor.length > 0 ||
    draft.other_history.trim() !== emptyDraft.other_history ||
    draft.intake_completed !== emptyDraft.intake_completed
  );
}

function executionModeFromDevice(device: string | undefined): "auto" | "cpu" | "gpu" {
  if (device === "cuda") {
    return "gpu";
  }
  if (device === "cpu") {
    return "cpu";
  }
  return "auto";
}

function visitPhaseCopy(locale: "en" | "ko", isInitialVisit: boolean): string {
  return isInitialVisit ? pick(locale, "Initial", "초진") : pick(locale, "Follow-up", "재진");
}

function computeNextFollowUpNumber(visits: VisitRecord[]): number {
  let maxFollowUp = 0;
  for (const visit of visits) {
    const match = String(visit.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
    if (!match) {
      continue;
    }
    maxFollowUp = Math.max(maxFollowUp, Number(match[1]) || 0);
  }
  return maxFollowUp + 1;
}

export function CaseWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  canOpenOperations,
  theme,
  onSelectSite,
  onExportManifest,
  onLogout,
  onOpenOperations,
  onSiteDataChanged,
  onToggleTheme,
}: CaseWorkspaceProps) {
  const { locale, localeTag, common } = useI18n();
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;
  const selectedSiteRecord = sites.find((site) => site.site_id === selectedSiteId) ?? null;
  const selectedSiteLabel = selectedSiteId ? getSiteDisplayName(selectedSiteRecord, selectedSiteId) : null;
  const isAlreadyExistsError = (nextError: unknown) => {
    if (!(nextError instanceof Error)) {
      return false;
    }
    const rawMessage = nextError.message.toLowerCase();
    const translatedMessage = translateApiError(locale, nextError.message).toLowerCase();
    return (
      rawMessage.includes("already exists") ||
      rawMessage.includes("이미 존재") ||
      translatedMessage.includes("already exists") ||
      translatedMessage.includes("이미 존재")
    );
  };
  const [saveBusy, setSaveBusy] = useState(false);
  const [editDraftBusy, setEditDraftBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [railView, setRailView] = useState<"cases" | "patients">("patients");
  const [draftLesionPromptBoxes, setDraftLesionPromptBoxes] = useState<LesionBoxMap>({});
  const [contributionBusy, setContributionBusy] = useState(false);
  const [researchRegistryBusy, setResearchRegistryBusy] = useState(false);
  const [researchRegistryModalOpen, setResearchRegistryModalOpen] = useState(false);
  const [pendingResearchRegistryAutoInclude, setPendingResearchRegistryAutoInclude] = useState(false);
  const [contributionResult, setContributionResult] = useState<CaseContributionResponse | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [patientListPage, setPatientListPage] = useState(1);
  const [patientListThumbs, setPatientListThumbs] = useState<Record<string, PatientListThumbnail[]>>({});
  const [toast, setToastState] = useState<ToastState>(null);
  const [toastHistory, setToastHistory] = useState<ToastLogEntry[]>([]);
  const whiteFileInputRef = useRef<HTMLInputElement | null>(null);
  const fluoresceinFileInputRef = useRef<HTMLInputElement | null>(null);
  const patientListThumbUrlsRef = useRef<string[]>([]);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const draftLesionDrawStateRef = useRef<{ imageId: string; pointerId: number; x: number; y: number } | null>(null);
  const workspaceHistoryRef = useRef<WorkspaceHistoryEntry | null>(null);
  const workspacePopNavigationRef = useRef(false);
  const deferredSearch = useDeferredValue(caseSearch);
  const setToast = useCallback<Dispatch<SetStateAction<ToastState>>>((nextValue) => {
    setToastState((current) => {
      const resolved = typeof nextValue === "function" ? nextValue(current) : nextValue;
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
          ].slice(0, 8)
        );
      }
      return resolved;
    });
  }, []);
  const copy = {
    recoveredDraft: pick(locale, "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.", "??蹂묒썝??留덉?留?珥덉븞 ?띿꽦??蹂듦뎄?덉뒿?덈떎. ??????대?吏 ?뚯씪? ?ㅼ떆 泥⑤???二쇱꽭??"),
    unableLoadRecentCases: pick(locale, "Unable to load recent cases.", "理쒓렐 耳?댁뒪瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadSiteActivity: pick(locale, "Unable to load hospital activity.", "蹂묒썝 ?쒕룞??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadSiteValidationHistory: pick(locale, "Unable to load hospital validation history.", "蹂묒썝 寃利??대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    unableLoadCaseHistory: pick(locale, "Unable to load case history.", "耳?댁뒪 ?대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
    selectSavedCaseForRoi: pick(locale, "Select a saved case before running cornea preview.", "媛곷쭑 crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(locale, `Cornea preview generated for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 媛곷쭑 crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`),
    roiPreviewFailed: pick(locale, "Cornea preview failed.", "媛곷쭑 crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎."),
    selectSiteForValidation: pick(locale, "Select a hospital before running hospital validation.", "蹂묒썝 寃利앹쓣 ?ㅽ뻾?섎젮硫?蹂묒썝???좏깮?섏꽭??"),
    siteValidationSaved: (validationId: string) =>
      pick(locale, `Hospital validation saved as ${validationId}.`, `蹂묒썝 寃利앹씠 ${validationId}濡???λ릺?덉뒿?덈떎.`),
    siteValidationFailed: pick(locale, "Hospital validation failed.", "蹂묒썝 寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎."),
    selectSavedCaseForValidation: pick(locale, "Select a saved case before running validation.", "寃利앹쓣 ?ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    validationSaved: (patientId: string, visitDate: string) =>
      pick(locale, `Validation saved for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 寃利앹씠 ??λ릺?덉뒿?덈떎.`),
    validationFailed: pick(locale, "Validation failed.", "寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎."),
    selectValidationBeforeAiClinic: pick(locale, "Run validation before opening AI Clinic retrieval.", "AI Clinic 寃?됱쓣 ?닿린 ?꾩뿉 癒쇱? 寃利앹쓣 ?ㅽ뻾?섏꽭??"),
    aiClinicReady: (count: number) =>
      pick(locale, `AI Clinic found ${count} similar patient case(s).`, `AI Clinic???좎궗 ?섏옄 耳?댁뒪 ${count}嫄댁쓣 李얠븯?듬땲??`),
    aiClinicFailed: pick(locale, "AI Clinic retrieval failed.", "AI Clinic 寃?됱뿉 ?ㅽ뙣?덉뒿?덈떎."),
    aiClinicTextUnavailable: pick(locale, "BiomedCLIP text retrieval is currently unavailable in this runtime.", "?꾩옱 ?ㅽ뻾 ?섍꼍?먯꽌??BiomedCLIP ?띿뒪??寃?됱쓣 ?ъ슜?????놁뒿?덈떎."),
    selectSavedCaseForContribution: pick(locale, "Select a saved case before contributing.", "湲곗뿬瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??"),
    activeOnly: pick(locale, "Only active visits are enabled for contribution under the current policy.", "?꾩옱 ?뺤콉?먯꽌??active 諛⑸Ц留?湲곗뿬?????덉뒿?덈떎."),
    contributionQueued: (patientId: string, visitDate: string) =>
      pick(locale, `Contribution queued for ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 湲곗뿬媛 ?湲곗뿴???깅줉?섏뿀?듬땲??`),
    contributionFailed: pick(locale, "Contribution failed.", "湲곗뿬???ㅽ뙣?덉뒿?덈떎."),
    selectSiteForCase: pick(locale, "Select a hospital before creating a case.", "耳?댁뒪瑜??앹꽦?섎젮硫?蹂묒썝???좏깮?섏꽭??"),
    patientIdRequired: pick(locale, "Patient ID is required.", "?섏옄 ID???꾩닔?낅땲??"),
    visitDateRequired: pick(locale, "Visit reference is required.", "諛⑸Ц 湲곗?媛믪? ?꾩닔?낅땲??"),
    cultureSpeciesRequired: pick(locale, "Select the primary organism.", "???洹좎쥌???좏깮?섏꽭??"),
    imageRequired: pick(locale, "Add at least one slit-lamp image to save this case.", "耳?댁뒪瑜???ν븯?ㅻ㈃ ?멸레???대?吏瑜??섎굹 ?댁긽 異붽??섏꽭??"),
    patientCreationFailed: pick(locale, "Patient creation failed.", "?섏옄 ?앹꽦???ㅽ뙣?덉뒿?덈떎."),
    caseSaved: (patientId: string, visitDate: string, siteLabel: string) =>
      pick(locale, `Case ${patientId} / ${visitDate} saved to ${siteLabel}.`, `${patientId} / ${visitDate} 케이스가 ${siteLabel}에 저장되었습니다.`),
    caseSaveFailed: pick(locale, "Case save failed.", "耳?댁뒪 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎."),
    organismAdded: pick(locale, "Organism added to this visit.", "??諛⑸Ц??洹좎쥌??異붽??덉뒿?덈떎."),
    organismDuplicate: pick(locale, "That organism is already attached to this visit.", "?대? ??諛⑸Ц??異붽???洹좎쥌?낅땲??"),
    intakeComplete: pick(locale, "Core case intake is marked complete.", "湲곕낯 耳?댁뒪 ?낅젰???꾨즺濡??쒖떆?덉뒿?덈떎."),
    intakeStepRequired: pick(locale, "Complete the intake section before saving this case.", "케이스 저장 전에 intake 섹션을 먼저 완료해 주세요."),
    intakeOrganismRequired: pick(locale, "Select the primary organism first.", "먼저 대표 균종을 선택해 주세요."),
    draftAutosaved: (time: string) => pick(locale, `Draft autosaved ${time}`, `${time}에 초안 자동 저장`),
    draftUnsaved: pick(locale, "Draft changes live only in this tab", "초안 변경 내용은 현재 탭에만 유지됩니다."),
    recentAlerts: pick(locale, "Recent alerts", "최근 알림"),
    recentAlertsCopy: pick(locale, "Transient toasts stay here for this session.", "짧게 사라지는 토스트도 현재 세션에서는 여기 남겨둡니다."),
    noAlertsYet: pick(locale, "No alerts yet in this session.", "현재 세션에는 아직 알림이 없습니다."),
    clearAlerts: pick(locale, "Clear alerts", "알림 비우기"),
    alertsKept: pick(locale, "kept", "보관"),
    unableLoadPatientList: pick(locale, "Unable to load the patient list.", "환자 목록을 불러오지 못했습니다."),
    patients: pick(locale, "patients", "?섏옄"),
    savedCases: pick(locale, "saved cases", "??λ맂 耳?댁뒪"),
    loadingSavedCases: pick(locale, "Loading saved cases...", "??λ맂 耳?댁뒪瑜?遺덈윭?ㅻ뒗 以?.."),
    noSavedCases: pick(locale, "No saved cases for this hospital yet.", "??蹂묒썝?먮뒗 ?꾩쭅 ??λ맂 耳?댁뒪媛 ?놁뒿?덈떎."),
    allRecords: pick(locale, "All records", "?꾩껜"),
    myPatientsOnly: pick(locale, "My patients", "???섏옄"),
    patientScopeAll: (count: number) =>
      pick(locale, `Showing all hospital patients (${count}).`, `蹂묒썝 ?꾩껜 ?섏옄 ${count}紐낆쓣 ?쒖떆?⑸땲??`),
    patientScopeMine: (count: number) =>
      pick(locale, `Showing only patients registered by you (${count}).`, `?닿? ?깅줉???섏옄 ${count}紐낅쭔 ?쒖떆?⑸땲??`),
    favoriteAdded: pick(locale, "Case added to favorites.", "耳?댁뒪瑜?利먭꺼李얘린??異붽??덉뒿?덈떎."),
    favoriteRemoved: pick(locale, "Case removed from favorites.", "耳?댁뒪 利먭꺼李얘린瑜??댁젣?덉뒿?덈떎."),
    visitDeleted: (patientId: string, visitDate: string) =>
      pick(locale, `Deleted ${patientId} / ${visitDate}.`, `${patientId} / ${visitDate} 諛⑸Ц????젣?덉뒿?덈떎.`),
    patientDeleted: (patientId: string) =>
      pick(locale, `Deleted patient ${patientId}.`, `${patientId} ?섏옄瑜???젣?덉뒿?덈떎.`),
    deleteVisitFailed: pick(locale, "Unable to delete the visit.", "諛⑸Ц ??젣???ㅽ뙣?덉뒿?덈떎."),
    representativeUpdated: pick(locale, "Representative image updated.", "????대?吏瑜?蹂寃쏀뻽?듬땲??"),
    representativeUpdateFailed: pick(locale, "Unable to update the representative image.", "????대?吏 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎."),
    listViewHeaderCopy: pick(locale, "Browse saved patients and open the latest case.", "????섏옄瑜?蹂닿퀬 理쒖떊 耳?댁뒪瑜??쎈땲??"),
    caseAuthoringHeaderCopy: pick(locale, "Create, review, and contribute cases from this workspace.", "???묒뾽怨듦컙?먯꽌 利앸? ?묒꽦, 寃?? 湲곗뿬瑜?吏꾪뻾?????덉뒿?덈떎."),
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
    draftSavedAt,
    favoriteCaseIds,
    setFavoriteCaseIds,
    replaceDraftImages,
    clearDraftStorage,
  } = useCaseWorkspaceDraftState({
    selectedSiteId,
    userId: user.user_id,
    recoveredDraftMessage: copy.recoveredDraft,
    cultureSpecies: CULTURE_SPECIES,
    setToast,
    createDraft,
    normalizeRecoveredDraft,
    hasDraftContent,
    draftStorageKey,
    favoriteStorageKey,
  });
  const {
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
    selectedCompareModelVersionIds,
    setSelectedCompareModelVersionIds,
    historyBusy,
    caseHistory,
    setCaseHistory,
    loadCaseHistory,
    loadSiteActivity,
    loadSiteValidationRuns,
  } = useCaseWorkspaceSiteData({
    selectedSiteId,
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
  const {
    validationBusy,
    validationResult,
    modelCompareBusy,
    modelCompareResult,
    validationArtifacts,
    aiClinicBusy,
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
    liveLesionPreviews,
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
    handleRunRoiPreview,
    handleRunLesionPreview,
    handleSetSavedRepresentative,
    handleReviewSemanticPrompts,
    handleLesionPointerDown,
    handleLesionPointerMove,
    finishLesionPointer,
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
    toNormalizedBox,
    normalizeBox,
    clamp01,
    executionModeFromDevice,
    describeError,
    setToast,
    setPanelOpen,
    setCases,
    setSelectedCase,
    setSelectedCaseImages,
    setCaseHistory,
    setContributionResult,
    loadCaseHistory,
    loadSiteActivity,
    onSiteDataChanged,
    onValidationCompleted: async ({ siteId, selectedCase: validatedCase }) => {
      const registry = summary?.research_registry;
      if (!registry?.site_enabled) {
        return;
      }
      if (validatedCase.research_registry_status === "excluded" || validatedCase.research_registry_status === "included") {
        return;
      }
      if (!registry.user_enrolled) {
        setPendingResearchRegistryAutoInclude(true);
        setResearchRegistryModalOpen(true);
        return;
      }
      try {
        await includeCaseInResearchRegistry(
          validatedCase.patient_id,
          validatedCase.visit_date,
          "validation_auto_include"
        );
      } catch {
        // Leave the validation result visible even if registry auto-inclusion fails.
      }
    },
  });
  const whiteDraftImages = draftImages.filter((image) => image.view === "white");
  const fluoresceinDraftImages = draftImages.filter((image) => image.view === "fluorescein");

  useEffect(() => {
    return () => {
      for (const url of patientListThumbUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const historyEntry = readWorkspaceHistoryEntry(event.state);
      if (!historyEntry) {
        return;
      }

      workspacePopNavigationRef.current = true;
      setPanelOpen(true);
      setRailView(historyEntry.rail_view);
      setSelectedCase(
        historyEntry.selected_case_id
          ? cases.find((item) => item.case_id === historyEntry.selected_case_id) ?? null
          : null
      );
      if (!historyEntry.selected_case_id) {
        setSelectedCaseImages([]);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [cases, setSelectedCase, setSelectedCaseImages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextEntry = buildWorkspaceHistoryEntry(railView, selectedCase?.case_id ?? null);
    const browserEntry = readWorkspaceHistoryEntry(window.history.state);

    if (workspacePopNavigationRef.current) {
      workspacePopNavigationRef.current = false;
      workspaceHistoryRef.current = nextEntry;
      if (!isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        writeWorkspaceHistoryEntry(nextEntry, "replace");
      }
      return;
    }

    if (!workspaceHistoryRef.current) {
      workspaceHistoryRef.current = nextEntry;
      if (isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        return;
      }
      if (nextEntry.selected_case_id) {
        const backstopEntry = buildWorkspaceHistoryEntry("patients", nextEntry.selected_case_id);
        if (!isSameWorkspaceHistoryEntry(browserEntry, backstopEntry)) {
          writeWorkspaceHistoryEntry(backstopEntry, "replace");
        }
        writeWorkspaceHistoryEntry(nextEntry, "push");
        return;
      }
      writeWorkspaceHistoryEntry(nextEntry, "replace");
      return;
    }

    if (isSameWorkspaceHistoryEntry(workspaceHistoryRef.current, nextEntry)) {
      if (!isSameWorkspaceHistoryEntry(browserEntry, nextEntry)) {
        writeWorkspaceHistoryEntry(nextEntry, "replace");
      }
      return;
    }

    if (nextEntry.selected_case_id && workspaceHistoryRef.current.rail_view === "cases" && !workspaceHistoryRef.current.selected_case_id) {
      const backstopEntry = buildWorkspaceHistoryEntry("patients", nextEntry.selected_case_id);
      if (!isSameWorkspaceHistoryEntry(browserEntry, backstopEntry)) {
        writeWorkspaceHistoryEntry(backstopEntry, "replace");
      }
    }

    workspaceHistoryRef.current = nextEntry;
    writeWorkspaceHistoryEntry(nextEntry, "push");
  }, [railView, selectedCase?.case_id]);

  useEffect(() => {
    if (railView !== "patients") {
      return;
    }
    railListSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [railView]);

  function replaceDraftImagesAndBoxes(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    setDraftLesionPromptBoxes((current) =>
      Object.fromEntries(Object.entries(current).filter(([draftId]) => nextIds.has(draftId)))
    );
    replaceDraftImages(nextImages);
  }

  async function startFollowUpDraftFromSelectedCase() {
    if (!selectedCase) {
      return;
    }

    replaceDraftImagesAndBoxes([]);
    setDraftLesionPromptBoxes({});
    clearDraftStorage();
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPanelOpen(true);
    setRailView("cases");
    const selectedFollowUpMatch = String(selectedCase.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
    const fallbackFollowUpNumber = String((selectedFollowUpMatch ? Number(selectedFollowUpMatch[1]) || 0 : 0) + 1);

    const applyFallbackDraft = (followUpNumber: string) => {
      setDraft((current) => ({
        ...current,
        patient_id: selectedCase.patient_id,
        sex: selectedCase.sex || current.sex,
        age: String(selectedCase.age ?? current.age),
        chart_alias: selectedCase.chart_alias ?? current.chart_alias,
        local_case_code: selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category: selectedCase.culture_category || current.culture_category,
        culture_species: selectedCase.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          selectedCase.culture_category,
          selectedCase.culture_species,
          selectedCase.additional_organisms
        ),
        contact_lens_use: selectedCase.contact_lens_use || current.contact_lens_use,
        visit_status: selectedCase.visit_status || current.visit_status,
        is_initial_visit: false,
        follow_up_number: followUpNumber,
        intake_completed: true,
      }));
      setPendingOrganism({
        culture_category: selectedCase.culture_category || "bacterial",
        culture_species:
          selectedCase.additional_organisms?.[0]?.culture_species ||
          selectedCase.culture_species ||
          (CULTURE_SPECIES[selectedCase.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    };

    if (!selectedSiteId) {
      applyFallbackDraft(fallbackFollowUpNumber);
      return;
    }

    try {
      const visits = await fetchVisits(selectedSiteId, token, selectedCase.patient_id);
      const nextFollowUpNumber = String(computeNextFollowUpNumber(visits));
      const latestVisit = [...visits].sort((left, right) => visitTimestamp(right) - visitTimestamp(left))[0] ?? null;
      if (!latestVisit) {
        applyFallbackDraft(nextFollowUpNumber);
        return;
      }
      setDraft((current) => ({
        ...current,
        patient_id: selectedCase.patient_id,
        sex: selectedCase.sex || current.sex,
        age: String(selectedCase.age ?? current.age),
        chart_alias: selectedCase.chart_alias ?? current.chart_alias,
        local_case_code: selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category: latestVisit.culture_category || selectedCase.culture_category || current.culture_category,
        culture_species: latestVisit.culture_species || selectedCase.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          latestVisit.culture_category || selectedCase.culture_category,
          latestVisit.culture_species || selectedCase.culture_species,
          latestVisit.additional_organisms ?? selectedCase.additional_organisms
        ),
        contact_lens_use: latestVisit.contact_lens_use || selectedCase.contact_lens_use || current.contact_lens_use,
        visit_status: latestVisit.visit_status || selectedCase.visit_status || current.visit_status,
        is_initial_visit: false,
        follow_up_number: nextFollowUpNumber,
        predisposing_factor: latestVisit.predisposing_factor ?? current.predisposing_factor,
        other_history: latestVisit.other_history ?? current.other_history,
        intake_completed: true,
      }));
      setPendingOrganism({
        culture_category: latestVisit.culture_category || selectedCase.culture_category || "bacterial",
        culture_species:
          latestVisit.additional_organisms?.[0]?.culture_species ||
          latestVisit.culture_species ||
          selectedCase.culture_species ||
          (CULTURE_SPECIES[latestVisit.culture_category || selectedCase.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      applyFallbackDraft(fallbackFollowUpNumber);
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to prepare the next follow-up draft for this patient.", "???섏옄???ㅼ쓬 ?ъ쭊 珥덉븞??以鍮꾪븯吏 紐삵뻽?듬땲??")
        ),
      });
    }
  }

  async function startEditDraftFromSelectedCase() {
    if (!selectedCase) {
      return;
    }

    const caseToEdit = selectedCase;
    setEditDraftBusy(true);
    try {
      let nextDraftImages: DraftImage[] = [];
      let nextDraftBoxes: LesionBoxMap = {};
      let selectedVisit: VisitRecord | null = null;

      if (selectedSiteId) {
        const [savedImages, savedVisits] = await Promise.all([
          fetchImages(selectedSiteId, token, caseToEdit.patient_id, caseToEdit.visit_date),
          fetchVisits(selectedSiteId, token, caseToEdit.patient_id),
        ]);
        selectedVisit =
          savedVisits.find((visit) => visit.visit_date === caseToEdit.visit_date) ?? null;
        nextDraftImages = await Promise.all(
          savedImages.map(async (image) => {
            const blob = await fetchImageBlob(selectedSiteId, image.image_id, token);
            const mediaType = blob.type || "image/jpeg";
            const extension =
              mediaType === "image/png"
                ? "png"
                : mediaType === "image/webp"
                  ? "webp"
                  : mediaType === "image/bmp"
                    ? "bmp"
                    : mediaType === "image/tiff"
                      ? "tiff"
                      : "jpg";
            const file = new File([blob], `${image.image_id}.${extension}`, { type: mediaType });
            const draftId = createDraftId();
            nextDraftBoxes[draftId] =
              image.lesion_prompt_box && typeof image.lesion_prompt_box === "object"
                ? normalizeBox(image.lesion_prompt_box)
                : null;
            return {
              draft_id: draftId,
              file,
              preview_url: URL.createObjectURL(blob),
              view: image.view,
              is_representative: image.is_representative,
            };
          })
        );
      }

      clearDraftStorage();
      resetAnalysisState();
      setPanelOpen(true);
      setRailView("cases");
      setSelectedCase(null);
      setSelectedCaseImages([]);
      replaceDraftImagesAndBoxes(nextDraftImages);
      setDraftLesionPromptBoxes(nextDraftBoxes);
      setDraft((current) => ({
        ...current,
        patient_id: caseToEdit.patient_id,
        sex: caseToEdit.sex || current.sex,
        age: String(caseToEdit.age ?? current.age),
        chart_alias: caseToEdit.chart_alias ?? current.chart_alias,
        local_case_code: caseToEdit.local_case_code ?? current.local_case_code,
        actual_visit_date: caseToEdit.actual_visit_date?.trim() || "",
        culture_category: caseToEdit.culture_category || current.culture_category,
        culture_species: caseToEdit.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          caseToEdit.culture_category,
          caseToEdit.culture_species,
          selectedVisit?.additional_organisms ?? caseToEdit.additional_organisms
        ),
        contact_lens_use: selectedVisit?.contact_lens_use || caseToEdit.contact_lens_use || current.contact_lens_use,
        visit_status: selectedVisit?.visit_status || caseToEdit.visit_status || current.visit_status,
        is_initial_visit: /^initial$/i.test(caseToEdit.visit_date),
        follow_up_number: (() => {
          const followUpMatch = String(caseToEdit.visit_date ?? "").match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
          return followUpMatch ? String(Number(followUpMatch[1]) || 1) : current.follow_up_number;
        })(),
        predisposing_factor: selectedVisit?.predisposing_factor ?? current.predisposing_factor,
        other_history: selectedVisit?.other_history ?? current.other_history,
        intake_completed: false,
      }));
      setPendingOrganism({
        culture_category: caseToEdit.culture_category || "bacterial",
        culture_species:
          caseToEdit.additional_organisms?.[0]?.culture_species ||
          caseToEdit.culture_species ||
          (CULTURE_SPECIES[caseToEdit.culture_category || "bacterial"]?.[0] ?? ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to open this saved case in edit mode.", "?????耳?댁뒪瑜??섏젙 紐⑤뱶濡??댁? 紐삵뻽?듬땲??")
        ),
      });
    } finally {
      setEditDraftBusy(false);
    }
  }

  function resetDraft() {
    setRailView("cases");
    replaceDraftImagesAndBoxes([]);
    clearDraftStorage();
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftLesionPromptBoxes({});
    setDraft(createDraft());
    setPendingOrganism({
      culture_category: "bacterial",
      culture_species: CULTURE_SPECIES.bacterial[0],
    });
    setShowAdditionalOrganismForm(false);
  }

  function startNewCaseDraft() {
    resetDraft();
    setPanelOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
      const next = exists ? current.filter((item) => item !== caseId) : [...current, caseId];
      setToast({
        tone: "success",
        message: exists ? copy.favoriteRemoved : copy.favoriteAdded,
      });
      return next;
    });
  }

  function openSavedCase(caseRecord: CaseSummaryRecord, nextView: "cases" | "patients" = "cases") {
    setSelectedCase(caseRecord);
    setPanelOpen(true);
    setRailView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyResearchRegistryStatusToLocalCase(
    patientId: string,
    visitDate: string,
    updates: {
      research_registry_status: "analysis_only" | "candidate" | "included" | "excluded";
      research_registry_updated_at?: string | null;
      research_registry_updated_by?: string | null;
      research_registry_source?: string | null;
    }
  ) {
    setCases((current) =>
      current.map((item) =>
        item.patient_id === patientId && item.visit_date === visitDate
          ? { ...item, ...updates }
          : item
      )
    );
    setSelectedCase((current) =>
      current && current.patient_id === patientId && current.visit_date === visitDate
        ? { ...current, ...updates }
        : current
    );
  }

  async function includeCaseInResearchRegistry(
    patientId: string,
    visitDate: string,
    source: string,
    successMessage?: string
  ) {
    if (!selectedSiteId) {
      return;
    }
    const result = await updateCaseResearchRegistry(selectedSiteId, token, {
      patient_id: patientId,
      visit_date: visitDate,
      action: "include",
      source,
    });
    applyResearchRegistryStatusToLocalCase(patientId, visitDate, result);
    await onSiteDataChanged(selectedSiteId);
    if (successMessage) {
      setToast({ tone: "success", message: successMessage });
    }
  }

  async function excludeCaseFromResearchRegistry(
    patientId: string,
    visitDate: string,
    source: string,
    successMessage?: string
  ) {
    if (!selectedSiteId) {
      return;
    }
    const result = await updateCaseResearchRegistry(selectedSiteId, token, {
      patient_id: patientId,
      visit_date: visitDate,
      action: "exclude",
      source,
    });
    applyResearchRegistryStatusToLocalCase(patientId, visitDate, result);
    await onSiteDataChanged(selectedSiteId);
    if (successMessage) {
      setToast({ tone: "success", message: successMessage });
    }
  }

  async function handleDeleteSavedCase(caseRecord: CaseSummaryRecord) {
    if (!selectedSiteId) {
      return;
    }
    const samePatientCases = cases.filter((item) => item.patient_id === caseRecord.patient_id);
    const confirmMessage = samePatientCases.length <= 1
      ? pick(
          locale,
          `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?\n\nThis is the only visit for the patient, so the patient record will also be removed.`,
          `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??\n\n???섏옄??留덉?留?諛⑸Ц?대씪 ?섏옄 湲곕줉???④퍡 ??젣?⑸땲??`
        )
      : pick(
          locale,
          `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?`,
          `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??`
        );
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const deleted = await deleteVisit(selectedSiteId, token, caseRecord.patient_id, caseRecord.visit_date);
      const nextCases = await fetchCases(selectedSiteId, token, { mine: showOnlyMine });
      setCases(nextCases);

      if (deleted.deleted_patient) {
        setSelectedCase(null);
        setSelectedCaseImages([]);
        setPatientVisitGallery({});
        resetAnalysisState();
        setRailView("patients");
        setToast({ tone: "success", message: copy.patientDeleted(caseRecord.patient_id) });
        return;
      }

      const preservedCurrentCase =
        selectedCase && selectedCase.case_id !== caseRecord.case_id
          ? nextCases.find((item) => item.case_id === selectedCase.case_id) ?? null
          : null;
      const remainingSamePatientCase = nextCases
        .filter((item) => item.patient_id === caseRecord.patient_id)
        .sort((left, right) => caseTimestamp(right) - caseTimestamp(left))[0] ?? null;
      const nextSelectedCase = preservedCurrentCase ?? remainingSamePatientCase ?? nextCases[0] ?? null;
      setSelectedCase(nextSelectedCase);
      setToast({ tone: "success", message: copy.visitDeleted(caseRecord.patient_id, caseRecord.visit_date) });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.deleteVisitFailed),
      });
    }
  }

  function updatePrimaryOrganism(cultureCategory: string, cultureSpecies: string) {
    setDraft((current) => ({
      ...current,
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: cultureSpecies.trim(),
      additional_organisms: normalizeAdditionalOrganisms(
        cultureCategory,
        cultureSpecies,
        current.additional_organisms
      ),
    }));
  }

  function addAdditionalOrganism() {
    const nextOrganism = {
      culture_category: pendingOrganism.culture_category.trim().toLowerCase(),
      culture_species: pendingOrganism.culture_species.trim(),
    };
    if (!nextOrganism.culture_category || !nextOrganism.culture_species) {
      return;
    }
    const currentOrganisms = listOrganisms(
      draft.culture_category,
      draft.culture_species,
      draft.additional_organisms
    );
    if (currentOrganisms.some((organism) => organismKey(organism) === organismKey(nextOrganism))) {
      setToast({
        tone: "error",
        message: copy.organismDuplicate,
      });
      return;
    }
    setDraft((current) => ({
      ...current,
      additional_organisms: [
        ...current.additional_organisms,
        nextOrganism,
      ],
    }));
    setToast({
      tone: "success",
      message: copy.organismAdded,
    });
  }

  function handleCompleteIntake() {
    if (!draft.patient_id.trim()) {
      setToast({ tone: "error", message: copy.patientIdRequired });
      return;
    }
    if (!draft.culture_species.trim()) {
      setToast({ tone: "error", message: copy.cultureSpeciesRequired });
      return;
    }
    setDraft((current) => ({ ...current, intake_completed: true }));
    setToast({ tone: "success", message: copy.intakeComplete });
  }

  function removeAdditionalOrganism(organismToRemove: OrganismRecord) {
    setDraft((current) => ({
      ...current,
      additional_organisms: current.additional_organisms.filter(
        (organism) => organismKey(organism) !== organismKey(organismToRemove)
      ),
    }));
  }

  function openFilePicker(view: "white" | "fluorescein") {
    if (view === "fluorescein") {
      fluoresceinFileInputRef.current?.click();
      return;
    }
    whiteFileInputRef.current?.click();
  }

  function appendFiles(files: File[], view: "white" | "fluorescein") {
    if (!files.length) {
      return;
    }
    setPanelOpen(true);
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftImages((current) => {
      const next = [...current];
      const hasRepresentative = current.some((image) => image.is_representative);
      for (const file of files) {
        next.push({
          draft_id: createDraftId(),
          file,
          preview_url: URL.createObjectURL(file),
          view,
          is_representative: false,
        });
      }
      if (!hasRepresentative && next[0]) {
        next[0] = { ...next[0], is_representative: true };
      }
      return next;
    });
  }

  function removeDraftImage(draftId: string) {
    const remaining = draftImages.filter((image) => image.draft_id !== draftId);
    if (remaining.length > 0 && !remaining.some((image) => image.is_representative)) {
      remaining[0] = { ...remaining[0], is_representative: true };
    }
    replaceDraftImagesAndBoxes(remaining);
  }

  function setRepresentativeImage(draftId: string) {
    setDraftImages((current) =>
      current.map((image) => ({
        ...image,
        is_representative: image.draft_id === draftId,
      }))
    );
  }

  function updateDraftLesionBoxFromPointer(draftId: string, clientX: number, clientY: number, element: HTMLDivElement) {
    const drawState = draftLesionDrawStateRef.current;
    if (!drawState || drawState.imageId !== draftId) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const currentX = clamp01((clientX - rect.left) / rect.width);
    const currentY = clamp01((clientY - rect.top) / rect.height);
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]: normalizeBox({
        x0: drawState.x,
        y0: drawState.y,
        x1: currentX,
        y1: currentY,
      }),
    }));
  }

  function handleDraftLesionPointerDown(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const startX = clamp01((event.clientX - rect.left) / rect.width);
    const startY = clamp01((event.clientY - rect.top) / rect.height);
    draftLesionDrawStateRef.current = {
      imageId: draftId,
      pointerId: event.pointerId,
      x: startX,
      y: startY,
    };
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]: { x0: startX, y0: startY, x1: startX, y1: startY },
    }));
    element.setPointerCapture(event.pointerId);
  }

  function handleDraftLesionPointerMove(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (
      draftLesionDrawStateRef.current?.pointerId !== event.pointerId ||
      draftLesionDrawStateRef.current?.imageId !== draftId
    ) {
      return;
    }
    updateDraftLesionBoxFromPointer(draftId, event.clientX, event.clientY, event.currentTarget);
  }

  function finishDraftLesionPointer(draftId: string, event: ReactPointerEvent<HTMLDivElement>) {
    const drawState = draftLesionDrawStateRef.current;
    if (!drawState || drawState.pointerId !== event.pointerId || drawState.imageId !== draftId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const currentX = clamp01((event.clientX - rect.left) / rect.width);
    const currentY = clamp01((event.clientY - rect.top) / rect.height);
    const nextBox = normalizeBox({
      x0: drawState.x,
      y0: drawState.y,
      x1: currentX,
      y1: currentY,
    });
    setDraftLesionPromptBoxes((current) => ({
      ...current,
      [draftId]: nextBox.x1 - nextBox.x0 < 0.01 || nextBox.y1 - nextBox.y0 < 0.01 ? null : nextBox,
    }));
    draftLesionDrawStateRef.current = null;
  }

  function togglePredisposingFactor(factor: string) {
    setDraft((current) => {
      const exists = current.predisposing_factor.includes(factor);
      return {
        ...current,
        predisposing_factor: exists
          ? current.predisposing_factor.filter((item) => item !== factor)
          : [...current.predisposing_factor, factor],
      };
    });
  }

  async function handleRunSiteValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForValidation });
      return;
    }

    setSiteValidationBusy(true);
    try {
      const started = await runSiteValidation(selectedSiteId, token);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.siteValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(copy.siteValidationFailed);
      }
      await onSiteDataChanged(selectedSiteId);
      await loadSiteActivity(selectedSiteId);
      await loadSiteValidationRuns(selectedSiteId);
      setToast({
        tone: "success",
        message: copy.siteValidationSaved(result.summary.validation_id),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.siteValidationFailed),
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

  async function handleContributeCase() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForContribution });
      return;
    }
    if (selectedCase.visit_status !== "active") {
      setToast({
        tone: "error",
        message: copy.activeOnly,
      });
      return;
    }

    setContributionBusy(true);
    setPanelOpen(true);
    try {
      const requestedContributionModelIds = selectedCompareModelVersionIds.length > 0 ? selectedCompareModelVersionIds : undefined;
      const contributionModelVersionId =
        requestedContributionModelIds && requestedContributionModelIds.length > 0
          ? undefined
          : validationResult?.model_version.ensemble_mode === "weighted_average"
            ? undefined
            : validationResult?.model_version.version_id;
      const result = await runCaseContribution(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult?.execution_device),
        model_version_id: contributionModelVersionId,
        model_version_ids: requestedContributionModelIds,
      });
      setContributionResult(result);
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      setCompletionState({
        kind: "contributed",
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        timestamp: new Date().toISOString(),
        stats: {
          user_contributions: result.stats.user_contributions,
          total_contributions: result.stats.total_contributions,
          user_contribution_pct: result.stats.user_contribution_pct,
        },
        update_id: result.update.update_id,
        update_count: result.update_count,
      });
      setToast({
        tone: "success",
        message:
          result.failures && result.failures.length > 0
            ? pick(
                locale,
                `${result.update_count} updates were queued, with ${result.failures.length} model(s) failing.`,
                `${result.update_count}개 업데이트를 올렸고, ${result.failures.length}개 모델은 실패했습니다.`
              )
            : result.update_count > 1
              ? pick(
                  locale,
                  `${result.update_count} contribution updates were queued for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
                  `${selectedCase.patient_id} / ${selectedCase.visit_date}에 대해 ${result.update_count}개 기여 업데이트를 대기열에 올렸습니다.`
                )
              : copy.contributionQueued(selectedCase.patient_id, selectedCase.visit_date),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.contributionFailed),
      });
    } finally {
      setContributionBusy(false);
    }
  }

  async function handleJoinResearchRegistry() {
    if (!selectedSiteId) {
      return;
    }
    setResearchRegistryBusy(true);
    try {
      await enrollResearchRegistry(selectedSiteId, token);
      await onSiteDataChanged(selectedSiteId);
      setResearchRegistryModalOpen(false);
      setToast({
        tone: "success",
        message: pick(
          locale,
          "Joined the research registry. Future eligible analyses can now flow into the dataset.",
          "연구 레지스트리에 가입했습니다. 이제 적격 분석 케이스가 데이터셋 흐름에 포함될 수 있습니다."
        ),
      });
      if (pendingResearchRegistryAutoInclude && selectedCase) {
        await includeCaseInResearchRegistry(
          selectedCase.patient_id,
          selectedCase.visit_date,
          "validation_auto_include",
          pick(
            locale,
            "This case was included in the research registry after validation.",
            "이 케이스는 검증 후 연구 레지스트리에 포함되었습니다."
          )
        );
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to join the research registry.", "연구 레지스트리에 가입할 수 없습니다.")
        ),
      });
    } finally {
      setPendingResearchRegistryAutoInclude(false);
      setResearchRegistryBusy(false);
    }
  }

  async function handleIncludeResearchCase() {
    if (!selectedCase) {
      return;
    }
    setResearchRegistryBusy(true);
    try {
      await includeCaseInResearchRegistry(
        selectedCase.patient_id,
        selectedCase.visit_date,
        "manual_include",
        pick(locale, "This case is now included in the research registry.", "이 케이스가 연구 레지스트리에 포함되었습니다.")
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to include this case in the registry.", "이 케이스를 레지스트리에 포함할 수 없습니다.")
        ),
      });
    } finally {
      setResearchRegistryBusy(false);
    }
  }

  async function handleExcludeResearchCase() {
    if (!selectedCase) {
      return;
    }
    setResearchRegistryBusy(true);
    try {
      await excludeCaseFromResearchRegistry(
        selectedCase.patient_id,
        selectedCase.visit_date,
        "manual_exclude",
        pick(locale, "This case was excluded from the research registry.", "이 케이스를 연구 레지스트리에서 제외했습니다.")
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Unable to exclude this case from the registry.", "이 케이스를 레지스트리에서 제외할 수 없습니다.")
        ),
      });
    } finally {
      setResearchRegistryBusy(false);
    }
  }

  async function handleSaveCase() {
    const nextVisitReference = buildVisitReference(draft);
    const patientId = draft.patient_id.trim();
    const visitPayload = (visitReference: string) => ({
      patient_id: patientId,
      visit_date: visitReference,
      actual_visit_date: draft.actual_visit_date.trim() || null,
      culture_category: draft.culture_category,
      culture_species: draft.culture_species.trim(),
      additional_organisms: normalizeAdditionalOrganisms(
        draft.culture_category,
        draft.culture_species,
        draft.additional_organisms
      ),
      contact_lens_use: draft.contact_lens_use,
      predisposing_factor: draft.predisposing_factor,
      other_history: draft.other_history.trim(),
      visit_status: draft.visit_status,
      is_initial_visit: /^initial$/i.test(visitReference),
      polymicrobial: draft.additional_organisms.length > 0,
    });
    const uploadDraftImagesToVisit = async (visitReference: string) => {
      for (const image of draftImages) {
        const uploadedImage = await uploadImage(selectedSiteId!, token, {
          patient_id: patientId,
          visit_date: visitReference,
          view: image.view,
          is_representative: image.is_representative,
          file: image.file,
        });
        const draftBox = draftLesionPromptBoxes[image.draft_id];
        if (draftBox) {
          await updateImageLesionBox(selectedSiteId!, uploadedImage.image_id, token, draftBox);
        }
      }
    };
    const finalizeSavedCase = async (visitReference: string) => {
      await onSiteDataChanged(selectedSiteId!);
      const nextCases = await fetchCases(selectedSiteId!, token, { mine: showOnlyMine });
      setCases(nextCases);
      const createdCase = nextCases.find(
        (item) => item.patient_id === patientId && item.visit_date === visitReference
      );
      await loadSiteActivity(selectedSiteId!);
      setToast({
        tone: "success",
        message: copy.caseSaved(patientId, visitReference, selectedSiteLabel ?? selectedSiteId!),
      });
      clearDraftStorage(selectedSiteId!);
      resetDraft();
      setSelectedCase(createdCase ?? null);
      setPanelOpen(true);
      setCompletionState({
        kind: "saved",
        patient_id: patientId,
        visit_date: visitReference,
        timestamp: new Date().toISOString(),
      });
    };
    const nextAvailableFollowUpReference = async () => {
      const visits = await fetchVisits(selectedSiteId!, token, patientId);
      const usedVisitReferences = visits.map((item) => item.visit_date);
      let maxFollowUp = 0;
      for (const item of usedVisitReferences) {
        const match = String(item).match(/^(?:F\/?U|FU)[-\s_#]*0*(\d+)$/i);
        if (match) {
          maxFollowUp = Math.max(maxFollowUp, Number(match[1]));
        }
      }
      return `FU #${String(maxFollowUp + 1)}`;
    };
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }
    if (!draft.intake_completed) {
      setToast({ tone: "error", message: copy.intakeStepRequired });
      return;
    }
    if (!draft.patient_id.trim()) {
      setToast({ tone: "error", message: copy.patientIdRequired });
      return;
    }
    if (!draft.culture_species.trim()) {
      setToast({ tone: "error", message: copy.cultureSpeciesRequired });
      return;
    }
    if (draftImages.length === 0) {
      setToast({ tone: "error", message: copy.imageRequired });
      return;
    }

    setSaveBusy(true);
    try {
      try {
        await createPatient(selectedSiteId, token, {
          patient_id: patientId,
          sex: draft.sex,
          age: Number(draft.age || 0),
          chart_alias: "",
          local_case_code: draft.local_case_code.trim(),
        });
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
      }

      try {
        await createVisit(selectedSiteId, token, visitPayload(nextVisitReference));
        await uploadDraftImagesToVisit(nextVisitReference);
        await finalizeSavedCase(nextVisitReference);
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
        const overwriteConfirmed = window.confirm(
          pick(
            locale,
            `Visit ${patientId} / ${displayVisitReference(locale, nextVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
            `諛⑸Ц ${patientId} / ${displayVisitReference(locale, nextVisitReference)}媛 ?대? 議댁옱?⑸땲??\n\n?뺤씤???꾨Ⅴ硫???뼱?곌퀬, 痍⑥냼瑜??꾨Ⅴ硫??ㅻⅨ 耳?댁뒪濡???ν빀?덈떎.`
          )
        );
        if (overwriteConfirmed) {
          await updateVisit(selectedSiteId, token, patientId, nextVisitReference, visitPayload(nextVisitReference));
          await deleteVisitImages(selectedSiteId, token, patientId, nextVisitReference);
          await uploadDraftImagesToVisit(nextVisitReference);
          await finalizeSavedCase(nextVisitReference);
        } else {
          const alternateVisitReference = await nextAvailableFollowUpReference();
          const saveAlternateConfirmed = window.confirm(
            pick(
              locale,
              `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
              `??耳?댁뒪瑜?${displayVisitReference(locale, alternateVisitReference)}濡???ν븷源뚯슂?`
            )
          );
          if (!saveAlternateConfirmed) {
            return;
          }
          await createVisit(selectedSiteId, token, visitPayload(alternateVisitReference));
          await uploadDraftImagesToVisit(alternateVisitReference);
          await finalizeSavedCase(alternateVisitReference);
        }
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.caseSaveFailed),
      });
    } finally {
      setSaveBusy(false);
    }
  }

  useEffect(() => {
    setPatientListPage(1);
  }, [selectedSiteId]);

  const normalizedPatientListSearch = deferredSearch.trim().toLowerCase();
  const allPatientRows = useMemo(() => {
    const groups = new Map<string, CaseSummaryRecord[]>();
    for (const caseRecord of cases) {
      if (normalizedPatientListSearch) {
        const haystack = [
          caseRecord.patient_id,
          caseRecord.local_case_code,
          caseRecord.chart_alias,
          caseRecord.culture_category,
          caseRecord.culture_species,
          ...(caseRecord.additional_organisms ?? []).map((o) => o.culture_species),
          caseRecord.visit_date,
          caseRecord.actual_visit_date ?? "",
        ].join(" ").toLowerCase();
        if (!haystack.includes(normalizedPatientListSearch)) {
          continue;
        }
      }
      const group = groups.get(caseRecord.patient_id) ?? [];
      group.push(caseRecord);
      groups.set(caseRecord.patient_id, group);
    }
    return Array.from(groups.entries())
      .map(([patientId, groupedCases]) => {
        const sortedCases = [...groupedCases].sort((left, right) => caseTimestamp(right) - caseTimestamp(left));
        const latestCase = sortedCases[0];
        return {
          patient_id: patientId,
          latest_case: latestCase,
          case_count: groupedCases.length,
          organism_summary: Array.from(
            new Set(
              sortedCases
                .flatMap((item) => listOrganisms(item.culture_category, item.culture_species, item.additional_organisms))
                .map((o) => o.culture_species),
            ),
          ).slice(0, 2).join(" · "),
          representative_thumbnails: sortedCases
            .filter((item) => item.representative_image_id)
            .slice(0, 3)
            .map((item) => ({
              case_id: item.case_id,
              image_id: item.representative_image_id as string,
              view: item.representative_view,
              preview_url: null,
            })),
        };
      })
      .sort((left, right) => caseTimestamp(right.latest_case) - caseTimestamp(left.latest_case));
  }, [cases, normalizedPatientListSearch]);
  const patientListTotalCount = allPatientRows.length;
  const patientListTotalPages = Math.max(1, Math.ceil(patientListTotalCount / PATIENT_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, patientListPage), patientListTotalPages);
  const patientListRows = allPatientRows.slice((safePage - 1) * PATIENT_LIST_PAGE_SIZE, safePage * PATIENT_LIST_PAGE_SIZE);

  const selectedPatientCases = selectedCase
    ? [...cases]
        .filter((item) => item.patient_id === selectedCase.patient_id)
        .sort((left, right) => caseTimestamp(right) - caseTimestamp(left))
    : [];
  const patientListThumbKey = patientListRows
    .map((row) => `${row.patient_id}:${row.representative_thumbnails.map((item) => item.image_id).join(",")}`)
    .join("|");
  useEffect(() => {
    for (const url of patientListThumbUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    patientListThumbUrlsRef.current = [];
    if (!selectedSiteId || railView !== "patients" || patientListRows.length === 0) {
      setPatientListThumbs({});
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    const createdUrls: string[] = [];
    const controller = new AbortController();
    async function loadPatientListThumbs() {
      setPatientListThumbs({});
      await Promise.all(
        patientListRows.map(async (row) => {
          const thumbs = await Promise.all(
            row.representative_thumbnails.map(async (item) => {
              try {
                const blob = await fetchImagePreviewBlob(currentSiteId, item.image_id, token, {
                  maxSide: 256,
                  signal: controller.signal,
                });
                if (cancelled) {
                  return { ...item, preview_url: null };
                }
                const previewUrl = URL.createObjectURL(blob);
                createdUrls.push(previewUrl);
                return { ...item, preview_url: previewUrl };
              } catch {
                return { ...item, preview_url: null };
              }
            }),
          );
          if (!cancelled) {
            setPatientListThumbs((prev) => ({ ...prev, [row.patient_id]: thumbs }));
          }
        }),
      );
      if (!cancelled) {
        patientListThumbUrlsRef.current = createdUrls;
      } else {
        for (const url of createdUrls) {
          URL.revokeObjectURL(url);
        }
      }
    }
    void loadPatientListThumbs();
    return () => {
      cancelled = true;
      controller.abort();
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [patientListThumbKey, railView, selectedSiteId, token]);
  const speciesOptions = CULTURE_SPECIES[draft.culture_category] ?? [];
  const pendingSpeciesOptions = CULTURE_SPECIES[pendingOrganism.culture_category] ?? [];
  const momentumPercent = cases.length === 0 ? 18 : Math.min(100, 18 + cases.length * 12);
  const canRunValidation = ["admin", "site_admin", "researcher"].includes(user.role);
  const canRunRoiPreview = canRunValidation;
  const canRunAiClinic = canRunValidation && Boolean(validationResult) && Boolean(selectedCase);
  const compareModelCandidates = MODEL_COMPARE_ARCHITECTURES.map((architecture) =>
    [...siteModelVersions]
      .reverse()
      .find((item) => item.ready !== false && String(item.architecture || "").trim().toLowerCase() === architecture)
  ).filter((item): item is ModelVersionRecord => Boolean(item?.version_id));
  const canContributeSelectedCase =
    canRunValidation && Boolean(selectedCase) && selectedCase?.visit_status === "active";
  const researchRegistryEnabled = Boolean(summary?.research_registry?.site_enabled);
  const researchRegistryUserEnrolled = Boolean(summary?.research_registry?.user_enrolled);
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const validationPredictedConfidence = predictedClassConfidence(
    validationResult?.summary.predicted_label,
    validationResult?.summary.prediction_probability
  );
  const validationConfidence = confidencePercent(validationPredictedConfidence);
  const validationConfidenceTone = confidenceTone(validationConfidence);
  const selectedCompletion =
    selectedCase &&
    completionState &&
    completionState.patient_id === selectedCase.patient_id &&
    completionState.visit_date === selectedCase.visit_date
      ? completionState
      : null;
  const completionContent = selectedCompletion ? (
    <CompletionCard
      locale={locale}
      completion={selectedCompletion}
      hospitalValidationCount={summary?.n_validation_runs ?? 0}
      formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
      notAvailableLabel={common.notAvailable}
    />
  ) : null;
  const draftStatusLabel = draftSavedAt
    ? copy.draftAutosaved(new Date(draftSavedAt).toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" }))
    : copy.draftUnsaved;
  const intakeOrganisms = listOrganisms(draft.culture_category, draft.culture_species, draft.additional_organisms);
  const resolvedVisitReference = buildVisitReference(draft);
  const resolvedVisitReferenceLabel = displayVisitReference(locale, resolvedVisitReference);
  const actualVisitDateLabel = draft.actual_visit_date.trim() || common.notAvailable;
  const selectedPredisposingFactorLabels = draft.predisposing_factor.map((factor) =>
    translateOption(locale, "predisposing", factor)
  );
  const isAuthoringCanvas = railView !== "patients" && !selectedCase;
  const draftRepresentativeCount = draftImages.filter((image) => image.is_representative).length;
  const draftLesionBoxCount = draftImages.filter((image) => Boolean(draftLesionPromptBoxes[image.draft_id])).length;
  const draftChecklist = [
    Boolean(draft.patient_id.trim() && draft.age.trim()),
    Boolean(draft.visit_status && draft.contact_lens_use),
    Boolean(draft.culture_category && draft.culture_species.trim()),
    draftImages.length > 0,
  ];
  const draftCompletionCount = draftChecklist.filter(Boolean).length;
  const draftCompletionPercent = Math.round((draftCompletionCount / draftChecklist.length) * 100);
  const draftPendingItems: string[] = [];
  if (!selectedSiteId) {
    draftPendingItems.push(pick(locale, "Select a hospital workspace.", "병원 워크스페이스를 선택하세요."));
  }
  if (!draft.patient_id.trim()) {
    draftPendingItems.push(pick(locale, "Add a patient identifier.", "환자 식별자를 입력하세요."));
  }
  if (!draft.culture_species.trim()) {
    draftPendingItems.push(pick(locale, "Choose the primary organism.", "기본 원인균을 선택하세요."));
  }
  if (!draft.intake_completed) {
    draftPendingItems.push(pick(locale, "Complete the intake to unlock submission.", "제출을 열려면 intake를 완료하세요."));
  }
  if (draftImages.length === 0) {
    draftPendingItems.push(pick(locale, "Add at least one image to the board.", "이미지를 한 장 이상 보드에 추가하세요."));
  }
  if (draftImages.length > 0 && draftRepresentativeCount === 0) {
    draftPendingItems.push(pick(locale, "Mark one representative image.", "대표 이미지를 한 장 지정하세요."));
  }
  if (draftImages.length > draftLesionBoxCount) {
    draftPendingItems.push(
      pick(locale, "Draw lesion boxes on the key images.", "핵심 이미지에 lesion box를 그리세요.")
    );
  }
  const validationPanelContent = (
    <ValidationPanel
      locale={locale}
      common={common}
      validationResult={validationResult}
      validationBusy={validationBusy}
      canRunValidation={canRunValidation}
      hasSelectedCase={Boolean(selectedCase)}
      validationConfidence={validationConfidence}
      validationConfidenceTone={validationConfidenceTone}
      validationPredictedConfidence={validationPredictedConfidence}
      onRunValidation={() => void handleRunValidation()}
      artifactContent={
        <ValidationArtifactStack
          locale={locale}
          representativePreviewUrl={representativeSavedImage?.preview_url}
          roiCropUrl={validationArtifacts.roi_crop}
          gradcamUrl={validationArtifacts.gradcam}
          medsamMaskUrl={validationArtifacts.medsam_mask}
          lesionCropUrl={validationArtifacts.lesion_crop}
          lesionMaskUrl={validationArtifacts.lesion_mask}
        />
      }
      modelCompareBusy={modelCompareBusy}
      selectedCompareModelVersionIds={selectedCompareModelVersionIds}
      compareModelCandidates={compareModelCandidates}
      onToggleModelVersion={(versionId, checked) =>
        setSelectedCompareModelVersionIds((current) =>
          checked ? [...current, versionId] : current.filter((item) => item !== versionId)
        )
      }
      onRunModelCompare={() => void handleRunModelCompare()}
      modelCompareResult={modelCompareResult}
      formatProbability={formatProbability}
    />
  );
  const aiClinicPanelContent = (
    <AiClinicPanel
      locale={locale}
      validationResult={validationResult}
      aiClinicBusy={aiClinicBusy}
      canRunAiClinic={canRunAiClinic}
      onRunAiClinic={() => void handleRunAiClinic()}
    >
      <AiClinicResult
        locale={locale}
        result={aiClinicResult}
        notAvailableLabel={common.notAvailable}
        aiClinicTextUnavailableLabel={copy.aiClinicTextUnavailable}
        displayVisitReference={(visitReference) => displayVisitReference(locale, visitReference)}
        formatSemanticScore={formatSemanticScore}
        formatImageQualityScore={formatImageQualityScore}
        formatProbability={formatProbability}
        formatMetadataField={(field) => formatAiClinicMetadataField(locale, field)}
      />
    </AiClinicPanel>
  );
  const mainHeaderTitle =
    railView === "patients"
      ? pick(locale, "Patient list", "환자 목록")
      : selectedCase
        ? pick(locale, "Case review", "케이스 리뷰")
        : pick(locale, "Case canvas", "케이스 캔버스");
  const mainHeaderCopy =
    railView === "patients"
      ? copy.listViewHeaderCopy
      : selectedCase
        ? pick(
            locale,
            "Review the saved visit, validation context, and contribution history in one place.",
            "저장된 방문, 검증 맥락, 기여 이력을 한 곳에서 검토합니다."
          )
        : pick(
            locale,
            "A structured document canvas for one clinical case. Capture the intake, image board, and submission state without the dashboard noise.",
            "한 건의 임상 케이스를 위한 구조화 문서 캔버스입니다. 대시보드 소음을 줄이고 intake, 이미지 보드, 제출 상태에 집중합니다."
          );

  return (
    <main className={workspaceShellClass} data-workspace-theme={theme}>
      <div className={workspaceNoiseClass} />
      <aside className={workspaceRailClass}>
        <div className={workspaceBrandClass}>
          <div className={workspaceBrandCopyClass}>
            <h1 className={workspaceBrandTitleClass}>{pick(locale, "K-ERA", "K-ERA")}</h1>
            <div className={workspaceKickerClass}>{pick(locale, "Case Studio", "케이스 스튜디오")}</div>
          </div>
          <div className={workspaceBrandActionsClass}>
            <Button className="min-w-[108px]" type="button" variant="primary" onClick={startNewCaseDraft}>
              {pick(locale, "New case", "?좉퇋 耳?댁뒪")}
            </Button>
            <Button
              className={railView === "patients" ? "min-w-[108px] border-brand/20 bg-brand-soft text-brand" : "min-w-[108px]"}
              type="button"
              variant="ghost"
              onClick={() => setRailView("patients")}
            >
              {pick(locale, "List view", "리스트")}
            </Button>
          </div>
        </div>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <span className={railLabelClass}>{pick(locale, "Hospital", "蹂묒썝")}</span>
            <div className={railSummaryClass}>
              <strong className={railSummaryValueClass}>{sites.length}</strong>
              <span className={railSummaryMetaClass}>{pick(locale, "linked", "연결됨")}</span>
            </div>
          </div>
          <div className={railSiteListClass}>
            {sites.map((site) => (
              <button
                key={site.site_id}
                className={railSiteButtonClass(selectedSiteId === site.site_id)}
                type="button"
                onClick={() => onSelectSite(site.site_id)}
              >
                <strong>{getSiteDisplayName(site)}</strong>
              </button>
            ))}
          </div>
        </Card>

        <Card as="section" variant="nested" className={railSectionClass}>
          <div className={railSectionHeadClass}>
            <div className="grid gap-1">
              <span className={railLabelClass}>{copy.recentAlerts}</span>
              <p className="m-0 text-sm leading-6 text-muted">{copy.recentAlertsCopy}</p>
            </div>
            <div className={railSummaryClass}>
              <strong className={railSummaryValueClass}>{toastHistory.length}</strong>
              <span className={railSummaryMetaClass}>{copy.alertsKept}</span>
            </div>
          </div>
          {toastHistory.length ? (
            <>
              <div className={railActivityListClass}>
                {toastHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`${railActivityItemClass} ${
                      entry.tone === "error"
                        ? "border-danger/25 bg-danger/6"
                        : "border-emerald-300/35 bg-emerald-500/6"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{entry.tone === "success" ? common.saved : common.actionNeeded}</strong>
                      <span className="text-[0.72rem] text-muted">
                        {new Date(entry.created_at).toLocaleTimeString(localeTag, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="ghost" onClick={() => setToastHistory([])}>
                  {copy.clearAlerts}
                </Button>
              </div>
            </>
          ) : (
            <div className={emptySurfaceClass}>{copy.noAlertsYet}</div>
          )}
        </Card>

        {isAuthoringCanvas ? (
          <Card as="section" variant="nested" className={railSectionClass}>
            <div className={railSectionHeadClass}>
              <span className={railLabelClass}>{pick(locale, "Canvas", "캔버스")}</span>
              <div className={railSummaryClass}>
                <strong className={railSummaryValueClass}>{`${draftCompletionPercent}%`}</strong>
                <span className={railSummaryMetaClass}>{pick(locale, "structured", "구조화됨")}</span>
              </div>
            </div>
            <div className={momentumTrackClass}>
              <div className={momentumFillClass} style={{ width: `${draftCompletionPercent}%` }} />
            </div>
            <p className={railCopyClass}>
              {pick(
                locale,
                "The writing view stays focused on one clinical case. The dashboard metrics return once you switch back to list or review mode.",
                "작성 화면은 한 건의 임상 케이스에만 집중합니다. 리스트나 리뷰 모드로 돌아가면 운영 지표가 다시 보입니다."
              )}
            </p>
            <div className={railActivityListClass}>
              <div className={railActivityItemClass}>
                <strong>{pick(locale, "Draft images", "초안 이미지")}</strong>
                <span>{`${draftImages.length} ${pick(locale, "files", "파일")}`}</span>
                <span>{`${draftRepresentativeCount} ${pick(locale, "representative", "대표")}`}</span>
              </div>
              <div className={railActivityItemClass}>
                <strong>{pick(locale, "Visit reference", "방문 기준")}</strong>
                <span>{resolvedVisitReferenceLabel}</span>
                <span>{draftStatusLabel}</span>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <Card as="section" variant="nested" className={railSectionClass}>
              <div className={railSectionHeadClass}>
                <span className={railLabelClass}>{pick(locale, "Momentum", "진행도")}</span>
                <div className={railSummaryClass}>
                  <strong className={railSummaryValueClass}>{cases.length}</strong>
                  <span className={railSummaryMetaClass}>{copy.savedCases}</span>
                </div>
              </div>
              <div className={momentumTrackClass}>
                <div className={momentumFillClass} style={{ width: `${momentumPercent}%` }} />
              </div>
              <p className={railCopyClass}>
                {pick(
                  locale,
                  "Each saved case expands the local dataset surface and keeps the migration grounded in real workflow.",
                  "??λ맂 耳?댁뒪媛 ?섏뼱?좎닔濡?濡쒖뺄 ?곗씠?곗뀑???뺤옣?섍퀬 ?ㅼ젣 ?뚰겕?뚮줈??湲곗????댁쟾???좎??⑸땲??"
                )}
              </p>
            </Card>

            <Card as="section" variant="nested" className={railSectionClass}>
              <div className={railSectionHeadClass}>
                <div className="grid gap-1">
                  <span className={railLabelClass}>{pick(locale, "Activity", "활동")}</span>
                  <p className="m-0 text-sm leading-6 text-muted">
                    {pick(locale, "Recent validation and contribution flow", "최근 검증 및 기여 흐름")}
                  </p>
                </div>
                <div className={railSummaryClass}>
                  <strong className={railSummaryValueClass}>{siteActivity?.pending_updates ?? 0}</strong>
                  <span className={railSummaryMetaClass}>
                    {activityBusy ? pick(locale, "syncing", "동기화 중") : pick(locale, "pending", "대기")}
                  </span>
                </div>
              </div>
              <MetricGrid className={railMetricGridClass} columns={2}>
                <div className={railMetricCardClass}>
                  <strong className={railMetricValueClass}>{siteActivity?.pending_updates ?? 0}</strong>
                  <span className={railMetricLabelClass}>{pick(locale, "pending deltas", "대기 중 delta")}</span>
                </div>
                <div className={railMetricCardClass}>
                  <strong className={railMetricValueClass}>{siteActivity?.recent_validations.length ?? 0}</strong>
                  <span className={railMetricLabelClass}>{pick(locale, "recent validations", "최근 검증")}</span>
                </div>
              </MetricGrid>
              <div className="mt-4 grid gap-3">
                {siteActivity?.recent_validations.slice(0, 2).map((item) => (
                  <div key={item.validation_id} className={railActivityItemClass}>
                    <strong>{item.model_version}</strong>
                    <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                    <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${formatProbability(item.accuracy, common.notAvailable)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
                  </div>
                ))}
                {siteActivity?.recent_contributions.slice(0, 2).map((item) => (
                  <div key={item.contribution_id} className={railActivityItemClass}>
                    <strong>{formatPublicAlias(item.public_alias, locale) ?? common.notAvailable}</strong>
                    <span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span>
                    <span>
                      {item.update_status ?? pick(locale, "queued", "?湲곗뿴 ?깅줉")}
                      {item.case_reference_id ? ` · ${item.case_reference_id}` : ""}
                    </span>
                  </div>
                ))}
                {!activityBusy && !siteActivity?.recent_validations.length && !siteActivity?.recent_contributions.length ? (
                  <div className={emptySurfaceClass}>{pick(locale, "No hospital activity recorded yet.", "?꾩쭅 湲곕줉??蹂묒썝 ?쒕룞???놁뒿?덈떎.")}</div>
                ) : null}
              </div>
            </Card>

            <Card as="section" variant="nested" className={railSectionClass}>
              <div className={`${railSectionHeadClass} ${validationRailHeadClass}`}>
                <div className="grid gap-1">
                  <span className={railLabelClass}>{pick(locale, "Validation", "검증")}</span>
                  <p className="m-0 text-sm leading-6 text-muted">
                    {pick(locale, "Run the latest site-level check from here", "여기에서 최신 병원 단위 검증을 실행합니다")}
                  </p>
                </div>
                <Button
                  className={railRunButtonClass}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRunSiteValidation()}
                  disabled={siteValidationBusy || !selectedSiteId || !canRunValidation}
                >
                  {siteValidationBusy ? pick(locale, "Running...", "?ㅽ뻾 以?..") : pick(locale, "Run hospital validation", "蹂묒썝 寃利??ㅽ뻾")}
                </Button>
              </div>
              {latestSiteValidation ? (
                <div className={railMetricGridClass}>
                  <div className={railMetricCardClass}>
                    <strong className={railMetricValueClass}>
                      {typeof latestSiteValidation.AUROC === "number" ? latestSiteValidation.AUROC.toFixed(3) : common.notAvailable}
                    </strong>
                    <span className={railMetricLabelClass}>AUROC</span>
                  </div>
                  <div className={railMetricCardClass}>
                    <strong className={railMetricValueClass}>
                      {typeof latestSiteValidation.accuracy === "number" ? latestSiteValidation.accuracy.toFixed(3) : common.notAvailable}
                    </strong>
                    <span className={railMetricLabelClass}>{pick(locale, "accuracy", "정확도")}</span>
                  </div>
                  <div className={railMetricCardClass}>
                    <strong className={railMetricValueClass}>{latestSiteValidation.n_cases ?? 0}</strong>
                    <span className={railMetricLabelClass}>{pick(locale, "cases", "耳?댁뒪")}</span>
                  </div>
                  <div className={railMetricCardClass}>
                    <strong className={railMetricValueClass}>{latestSiteValidation.model_version}</strong>
                    <span className={railMetricLabelClass}>{pick(locale, "latest model", "理쒖떊 紐⑤뜽")}</span>
                  </div>
                </div>
              ) : (
                <div className={emptySurfaceClass}>{pick(locale, "No hospital-level validation has been run yet.", "?꾩쭅 蹂묒썝 ?⑥쐞 寃利앹씠 ?ㅽ뻾?섏? ?딆븯?듬땲??")}</div>
              )}
              <div className={railActivityListClass}>
                {siteValidationRuns.slice(0, 3).map((item) => (
                  <div key={item.validation_id} className={railActivityItemClass}>
                    <strong>{item.model_version}</strong>
                    <span>{formatDateTime(item.run_date, localeTag, common.notAvailable)}</span>
                    <span>{typeof item.accuracy === "number" ? `${pick(locale, "acc", "정확도")} ${item.accuracy.toFixed(3)}` : `${item.n_cases ?? 0} ${pick(locale, "cases", "케이스")}`}</span>
                  </div>
                ))}
              </div>
              {!canRunValidation ? <p className={railCopyClass}>{pick(locale, "Viewer accounts can review metrics but cannot run hospital validation.", "酉곗뼱 怨꾩젙? 吏?쒕쭔 ?뺤씤?????덇퀬 蹂묒썝 寃利앹? ?ㅽ뻾?????놁뒿?덈떎.")}</p> : null}
            </Card>
          </>
        )}

      </aside>

      <section className={workspaceMainClass}>
        <header className={workspaceHeaderClass}>
          <div>
            <div className={workspaceKickerClass}>{pick(locale, "Research document", "?곌뎄 臾몄꽌")}</div>
            <div className={workspaceTitleRowClass}>
              <h2>{mainHeaderTitle}</h2>
              <span className={workspaceTitleCopyClass}>{mainHeaderCopy}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className={workspaceUserBadgeClass}>{translateRole(locale, user.role)}</span>
            <LocaleToggle />
            <Button variant="ghost" type="button" onClick={onToggleTheme}>
              {theme === "dark" ? pick(locale, "Light mode", "?쇱씠??紐⑤뱶") : pick(locale, "Dark mode", "?ㅽ겕 紐⑤뱶")}
            </Button>
            {canOpenOperations ? (
              <Button variant="ghost" type="button" onClick={() => onOpenOperations()}>
                {pick(locale, "Operations", "?댁쁺 ?붾㈃")}
              </Button>
            ) : null}
            <Button variant="ghost" type="button" onClick={onExportManifest} disabled={!selectedSiteId}>
              {pick(locale, "Export manifest", "留ㅻ땲?섏뒪???대낫?닿린")}
            </Button>
            <Button className={completeIntakeButtonClass} type="button" variant="primary" onClick={onLogout}>
                {pick(locale, "Log out", "濡쒓렇?꾩썐")}
            </Button>
          </div>
        </header>

        <div className={workspaceCenterClass}>
          {railView === "patients" ? (
            <PatientListBoard
              locale={locale}
              localeTag={localeTag}
              commonNotAvailable={common.notAvailable}
              selectedSiteLabel={selectedSiteLabel}
              selectedPatientId={selectedCase?.patient_id}
              patientListRows={patientListRows}
              patientListTotalCount={patientListTotalCount}
              patientListPage={safePage}
              patientListTotalPages={patientListTotalPages}
              patientListThumbsByPatient={patientListThumbs}
              caseSearch={caseSearch}
              showOnlyMine={showOnlyMine}
              casesLoading={casesLoading}
              copyPatients={copy.patients}
              copyAllRecords={copy.allRecords}
              copyMyPatientsOnly={copy.myPatientsOnly}
              copyLoadingSavedCases={copy.loadingSavedCases}
              pick={pick}
              translateOption={translateOption}
              displayVisitReference={displayVisitReference}
              formatDateTime={formatDateTime}
              onSearchChange={handlePatientListSearchChange}
              onShowOnlyMineChange={handlePatientScopeChange}
              onPageChange={handlePatientListPageChange}
              onOpenSavedCase={openSavedCase}
            />
          ) : selectedCase ? (
          <section className={`${docSurfaceClass} gap-4 p-5 lg:gap-5 lg:p-5`}>
            <SavedCaseOverview
              locale={locale}
              localeTag={localeTag}
              commonLoading={common.loading}
              commonNotAvailable={common.notAvailable}
              selectedCase={selectedCase}
              selectedPatientCases={selectedPatientCases}
              panelBusy={panelBusy}
              patientVisitGalleryBusy={patientVisitGalleryBusy}
              patientVisitGallery={patientVisitGallery}
              liveLesionPreviews={liveLesionPreviews}
              editDraftBusy={editDraftBusy}
              pick={pick}
              translateOption={translateOption}
              displayVisitReference={displayVisitReference}
              formatDateTime={formatDateTime}
              organismSummaryLabel={organismSummaryLabel}
              onStartEditDraft={startEditDraftFromSelectedCase}
              onStartFollowUpDraft={startFollowUpDraftFromSelectedCase}
              onToggleFavorite={toggleFavoriteCase}
              onOpenSavedCase={openSavedCase}
              onDeleteSavedCase={handleDeleteSavedCase}
              isFavoriteCase={isFavoriteCase}
              caseTitle={formatCaseTitle(selectedCase)}
            />

            <SavedCaseImageBoard
              locale={locale}
              commonLoading={common.loading}
              commonNotAvailable={common.notAvailable}
              panelBusy={panelBusy}
              selectedCaseImages={selectedCaseImages}
              semanticPromptInputMode={semanticPromptInputMode}
              semanticPromptInputOptions={semanticPromptInputOptions}
              semanticPromptBusyImageId={semanticPromptBusyImageId}
              semanticPromptReviews={semanticPromptReviews}
              semanticPromptErrors={semanticPromptErrors}
              semanticPromptOpenImageIds={semanticPromptOpenImageIds}
              liveLesionPreviews={liveLesionPreviews}
              lesionPromptDrafts={lesionPromptDrafts}
              lesionPromptSaved={lesionPromptSaved}
              lesionBoxBusyImageId={lesionBoxBusyImageId}
              representativeBusyImageId={representativeBusyImageId}
              pick={pick}
              translateOption={translateOption}
              formatSemanticScore={formatSemanticScore}
              onSemanticPromptInputModeChange={setSemanticPromptInputMode}
              onSetSavedRepresentative={handleSetSavedRepresentative}
              onReviewSemanticPrompts={handleReviewSemanticPrompts}
              onLesionPointerDown={handleLesionPointerDown}
              onLesionPointerMove={handleLesionPointerMove}
              onFinishLesionPointer={finishLesionPointer}
            />

            <SavedCasePreviewPanels
              locale={locale}
              commonLoading={common.loading}
              canRunRoiPreview={canRunRoiPreview}
              selectedCaseImageCount={selectedCaseImages.length}
              hasAnySavedLesionBox={hasAnySavedLesionBox}
              roiPreviewBusy={roiPreviewBusy}
              lesionPreviewBusy={lesionPreviewBusy}
              roiPreviewItems={roiPreviewItems}
              lesionPreviewItems={lesionPreviewItems}
              pick={pick}
              translateOption={translateOption}
              onRunRoiPreview={handleRunRoiPreview}
              onRunLesionPreview={handleRunLesionPreview}
            />

            <section className={docSectionClass}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Validation and AI Clinic", "寃利?諛?AI Clinic")}</div>}
                title={pick(locale, "Validation, artifacts, and retrieval support", "검증, 아티팩트, 검색 지원")}
                titleAs="h4"
                description={pick(
                  locale,
                  "Review model validation, artifacts, similar-patient retrieval, and differential support in a wider layout.",
                  "紐⑤뜽 寃利? ?꾪떚?⑺듃, ?좎궗 ?섏옄 寃?? differential support瑜??볦? ?덉씠?꾩썐?먯꽌 ?뺤씤?⑸땲??"
                )}
                aside={<span className={docSiteBadgeClass}>{`${selectedCaseImages.length} ${pick(locale, "images", "?대?吏")}`}</span>}
              />
              <div className={panelStackClass}>
                {validationPanelContent}
                {aiClinicPanelContent}
              </div>
            </section>
          </section>
          ) : (
          <article className={canvasDocumentClass}>
            <section className={canvasHeaderClass}>
              <div className={canvasHeaderGlowClass} />
              <div className={canvasHeaderContentClass}>
                <div className="grid gap-3">
                  <div className={`${canvasHeaderMetaRowClass} min-w-0 flex-nowrap overflow-x-auto pb-1`}>
                    <span className={canvasHeaderKickerClass}>{pick(locale, "Structured case canvas", "구조화 케이스 캔버스")}</span>
                    <span className={canvasHeaderMetaChipClass}>{selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}</span>
                    <span className={canvasHeaderMetaChipClass}>{draftStatusLabel}</span>
                    <span className={canvasHeaderMetaChipClass}>{resolvedVisitReferenceLabel}</span>
                  </div>
                </div>

                <div className={canvasSummaryGridClass}>
                  <div className={canvasSummaryCardClass}>
                    <span className={canvasSummaryLabelClass}>{pick(locale, "Patient", "환자")}</span>
                    <strong className={canvasSummaryValueClass}>
                      {draft.patient_id.trim() || pick(locale, "Waiting for patient ID", "환자 ID 대기 중")}
                    </strong>
                  </div>
                  <div className={canvasSummaryCardClass}>
                    <span className={canvasSummaryLabelClass}>{pick(locale, "Visit", "방문")}</span>
                    <strong className={canvasSummaryValueClass}>
                      {`${resolvedVisitReferenceLabel} · ${translateOption(locale, "visitStatus", draft.visit_status)}`}
                    </strong>
                  </div>
                  <div className={canvasSummaryCardClass}>
                    <span className={canvasSummaryLabelClass}>{pick(locale, "Organism", "원인균")}</span>
                    <strong className={canvasSummaryValueClass}>
                      {organismSummaryLabel(draft.culture_category, draft.culture_species, draft.additional_organisms, 1) ||
                        pick(locale, "Choose primary organism", "기본 원인균 선택")}
                    </strong>
                  </div>
                </div>
              </div>
            </section>

            <PatientVisitForm
              locale={locale}
              draft={draft}
              draftImagesCount={draftImages.length}
              notAvailableLabel={common.notAvailable}
              sexOptions={SEX_OPTIONS}
              contactLensOptions={CONTACT_LENS_OPTIONS}
              predisposingFactorOptions={PREDISPOSING_FACTOR_OPTIONS}
              visitStatusOptions={VISIT_STATUS_OPTIONS}
              cultureSpecies={CULTURE_SPECIES}
              speciesOptions={speciesOptions}
              pendingOrganism={pendingOrganism}
              pendingSpeciesOptions={pendingSpeciesOptions}
              showAdditionalOrganismForm={showAdditionalOrganismForm}
              intakeOrganisms={intakeOrganisms}
              primaryOrganismSummary={organismSummaryLabel(draft.culture_category, draft.culture_species, draft.additional_organisms, 2)}
              resolvedVisitReferenceLabel={resolvedVisitReferenceLabel}
              actualVisitDateLabel={actualVisitDateLabel}
              setDraft={setDraft}
              setPendingOrganism={setPendingOrganism}
              setShowAdditionalOrganismForm={setShowAdditionalOrganismForm}
              togglePredisposingFactor={togglePredisposingFactor}
              updatePrimaryOrganism={updatePrimaryOrganism}
              addAdditionalOrganism={addAdditionalOrganism}
              removeAdditionalOrganism={removeAdditionalOrganism}
              onCompleteIntake={handleCompleteIntake}
            />

            <ImageManagerPanel
              locale={locale}
              intakeCompleted={draft.intake_completed}
              resolvedVisitReferenceLabel={resolvedVisitReferenceLabel}
              whiteDraftImages={whiteDraftImages}
              fluoresceinDraftImages={fluoresceinDraftImages}
              draftLesionPromptBoxes={draftLesionPromptBoxes}
              whiteFileInputRef={whiteFileInputRef}
              fluoresceinFileInputRef={fluoresceinFileInputRef}
              openFilePicker={openFilePicker}
              appendFiles={appendFiles}
              handleDraftLesionPointerDown={handleDraftLesionPointerDown}
              handleDraftLesionPointerMove={handleDraftLesionPointerMove}
              finishDraftLesionPointer={finishDraftLesionPointer}
              removeDraftImage={removeDraftImage}
              setRepresentativeImage={setRepresentativeImage}
              onSaveCase={() => void handleSaveCase()}
              saveBusy={saveBusy}
              selectedSiteId={selectedSiteId}
            />
          </article>
          )}

          <aside className={workspacePanelClass}>
            {selectedCase ? (
              <div className={panelStackClass}>
                <ContributionHistoryPanel
                  locale={locale}
                  selectedCase={selectedCase}
                  canRunValidation={canRunValidation}
                  canContributeSelectedCase={canContributeSelectedCase}
                  hasValidationResult={Boolean(validationResult)}
                  researchRegistryEnabled={researchRegistryEnabled}
                  researchRegistryUserEnrolled={researchRegistryUserEnrolled}
                  researchRegistryBusy={researchRegistryBusy}
                  contributionBusy={contributionBusy}
                  contributionResult={contributionResult}
                  currentUserPublicAlias={user.public_alias ?? contributionResult?.stats.user_public_alias ?? null}
                  contributionLeaderboard={siteActivity?.contribution_leaderboard ?? contributionResult?.stats.leaderboard ?? null}
                  historyBusy={historyBusy}
                  caseHistory={caseHistory}
                  onJoinResearchRegistry={() => void handleJoinResearchRegistry()}
                  onIncludeResearchCase={() => void handleIncludeResearchCase()}
                  onExcludeResearchCase={() => void handleExcludeResearchCase()}
                  onContributeCase={() => void handleContributeCase()}
                  completionContent={completionContent}
                  formatProbability={formatProbability}
                  notAvailableLabel={common.notAvailable}
                />
              </div>
            ) : (
              isAuthoringCanvas ? (
                <div className={canvasSidebarClass}>
                  <section className={canvasSidebarCardClass}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <span className={canvasSidebarSectionLabelClass}>{pick(locale, "Draft state", "초안 상태")}</span>
                        <strong className="text-[1.1rem] font-semibold tracking-[-0.03em] text-ink">{draftStatusLabel}</strong>
                      </div>
                      <span className={canvasHeaderMetaChipClass}>{selectedSiteLabel ?? pick(locale, "No hospital", "병원 없음")}</span>
                    </div>
                    <div className={canvasSidebarMetricGridClass}>
                      <div className={canvasSidebarMetricCardClass}>
                        <strong className={canvasSidebarMetricValueClass}>{`${draftCompletionCount}/4`}</strong>
                        <span className={canvasSidebarMetricLabelClass}>{pick(locale, "sections", "섹션")}</span>
                      </div>
                      <div className={canvasSidebarMetricCardClass}>
                        <strong className={canvasSidebarMetricValueClass}>{draftImages.length}</strong>
                        <span className={canvasSidebarMetricLabelClass}>{pick(locale, "images", "이미지")}</span>
                      </div>
                      <div className={canvasSidebarMetricCardClass}>
                        <strong className={canvasSidebarMetricValueClass}>{draftRepresentativeCount}</strong>
                        <span className={canvasSidebarMetricLabelClass}>{pick(locale, "representative", "대표")}</span>
                      </div>
                      <div className={canvasSidebarMetricCardClass}>
                        <strong className={canvasSidebarMetricValueClass}>{draftLesionBoxCount}</strong>
                        <span className={canvasSidebarMetricLabelClass}>{pick(locale, "lesion boxes", "lesion box")}</span>
                      </div>
                    </div>
                    <div className={momentumTrackClass}>
                      <div className={momentumFillClass} style={{ width: `${draftCompletionPercent}%` }} />
                    </div>
                  </section>

                  <section className={canvasSidebarCardClass}>
                    <div className="grid gap-1">
                      <span className={canvasSidebarSectionLabelClass}>{pick(locale, "Next up", "다음 작업")}</span>
                      <p className="m-0 text-sm leading-6 text-muted">
                        {pick(
                          locale,
                          "Keep the right rail focused on what blocks submission instead of on hospital analytics.",
                          "우측 레일은 병원 분석보다 제출을 막는 항목에 집중합니다."
                        )}
                      </p>
                    </div>
                    <div className={canvasSidebarListClass}>
                      {draftPendingItems.length > 0 ? (
                        draftPendingItems.slice(0, 5).map((item) => (
                          <div key={item} className={canvasSidebarItemClass}>
                            {item}
                          </div>
                        ))
                      ) : (
                        <div className={canvasSidebarItemClass}>
                          {pick(locale, "All core draft checks are in place. Review the image board and submit when ready.", "핵심 초안 체크가 모두 완료되었습니다. 이미지 보드를 검토한 뒤 준비되면 제출하세요.")}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className={canvasSidebarCardClass}>
                    <div className="grid gap-1">
                      <span className={canvasSidebarSectionLabelClass}>{pick(locale, "Predisposing factors", "선행 인자")}</span>
                      <p className="m-0 text-sm leading-6 text-muted">
                        {pick(
                          locale,
                          "Selected visit factors stay visible here while you finish the draft.",
                          "선택한 방문 인자는 초안을 마무리하는 동안 여기에서 계속 보입니다."
                        )}
                      </p>
                    </div>
                    {selectedPredisposingFactorLabels.length > 0 ? (
                      <div className={organismChipRowClass}>
                        {selectedPredisposingFactorLabels.map((label) => (
                          <span
                            key={`draft-predisposing-${label}`}
                            className={predisposingChipClass}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className={canvasSidebarItemClass}>
                        {pick(
                          locale,
                          "No predisposing factor selected yet.",
                          "아직 선택된 선행 인자가 없습니다."
                        )}
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className={panelStackClass}>
                  <Card as="section" variant="panel" className="grid gap-4 p-5">
                    <SectionHeader
                      titleAs="h4"
                      title={pick(locale, "Selected hospital", "선택한 병원")}
                      aside={
                        <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-white/55 px-3 text-[0.78rem] font-medium text-muted dark:bg-white/4">
                          {selectedSiteLabel ?? pick(locale, "none", "없음")}
                        </span>
                      }
                    />
                    <MetricGrid columns={2}>
                      <MetricItem value={summary?.n_patients ?? 0} label={pick(locale, "patients", "환자")} />
                      <MetricItem value={summary?.n_visits ?? 0} label={pick(locale, "visits", "방문")} />
                      <MetricItem value={summary?.n_images ?? 0} label={pick(locale, "images", "이미지")} />
                      <MetricItem value={summary?.n_validation_runs ?? 0} label={pick(locale, "validations", "검증")} />
                    </MetricGrid>
                  </Card>
                </div>
              )
            )}
          </aside>
        </div>
      </section>

      {researchRegistryModalOpen ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <Card as="section" variant="panel" className="grid max-w-[560px] gap-4 p-6">
            <SectionHeader
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Research registry", "연구 레지스트리")}</div>}
              title={pick(locale, "Join once, then keep contribution automatic", "한 번 가입하고 자동 기여 흐름 사용")}
              titleAs="h3"
              description={pick(
                locale,
                "K-ERA keeps AI validation free. If you join the registry, de-identified cases from this site can be included for model improvement and multi-center research, with per-case opt-out remaining available.",
                "K-ERA는 AI 검증을 무료로 유지합니다. 레지스트리에 가입하면 이 기관의 비식별 케이스가 모델 개선과 다기관 연구에 포함될 수 있고, 각 케이스는 이후에도 개별 제외할 수 있습니다."
              )}
            />
            <Card as="div" variant="nested" className="grid gap-2 p-4">
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Original data ownership remains with the contributing institution. This step only enables research-registry participation for your account at the current site.",
                  "원본 데이터의 권리는 기여 기관에 남아 있습니다. 이 단계는 현재 병원에서 이 계정의 연구 레지스트리 참여만 활성화합니다."
                )}
              </p>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "You can still exclude any case later from the case-side registry panel.",
                  "이후에도 케이스별 레지스트리 패널에서 언제든 개별 제외할 수 있습니다."
                )}
              </p>
            </Card>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPendingResearchRegistryAutoInclude(false);
                  setResearchRegistryModalOpen(false);
                }}
              >
                {pick(locale, "Continue without joining", "가입 없이 계속")}
              </Button>
              <Button type="button" variant="primary" loading={researchRegistryBusy} onClick={() => void handleJoinResearchRegistry()}>
                {pick(locale, "Join research registry", "연구 레지스트리 가입")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {toast ? (
        <div className={workspaceToastClass(toast.tone)}>
          <strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong>
          <span>{toast.message}</span>
        </div>
      ) : null}
    </main>
  );
}

function caseTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue = caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function visitTimestamp(visitRecord: VisitRecord): number {
  const parsed = new Date(visitRecord.created_at ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}
