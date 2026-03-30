"use client";

import {
  startTransition,
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

import {
  LocaleToggle,
  pick,
  translateApiError,
  translateOption,
  translateRole,
  useI18n,
  type Locale,
} from "../lib/i18n";
import { AiClinicPanel } from "./case-workspace/ai-clinic-panel";
import { AiClinicResult } from "./case-workspace/ai-clinic-result";
import { CaseWorkspaceAuthoringCanvas } from "./case-workspace/case-workspace-authoring-canvas";
import { CaseWorkspaceLeftRail } from "./case-workspace/case-workspace-left-rail";
import { CaseWorkspaceReviewPanel } from "./case-workspace/case-workspace-review-panel";
import { CaseWorkspaceShell } from "./case-workspace/case-workspace-shell";
import { CompletionCard } from "./case-workspace/completion-card";
import { ContributionHistoryPanel } from "./case-workspace/contribution-history-panel";
import { ImageManagerPanel } from "./case-workspace/image-manager-panel";
import { MedsamArtifactBacklogPanel } from "./case-workspace/medsam-artifact-backlog-panel";
import { PatientVisitForm } from "./case-workspace/patient-visit-form";
import { PatientListBoard } from "./case-workspace/patient-list-board";
import { SavedCaseImageBoard } from "./case-workspace/saved-case-image-board";
import {
  SavedCaseOverview,
  SavedCaseSidebar,
} from "./case-workspace/saved-case-overview";
import { SavedCasePreviewPanels } from "./case-workspace/saved-case-preview-panels";
import type {
  AiClinicPreviewResponse,
  LesionBoxMap,
  LesionPreviewCard,
  LiveLesionPreviewMap,
  NormalizedBox,
  PatientListRow,
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
import { SectionHeader } from "./ui/section-header";
import { DesktopControlPlaneStatusBadge } from "./ui/desktop-control-plane-status-badge";
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
  workspaceUserBadgeClass,
  validationRailHeadClass,
  workspaceBrandActionsClass,
  workspaceBrandActionButtonClass,
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
import { filterVisibleSites, getSiteDisplayName } from "../lib/site-labels";
import {
  canUseDesktopTransport,
  prefetchDesktopVisitImages,
} from "../lib/desktop-transport";
import { type DesktopControlPlaneProbe } from "../lib/desktop-control-plane-status";
import { formatPublicAlias } from "../lib/public-alias";
import {
  type CaseHistoryResponse,
  type CaseValidationCompareResponse,
  type CaseContributionResponse,
  backfillMedsamArtifacts,
  buildImageContentUrl,
  buildImagePreviewUrl,
  type ImageRecord,
  type OrganismRecord,
  fetchMedsamArtifactItems,
  fetchMedsamArtifactStatus,
  fetchPatientIdLookup,
  fetchSiteSummaryCounts,
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
  invalidateDesktopCaseWorkspaceCaches,
  fetchPatientListPage,
  fetchLiveLesionPreviewJob,
  fetchImageSemanticPromptScores,
  fetchVisits,
  fetchValidationArtifactBlob,
  fetchImages,
  fetchSiteActivity,
  fetchSiteModelVersions,
  fetchSiteValidations,
  prewarmPatientListPage,
  type AuthUser,
  type CaseSummaryRecord,
  type CaseValidationResponse,
  type LiveLesionPreviewJobResponse,
  type MedsamArtifactItemsResponse,
  type MedsamArtifactStatusKey,
  type MedsamArtifactStatusSummary,
  type ModelVersionRecord,
  type PatientIdLookupResponse,
  type SemanticPromptInputMode,
  type SiteRecord,
  type SiteSummary,
  type VisitRecord,
  mergeSiteSummaryCounts,
  runSiteValidation,
  setRepresentativeImage as setRepresentativeImageOnServer,
  startLiveLesionPreview,
  updatePatient,
  updateVisit,
  runCaseAiClinic,
  runCaseContribution,
  runCaseValidation,
  runCaseValidationCompare,
  updateCaseResearchRegistry,
  updateImageLesionBox,
  uploadImage,
} from "../lib/api";
import { waitForSiteJobSettlement } from "../lib/site-job-runtime";

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
const MAX_MODEL_COMPARE_SELECTIONS = 8;
const PATIENT_LIST_PAGE_SIZE = 25;
const SAVED_CASE_IMAGE_PREVIEW_MAX_SIDE = 960;
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
    "Beauveria bassiana",
    "Other",
  ],
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

function toSavedCaseImagePreview(siteId: string, token: string, image: ImageRecord): SavedImagePreview {
  return {
    ...image,
    content_url: image.content_url ?? buildImageContentUrl(siteId, image.image_id, token),
    preview_url:
      ("preview_url" in image && typeof image.preview_url === "string" && image.preview_url.trim().length > 0
        ? image.preview_url
        : null) ??
      buildImagePreviewUrl(siteId, image.image_id, token, {
        maxSide: SAVED_CASE_IMAGE_PREVIEW_MAX_SIDE,
      }),
  };
}

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

type WorkspaceHistoryEntry = {
  scope: "case-workspace";
  version: 1;
  rail_view: "cases" | "patients";
  selected_case_id: string | null;
};

const WORKSPACE_HISTORY_KEY = "__keraWorkspace";

function buildWorkspaceHistoryEntry(
  railView: "cases" | "patients",
  selectedCaseId: string | null,
): WorkspaceHistoryEntry {
  return {
    scope: "case-workspace",
    version: 1,
    rail_view: railView,
    selected_case_id: selectedCaseId,
  };
}

function readWorkspaceHistoryEntry(
  state: unknown,
): WorkspaceHistoryEntry | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const rawEntry = (state as Record<string, unknown>)[WORKSPACE_HISTORY_KEY];
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }
  const entry = rawEntry as Record<string, unknown>;
  const scope = entry.scope;
  const version = entry.version;
  const railView = entry.rail_view;
  const selectedCaseId = entry.selected_case_id;

  if (scope !== "case-workspace" || version !== 1) {
    return null;
  }
  if (railView !== "cases" && railView !== "patients") {
    return null;
  }
  if (selectedCaseId !== null && typeof selectedCaseId !== "string") {
    return null;
  }
  return {
    scope: "case-workspace",
    version: 1,
    rail_view: railView,
    selected_case_id: selectedCaseId,
  };
}

function isSameWorkspaceHistoryEntry(
  left: WorkspaceHistoryEntry | null,
  right: WorkspaceHistoryEntry | null,
): boolean {
  return (
    left?.rail_view === right?.rail_view &&
    left?.selected_case_id === right?.selected_case_id
  );
}

function writeWorkspaceHistoryEntry(
  entry: WorkspaceHistoryEntry,
  mode: "push" | "replace",
) {
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

function hasUsableLesionPromptBox(
  box: NormalizedBox | null | undefined,
): box is NormalizedBox {
  return Boolean(
    box &&
      box.x1 - box.x0 >= 0.01 &&
      box.y1 - box.y0 >= 0.01,
  );
}

function organismKey(
  organism: Pick<OrganismRecord, "culture_category" | "culture_species">,
): string {
  return `${organism.culture_category.trim().toLowerCase()}::${organism.culture_species.trim().toLowerCase()}`;
}

function normalizeAdditionalOrganisms(
  primaryCategory: string,
  primarySpecies: string,
  organisms: OrganismRecord[] | undefined,
): OrganismRecord[] {
  const primaryKey = organismKey({
    culture_category: primaryCategory,
    culture_species: primarySpecies,
  });
  const seen = new Set<string>([primaryKey]);
  const normalized: OrganismRecord[] = [];
  for (const organism of organisms ?? []) {
    const culture_category = String(organism?.culture_category ?? "")
      .trim()
      .toLowerCase();
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
  additionalOrganisms: OrganismRecord[] | undefined,
): OrganismRecord[] {
  const primarySpecies = cultureSpecies.trim();
  if (!primarySpecies) {
    return normalizeAdditionalOrganisms(
      cultureCategory,
      cultureSpecies,
      additionalOrganisms,
    );
  }
  return [
    {
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: primarySpecies,
    },
    ...normalizeAdditionalOrganisms(
      cultureCategory,
      cultureSpecies,
      additionalOrganisms,
    ),
  ];
}

function organismSummaryLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
  maxVisibleSpecies = 1,
): string {
  const organisms = listOrganisms(
    cultureCategory,
    cultureSpecies,
    additionalOrganisms,
  );
  if (!organisms.length) {
    return "";
  }
  if (organisms.length <= maxVisibleSpecies) {
    return organisms.map((organism) => organism.culture_species).join(" / ");
  }
  const visible = organisms
    .slice(0, Math.max(1, maxVisibleSpecies))
    .map((organism) => organism.culture_species)
    .join(" / ");
  return `${visible} + ${organisms.length - Math.max(1, maxVisibleSpecies)}`;
}

function buildFallbackSiteSummary(
  siteId: string,
  caseRecords: CaseSummaryRecord[],
): SiteSummary {
  const patientIds = new Set(
    caseRecords
      .map((record) => String(record.patient_id || "").trim())
      .filter((value) => value.length > 0),
  );
  return {
    site_id: siteId,
    n_patients: patientIds.size,
    n_visits: caseRecords.length,
    n_images: caseRecords.reduce(
      (sum, record) => sum + Math.max(0, Number(record.image_count || 0)),
      0,
    ),
    n_active_visits: caseRecords.reduce(
      (sum, record) => sum + (record.active_stage ? 1 : 0),
      0,
    ),
    n_fungal_visits: caseRecords.reduce(
      (sum, record) =>
        sum + (String(record.culture_category || "").trim().toLowerCase() === "fungal" ? 1 : 0),
      0,
    ),
    n_bacterial_visits: caseRecords.reduce(
      (sum, record) =>
        sum + (String(record.culture_category || "").trim().toLowerCase() === "bacterial" ? 1 : 0),
      0,
    ),
    n_validation_runs: 0,
    latest_validation: null,
  };
}

function mergeRailSummaryCategoryCounts(
  summary: SiteSummary | null,
  derivedSummary: SiteSummary | null,
): SiteSummary | null {
  if (!summary) {
    return derivedSummary;
  }
  if (!derivedSummary) {
    return summary;
  }
  const summaryFungal = summary.n_fungal_visits;
  const summaryBacterial = summary.n_bacterial_visits;
  const derivedFungal = derivedSummary.n_fungal_visits ?? 0;
  const derivedBacterial = derivedSummary.n_bacterial_visits ?? 0;
  const derivedTotal = derivedFungal + derivedBacterial;
  const summaryHasExplicitCategoryCounts =
    typeof summaryFungal === "number" && typeof summaryBacterial === "number";
  const summaryCategoryTotal = (summaryFungal ?? 0) + (summaryBacterial ?? 0);

  if (
    summaryHasExplicitCategoryCounts &&
    (summaryCategoryTotal > 0 || derivedTotal === 0)
  ) {
    return summary;
  }

  return {
    ...summary,
    n_fungal_visits: derivedFungal,
    n_bacterial_visits: derivedBacterial,
  };
}

function organismDetailLabel(
  cultureCategory: string,
  cultureSpecies: string,
  additionalOrganisms: OrganismRecord[] | undefined,
): string {
  return listOrganisms(cultureCategory, cultureSpecies, additionalOrganisms)
    .map((organism) => organism.culture_species)
    .join(" / ");
}

function formatProbability(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

function formatSemanticScore(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return emptyLabel;
  }
  return value.toFixed(3);
}

function formatImageQualityScore(
  value: number | null | undefined,
  emptyLabel = "n/a",
): string {
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

function modelVersionCreatedAtTimestamp(
  value: string | null | undefined,
): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSelectableCompareModelVersion(
  modelVersion: ModelVersionRecord,
): boolean {
  const versionId = String(modelVersion.version_id || "").trim();
  const normalizedStage = String(modelVersion.stage || "")
    .trim()
    .toLowerCase();
  return (
    versionId.length > 0 &&
    modelVersion.ready !== false &&
    normalizedStage !== "analysis"
  );
}

function sortCompareModelVersions(
  modelVersions: ModelVersionRecord[],
): ModelVersionRecord[] {
  return [...modelVersions].sort(
    (left, right) =>
      modelVersionCreatedAtTimestamp(right.created_at) -
      modelVersionCreatedAtTimestamp(left.created_at),
  );
}

function defaultModelCompareSelection(
  modelVersions: ModelVersionRecord[],
): string[] {
  const selected: string[] = [];
  const seenArchitectures = new Set<string>();
  for (const modelVersion of sortCompareModelVersions(modelVersions)) {
    if (!isSelectableCompareModelVersion(modelVersion)) {
      continue;
    }
    const architecture =
      String(modelVersion.architecture || "")
        .trim()
        .toLowerCase() || modelVersion.version_id;
    if (seenArchitectures.has(architecture)) {
      continue;
    }
    seenArchitectures.add(architecture);
    selected.push(modelVersion.version_id);
    if (selected.length >= MAX_MODEL_COMPARE_SELECTIONS) {
      break;
    }
  }
  return selected;
}

function predictedClassConfidence(
  predictedLabel: string | null | undefined,
  probability: number | null | undefined,
): number | null {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return null;
  }
  if (predictedLabel === "bacterial") {
    return 1 - probability;
  }
  return probability;
}

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

function followUpReferenceFromPatientLookup(
  patientLookup: PatientIdLookupResponse | null,
): string | null {
  if (!patientLookup?.exists || Number(patientLookup.visit_count || 0) <= 0) {
    return null;
  }
  const latestVisitDate = String(patientLookup.latest_visit_date ?? "").trim();
  const followUpMatch = latestVisitDate.match(FOLLOW_UP_VISIT_PATTERN);
  const nextFollowUpNumber = followUpMatch ? Number(followUpMatch[1]) || 1 : 1;
  return `FU #${String(nextFollowUpNumber + (followUpMatch ? 1 : 0))}`;
}

function resolveDraftVisitReference(
  draft: DraftState,
  patientLookup: PatientIdLookupResponse | null,
): string {
  const requestedVisitReference = buildVisitReference(draft);
  if (!/^initial$/i.test(requestedVisitReference)) {
    return requestedVisitReference;
  }
  return (
    followUpReferenceFromPatientLookup(patientLookup) ?? requestedVisitReference
  );
}

const FOLLOW_UP_VISIT_PATTERN = /^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$/i;

function displayVisitReference(
  locale: "en" | "ko",
  visitReference: string,
): string {
  const normalized = String(visitReference ?? "").trim();
  if (!normalized) {
    return normalized;
  }
  if (/^(initial|초진|珥덉쭊)$/i.test(normalized)) {
    return pick(locale, "Initial", "초진");
  }
  const followUpMatch = normalized.match(FOLLOW_UP_VISIT_PATTERN);
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
    draft.additional_organisms,
  );
  const visitReference = String(recoveredDraft.visit_date ?? "").trim();
  const followUpMatch = visitReference.match(FOLLOW_UP_VISIT_PATTERN);
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
      String(recoveredDraft.actual_visit_date ?? "").trim() ||
      String(recoveredDraft.visit_date ?? "").trim(),
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

function visitPhaseCopy(locale: "en" | "ko", isInitialVisit: boolean): string {
  return isInitialVisit
    ? pick(locale, "Initial", "초진")
    : pick(locale, "Follow-up", "재진");
}

function computeNextFollowUpNumber(visits: VisitRecord[]): number {
  let maxFollowUp = 0;
  for (const visit of visits) {
    const match = String(visit.visit_date ?? "").match(FOLLOW_UP_VISIT_PATTERN);
    if (!match) {
      continue;
    }
    maxFollowUp = Math.max(maxFollowUp, Number(match[1]) || 0);
  }
  return maxFollowUp + 1;
}

function yieldUploadLoopToBrowser(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

const DESKTOP_SAVE_UPLOAD_CONCURRENCY = 2;

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
      if (currentIndex < items.length - 1) {
        await yieldUploadLoopToBrowser();
      }
    }
  };

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, () => runWorker()),
  );
  return results;
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
  const [contributionBusy, setContributionBusy] = useState(false);
  const [researchRegistryBusy, setResearchRegistryBusy] = useState(false);
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
  const [patientListPage, setPatientListPage] = useState(1);
  const [patientListRows, setPatientListRows] = useState<PatientListRow[]>([]);
  const [patientListTotalCount, setPatientListTotalCount] = useState(0);
  const [patientListTotalPages, setPatientListTotalPages] = useState(1);
  const [patientListLoading, setPatientListLoading] = useState(false);
  const [fallbackRailSummary, setFallbackRailSummary] =
    useState<SiteSummary | null>(null);
  const [patientIdLookup, setPatientIdLookup] =
    useState<PatientIdLookupResponse | null>(null);
  const [patientIdLookupBusy, setPatientIdLookupBusy] = useState(false);
  const [patientIdLookupError, setPatientIdLookupError] = useState<
    string | null
  >(null);
  const [medsamArtifactPanelEnabled, setMedsamArtifactPanelEnabled] =
    useState(false);
  const [medsamArtifactStatus, setMedsamArtifactStatus] =
    useState<MedsamArtifactStatusSummary | null>(null);
  const [medsamArtifactStatusBusy, setMedsamArtifactStatusBusy] =
    useState(false);
  const [medsamArtifactBackfillBusy, setMedsamArtifactBackfillBusy] =
    useState(false);
  const [medsamArtifactActiveStatus, setMedsamArtifactActiveStatus] =
    useState<MedsamArtifactStatusKey | null>(null);
  const [medsamArtifactScope, setMedsamArtifactScope] = useState<
    "patient" | "visit" | "image"
  >("visit");
  const [medsamArtifactItems, setMedsamArtifactItems] = useState<
    MedsamArtifactItemsResponse["items"]
  >([]);
  const [medsamArtifactItemsBusy, setMedsamArtifactItemsBusy] = useState(false);
  const [medsamArtifactPage, setMedsamArtifactPage] = useState(1);
  const [medsamArtifactTotalCount, setMedsamArtifactTotalCount] = useState(0);
  const [medsamArtifactTotalPages, setMedsamArtifactTotalPages] = useState(1);
  const [toast, setToastState] = useState<ToastState>(null);
  const [toastHistory, setToastHistory] = useState<ToastLogEntry[]>([]);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [caseImageCacheVersion, setCaseImageCacheVersion] = useState(0);
  const whiteFileInputRef = useRef<HTMLInputElement | null>(null);
  const fluoresceinFileInputRef = useRef<HTMLInputElement | null>(null);
  const alertsPanelRef = useRef<HTMLDivElement | null>(null);
  const railListSectionRef = useRef<HTMLElement | null>(null);
  const draftLesionDrawStateRef = useRef<{
    imageId: string;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const workspaceHistoryRef = useRef<WorkspaceHistoryEntry | null>(null);
  const workspacePopNavigationRef = useRef(false);
  const workspaceOpenedAtRef = useRef<number | null>(null);
  const siteLabelLoggedRef = useRef<string | null>(null);
  const patientListLoggedSiteIdRef = useRef<string | null>(null);
  const caseOpenStartedAtRef = useRef<number | null>(null);
  const caseOpenCaseIdRef = useRef<string | null>(null);
  const caseImagesLoggedCaseIdRef = useRef<string | null>(null);
  const patientListThumbs = useMemo(
    () => buildPatientListThumbMap(patientListRows),
    [patientListRows],
  );
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
    createDraft,
    normalizeRecoveredDraft,
    hasDraftContent,
    draftStorageKey,
    favoriteStorageKey,
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
  const onArtifactsChanged = useCallback(() => {
    if (
      !medsamArtifactPanelEnabled ||
      !medsamArtifactStatus ||
      !selectedSiteId
    ) {
      return;
    }
    void fetchMedsamArtifactStatus(selectedSiteId, token, {
      mine: showOnlyMine,
    })
      .then((nextStatus) => setMedsamArtifactStatus(nextStatus))
      .catch(() => {});
  }, [
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    selectedSiteId,
    token,
    showOnlyMine,
  ]);
  useEffect(() => {
    setMedsamArtifactStatus(null);
    setMedsamArtifactStatusBusy(false);
    setMedsamArtifactBackfillBusy(false);
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactItemsBusy(false);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }, [selectedSiteId, showOnlyMine]);
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
    toNormalizedBox,
    normalizeBox,
    clamp01,
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

  const whiteDraftImages = draftImages.filter(
    (image) => image.view === "white",
  );
  const fluoresceinDraftImages = draftImages.filter(
    (image) => image.view === "fluorescein",
  );

  useEffect(() => {
    invalidateCaseWorkspaceImageCaches();
  }, [invalidateCaseWorkspaceImageCaches, selectedSiteId]);

  useEffect(() => {
    siteLabelLoggedRef.current = null;
    patientListLoggedSiteIdRef.current = null;
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
          ? (cases.find(
              (item) => item.case_id === historyEntry.selected_case_id,
            ) ?? null)
          : null,
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

    const nextEntry = buildWorkspaceHistoryEntry(
      railView,
      selectedCase?.case_id ?? null,
    );
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
        const backstopEntry = buildWorkspaceHistoryEntry(
          "patients",
          nextEntry.selected_case_id,
        );
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

    if (
      nextEntry.selected_case_id &&
      workspaceHistoryRef.current.rail_view === "cases" &&
      !workspaceHistoryRef.current.selected_case_id
    ) {
      const backstopEntry = buildWorkspaceHistoryEntry(
        "patients",
        nextEntry.selected_case_id,
      );
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
    railListSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [railView]);

  function replaceDraftImagesAndBoxes(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    setDraftLesionPromptBoxes((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([draftId]) => nextIds.has(draftId)),
      ),
    );
    replaceDraftImages(nextImages);
  }

  async function startFollowUpDraftFromSelectedCase() {
    if (!selectedCase) {
      return;
    }

    setEditingCaseContext(null);
    replaceDraftImagesAndBoxes([]);
    setDraftLesionPromptBoxes({});
    clearDraftStorage();
    resetAnalysisState();
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPanelOpen(true);
    setRailView("cases");
    const selectedFollowUpMatch = String(selectedCase.visit_date ?? "").match(
      FOLLOW_UP_VISIT_PATTERN,
    );
    const fallbackFollowUpNumber = String(
      (selectedFollowUpMatch ? Number(selectedFollowUpMatch[1]) || 0 : 0) + 1,
    );

    const applyFallbackDraft = (followUpNumber: string) => {
      setDraft((current) => ({
        ...current,
        patient_id: selectedCase.patient_id,
        sex: selectedCase.sex || current.sex,
        age: String(selectedCase.age ?? current.age),
        chart_alias: selectedCase.chart_alias ?? current.chart_alias,
        local_case_code:
          selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category:
          selectedCase.culture_category || current.culture_category,
        culture_species:
          selectedCase.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          selectedCase.culture_category,
          selectedCase.culture_species,
          selectedCase.additional_organisms,
        ),
        contact_lens_use:
          selectedCase.contact_lens_use || current.contact_lens_use,
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
          (CULTURE_SPECIES[selectedCase.culture_category || "bacterial"]?.[0] ??
            ""),
      });
      setShowAdditionalOrganismForm(false);
    };

    if (!selectedSiteId) {
      applyFallbackDraft(fallbackFollowUpNumber);
      return;
    }

    try {
      const visits = await fetchVisits(
        selectedSiteId,
        token,
        selectedCase.patient_id,
      );
      const nextFollowUpNumber = String(computeNextFollowUpNumber(visits));
      const latestVisit =
        [...visits].sort(
          (left, right) => visitTimestamp(right) - visitTimestamp(left),
        )[0] ?? null;
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
        local_case_code:
          selectedCase.local_case_code ?? current.local_case_code,
        actual_visit_date: "",
        culture_category:
          latestVisit.culture_category ||
          selectedCase.culture_category ||
          current.culture_category,
        culture_species:
          latestVisit.culture_species ||
          selectedCase.culture_species ||
          current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          latestVisit.culture_category || selectedCase.culture_category,
          latestVisit.culture_species || selectedCase.culture_species,
          latestVisit.additional_organisms ?? selectedCase.additional_organisms,
        ),
        contact_lens_use:
          latestVisit.contact_lens_use ||
          selectedCase.contact_lens_use ||
          current.contact_lens_use,
        visit_status:
          latestVisit.visit_status ||
          selectedCase.visit_status ||
          current.visit_status,
        is_initial_visit: false,
        follow_up_number: nextFollowUpNumber,
        predisposing_factor:
          latestVisit.predisposing_factor ?? current.predisposing_factor,
        other_history: latestVisit.other_history ?? current.other_history,
        intake_completed: true,
      }));
      setPendingOrganism({
        culture_category:
          latestVisit.culture_category ||
          selectedCase.culture_category ||
          "bacterial",
        culture_species:
          latestVisit.additional_organisms?.[0]?.culture_species ||
          latestVisit.culture_species ||
          selectedCase.culture_species ||
          (CULTURE_SPECIES[
            latestVisit.culture_category ||
              selectedCase.culture_category ||
              "bacterial"
          ]?.[0] ??
            ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      applyFallbackDraft(fallbackFollowUpNumber);
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to prepare the next follow-up draft for this patient.",
            "???섏옄???ㅼ쓬 ?ъ쭊 珥덉븞??以鍮꾪븯吏 紐삵뻽?듬땲??",
          ),
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
          fetchImages(
            selectedSiteId,
            token,
            caseToEdit.patient_id,
            caseToEdit.visit_date,
          ),
          fetchVisits(selectedSiteId, token, caseToEdit.patient_id),
        ]);
        selectedVisit =
          savedVisits.find(
            (visit) => visit.visit_date === caseToEdit.visit_date,
          ) ?? null;
        nextDraftImages = await Promise.all(
          savedImages.map(async (image) => {
            const blob = await fetchImageBlob(
              selectedSiteId,
              image.image_id,
              token,
            );
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
            const file = new File([blob], `${image.image_id}.${extension}`, {
              type: mediaType,
            });
            const draftId = createDraftId();
            nextDraftBoxes[draftId] =
              image.lesion_prompt_box &&
              typeof image.lesion_prompt_box === "object"
                ? normalizeBox(image.lesion_prompt_box)
                : null;
            return {
              draft_id: draftId,
              file,
              preview_url: URL.createObjectURL(blob),
              view: image.view,
              is_representative: image.is_representative,
            };
          }),
        );
      }

      clearDraftStorage();
      resetAnalysisState();
      setPanelOpen(true);
      setRailView("cases");
      setEditingCaseContext({
        patient_id: caseToEdit.patient_id,
        visit_date: caseToEdit.visit_date,
        created_at: caseToEdit.created_at,
        created_by_user_id: caseToEdit.created_by_user_id,
      });
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
        culture_category:
          caseToEdit.culture_category || current.culture_category,
        culture_species: caseToEdit.culture_species || current.culture_species,
        additional_organisms: normalizeAdditionalOrganisms(
          caseToEdit.culture_category,
          caseToEdit.culture_species,
          selectedVisit?.additional_organisms ??
            caseToEdit.additional_organisms,
        ),
        contact_lens_use:
          selectedVisit?.contact_lens_use ||
          caseToEdit.contact_lens_use ||
          current.contact_lens_use,
        visit_status:
          selectedVisit?.visit_status ||
          caseToEdit.visit_status ||
          current.visit_status,
        is_initial_visit: /^initial$/i.test(caseToEdit.visit_date),
        follow_up_number: (() => {
          const followUpMatch = String(caseToEdit.visit_date ?? "").match(
            FOLLOW_UP_VISIT_PATTERN,
          );
          return followUpMatch
            ? String(Number(followUpMatch[1]) || 1)
            : current.follow_up_number;
        })(),
        predisposing_factor:
          selectedVisit?.predisposing_factor ?? current.predisposing_factor,
        other_history: selectedVisit?.other_history ?? current.other_history,
        intake_completed: false,
      }));
      setPendingOrganism({
        culture_category: caseToEdit.culture_category || "bacterial",
        culture_species:
          caseToEdit.additional_organisms?.[0]?.culture_species ||
          caseToEdit.culture_species ||
          (CULTURE_SPECIES[caseToEdit.culture_category || "bacterial"]?.[0] ??
            ""),
      });
      setShowAdditionalOrganismForm(false);
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to open this saved case in edit mode.",
            "?????耳?댁뒪瑜??섏젙 紐⑤뱶濡??댁? 紐삵뻽?듬땲??",
          ),
        ),
      });
    } finally {
      setEditDraftBusy(false);
    }
  }

  function resetDraft() {
    setRailView("cases");
    setEditingCaseContext(null);
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
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }
    resetDraft();
    setPanelOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handlePatientListSearchChange(value: string) {
    setCaseSearch(value);
    setPatientListPage(1);
  }

  function handleOpenPatientList() {
    setCaseSearch("");
    setPatientListPage(1);
    setRailView("patients");
  }

  function handleOpenLatestAutosavedDraft() {
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setPanelOpen(true);
    setRailView("cases");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handlePatientScopeChange(nextValue: boolean) {
    setShowOnlyMine(nextValue);
    setPatientListPage(1);
  }

  function handlePatientListPageChange(nextPage: number) {
    setPatientListPage(nextPage);
  }

  function resetMedsamArtifactBacklogState() {
    setMedsamArtifactStatus(null);
    setMedsamArtifactStatusBusy(false);
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactItemsBusy(false);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }

  async function handleEnableMedsamArtifactPanel() {
    resetMedsamArtifactBacklogState();
    setMedsamArtifactPanelEnabled(true);
    await handleRefreshMedsamArtifactStatus(true);
  }

  function handleDisableMedsamArtifactPanel() {
    setMedsamArtifactPanelEnabled(false);
    setMedsamArtifactBackfillBusy(false);
    resetMedsamArtifactBacklogState();
  }

  async function handleRefreshMedsamArtifactStatus(refresh = true) {
    if (!selectedSiteId) {
      return;
    }
    setMedsamArtifactStatusBusy(true);
    try {
      const nextStatus = await fetchMedsamArtifactStatus(
        selectedSiteId,
        token,
        {
          mine: showOnlyMine,
          refresh,
        },
      );
      setMedsamArtifactStatus(nextStatus);
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to load artifact backlog.",
            "아티팩트 백로그를 불러오지 못했습니다.",
          ),
        ),
      });
    } finally {
      setMedsamArtifactStatusBusy(false);
    }
  }

  function handleOpenMedsamArtifactBacklog(status: MedsamArtifactStatusKey) {
    if (!medsamArtifactPanelEnabled) {
      return;
    }
    if (medsamArtifactActiveStatus === status) {
      handleCloseMedsamArtifactBacklog();
      return;
    }
    setMedsamArtifactActiveStatus(status);
    setMedsamArtifactPage(1);
  }

  function handleCloseMedsamArtifactBacklog() {
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }

  function handleMedsamArtifactScopeChange(
    scope: "patient" | "visit" | "image",
  ) {
    setMedsamArtifactScope(scope);
    setMedsamArtifactPage(1);
  }

  function handleMedsamArtifactPageChange(nextPage: number) {
    setMedsamArtifactPage(nextPage);
  }

  async function handleBackfillMedsamArtifacts() {
    if (!selectedSiteId) {
      return;
    }
    setMedsamArtifactBackfillBusy(true);
    try {
      await backfillMedsamArtifacts(selectedSiteId, token, {
        mine: showOnlyMine,
        refresh_cache: true,
      });
      await handleRefreshMedsamArtifactStatus(true);
      setToast({
        tone: "success",
        message: pick(
          locale,
          "MedSAM artifact backfill started in the background.",
          "MedSAM 아티팩트 백필이 백그라운드에서 시작되었습니다.",
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to start MedSAM artifact backfill.",
            "MedSAM 아티팩트 백필을 시작하지 못했습니다.",
          ),
        ),
      });
    } finally {
      setMedsamArtifactBackfillBusy(false);
    }
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

  function openSavedCase(
    caseRecord: CaseSummaryRecord,
    nextView: "cases" | "patients" = "cases",
  ) {
    if (desktopFastMode) {
      caseOpenStartedAtRef.current = performance.now();
      caseOpenCaseIdRef.current = caseRecord.case_id;
      caseImagesLoggedCaseIdRef.current = null;
      if (WORKSPACE_TIMING_LOGS) {
        console.info("[kera-fast-path] case-open", {
          case_id: caseRecord.case_id,
          patient_id: caseRecord.patient_id,
          visit_date: caseRecord.visit_date,
        });
      }
    }
    setCases((current) => {
      if (current.some((item) => item.case_id === caseRecord.case_id)) {
        return current;
      }
      return [caseRecord, ...current];
    });
    setSelectedCase(caseRecord);
    setSelectedPatientCases(
      buildKnownPatientTimeline(cases, caseRecord.patient_id, caseRecord),
    );
    setPanelOpen(true);
    setRailView(nextView);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function handleOpenImageTextSearchResult(
    patientId: string,
    visitDate: string,
  ) {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCase });
      return;
    }

    const findMatchingCase = (items: CaseSummaryRecord[]) =>
      items.find(
        (item) =>
          item.patient_id === patientId && item.visit_date === visitDate,
      ) ?? null;

    const cachedMatch = findMatchingCase(cases);
    if (cachedMatch) {
      openSavedCase(cachedMatch, "cases");
      return;
    }

    try {
      const nextCases = await fetchCases(selectedSiteId, token, {
        mine: showOnlyMine,
      });
      setCases(nextCases);
      const refreshedMatch = findMatchingCase(nextCases);
      if (refreshedMatch) {
        openSavedCase(refreshedMatch, "cases");
        return;
      }
      setToast({
        tone: "error",
        message: pick(
          locale,
          `Could not open ${patientId} / ${displayVisitReference(locale, visitDate)} from the image search results.`,
          `이미지 검색 결과의 ${patientId} / ${displayVisitReference(locale, visitDate)} 케이스를 열 수 없습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to refresh the case list for this search result.",
            "검색 결과용 케이스 목록을 다시 불러오지 못했습니다.",
          ),
        ),
      });
    }
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

  function applyResearchRegistryStatusToLocalCase(
    patientId: string,
    visitDate: string,
    updates: {
      research_registry_status:
        | "analysis_only"
        | "candidate"
        | "included"
        | "excluded";
      research_registry_updated_at?: string | null;
      research_registry_updated_by?: string | null;
      research_registry_source?: string | null;
    },
  ) {
    setCases((current) =>
      current.map((item) =>
        item.patient_id === patientId && item.visit_date === visitDate
          ? { ...item, ...updates }
          : item,
      ),
    );
    setSelectedCase((current) =>
      current &&
      current.patient_id === patientId &&
      current.visit_date === visitDate
        ? { ...current, ...updates }
        : current,
    );
    setSelectedPatientCases((current) =>
      current.map((item) =>
        item.patient_id === patientId && item.visit_date === visitDate
          ? { ...item, ...updates }
          : item,
      ),
    );
  }

  async function includeCaseInResearchRegistry(
    patientId: string,
    visitDate: string,
    source: string,
    successMessage?: string,
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
    successMessage?: string,
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
    const samePatientCases = cases.filter(
      (item) => item.patient_id === caseRecord.patient_id,
    );
    const confirmMessage =
      samePatientCases.length <= 1
        ? pick(
            locale,
            `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?\n\nThis is the only visit for the patient, so the patient record will also be removed.`,
            `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??\n\n???섏옄??留덉?留?諛⑸Ц?대씪 ?섏옄 湲곕줉???④퍡 ??젣?⑸땲??`,
          )
        : pick(
            locale,
            `Delete ${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)}?`,
            `${caseRecord.patient_id} / ${displayVisitReference(locale, caseRecord.visit_date)} 諛⑸Ц????젣?좉퉴??`,
          );
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const deleted = await deleteVisit(
        selectedSiteId,
        token,
        caseRecord.patient_id,
        caseRecord.visit_date,
      );
      invalidateCaseWorkspaceImageCaches();
      const nextCases = await fetchCases(selectedSiteId, token, {
        mine: showOnlyMine,
      });
      setCases(nextCases);

      if (deleted.deleted_patient) {
        setSelectedCase(null);
        setSelectedPatientCases([]);
        setSelectedCaseImages([]);
        setPatientVisitGallery({});
        resetAnalysisState();
        setRailView("patients");
        setToast({
          tone: "success",
          message: copy.patientDeleted(caseRecord.patient_id),
        });
        return;
      }

      const preservedCurrentCase =
        selectedCase && selectedCase.case_id !== caseRecord.case_id
          ? (nextCases.find((item) => item.case_id === selectedCase.case_id) ??
            null)
          : null;
      const remainingSamePatientCase =
        nextCases
          .filter((item) => item.patient_id === caseRecord.patient_id)
          .sort(
            (left, right) => caseTimestamp(right) - caseTimestamp(left),
          )[0] ?? null;
      const nextSelectedCase =
        preservedCurrentCase ??
        remainingSamePatientCase ??
        nextCases[0] ??
        null;
      setSelectedCase(nextSelectedCase);
      setSelectedPatientCases(
        nextSelectedCase
          ? buildKnownPatientTimeline(
              nextCases,
              nextSelectedCase.patient_id,
              nextSelectedCase,
            )
          : [],
      );
      setToast({
        tone: "success",
        message: copy.visitDeleted(
          caseRecord.patient_id,
          caseRecord.visit_date,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, copy.deleteVisitFailed),
      });
    }
  }

  function updatePrimaryOrganism(
    cultureCategory: string,
    cultureSpecies: string,
  ) {
    setDraft((current) => ({
      ...current,
      culture_category: cultureCategory.trim().toLowerCase(),
      culture_species: cultureSpecies.trim(),
      additional_organisms: normalizeAdditionalOrganisms(
        cultureCategory,
        cultureSpecies,
        current.additional_organisms,
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
      draft.additional_organisms,
    );
    if (
      currentOrganisms.some(
        (organism) => organismKey(organism) === organismKey(nextOrganism),
      )
    ) {
      setToast({
        tone: "error",
        message: copy.organismDuplicate,
      });
      return;
    }
    setDraft((current) => ({
      ...current,
      additional_organisms: [...current.additional_organisms, nextOrganism],
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
        (organism) => organismKey(organism) !== organismKey(organismToRemove),
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
      const hasRepresentative = current.some(
        (image) => image.is_representative,
      );
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
    if (
      remaining.length > 0 &&
      !remaining.some((image) => image.is_representative)
    ) {
      remaining[0] = { ...remaining[0], is_representative: true };
    }
    replaceDraftImagesAndBoxes(remaining);
  }

  function setRepresentativeImage(draftId: string) {
    setDraftImages((current) =>
      current.map((image) => ({
        ...image,
        is_representative: image.draft_id === draftId,
      })),
    );
  }

  function updateDraftLesionBoxFromPointer(
    draftId: string,
    clientX: number,
    clientY: number,
    element: HTMLDivElement,
  ) {
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

  function handleDraftLesionPointerDown(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
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
    element.setPointerCapture?.(event.pointerId);
  }

  function handleDraftLesionPointerMove(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      draftLesionDrawStateRef.current?.pointerId !== event.pointerId ||
      draftLesionDrawStateRef.current?.imageId !== draftId
    ) {
      return;
    }
    updateDraftLesionBoxFromPointer(
      draftId,
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
  }

  function finishDraftLesionPointer(
    draftId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const drawState = draftLesionDrawStateRef.current;
    if (
      !drawState ||
      drawState.pointerId !== event.pointerId ||
      drawState.imageId !== draftId
    ) {
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
      [draftId]:
        nextBox.x1 - nextBox.x0 < 0.01 || nextBox.y1 - nextBox.y0 < 0.01
          ? null
          : nextBox,
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
      const latestJob = await waitForSiteJobSettlement({
        siteId: selectedSiteId,
        token,
        initialJob: started.job,
        isActive(status) {
          return ["queued", "running"].includes(
            String(status || "")
              .trim()
              .toLowerCase(),
          );
        },
      });
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
      const requestedContributionModelIds =
        selectedCompareModelVersionIds.length > 0
          ? selectedCompareModelVersionIds
          : undefined;
      const contributionModelVersionId =
        requestedContributionModelIds &&
        requestedContributionModelIds.length > 0
          ? undefined
          : validationResult?.model_version.ensemble_mode === "weighted_average"
            ? undefined
            : validationResult?.model_version.version_id;
      const result = await runCaseContribution(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(
          validationResult?.execution_device,
        ),
        model_version_id: contributionModelVersionId,
        model_version_ids: requestedContributionModelIds,
      });
      setContributionResult(result);
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        { forceRefresh: true },
      );
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
                `${result.update_count}개 업데이트를 올렸고, ${result.failures.length}개 모델은 실패했습니다.`,
              )
            : result.update_count > 1
              ? pick(
                  locale,
                  `${result.update_count} contribution updates were queued for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
                  `${selectedCase.patient_id} / ${selectedCase.visit_date}에 대해 ${result.update_count}개 기여 업데이트를 대기열에 올렸습니다.`,
                )
              : copy.contributionQueued(
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                ),
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
    if (!selectedSiteId || !researchRegistryJoinReady) {
      return;
    }
    const shouldAutoInclude = pendingResearchRegistryAutoInclude;
    setResearchRegistryBusy(true);
    try {
      await enrollResearchRegistry(selectedSiteId, token);
      await onSiteDataChanged(selectedSiteId);
      setResearchRegistryModalOpen(false);
      setResearchRegistryExplanationConfirmed(false);
      setResearchRegistryUsageConsented(false);
      setToast({
        tone: "success",
        message: pick(
          locale,
          "Joined the research registry. Future eligible analyses can now flow into the dataset.",
          "연구 레지스트리에 가입했습니다. 이제 적격 분석 케이스가 데이터셋 흐름에 포함될 수 있습니다.",
        ),
      });
      if (shouldAutoInclude && selectedCase) {
        await includeCaseInResearchRegistry(
          selectedCase.patient_id,
          selectedCase.visit_date,
          "validation_auto_include",
          pick(
            locale,
            "This case was included in the research registry after validation.",
            "이 케이스는 검증 후 연구 레지스트리에 포함되었습니다.",
          ),
        );
      }
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to join the research registry.",
            "연구 레지스트리에 가입할 수 없습니다.",
          ),
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
        pick(
          locale,
          "This case is now included in the research registry.",
          "이 케이스가 연구 레지스트리에 포함되었습니다.",
        ),
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to include this case in the registry.",
            "이 케이스를 레지스트리에 포함할 수 없습니다.",
          ),
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
        pick(
          locale,
          "This case was excluded from the research registry.",
          "이 케이스를 연구 레지스트리에서 제외했습니다.",
        ),
      );
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to exclude this case from the registry.",
            "이 케이스를 레지스트리에서 제외할 수 없습니다.",
          ),
        ),
      });
    } finally {
      setResearchRegistryBusy(false);
    }
  }

  async function handleSaveCase() {
    const requestedVisitReference = buildVisitReference(draft);
    const patientId = draft.patient_id.trim();
    const editingSourceCase = editingCaseContext;
    const matchingPatientLookup =
      patientIdLookup &&
      patientIdLookup.requested_patient_id.trim() === patientId
        ? patientIdLookup
        : null;
    const nextVisitReference = resolveDraftVisitReference(
      draft,
      editingSourceCase ? null : matchingPatientLookup,
    );
    const patientPayload = {
      sex: draft.sex,
      age: Number(draft.age || 0),
      chart_alias: draft.chart_alias.trim(),
      local_case_code: draft.local_case_code.trim(),
    };
    const additionalOrganisms = normalizeAdditionalOrganisms(
      draft.culture_category,
      draft.culture_species,
      draft.additional_organisms,
    );
    const draftImageLesionBoxes = draftImages.map((image) => {
      const nextBox = draftLesionPromptBoxes[image.draft_id] ?? null;
      if (!nextBox) {
        return null;
      }
      const normalized = normalizeBox(nextBox);
      return hasUsableLesionPromptBox(normalized) ? normalized : null;
    });
    const visitPayload = (visitReference: string) => ({
      patient_id: patientId,
      visit_date: visitReference,
      actual_visit_date: draft.actual_visit_date.trim() || null,
      culture_category: draft.culture_category,
      culture_species: draft.culture_species.trim(),
      additional_organisms: additionalOrganisms,
      contact_lens_use: draft.contact_lens_use,
      predisposing_factor: draft.predisposing_factor,
      other_history: draft.other_history.trim(),
      visit_status: draft.visit_status,
      is_initial_visit: /^initial$/i.test(visitReference),
      polymicrobial: additionalOrganisms.length > 0,
    });
    const uploadDraftImagesToVisit = async (visitReference: string) => {
      const uploadSingleDraftImage = async (
        image: (typeof draftImages)[number],
      ) => {
        const uploadedImage = await uploadImage(selectedSiteId!, token, {
          patient_id: patientId,
          visit_date: visitReference,
          view: image.view,
          is_representative: image.is_representative,
          refresh_embeddings: false,
          file: image.file,
        });
        return toSavedCaseImagePreview(selectedSiteId!, token, uploadedImage);
      };
      const uploadedImages: SavedImagePreview[] = [];
      if (canUseDesktopTransport()) {
        uploadedImages.push(
          ...(await mapWithConcurrency(
            draftImages,
            DESKTOP_SAVE_UPLOAD_CONCURRENCY,
            async (image) => uploadSingleDraftImage(image),
          )),
        );
      } else {
        uploadedImages.push(
          ...(await Promise.all(
            draftImages.map((image) => uploadSingleDraftImage(image)),
          )),
        );
      }
      const representativeImage =
        uploadedImages.find((image) => image.is_representative) ??
        uploadedImages[0] ??
        null;
      if (representativeImage && !canUseDesktopTransport()) {
        void setRepresentativeImageOnServer(selectedSiteId!, token, {
          patient_id: patientId,
          visit_date: visitReference,
          representative_image_id: representativeImage.image_id,
        }).catch((nextError) => {
          console.warn("Post-save embedding refresh queue failed", nextError);
        });
      }
      const uploadedImagesWithLesionBoxes = uploadedImages.map((image, index) => {
        const lesionPromptBox = draftImageLesionBoxes[index];
        if (!lesionPromptBox) {
          return image;
        }
        return {
          ...image,
          lesion_prompt_box: lesionPromptBox,
          has_lesion_box: true,
        };
      });
      return uploadedImagesWithLesionBoxes;
    };
    const buildOptimisticSavedCase = (
      visitRecord: Partial<VisitRecord>,
      visitReference: string,
      uploadedImages: SavedImagePreview[],
    ): CaseSummaryRecord => {
      const representativeImage =
        uploadedImages.find((image) => image.is_representative) ??
        uploadedImages[0] ??
        null;
      const createdAt =
        visitRecord.created_at ??
        editingSourceCase?.created_at ??
        new Date().toISOString();
      return {
        case_id: `${patientId}::${visitReference}`,
        visit_id: String(visitRecord.visit_id ?? `${patientId}::${visitReference}`),
        patient_id: patientId,
        created_by_user_id:
          visitRecord.created_by_user_id ??
          editingSourceCase?.created_by_user_id ??
          user.user_id,
        visit_date: visitReference,
        actual_visit_date: draft.actual_visit_date.trim() || null,
        chart_alias: patientPayload.chart_alias,
        local_case_code: patientPayload.local_case_code,
        sex: draft.sex,
        age: draft.age.trim().length > 0 ? Number(draft.age) : null,
        culture_category: draft.culture_category,
        culture_species: draft.culture_species.trim(),
        additional_organisms: additionalOrganisms,
        contact_lens_use: draft.contact_lens_use,
        predisposing_factor: draft.predisposing_factor,
        other_history: draft.other_history.trim(),
        visit_status: draft.visit_status,
        active_stage: draft.visit_status === "active",
        is_initial_visit: /^initial$/i.test(visitReference),
        smear_result: visitRecord.smear_result ?? "not done",
        polymicrobial: additionalOrganisms.length > 0,
        image_count: uploadedImages.length,
        representative_image_id: representativeImage?.image_id ?? null,
        representative_view: representativeImage?.view ?? null,
        created_at: createdAt,
        latest_image_uploaded_at:
          uploadedImages[uploadedImages.length - 1]?.uploaded_at ?? createdAt,
      };
    };
    const finalizeSavedCase = (
      visitRecord: Partial<VisitRecord>,
      visitReference: string,
      uploadedImages: SavedImagePreview[] = [],
    ) => {
      const optimisticCase = buildOptimisticSavedCase(
        visitRecord,
        visitReference,
        uploadedImages,
      );
      const nextKnownCases = upsertCaseSummaryRecord(cases, optimisticCase, {
        replaceCase: editingSourceCase,
      });
      const shouldIncludeOptimisticCase =
        !showOnlyMine ||
        String(
          visitRecord.created_by_user_id ??
            editingSourceCase?.created_by_user_id ??
            user.user_id,
        ) === user.user_id;
      const shouldOptimisticallyUpdatePatientList =
        shouldIncludeOptimisticCase &&
        patientMatchesListSearch(normalizedPatientListSearch, optimisticCase);
      const currentPatientCaseCount = nextKnownCases.filter(
        (item) => item.patient_id === optimisticCase.patient_id,
      ).length;
      const currentPatientRow = patientListRows.find(
        (row) => row.patient_id === optimisticCase.patient_id,
      );
      const optimisticThumbnail = (() => {
        const representativeImage =
          uploadedImages.find((image) => image.is_representative) ??
          uploadedImages[0] ??
          null;
        if (!representativeImage) {
          return null;
        }
        return {
          case_id: optimisticCase.case_id,
          image_id: representativeImage.image_id,
          view: representativeImage.view,
          preview_url: representativeImage.preview_url,
          fallback_url: representativeImage.content_url ?? null,
        };
      })();
      const optimisticPatientRow: PatientListRow = {
        patient_id: optimisticCase.patient_id,
        latest_case: optimisticCase,
        case_count: Math.max(1, currentPatientCaseCount),
        representative_thumbnail_count: Math.max(
          optimisticThumbnail ? 1 : 0,
          currentPatientRow?.representative_thumbnail_count ??
            currentPatientRow?.representative_thumbnails.length ??
            0,
        ),
        organism_summary: organismSummaryLabel(
          optimisticCase.culture_category,
          optimisticCase.culture_species,
          optimisticCase.additional_organisms,
          2,
        ),
        representative_thumbnails: [
          ...(optimisticThumbnail ? [optimisticThumbnail] : []),
          ...(currentPatientRow?.representative_thumbnails ?? []).filter(
            (thumbnail) => thumbnail.case_id !== optimisticCase.case_id,
          ),
        ].slice(0, 3),
      };

      if (shouldIncludeOptimisticCase) {
        startTransition(() => {
          setCases(nextKnownCases);
          if (shouldOptimisticallyUpdatePatientList) {
            const rowExistsOnCurrentPage = Boolean(currentPatientRow);
            const nextPatientListRows =
              rowExistsOnCurrentPage || patientListPage === 1
                ? upsertPatientListRow(patientListRows, optimisticPatientRow).slice(
                    0,
                    PATIENT_LIST_PAGE_SIZE,
                  )
                : patientListRows;
            const nextTotalCount = currentPatientRow
              ? patientListTotalCount
              : patientListTotalCount + 1;
            setPatientListRows(nextPatientListRows);
            setPatientListTotalCount(nextTotalCount);
            setPatientListTotalPages(
              Math.max(1, Math.ceil(nextTotalCount / PATIENT_LIST_PAGE_SIZE)),
            );
            if (patientListPage === 1) {
              setPatientListPage(1);
            }
          }
        });
      }

      if (uploadedImages.length > 0) {
        primeCaseImageCache(optimisticCase, uploadedImages);
      }
      setToast({
        tone: "success",
        message: copy.caseSaved(
          patientId,
          visitReference,
          selectedSiteLabel ?? selectedSiteId!,
        ),
      });
      clearDraftStorage(selectedSiteId!);
      resetDraft();
      setSelectedCase(optimisticCase);
      setSelectedPatientCases(
        buildKnownPatientTimeline(nextKnownCases, optimisticCase.patient_id, optimisticCase),
      );
      setPanelOpen(true);
      void loadSiteActivity(selectedSiteId!);
      setCompletionState({
        kind: "saved",
        patient_id: patientId,
        visit_date: visitReference,
        timestamp: new Date().toISOString(),
      });
      const postSaveLesionEntries = uploadedImages
        .map((image) => ({
          imageId: image.image_id,
          lesionBox: toNormalizedBox(image.lesion_prompt_box),
          isRepresentative: Boolean(image.is_representative),
        }))
        .filter(
          (entry): entry is {
            imageId: string;
            lesionBox: NormalizedBox;
            isRepresentative: boolean;
          } => hasUsableLesionPromptBox(entry.lesionBox),
        );
      if (postSaveLesionEntries.length > 0) {
        window.setTimeout(() => {
          void applySavedLesionBoxesAndStartLivePreview(
            postSaveLesionEntries,
          ).catch((nextError) => {
            console.warn("Post-save lesion preview warm-up failed", nextError);
          });
        }, 0);
      }
      if (uploadedImages.length > 0) {
        window.setTimeout(() => {
          void fetchCaseRoiPreview(
            selectedSiteId!,
            patientId,
            visitReference,
            token,
          ).catch((nextError) => {
            console.warn("Saved case MedSAM warm-up failed", nextError);
          });
        }, postSaveLesionEntries.length > 0 ? 600 : 200);
      }

      void (async () => {
        try {
          await onSiteDataChanged(selectedSiteId!);
          const [nextCases, nextPatientList] = await Promise.all([
            fetchCases(selectedSiteId!, token, { mine: showOnlyMine }),
            fetchPatientListPage(selectedSiteId!, token, {
              mine: showOnlyMine,
              page: 1,
              page_size: PATIENT_LIST_PAGE_SIZE,
              search: normalizedPatientListSearch,
            }),
          ]);
          const refreshedCase =
            nextCases.find(
              (item) =>
                item.patient_id === patientId && item.visit_date === visitReference,
            ) ?? optimisticCase;
          if (uploadedImages.length > 0) {
            primeCaseImageCache(refreshedCase, uploadedImages);
          }
          startTransition(() => {
            setCases(nextCases);
            setPatientListRows(nextPatientList.items);
            setPatientListTotalCount(nextPatientList.total_count);
            setPatientListTotalPages(
              Math.max(1, nextPatientList.total_pages || 1),
            );
            setPatientListPage(nextPatientList.page);
            setSelectedCase((current) => {
              if (!current) {
                return current;
              }
              return current.patient_id === patientId &&
                current.visit_date === visitReference
                ? refreshedCase
                : current;
            });
            setSelectedPatientCases((current) =>
              current.some((item) => item.patient_id === patientId)
                ? buildKnownPatientTimeline(nextCases, patientId, refreshedCase)
                : current,
            );
          });
        } catch (nextError) {
          console.warn("Saved case background refresh failed", nextError);
        }
      })();
    };
    const nextAvailableFollowUpReference = async () => {
      const visits = await fetchVisits(selectedSiteId!, token, patientId);
      const usedVisitReferences = visits.map((item) => item.visit_date);
      let maxFollowUp = 0;
      for (const item of usedVisitReferences) {
        const match = String(item).match(FOLLOW_UP_VISIT_PATTERN);
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
    if (draftImageLesionBoxes.some((box) => !hasUsableLesionPromptBox(box))) {
      setToast({ tone: "error", message: copy.lesionBoxesRequired });
      return;
    }

    setSaveBusy(true);
    try {
      const ensureAndSyncPatient = async () => {
        try {
          if (matchingPatientLookup?.exists) {
            await updatePatient(
              selectedSiteId,
              token,
              patientId,
              patientPayload,
            );
            return;
          }
          await createPatient(selectedSiteId, token, {
            patient_id: patientId,
            ...patientPayload,
          });
        } catch (nextError) {
          if (!isAlreadyExistsError(nextError)) {
            throw nextError;
          }
          await updatePatient(selectedSiteId, token, patientId, patientPayload);
        }
      };
      const overwriteEditedVisit = async (visitReference: string) => {
        const savedVisit = (await updateVisit(
          selectedSiteId,
          token,
          editingSourceCase?.patient_id ?? patientId,
          editingSourceCase?.visit_date ?? visitReference,
          visitPayload(visitReference),
        )) as Partial<VisitRecord>;
        await deleteVisitImages(
          selectedSiteId,
          token,
          patientId,
          visitReference,
        );
        const uploadedImages = await uploadDraftImagesToVisit(visitReference);
        finalizeSavedCase(savedVisit, visitReference, uploadedImages);
      };

      await ensureAndSyncPatient();

      if (editingSourceCase) {
        try {
          await overwriteEditedVisit(nextVisitReference);
          return;
        } catch (nextError) {
          if (!isAlreadyExistsError(nextError)) {
            throw nextError;
          }
          const overwriteConfirmed = window.confirm(
            pick(
              locale,
              `Visit ${patientId} / ${displayVisitReference(locale, nextVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
              `방문 ${patientId} / ${displayVisitReference(locale, nextVisitReference)}가 이미 존재합니다.\n\n확인을 누르면 덮어쓰고, 취소를 누르면 다른 케이스로 저장합니다.`,
            ),
          );
          if (overwriteConfirmed) {
            await deleteVisit(
              selectedSiteId,
              token,
              patientId,
              nextVisitReference,
            );
            await overwriteEditedVisit(nextVisitReference);
          } else {
            const alternateVisitReference =
              await nextAvailableFollowUpReference();
            const saveAlternateConfirmed = window.confirm(
              pick(
                locale,
                `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
                `이 케이스를 ${displayVisitReference(locale, alternateVisitReference)}로 저장할까요?`,
              ),
            );
            if (!saveAlternateConfirmed) {
              return;
            }
            await overwriteEditedVisit(alternateVisitReference);
          }
          return;
        }
      }

      const createVisitReference =
        matchingPatientLookup?.exists &&
        Number(matchingPatientLookup.visit_count || 0) > 0 &&
        /^initial$/i.test(requestedVisitReference)
          ? await nextAvailableFollowUpReference()
          : nextVisitReference;
      const existingPatientFollowUpOnly =
        matchingPatientLookup?.exists &&
        Number(matchingPatientLookup.visit_count || 0) > 0;

      try {
        const savedVisit = (await createVisit(
          selectedSiteId,
          token,
          visitPayload(createVisitReference),
        )) as Partial<VisitRecord>;
        const uploadedImages = await uploadDraftImagesToVisit(createVisitReference);
        finalizeSavedCase(savedVisit, createVisitReference, uploadedImages);
      } catch (nextError) {
        if (!isAlreadyExistsError(nextError)) {
          throw nextError;
        }
        if (existingPatientFollowUpOnly) {
          const alternateVisitReference =
            await nextAvailableFollowUpReference();
          if (alternateVisitReference === createVisitReference) {
            throw nextError;
          }
          const savedVisit = (await createVisit(
            selectedSiteId,
            token,
            visitPayload(alternateVisitReference),
          )) as Partial<VisitRecord>;
          const uploadedImages = await uploadDraftImagesToVisit(alternateVisitReference);
          finalizeSavedCase(savedVisit, alternateVisitReference, uploadedImages);
          return;
        }
        const overwriteConfirmed = window.confirm(
          pick(
            locale,
            `Visit ${patientId} / ${displayVisitReference(locale, createVisitReference)} already exists.\n\nPress OK to overwrite it.\nPress Cancel to save as another case.`,
            `諛⑸Ц ${patientId} / ${displayVisitReference(locale, createVisitReference)}媛 ?대? 議댁옱?⑸땲??\n\n?뺤씤???꾨Ⅴ硫???뼱?곌퀬, 痍⑥냼瑜??꾨Ⅴ硫??ㅻⅨ 耳?댁뒪濡???ν빀?덈떎.`,
          ),
        );
        if (overwriteConfirmed) {
          const savedVisit = (await updateVisit(
            selectedSiteId,
            token,
            patientId,
            createVisitReference,
            visitPayload(createVisitReference),
          )) as Partial<VisitRecord>;
          await deleteVisitImages(
            selectedSiteId,
            token,
            patientId,
            createVisitReference,
          );
          const uploadedImages = await uploadDraftImagesToVisit(createVisitReference);
          finalizeSavedCase(savedVisit, createVisitReference, uploadedImages);
        } else {
          const alternateVisitReference =
            await nextAvailableFollowUpReference();
          const saveAlternateConfirmed = window.confirm(
            pick(
              locale,
              `Save this case as ${displayVisitReference(locale, alternateVisitReference)} instead?`,
              `??耳?댁뒪瑜?${displayVisitReference(locale, alternateVisitReference)}濡???ν븷源뚯슂?`,
            ),
          );
          if (!saveAlternateConfirmed) {
            return;
          }
          const savedVisit = (await createVisit(
            selectedSiteId,
            token,
            visitPayload(alternateVisitReference),
          )) as Partial<VisitRecord>;
          const uploadedImages = await uploadDraftImagesToVisit(alternateVisitReference);
          finalizeSavedCase(savedVisit, alternateVisitReference, uploadedImages);
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

  useEffect(() => {
    setMedsamArtifactStatus(null);
    setMedsamArtifactStatusBusy(false);
    setMedsamArtifactItems([]);
    setMedsamArtifactItemsBusy(false);
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }, [selectedSiteId, showOnlyMine]);

  const normalizedPatientListSearch = caseSearch.trim();
  useEffect(() => {
    if (!selectedSiteId) {
      startTransition(() => {
        setPatientListRows([]);
        setPatientListTotalCount(0);
        setPatientListTotalPages(1);
        setPatientListLoading(false);
        setMedsamArtifactStatus(null);
        setMedsamArtifactItems([]);
        setMedsamArtifactActiveStatus(null);
        setMedsamArtifactTotalPages(1);
      });
      return;
    }
    if (railView !== "patients") {
      setPatientListLoading(false);
      return;
    }

    const currentSiteId = selectedSiteId;
    let cancelled = false;
    let prefetchTimerId: number | null = null;
    const controller = new AbortController();

    async function loadPatientListPage() {
      setPatientListLoading(true);
      try {
        const response = await fetchPatientListPage(currentSiteId, token, {
          mine: showOnlyMine,
          page: patientListPage,
          page_size: PATIENT_LIST_PAGE_SIZE,
          search: normalizedPatientListSearch,
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPatientListRows(response.items);
          setPatientListTotalCount(response.total_count);
          setPatientListTotalPages(Math.max(1, response.total_pages || 1));
          setPatientListPage((current) =>
            current === response.page ? current : response.page,
          );
        });
        if (
          desktopFastMode &&
          WORKSPACE_TIMING_LOGS &&
          patientListLoggedSiteIdRef.current !== currentSiteId
        ) {
          patientListLoggedSiteIdRef.current = currentSiteId;
          const startedAt = workspaceOpenedAtRef.current ?? performance.now();
          console.info("[kera-fast-path] patient-list-ready", {
            site_id: currentSiteId,
            rows: response.items.length,
            total_count: response.total_count,
            elapsed_ms: Math.round(performance.now() - startedAt),
          });
        }
        if (typeof window !== "undefined") {
          prefetchTimerId = window.setTimeout(() => {
            response.items.slice(0, 6).forEach((row) => {
              prefetchDesktopVisitImages(
                currentSiteId,
                row.latest_case.patient_id,
                row.latest_case.visit_date,
              );
            });
          }, 0);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          startTransition(() => {
            setPatientListRows([]);
            setPatientListTotalCount(0);
            setPatientListTotalPages(1);
          });
          setToast({
            tone: "error",
            message: describeError(nextError, copy.unableLoadPatientList),
          });
        }
      } finally {
        if (!cancelled) {
          setPatientListLoading(false);
        }
      }
    }

    void loadPatientListPage();
    return () => {
      cancelled = true;
      if (prefetchTimerId !== null) {
        window.clearTimeout(prefetchTimerId);
      }
      controller.abort();
    };
  }, [
    selectedSiteId,
    token,
    showOnlyMine,
    patientListPage,
    normalizedPatientListSearch,
    railView,
    describeError,
    copy.unableLoadPatientList,
    setToast,
  ]);

  useEffect(() => {
    if (
      !selectedSiteId ||
      railView !== "patients" ||
      !medsamArtifactPanelEnabled ||
      !medsamArtifactActiveStatus
    ) {
      setMedsamArtifactItems([]);
      setMedsamArtifactTotalCount(0);
      setMedsamArtifactTotalPages(1);
      setMedsamArtifactItemsBusy(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setMedsamArtifactItemsBusy(true);
    const activeJob = medsamArtifactStatus?.active_job as {
      status?: string;
    } | null;
    const refreshArtifacts = ["queued", "running"].includes(
      String(activeJob?.status || "").toLowerCase(),
    );
    void fetchMedsamArtifactItems(selectedSiteId, token, {
      scope: medsamArtifactScope,
      status_key: medsamArtifactActiveStatus,
      mine: showOnlyMine,
      refresh: refreshArtifacts,
      page: medsamArtifactPage,
      page_size: PATIENT_LIST_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMedsamArtifactItems(response.items);
        setMedsamArtifactTotalCount(Math.max(0, response.total_count || 0));
        setMedsamArtifactTotalPages(Math.max(1, response.total_pages || 1));
        setMedsamArtifactPage((current) =>
          current === response.page ? current : response.page,
        );
      })
      .catch((nextError) => {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setMedsamArtifactItems([]);
          setMedsamArtifactTotalCount(0);
          setMedsamArtifactTotalPages(1);
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Unable to load artifact backlog items.",
                "아티팩트 백로그 항목을 불러오지 못했습니다.",
              ),
            ),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMedsamArtifactItemsBusy(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    selectedSiteId,
    token,
    showOnlyMine,
    railView,
    medsamArtifactPanelEnabled,
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactPage,
    medsamArtifactStatus?.last_synced_at,
    describeError,
    locale,
    setToast,
  ]);

  useEffect(() => {
    if (
      !medsamArtifactPanelEnabled ||
      !selectedSiteId ||
      railView !== "patients"
    ) {
      return;
    }
    const activeJob = medsamArtifactStatus?.active_job as {
      status?: string;
    } | null;
    if (
      !activeJob ||
      !["queued", "running"].includes(
        String(activeJob.status || "").toLowerCase(),
      )
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchMedsamArtifactStatus(selectedSiteId, token, {
        mine: showOnlyMine,
        refresh: true,
      })
        .then((nextStatus) => {
          setMedsamArtifactStatus(nextStatus);
        })
        .catch(() => {
          return;
        });
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [
    medsamArtifactPanelEnabled,
    selectedSiteId,
    token,
    showOnlyMine,
    railView,
    medsamArtifactStatus,
  ]);

  const safePage = Math.min(
    Math.max(1, patientListPage),
    patientListTotalPages,
  );

  useEffect(() => {
    if (canUseDesktopTransport()) {
      return;
    }
    if (!selectedSiteId || railView === "patients") {
      return;
    }
    prewarmPatientListPage(selectedSiteId, token, {
      mine: showOnlyMine,
      page: 1,
      page_size: PATIENT_LIST_PAGE_SIZE,
      search: normalizedPatientListSearch,
    });
  }, [
    normalizedPatientListSearch,
    railView,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  useEffect(() => {
    if (canUseDesktopTransport()) {
      return;
    }
    if (
      !selectedSiteId ||
      railView !== "patients" ||
      patientListRows.length === 0
    ) {
      return;
    }
    if (patientListPage >= patientListTotalPages) {
      return;
    }
    prewarmPatientListPage(selectedSiteId, token, {
      mine: showOnlyMine,
      page: patientListPage + 1,
      page_size: PATIENT_LIST_PAGE_SIZE,
      search: normalizedPatientListSearch,
    });
  }, [
    normalizedPatientListSearch,
    patientListPage,
    patientListRows,
    patientListTotalPages,
    railView,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  const speciesOptions = CULTURE_SPECIES[draft.culture_category] ?? [];
  const pendingSpeciesOptions =
    CULTURE_SPECIES[pendingOrganism.culture_category] ?? [];
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
  const canContributeSelectedCase =
    canRunValidation &&
    Boolean(selectedCase) &&
    selectedCase?.visit_status === "active";
  const researchRegistryEnabled = Boolean(
    summary?.research_registry?.site_enabled,
  );
  const researchRegistryUserEnrolled = Boolean(
    summary?.research_registry?.user_enrolled,
  );
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const validationPredictedConfidence = predictedClassConfidence(
    validationResult?.summary.predicted_label,
    validationResult?.summary.prediction_probability,
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
      formatDateTime={(value, emptyLabel = common.notAvailable) =>
        formatDateTime(value, localeTag, emptyLabel)
      }
      notAvailableLabel={common.notAvailable}
    />
  ) : null;
  const draftStatusLabel = draftSavedAt
    ? copy.draftAutosaved(
        new Date(draftSavedAt).toLocaleTimeString(localeTag, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      )
    : copy.draftUnsaved;
  const intakeOrganisms = listOrganisms(
    draft.culture_category,
    draft.culture_species,
    draft.additional_organisms,
  );
  const matchingDraftPatientLookup =
    patientIdLookup &&
    patientIdLookup.requested_patient_id.trim() === draft.patient_id.trim()
      ? patientIdLookup
      : null;
  const resolvedVisitReference = resolveDraftVisitReference(
    draft,
    editingCaseContext ? null : matchingDraftPatientLookup,
  );
  const resolvedVisitReferenceLabel = displayVisitReference(
    locale,
    resolvedVisitReference,
  );
  const latestAutosavedDraft =
    draftSavedAt && !draft.intake_completed
      ? {
          patientId:
            draft.patient_id.trim() ||
            pick(locale, "Untitled draft", "임시 케이스"),
          visitLabel: resolvedVisitReferenceLabel,
          savedLabel: draftStatusLabel,
        }
      : null;
  const actualVisitDateLabel =
    draft.actual_visit_date.trim() || common.notAvailable;
  const draftRepresentativeCount = draftImages.filter(
    (image) => image.is_representative,
  ).length;
  const draftChecklist = [
    Boolean(draft.patient_id.trim() && draft.age.trim()),
    Boolean(draft.visit_status && draft.contact_lens_use),
    Boolean(draft.culture_category && draft.culture_species.trim()),
    draftImages.length > 0,
  ];
  const draftCompletionCount = draftChecklist.filter(Boolean).length;
  const draftCompletionPercent = Math.round(
    (draftCompletionCount / draftChecklist.length) * 100,
  );
  const draftPendingItems: string[] = [];
  if (!selectedSiteId) {
    draftPendingItems.push(
      pick(
        locale,
        "Select a hospital workspace.",
        "병원 워크스페이스를 선택하세요.",
      ),
    );
  }
  if (!draft.patient_id.trim()) {
    draftPendingItems.push(
      pick(locale, "Add a patient identifier.", "환자 식별자를 입력하세요."),
    );
  }
  if (!draft.culture_species.trim()) {
    draftPendingItems.push(
      pick(locale, "Choose the primary organism.", "기본 원인균을 선택하세요."),
    );
  }
  if (!draft.intake_completed) {
    draftPendingItems.push(
      pick(
        locale,
        "Complete the intake to unlock submission.",
        "제출을 열려면 intake를 완료하세요.",
      ),
    );
  }
  if (draftImages.length === 0) {
    draftPendingItems.push(
      pick(
        locale,
        "Add at least one image to the board.",
        "이미지를 한 장 이상 보드에 추가하세요.",
      ),
    );
  }
  if (draftImages.length > 0 && draftRepresentativeCount === 0) {
    draftPendingItems.push(
      pick(
        locale,
        "Mark one representative image.",
        "대표 이미지를 한 장 지정하세요.",
      ),
    );
  }
  const handleRunValidationStable = useCallback(
    () => void handleRunValidation(),
    [handleRunValidation],
  );
  const handleRunModelCompareStable = useCallback(
    () => void handleRunModelCompare(),
    [handleRunModelCompare],
  );
  const handleToggleModelVersion = useCallback(
    (versionId: string, checked: boolean) => {
      const normalizedVersionId = String(versionId || "").trim();
      if (!normalizedVersionId) {
        return;
      }
      const current = Array.from(
        new Set(
          selectedCompareModelVersionIds
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0),
        ),
      );
      if (!checked) {
        setSelectedCompareModelVersionIds(
          current.filter((item) => item !== normalizedVersionId),
        );
        return;
      }
      if (current.includes(normalizedVersionId)) {
        return;
      }
      if (current.length >= MAX_MODEL_COMPARE_SELECTIONS) {
        setToast({
          tone: "error",
          message: pick(
            locale,
            `You can compare up to ${MAX_MODEL_COMPARE_SELECTIONS} models at once.`,
            `한 번에 최대 ${MAX_MODEL_COMPARE_SELECTIONS}개 모델까지 비교할 수 있습니다.`,
          ),
        });
        return;
      }
      setSelectedCompareModelVersionIds([...current, normalizedVersionId]);
    },
    [
      locale,
      pick,
      selectedCompareModelVersionIds,
      setToast,
      setSelectedCompareModelVersionIds,
    ],
  );
  const artifactContent = useMemo(
    () => (
      <ValidationArtifactStack
        locale={locale}
        representativePreviewUrl={representativeSavedImage?.preview_url}
        roiCropUrl={validationArtifacts.roi_crop}
        gradcamUrl={validationArtifacts.gradcam}
        gradcamCorneaUrl={validationArtifacts.gradcam_cornea}
        gradcamLesionUrl={validationArtifacts.gradcam_lesion}
        medsamMaskUrl={validationArtifacts.medsam_mask}
        lesionCropUrl={validationArtifacts.lesion_crop}
        lesionMaskUrl={validationArtifacts.lesion_mask}
      />
    ),
    [
      locale,
      representativeSavedImage?.preview_url,
      validationArtifacts.roi_crop,
      validationArtifacts.gradcam,
      validationArtifacts.gradcam_cornea,
      validationArtifacts.gradcam_lesion,
      validationArtifacts.medsam_mask,
      validationArtifacts.lesion_crop,
      validationArtifacts.lesion_mask,
    ],
  );
  const validationPanelContent = useMemo(
    () => (
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
        onRunValidation={handleRunValidationStable}
        artifactContent={artifactContent}
        modelCompareBusy={modelCompareBusy}
        selectedCompareModelVersionIds={selectedCompareModelVersionIds}
        compareModelCandidates={compareModelCandidates}
        onToggleModelVersion={handleToggleModelVersion}
        onRunModelCompare={handleRunModelCompareStable}
        modelCompareResult={modelCompareResult}
        formatProbability={formatProbability}
      />
    ),
    [
      locale,
      common,
      validationResult,
      validationBusy,
      canRunValidation,
      selectedCase,
      validationConfidence,
      validationConfidenceTone,
      validationPredictedConfidence,
      handleRunValidationStable,
      artifactContent,
      modelCompareBusy,
      selectedCompareModelVersionIds,
      compareModelCandidates,
      handleToggleModelVersion,
      handleRunModelCompareStable,
      modelCompareResult,
      formatProbability,
    ],
  );
  const handleRunAiClinicStable = useCallback(
    () => void handleRunAiClinic(),
    [handleRunAiClinic],
  );
  const handleExpandAiClinicStable = useCallback(
    () => void handleExpandAiClinic(),
    [handleExpandAiClinic],
  );
  const displayVisitReferenceForLocale = useCallback(
    (visitReference: string) => displayVisitReference(locale, visitReference),
    [locale],
  );
  const formatAiClinicMetadataFieldForLocale = useCallback(
    (field: string) => formatAiClinicMetadataField(locale, field),
    [locale],
  );
  const canExpandAiClinic =
    canRunAiClinic &&
    aiClinicResult !== null &&
    aiClinicResult.analysis_stage !== "expanded";
  const aiClinicPanelContent = useMemo(
    () => (
      <AiClinicPanel
        locale={locale}
        validationResult={validationResult}
        aiClinicBusy={aiClinicBusy}
        aiClinicExpandedBusy={aiClinicExpandedBusy}
        canRunAiClinic={canRunAiClinic}
        canExpandAiClinic={canExpandAiClinic}
        onRunAiClinic={handleRunAiClinicStable}
        onExpandAiClinic={handleExpandAiClinicStable}
      >
        <AiClinicResult
          locale={locale}
          validationResult={validationResult}
          modelCompareResult={modelCompareResult}
          result={aiClinicResult}
          aiClinicPreviewBusy={aiClinicPreviewBusy}
          aiClinicExpandedBusy={aiClinicExpandedBusy}
          canExpandAiClinic={canExpandAiClinic}
          onExpandAiClinic={handleExpandAiClinicStable}
          notAvailableLabel={common.notAvailable}
          aiClinicTextUnavailableLabel={copy.aiClinicTextUnavailable}
          displayVisitReference={displayVisitReferenceForLocale}
          formatSemanticScore={formatSemanticScore}
          formatImageQualityScore={formatImageQualityScore}
          formatProbability={formatProbability}
          formatMetadataField={formatAiClinicMetadataFieldForLocale}
          token={token}
        />
      </AiClinicPanel>
    ),
    [
      locale,
      validationResult,
      aiClinicBusy,
      aiClinicExpandedBusy,
      canRunAiClinic,
      canExpandAiClinic,
      handleRunAiClinicStable,
      handleExpandAiClinicStable,
      modelCompareResult,
      aiClinicResult,
      aiClinicPreviewBusy,
      common.notAvailable,
      copy.aiClinicTextUnavailable,
      displayVisitReferenceForLocale,
      formatAiClinicMetadataFieldForLocale,
    ],
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
            "저장된 방문, 검증 맥락, 기여 이력을 한 곳에서 검토합니다.",
          )
        : pick(
            locale,
            "Capture intake, images, and submission for one case.",
            "한 케이스의 intake, 이미지, 제출 상태를 정리합니다.",
          );
  const showSecondaryPanel =
    !desktopFastMode &&
    railView !== "patients" &&
    (isAuthoringCanvas || Boolean(selectedCase));
  const showPatientListSidebar = railView === "patients";
  const selectedCaseLayoutClass =
    selectedCase && showSecondaryPanel
      ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px_360px] xl:items-start"
      : selectedCase
        ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start"
        : null;
  const mainLayoutClass = selectedCase
    ? (selectedCaseLayoutClass ?? "grid gap-6")
    : showSecondaryPanel || showPatientListSidebar
      ? workspaceCenterClass
      : "grid gap-6";

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
        <header className={workspaceHeaderClass}>
          <div>
            <div className={workspaceKickerClass}>
              {pick(locale, "Research document", "?곌뎄 臾몄꽌")}
            </div>
            <div className={workspaceTitleRowClass}>
              <h2>{mainHeaderTitle}</h2>
              <span className={workspaceTitleCopyClass}>{mainHeaderCopy}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <DesktopControlPlaneStatusBadge
              locale={locale}
              status={controlPlaneStatus}
              busy={controlPlaneStatusBusy}
            />
            {!canOpenOperations ? (
              <span className={workspaceUserBadgeClass}>
                {translateRole(locale, user.role)}
              </span>
            ) : null}
            <div className="relative" ref={alertsPanelRef}>
              <Button
                type="button"
                variant={alertsPanelOpen ? "primary" : "ghost"}
                aria-haspopup="dialog"
                aria-expanded={alertsPanelOpen}
                onClick={() => setAlertsPanelOpen((current) => !current)}
                trailingIcon={
                  toastHistory.length ? (
                    <span
                      aria-hidden="true"
                      className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[0.72rem] font-semibold ${
                        alertsPanelOpen
                          ? "border border-white/20 bg-white/16 text-[var(--accent-contrast)]"
                          : "border border-border/70 bg-surface text-muted"
                      }`}
                    >
                      {toastHistory.length}
                    </span>
                  ) : null
                }
              >
                {copy.recentAlerts}
              </Button>
              {alertsPanelOpen ? (
                <Card
                  as="section"
                  variant="nested"
                  role="dialog"
                  aria-label={copy.recentAlerts}
                  className="absolute right-0 top-full z-40 mt-3 grid w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-4 border border-border/80 bg-surface p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <strong className="text-sm font-semibold text-ink">
                        {copy.recentAlerts}
                      </strong>
                      <p className="m-0 text-sm leading-6 text-muted">
                        {copy.recentAlertsCopy}
                      </p>
                    </div>
                    <div className="grid gap-2 justify-items-end">
                      <span
                        className={docSiteBadgeClass}
                      >{`${toastHistory.length} ${copy.alertsKept}`}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={clearToastHistory}
                        disabled={toastHistory.length === 0}
                      >
                        {copy.clearAlerts}
                      </Button>
                    </div>
                  </div>
                  {toastHistory.length ? (
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
                            <strong>
                              {entry.tone === "success"
                                ? common.saved
                                : common.actionNeeded}
                            </strong>
                            <span className="text-[0.72rem] text-muted">
                              {new Date(entry.created_at).toLocaleTimeString(
                                localeTag,
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                          </div>
                          <span>{entry.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={emptySurfaceClass}>{copy.noAlertsYet}</div>
                  )}
                </Card>
              ) : null}
            </div>
            <LocaleToggle />
            <Button variant="ghost" type="button" onClick={onToggleTheme}>
              {theme === "dark"
                ? pick(locale, "Light mode", "?쇱씠??紐⑤뱶")
                : pick(locale, "Dark mode", "?ㅽ겕 紐⑤뱶")}
            </Button>
            {onOpenHospitalAccessRequest ? (
              <Button
                variant="ghost"
                type="button"
                onClick={onOpenHospitalAccessRequest}
              >
                {selectedSiteId
                  ? pick(locale, "Request hospital change", "병원 변경 요청")
                  : pick(locale, "Request hospital access", "병원 접근 요청")}
              </Button>
            ) : null}
            {canOpenOperations ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenOperations()}
              >
                {pick(locale, "Admin", "관리자")}
              </Button>
            ) : null}
            {onOpenDesktopSettings ? (
              <Button
                variant="ghost"
                type="button"
                onClick={onOpenDesktopSettings}
              >
                {pick(locale, "Desktop settings", "데스크톱 설정")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              type="button"
              onClick={onExportManifest}
              disabled={!selectedSiteId}
            >
              {pick(locale, "Export manifest", "留ㅻ땲?섏뒪???대낫?닿린")}
            </Button>
            <Button
              className={completeIntakeButtonClass}
              type="button"
              variant="primary"
              onClick={onLogout}
            >
              {pick(locale, "Log out", "濡쒓렇?꾩썐")}
            </Button>
          </div>
        </header>

        <div className={mainLayoutClass}>
          {railView === "patients" ? (
            <>
              <div className="order-2 xl:order-1">
                <PatientListBoard
                  locale={locale}
                  localeTag={localeTag}
                  commonNotAvailable={common.notAvailable}
                  siteId={selectedSiteId}
                  token={token}
                  selectedSiteLabel={selectedSiteLabel}
                  selectedPatientId={selectedCase?.patient_id}
                  patientListRows={patientListRows}
                  patientListTotalCount={patientListTotalCount}
                  patientListPage={safePage}
                  patientListTotalPages={patientListTotalPages}
                  patientListThumbsByPatient={patientListThumbs}
                  caseSearch={caseSearch}
                  showOnlyMine={showOnlyMine}
                  casesLoading={patientListLoading}
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
                  onOpenImageTextSearchResult={handleOpenImageTextSearchResult}
                  onPrefetchCase={(caseRecord) => {
                    if (selectedSiteId) {
                      prefetchDesktopVisitImages(
                        selectedSiteId,
                        caseRecord.patient_id,
                        caseRecord.visit_date,
                      );
                    }
                  }}
                  medsamArtifactActiveStatus={medsamArtifactActiveStatus}
                  medsamArtifactScope={medsamArtifactScope}
                  medsamArtifactItems={medsamArtifactItems}
                  medsamArtifactItemsBusy={medsamArtifactItemsBusy}
                  medsamArtifactPage={medsamArtifactPage}
                  medsamArtifactTotalCount={medsamArtifactTotalCount}
                  medsamArtifactTotalPages={medsamArtifactTotalPages}
                  onCloseMedsamArtifactBacklog={
                    handleCloseMedsamArtifactBacklog
                  }
                  onMedsamArtifactScopeChange={handleMedsamArtifactScopeChange}
                  onMedsamArtifactPageChange={handleMedsamArtifactPageChange}
                />
              </div>
              <aside
                className={`${workspacePanelClass} order-1 xl:order-2 xl:self-start`}
              >
                <MedsamArtifactBacklogPanel
                  locale={locale}
                  pick={pick}
                  medsamArtifactPanelEnabled={medsamArtifactPanelEnabled}
                  medsamArtifactStatus={medsamArtifactStatus}
                  medsamArtifactStatusBusy={medsamArtifactStatusBusy}
                  medsamArtifactBackfillBusy={medsamArtifactBackfillBusy}
                  medsamArtifactActiveStatus={medsamArtifactActiveStatus}
                  canBackfillMedsamArtifacts={canRunValidation}
                  onEnableMedsamArtifactPanel={() =>
                    void handleEnableMedsamArtifactPanel()
                  }
                  onDisableMedsamArtifactPanel={
                    handleDisableMedsamArtifactPanel
                  }
                  onRefreshMedsamArtifactStatus={() =>
                    void handleRefreshMedsamArtifactStatus(true)
                  }
                  onOpenMedsamArtifactBacklog={handleOpenMedsamArtifactBacklog}
                  onCloseMedsamArtifactBacklog={
                    handleCloseMedsamArtifactBacklog
                  }
                  onBackfillMedsamArtifacts={() =>
                    void handleBackfillMedsamArtifacts()
                  }
                />
              </aside>
            </>
          ) : selectedCase ? (
            <>
              <section
                className={`${docSurfaceClass} gap-4 p-5 lg:gap-5 lg:p-5`}
              >
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
                  patientVisitGalleryLoadingCaseIds={patientVisitGalleryLoadingCaseIds}
                  patientVisitGalleryErrorCaseIds={patientVisitGalleryErrorCaseIds}
                  pick={pick}
                  translateOption={translateOption}
                  displayVisitReference={displayVisitReference}
                  formatDateTime={formatDateTime}
                  organismSummaryLabel={organismSummaryLabel}
                  editDraftBusy={editDraftBusy}
                  onStartEditDraft={startEditDraftFromSelectedCase}
                  onStartFollowUpDraft={startFollowUpDraftFromSelectedCase}
                  onToggleFavorite={toggleFavoriteCase}
                  onOpenSavedCase={openSavedCase}
                  onEnsureVisitImages={(caseRecord) => {
                    if (!selectedSiteId) {
                      return Promise.resolve([]);
                    }
                    return ensurePatientVisitImagesLoaded(selectedSiteId, caseRecord);
                  }}
                  onDeleteSavedCase={handleDeleteSavedCase}
                  isFavoriteCase={isFavoriteCase}
                  caseTitle={formatCaseTitle(selectedCase)}
                />

                <SavedCaseImageBoard
                  locale={locale}
                  commonLoading={common.loading}
                  commonNotAvailable={common.notAvailable}
                  selectedVisitLabel={displayVisitReference(
                    locale,
                    selectedCase.visit_date,
                  )}
                  panelBusy={panelBusy}
                  selectedCaseImageCountHint={selectedCase.image_count}
                  selectedCaseImages={selectedCaseImages}
                  liveLesionMaskEnabled={liveLesionCropEnabled}
                  semanticPromptInputMode={semanticPromptInputMode}
                  semanticPromptInputOptions={semanticPromptInputOptions}
                  semanticPromptBusyImageId={semanticPromptBusyImageId}
                  semanticPromptReviews={semanticPromptReviews}
                  semanticPromptErrors={semanticPromptErrors}
                  semanticPromptOpenImageIds={semanticPromptOpenImageIds}
                  liveLesionPreviews={liveLesionPreviews}
                  savedImageRoiCropUrls={savedImageRoiCropUrls}
                  savedImageRoiCropBusy={savedImageRoiCropBusy}
                  savedImageLesionCropUrls={savedImageLesionCropUrls}
                  savedImageLesionCropBusy={savedImageLesionCropBusy}
                  lesionPromptDrafts={lesionPromptDrafts}
                  lesionPromptSaved={lesionPromptSaved}
                  lesionBoxBusyImageId={lesionBoxBusyImageId}
                  representativeBusyImageId={representativeBusyImageId}
                  pick={pick}
                  translateOption={translateOption}
                  formatSemanticScore={formatSemanticScore}
                  onToggleLiveLesionMask={() =>
                    setLiveLesionCropEnabled((current) => !current)
                  }
                  onSemanticPromptInputModeChange={setSemanticPromptInputMode}
                  onSetSavedRepresentative={handleSetSavedRepresentative}
                  onReviewSemanticPrompts={handleReviewSemanticPrompts}
                  onLesionPointerDown={handleLesionPointerDown}
                  onLesionPointerMove={handleLesionPointerMove}
                  onFinishLesionPointer={finishLesionPointer}
                />

                {analysisSectionMounted ? (
                  <>
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
                        eyebrow={
                          <div className={docSectionLabelClass}>
                            {pick(
                              locale,
                              "Validation and AI Clinic",
                              "寃利?諛?AI Clinic",
                            )}
                          </div>
                        }
                        title={pick(
                          locale,
                          "Validation, artifacts, and retrieval support",
                          "검증, 아티팩트, 검색 지원",
                        )}
                        titleAs="h4"
                        description={pick(
                          locale,
                          "Review model validation, artifacts, similar-patient retrieval, and differential support in a wider layout.",
                          "紐⑤뜽 寃利? ?꾪떚?⑺듃, ?좎궗 ?섏옄 寃?? differential support瑜??볦? ?덉씠?꾩썐?먯꽌 ?뺤씤?⑸땲??",
                        )}
                        aside={
                          <span
                            className={docSiteBadgeClass}
                          >{`${selectedCaseImages.length} ${pick(locale, "images", "?대?吏")}`}</span>
                        }
                      />
                      <div className={panelStackClass}>
                        {validationPanelContent}
                        {aiClinicPanelContent}
                      </div>
                    </section>
                  </>
                ) : null}
              </section>

              <SavedCaseSidebar
                locale={locale}
                pick={pick}
                selectedCaseImageCount={Math.max(
                  selectedCaseImages.length,
                  Number(selectedCase.image_count ?? 0),
                )}
                hasRepresentativeImage={
                  Boolean(selectedCase.representative_image_id) ||
                  selectedCaseImages.some((image) => image.is_representative)
                }
                hasAnySavedLesionBox={hasAnySavedLesionBox}
              />
            </>
          ) : !selectedSiteId ? (
            <section className={`${docSurfaceClass} gap-4 p-5 lg:gap-5 lg:p-5`}>
              <SectionHeader
                className={docSectionHeadClass}
                eyebrow={
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Hospital access", "병원 접근")}
                  </div>
                }
                title={pick(
                  locale,
                  "Choose or request a hospital before creating a case",
                  "케이스 생성 전에 병원을 선택하거나 요청하세요",
                )}
                titleAs="h4"
                description={pick(
                  locale,
                  "Case authoring is blocked until a hospital workspace is linked to this session.",
                  "현재 세션에 병원 워크스페이스가 연결되기 전에는 케이스 작성을 막습니다.",
                )}
                aside={
                  onOpenHospitalAccessRequest ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onOpenHospitalAccessRequest}
                    >
                      {pick(locale, "Open hospital request", "병원 요청 열기")}
                    </Button>
                  ) : null
                }
              />
              <div className={emptySurfaceClass}>
                {pick(
                  locale,
                  "Select an approved hospital or submit a hospital change request first. Patient, visit, and image authoring stay disabled until then.",
                  "승인된 병원을 선택하거나 병원 변경 요청을 먼저 제출하세요. 그전까지는 환자, 방문, 이미지 작성이 비활성화됩니다.",
                )}
              </div>
            </section>
          ) : (
            <CaseWorkspaceAuthoringCanvas
              locale={locale}
              selectedSiteLabel={selectedSiteLabel}
              draftStatusLabel={draftStatusLabel}
              resolvedVisitReferenceLabel={resolvedVisitReferenceLabel}
              intakeCompleted={draft.intake_completed}
              patientSummaryLabel={
                draft.patient_id.trim() ||
                pick(locale, "Waiting for patient ID", "환자 ID 대기 중")
              }
              visitSummaryLabel={`${resolvedVisitReferenceLabel} · ${translateOption(locale, "visitStatus", draft.visit_status)}`}
              organismSummary={
                organismSummaryLabel(
                  draft.culture_category,
                  draft.culture_species,
                  draft.additional_organisms,
                  1,
                ) || pick(locale, "Choose primary organism", "기본 원인균 선택")
              }
              patientVisitForm={
                <PatientVisitForm
                  locale={locale}
                  draft={draft}
                  draftStatusLabel={draftStatusLabel}
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
                  patientIdLookup={patientIdLookup}
                  patientIdLookupBusy={patientIdLookupBusy}
                  patientIdLookupError={patientIdLookupError}
                  primaryOrganismSummary={organismSummaryLabel(
                    draft.culture_category,
                    draft.culture_species,
                    draft.additional_organisms,
                    2,
                  )}
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
              }
              imageManagerPanel={
                draft.intake_completed ? (
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
                ) : null
              }
            />
          )}

          {showSecondaryPanel ? (
            <CaseWorkspaceReviewPanel
              locale={locale}
              selectedCasePanelContent={
                selectedCase ? (
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
                    currentUserPublicAlias={
                      user.public_alias ??
                      contributionResult?.stats.user_public_alias ??
                      null
                    }
                    contributionLeaderboard={
                      siteActivity?.contribution_leaderboard ??
                      contributionResult?.stats.leaderboard ??
                      null
                    }
                    historyBusy={historyBusy}
                    caseHistory={caseHistory}
                    onJoinResearchRegistry={() =>
                      openResearchRegistryModal(false)
                    }
                    onIncludeResearchCase={() =>
                      void handleIncludeResearchCase()
                    }
                    onExcludeResearchCase={() =>
                      void handleExcludeResearchCase()
                    }
                    onContributeCase={() => void handleContributeCase()}
                    completionContent={completionContent}
                    formatProbability={formatProbability}
                    notAvailableLabel={common.notAvailable}
                  />
                ) : null
              }
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
        <div
          className="fixed inset-0 z-80 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <Card
            as="section"
            variant="panel"
            className="grid max-w-[560px] gap-4 p-6"
          >
            <SectionHeader
              eyebrow={
                <div className={docSectionLabelClass}>
                  {pick(locale, "Research registry", "연구 레지스트리")}
                </div>
              }
              title={pick(
                locale,
                "Join once, then keep contribution automatic",
                "한 번 가입하고 자동 기여 흐름 사용",
              )}
              titleAs="h3"
              description={pick(
                locale,
                "K-ERA keeps AI validation free. If you join the registry, de-identified cases from this site can be included for model improvement and multi-center research, with per-case opt-out remaining available.",
                "K-ERA는 AI 검증을 무료로 유지합니다. 레지스트리에 가입하면 이 기관의 비식별 케이스가 모델 개선과 다기관 연구에 포함될 수 있고, 각 케이스는 이후에도 개별 제외할 수 있습니다.",
              )}
            />
            <Card as="div" variant="nested" className="grid gap-2 p-4">
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Original data ownership remains with the contributing institution. This step only enables research-registry participation for your account at the current site.",
                  "원본 데이터의 권리는 기여 기관에 남아 있습니다. 이 단계는 현재 병원에서 이 계정의 연구 레지스트리 참여만 활성화합니다.",
                )}
              </p>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "You can still exclude any case later from the case-side registry panel.",
                  "이후에도 케이스별 레지스트리 패널에서 언제든 개별 제외할 수 있습니다.",
                )}
              </p>
            </Card>
            <div className="grid gap-3">
              <label className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-4 py-3 text-sm text-ink dark:bg-white/4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={researchRegistryExplanationConfirmed}
                    disabled={researchRegistryBusy}
                    onChange={(event) =>
                      setResearchRegistryExplanationConfirmed(
                        event.target.checked,
                      )
                    }
                  />
                  <div className="grid gap-1">
                    <span className="font-semibold">
                      {pick(
                        locale,
                        "Acknowledge the registry explanation: pseudonymization, central storage scope, local source retention, and per-case exclusion remain available.",
                        "설명 확인: 가명처리, 중앙 저장 범위, 원본 로컬 보관, 케이스별 제외 가능",
                      )}
                    </span>
                    <span className="text-[0.82rem] leading-6 text-muted">
                      {pick(
                        locale,
                        "I understand that the central registry receives de-identified research data only, while the source images and records remain at the contributing institution.",
                        "중앙 레지스트리에는 비식별 연구데이터만 올라가고, 원본 이미지와 원자료는 기여 기관 내부에 보관된다는 점을 확인합니다.",
                      )}
                    </span>
                  </div>
                </div>
              </label>
              <label className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-white/70 px-4 py-3 text-sm text-ink dark:bg-white/4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={researchRegistryUsageConsented}
                    disabled={researchRegistryBusy}
                    onChange={(event) =>
                      setResearchRegistryUsageConsented(event.target.checked)
                    }
                  />
                  <div className="grid gap-1">
                    <span className="font-semibold">
                      {pick(
                        locale,
                        "Consent to registry use: allow registry inclusion plus model validation or improvement research use.",
                        "활용 동의: registry 포함 및 모델 검증/개선 연구 활용 동의",
                      )}
                    </span>
                    <span className="text-[0.82rem] leading-6 text-muted">
                      {pick(
                        locale,
                        "I consent to eligible cases from this site being included in the registry flow and used for model validation or improvement studies, while keeping per-case opt-out available.",
                        "이 병원의 적격 케이스가 레지스트리 흐름에 포함되고 모델 검증·개선 연구에 활용되는 데 동의하며, 이후에도 케이스별 제외가 가능함을 이해합니다.",
                      )}
                    </span>
                  </div>
                </div>
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={closeResearchRegistryModal}
              >
                {pick(locale, "Continue without joining", "가입 없이 계속")}
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={researchRegistryBusy}
                disabled={!researchRegistryJoinReady}
                onClick={() => void handleJoinResearchRegistry()}
              >
                {pick(locale, "Join research registry", "연구 레지스트리 가입")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </CaseWorkspaceShell>
  );
}

function caseTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue =
    caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function buildKnownPatientTimeline(
  caseRecords: CaseSummaryRecord[],
  patientId: string,
  fallbackCase: CaseSummaryRecord | null = null,
): CaseSummaryRecord[] {
  const normalizedPatientId = String(patientId ?? "").trim();
  if (!normalizedPatientId) {
    return fallbackCase ? [fallbackCase] : [];
  }
  const byCaseId = new Map<string, CaseSummaryRecord>();
  for (const item of caseRecords) {
    if (String(item.patient_id ?? "").trim() !== normalizedPatientId) {
      continue;
    }
    const caseId = String(item.case_id ?? "").trim();
    if (!caseId) {
      continue;
    }
    byCaseId.set(caseId, item);
  }
  if (fallbackCase) {
    byCaseId.set(fallbackCase.case_id, fallbackCase);
  }
  return Array.from(byCaseId.values()).sort(
    (left, right) => caseTimestamp(right) - caseTimestamp(left),
  );
}

function buildPatientListThumbMap(
  rows: PatientListRow[],
): Record<string, PatientListThumbnail[]> {
  return Object.fromEntries(
    rows.map((row) => [row.patient_id, row.representative_thumbnails]),
  );
}

function upsertCaseSummaryRecord(
  caseRecords: CaseSummaryRecord[],
  nextCase: CaseSummaryRecord,
  options: {
    replaceCase?:
      | {
          case_id?: string | null;
          patient_id: string;
          visit_date: string;
        }
      | null;
  } = {},
): CaseSummaryRecord[] {
  const replaceCase = options.replaceCase;
  const filtered = caseRecords.filter((item) => {
    if (
      replaceCase &&
      (item.case_id === replaceCase.case_id ||
        (item.patient_id === replaceCase.patient_id &&
          item.visit_date === replaceCase.visit_date))
    ) {
      return false;
    }
    return item.case_id !== nextCase.case_id;
  });
  return [nextCase, ...filtered].sort(
    (left, right) => caseTimestamp(right) - caseTimestamp(left),
  );
}

function upsertPatientListRow(
  rows: PatientListRow[],
  nextRow: PatientListRow,
): PatientListRow[] {
  return [nextRow, ...rows.filter((row) => row.patient_id !== nextRow.patient_id)].sort(
    (left, right) =>
      caseTimestamp(right.latest_case) - caseTimestamp(left.latest_case),
  );
}

function patientMatchesListSearch(
  normalizedSearch: string,
  caseRecord: CaseSummaryRecord,
): boolean {
  const search = normalizedSearch.trim().toLowerCase();
  if (!search) {
    return true;
  }
  const searchableValues = [
    caseRecord.patient_id,
    caseRecord.chart_alias,
    caseRecord.local_case_code,
    caseRecord.culture_category,
    caseRecord.culture_species,
    caseRecord.visit_date,
    caseRecord.actual_visit_date ?? "",
  ];
  return searchableValues.some((value) =>
    String(value ?? "").toLowerCase().includes(search),
  );
}

function visitTimestamp(visitRecord: VisitRecord): number {
  const parsed = new Date(visitRecord.created_at ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}
