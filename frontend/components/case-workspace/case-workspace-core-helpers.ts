"use client";

import {
  buildImageContentUrl,
  buildImagePreviewUrl,
  type CaseSummaryRecord,
  type ImageRecord,
  type ModelVersionRecord,
  type SiteSummary,
} from "../../lib/api";
import type { SavedImagePreview, NormalizedBox } from "./shared";
import { isPositiveCultureStatus } from "./case-workspace-draft-helpers";

const SAVED_CASE_IMAGE_PREVIEW_MAX_SIDE = 640;
const WORKSPACE_HISTORY_KEY = "__keraWorkspace";

export type WorkspaceHistoryEntry = {
  scope: "case-workspace";
  version: 1;
  rail_view: "cases" | "patients";
  selected_case_id: string | null;
};

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function toSavedCaseImagePreview(
  siteId: string,
  token: string,
  image: ImageRecord,
): SavedImagePreview {
  return {
    ...image,
    content_url:
      image.content_url ?? buildImageContentUrl(siteId, image.image_id, token),
    preview_url:
      ("preview_url" in image &&
      typeof image.preview_url === "string" &&
      image.preview_url.trim().length > 0
        ? image.preview_url
        : null) ??
      buildImagePreviewUrl(siteId, image.image_id, token, {
        maxSide: SAVED_CASE_IMAGE_PREVIEW_MAX_SIDE,
      }),
  };
}

export function buildWorkspaceHistoryEntry(
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

export function readWorkspaceHistoryEntry(
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

export function isSameWorkspaceHistoryEntry(
  left: WorkspaceHistoryEntry | null,
  right: WorkspaceHistoryEntry | null,
): boolean {
  return (
    left?.rail_view === right?.rail_view &&
    left?.selected_case_id === right?.selected_case_id
  );
}

export function writeWorkspaceHistoryEntry(
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

export function isResearchRegistryIncluded(
  value: string | null | undefined,
): boolean {
  return String(value || "").trim().toLowerCase() === "included";
}

export function isResearchEligibleCase(
  caseRecord:
    | Pick<
        CaseSummaryRecord,
        "visit_status" | "culture_status" | "image_count"
      >
    | null
    | undefined,
): boolean {
  return (
    Boolean(caseRecord) &&
    caseRecord?.visit_status === "active" &&
    isPositiveCultureStatus(caseRecord?.culture_status) &&
    Number(caseRecord?.image_count ?? 0) > 0
  );
}

export function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatCaseTitle(caseRecord: CaseSummaryRecord): string {
  return caseRecord.local_case_code || caseRecord.patient_id;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeBox(box: NormalizedBox): NormalizedBox {
  return {
    x0: clamp01(Math.min(box.x0, box.x1)),
    y0: clamp01(Math.min(box.y0, box.y1)),
    x1: clamp01(Math.max(box.x0, box.x1)),
    y1: clamp01(Math.max(box.y0, box.y1)),
  };
}

export function toNormalizedBox(value: unknown): NormalizedBox | null {
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

export function hasUsableLesionPromptBox(
  box: NormalizedBox | null | undefined,
): box is NormalizedBox {
  return Boolean(
    box && box.x1 - box.x0 >= 0.01 && box.y1 - box.y0 >= 0.01,
  );
}

export function buildFallbackSiteSummary(
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
        sum +
        (String(record.culture_category || "").trim().toLowerCase() ===
        "fungal"
          ? 1
          : 0),
      0,
    ),
    n_bacterial_visits: caseRecords.reduce(
      (sum, record) =>
        sum +
        (String(record.culture_category || "").trim().toLowerCase() ===
        "bacterial"
          ? 1
          : 0),
      0,
    ),
    n_validation_runs: 0,
    latest_validation: null,
  };
}

export function mergeRailSummaryCategoryCounts(
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

function modelVersionCreatedAtTimestamp(
  value: string | null | undefined,
): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSelectableCompareModelVersion(
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

export function sortCompareModelVersions(
  modelVersions: ModelVersionRecord[],
): ModelVersionRecord[] {
  return [...modelVersions].sort(
    (left, right) =>
      modelVersionCreatedAtTimestamp(right.created_at) -
      modelVersionCreatedAtTimestamp(left.created_at),
  );
}

function normalizedModelVersionArchitecture(modelVersion: ModelVersionRecord) {
  return String(modelVersion.architecture || "").trim().toLowerCase();
}

function normalizedModelVersionCropMode(modelVersion: ModelVersionRecord) {
  return String(modelVersion.crop_mode || "").trim().toLowerCase();
}

function supportsValidationReviewArtifacts(modelVersion: ModelVersionRecord) {
  const architecture = normalizedModelVersionArchitecture(modelVersion);
  if (!architecture) {
    return false;
  }
  if (
    architecture === "cnn" ||
    architecture === "vit" ||
    architecture === "swin" ||
    architecture === "convnext_tiny" ||
    architecture === "efficientnet_v2_s" ||
    architecture === "dinov2" ||
    architecture === "dinov2_mil" ||
    architecture === "swin_mil" ||
    architecture === "dual_input_concat" ||
    architecture === "densenet121" ||
    architecture === "densenet169" ||
    architecture === "densenet201" ||
    architecture.includes("lesion_guided_fusion")
  ) {
    return true;
  }
  const cropMode = normalizedModelVersionCropMode(modelVersion);
  return (
    cropMode === "automated" || cropMode === "paired" || cropMode === "manual"
  );
}

function modelVersionSearchText(modelVersion: ModelVersionRecord): string {
  return [
    modelVersion.version_id,
    modelVersion.version_name,
    modelVersion.architecture,
    modelVersion.crop_mode,
    modelVersion.case_aggregation,
    modelVersion.training_input_policy,
    modelVersion.notes,
    modelVersion.notes_en,
    modelVersion.notes_ko,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join(" ");
}

function pickPreferredCompareModel(
  modelVersions: ModelVersionRecord[],
  matcher: (modelVersion: ModelVersionRecord, searchText: string) => boolean,
  selectedIds: Set<string>,
): ModelVersionRecord | null {
  return (
    modelVersions.find((modelVersion) => {
      if (!isSelectableCompareModelVersion(modelVersion)) {
        return false;
      }
      if (selectedIds.has(modelVersion.version_id)) {
        return false;
      }
      return matcher(modelVersion, modelVersionSearchText(modelVersion));
    }) ?? null
  );
}

function findPreferredSelectableModelVersion(
  modelVersions: ModelVersionRecord[],
  preferredMatchers: Array<
    (modelVersion: ModelVersionRecord, searchText: string) => boolean
  >,
): ModelVersionRecord | null {
  const sortedModelVersions = sortCompareModelVersions(modelVersions);
  for (const matcher of preferredMatchers) {
    const match =
      sortedModelVersions.find(
        (modelVersion) =>
          isSelectableCompareModelVersion(modelVersion) &&
          matcher(modelVersion, modelVersionSearchText(modelVersion)),
      ) ?? null;
    if (match != null) {
      return match;
    }
  }
  return (
    sortedModelVersions.find((modelVersion) =>
      isSelectableCompareModelVersion(modelVersion),
    ) ?? null
  );
}

export function preferredValidationModelVersion(
  modelVersions: ModelVersionRecord[],
): ModelVersionRecord | null {
  return findPreferredSelectableModelVersion(modelVersions, [
    (modelVersion) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "convnext_tiny",
    (modelVersion, searchText) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      normalizedModelVersionCropMode(modelVersion) !== "raw" &&
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "efficientnet_v2_s" &&
      !searchText.includes("lesion_guided_fusion"),
    (modelVersion, searchText) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "efficientnet_v2_s" &&
      !searchText.includes("lesion_guided_fusion"),
    (modelVersion, searchText) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      searchText.includes("convnext_tiny_full"),
    (modelVersion) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "dinov2" &&
      !String(modelVersion.case_aggregation || "")
        .trim()
        .toLowerCase()
        .includes("mil"),
    (modelVersion) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      String(modelVersion.architecture || "").trim().toLowerCase() === "vit",
    (modelVersion) =>
      supportsValidationReviewArtifacts(modelVersion) &&
      normalizedModelVersionCropMode(modelVersion) !== "raw",
    (modelVersion) => supportsValidationReviewArtifacts(modelVersion),
    (modelVersion) => isSelectableCompareModelVersion(modelVersion),
  ]);
}

export function preferredVisitLevelMilModelVersion(
  modelVersions: ModelVersionRecord[],
): ModelVersionRecord | null {
  return findPreferredSelectableModelVersion(modelVersions, [
    (modelVersion, searchText) =>
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "efficientnet_v2_s_mil" &&
      Boolean(modelVersion.bag_level) &&
      (searchText.includes("efficientnet_v2_s_mil_full") ||
        searchText.includes("efficientnet-v2-s-mil-full") ||
        searchText.includes("efficientnet v2 s mil full")),
    (modelVersion) =>
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "efficientnet_v2_s_mil" && Boolean(modelVersion.bag_level),
  ]);
}

export function defaultModelCompareSelection(
  modelVersions: ModelVersionRecord[],
): string[] {
  const sortedModelVersions = sortCompareModelVersions(modelVersions);
  const selected: string[] = [];
  const selectedIds = new Set<string>();
  const seenArchitectures = new Set<string>();
  const preferredMatchers: Array<
    (modelVersion: ModelVersionRecord, searchText: string) => boolean
  > = [
    (modelVersion, searchText) =>
      (searchText.includes("efficientnet_v2_s_mil_full") ||
        searchText.includes("efficientnetv2-s mil") ||
        searchText.includes("efficientnet_v2_s mil")) &&
      !searchText.includes("lesion_guided_fusion"),
    (modelVersion, searchText) =>
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "efficientnet_v2_s" &&
      !searchText.includes("lesion_guided_fusion") &&
      !searchText.includes("ensemble"),
    (modelVersion, searchText) =>
      searchText.includes("dinov2") &&
      (searchText.includes("retrieval") || searchText.includes("similar case")) &&
      (searchText.includes("lesion") || searchText.includes("manual")),
    (modelVersion, searchText) =>
      String(modelVersion.architecture || "").trim().toLowerCase() ===
        "dinov2" &&
      !searchText.includes("mil"),
    (modelVersion, searchText) =>
      searchText.includes("convnext_tiny_full") ||
      searchText.includes("convnext-tiny full") ||
      (String(modelVersion.architecture || "").trim().toLowerCase() ===
        "convnext_tiny" &&
        !searchText.includes("mil")),
  ];

  for (const matcher of preferredMatchers) {
    const match = pickPreferredCompareModel(
      sortedModelVersions,
      matcher,
      selectedIds,
    );
    if (!match) {
      continue;
    }
    selected.push(match.version_id);
    selectedIds.add(match.version_id);
    const architecture =
      String(match.architecture || "").trim().toLowerCase() || match.version_id;
    seenArchitectures.add(architecture);
    if (selected.length >= 3) {
      return selected;
    }
  }

  for (const modelVersion of sortedModelVersions) {
    if (!isSelectableCompareModelVersion(modelVersion)) {
      continue;
    }
    if (selectedIds.has(modelVersion.version_id)) {
      continue;
    }
    const architecture =
      String(modelVersion.architecture || "").trim().toLowerCase() ||
      modelVersion.version_id;
    if (seenArchitectures.has(architecture)) {
      continue;
    }
    seenArchitectures.add(architecture);
    selected.push(modelVersion.version_id);
    selectedIds.add(modelVersion.version_id);
    if (selected.length >= 3) {
      break;
    }
  }
  return selected;
}

export function defaultValidationModelVersionSelection(
  modelVersions: ModelVersionRecord[],
): string | null {
  return preferredValidationModelVersion(modelVersions)?.version_id ?? null;
}
