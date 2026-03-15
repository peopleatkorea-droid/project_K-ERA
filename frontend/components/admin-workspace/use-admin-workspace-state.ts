"use client";

import { useState } from "react";

import { pick, useI18n } from "../../lib/i18n";
import {
  type AccessRequestRecord,
  type AdminOverviewResponse,
  type AggregationRecord,
  type AiClinicEmbeddingStatusResponse,
  type AuthUser,
  type BulkImportResponse,
  type CrossValidationFoldRecord,
  type CrossValidationReport,
  type InitialTrainingBenchmarkResponse,
  type InitialTrainingResponse,
  type ManagedSiteRecord,
  type ManagedUserRecord,
  type ModelUpdateRecord,
  type ModelVersionRecord,
  type ProjectRecord,
  type SiteComparisonRecord,
  type SiteJobRecord,
  type SiteValidationRunRecord,
  type StorageSettingsRecord,
} from "../../lib/api";
import { type DashboardCasePreview } from "./dashboard-section";

const ROC_CURVE_COLORS = ["#2a8f5b", "#f39c12", "#2e6cff", "#8f2bb3", "#d64545"];

export type WorkspaceSection =
  | "dashboard"
  | "imports"
  | "requests"
  | "training"
  | "cross_validation"
  | "registry"
  | "management"
  | "federation";

export type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

export type UserFormState = {
  username: string;
  full_name: string;
  password: string;
  role: string;
  site_ids: string[];
};

export type ToastState = { tone: "success" | "error"; message: string } | null;

type UseAdminWorkspaceStateOptions = {
  user: AuthUser;
  initialSection?: WorkspaceSection;
  selectedSiteId: string | null;
};

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getFoldConfusionMatrix(fold: CrossValidationFoldRecord | null | undefined): number[][] | null {
  const raw = fold?.test_metrics?.confusion_matrix;
  if (!raw || typeof raw !== "object" || !("matrix" in raw)) {
    return null;
  }
  const matrix = raw.matrix;
  if (
    Array.isArray(matrix) &&
    matrix.length === 2 &&
    matrix.every((row) => Array.isArray(row) && row.length === 2 && row.every((value) => typeof value === "number"))
  ) {
    return matrix as number[][];
  }
  return null;
}

function sumCrossValidationConfusionMatrices(folds: CrossValidationFoldRecord[]): number[][] | null {
  const matrices = folds.map((fold) => getFoldConfusionMatrix(fold)).filter((matrix): matrix is number[][] => matrix !== null);
  if (matrices.length === 0) {
    return null;
  }
  return matrices.reduce(
    (total, matrix) => [
      [total[0][0] + matrix[0][0], total[0][1] + matrix[0][1]],
      [total[1][0] + matrix[1][0], total[1][1] + matrix[1][1]],
    ],
    [
      [0, 0],
      [0, 0],
    ],
  );
}

function getValidationRunRocPoints(run: SiteValidationRunRecord | null | undefined): Array<{ x: number; y: number }> {
  const fpr = run?.roc_curve?.fpr;
  const tpr = run?.roc_curve?.tpr;
  if (!Array.isArray(fpr) || !Array.isArray(tpr) || fpr.length !== tpr.length || fpr.length < 2) {
    return [];
  }
  const points = fpr
    .map((falsePositiveRate, index) => {
      const truePositiveRate = tpr[index];
      if (typeof falsePositiveRate !== "number" || typeof truePositiveRate !== "number") {
        return null;
      }
      return {
        x: clampUnitInterval(falsePositiveRate),
        y: clampUnitInterval(truePositiveRate),
      };
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .sort((left, right) => left.x - right.x || left.y - right.y);
  return points.length >= 2 ? points : [];
}

export function getDefaultRocSelection(runs: SiteValidationRunRecord[]): string[] {
  const selectedIds: string[] = [];
  const seenModelKeys = new Set<string>();
  for (const run of runs) {
    if (!getValidationRunRocPoints(run).length) {
      continue;
    }
    const modelKey = `${run.model_version_id}:${run.model_version}`;
    if (seenModelKeys.has(modelKey)) {
      continue;
    }
    seenModelKeys.add(modelKey);
    selectedIds.push(run.validation_id);
    if (selectedIds.length >= 4) {
      break;
    }
  }
  return selectedIds;
}

export function createUserForm(): UserFormState {
  return {
    username: "",
    full_name: "",
    password: "",
    role: "viewer",
    site_ids: [],
  };
}

export function createSiteForm(projectId = "") {
  return {
    project_id: projectId,
    site_code: "",
    display_name: "",
    hospital_name: "",
  };
}

export function useAdminWorkspaceState({ user, initialSection, selectedSiteId }: UseAdminWorkspaceStateOptions) {
  const { locale, localeTag, common } = useI18n();
  const [section, setSection] = useState<WorkspaceSection>(initialSection ?? "dashboard");
  const [toast, setToast] = useState<ToastState>(null);
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [storageSettings, setStorageSettings] = useState<StorageSettingsRecord | null>(null);
  const [pendingRequests, setPendingRequests] = useState<AccessRequestRecord[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [modelVersions, setModelVersions] = useState<ModelVersionRecord[]>([]);
  const [modelUpdates, setModelUpdates] = useState<ModelUpdateRecord[]>([]);
  const [aggregations, setAggregations] = useState<AggregationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [managedSites, setManagedSites] = useState<ManagedSiteRecord[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUserRecord[]>([]);
  const [siteComparison, setSiteComparison] = useState<SiteComparisonRecord[]>([]);
  const [siteValidationRuns, setSiteValidationRuns] = useState<SiteValidationRunRecord[]>([]);
  const [selectedValidationId, setSelectedValidationId] = useState<string | null>(null);
  const [baselineValidationId, setBaselineValidationId] = useState<string | null>(null);
  const [compareValidationId, setCompareValidationId] = useState<string | null>(null);
  const [rocValidationIds, setRocValidationIds] = useState<string[]>([]);
  const [misclassifiedCases, setMisclassifiedCases] = useState<DashboardCasePreview[]>([]);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<BulkImportResponse | null>(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [siteForm, setSiteForm] = useState(() => createSiteForm());
  const [instanceStorageRootForm, setInstanceStorageRootForm] = useState("");
  const [siteStorageRootForm, setSiteStorageRootForm] = useState("");
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() => createUserForm());
  const [initialBusy, setInitialBusy] = useState(false);
  const [initialResult, setInitialResult] = useState<InitialTrainingResponse | null>(null);
  const [initialJob, setInitialJob] = useState<SiteJobRecord | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<InitialTrainingBenchmarkResponse | null>(null);
  const [benchmarkJob, setBenchmarkJob] = useState<SiteJobRecord | null>(null);
  const [crossValidationBusy, setCrossValidationBusy] = useState(false);
  const [crossValidationJob, setCrossValidationJob] = useState<SiteJobRecord | null>(null);
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<AiClinicEmbeddingStatusResponse | null>(null);
  const [embeddingStatusBusy, setEmbeddingStatusBusy] = useState(false);
  const [embeddingBackfillBusy, setEmbeddingBackfillBusy] = useState(false);
  const [validationExportBusy, setValidationExportBusy] = useState(false);
  const [crossValidationExportBusy, setCrossValidationExportBusy] = useState(false);
  const [crossValidationReports, setCrossValidationReports] = useState<CrossValidationReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedModelUpdateId, setSelectedModelUpdateId] = useState<string | null>(null);
  const [modelUpdateReviewNotes, setModelUpdateReviewNotes] = useState<Record<string, string>>({});
  const [selectedUpdatePreviewUrls, setSelectedUpdatePreviewUrls] = useState({
    source: null as string | null,
    roi: null as string | null,
    mask: null as string | null,
  });
  const [aggregationBusy, setAggregationBusy] = useState(false);
  const [storageSettingsBusy, setStorageSettingsBusy] = useState(false);
  const [newVersionName, setNewVersionName] = useState("");
  const [initialForm, setInitialForm] = useState({
    architecture: "convnext_tiny",
    execution_mode: "auto" as "auto" | "cpu" | "gpu",
    crop_mode: "automated" as "automated" | "manual" | "both",
    epochs: 30,
    learning_rate: 1e-4,
    batch_size: 16,
    val_split: 0.2,
    test_split: 0.2,
    use_pretrained: true,
    regenerate_split: false,
  });
  const [crossValidationForm, setCrossValidationForm] = useState({
    architecture: "convnext_tiny",
    execution_mode: "auto" as "auto" | "cpu" | "gpu",
    crop_mode: "automated" as "automated" | "manual",
    num_folds: 5,
    epochs: 10,
    learning_rate: 1e-4,
    batch_size: 16,
    val_split: 0.2,
    use_pretrained: true,
  });

  const canAggregate = user.role === "admin";
  const canManagePlatform = user.role === "admin";
  const canManageStorageRoot = user.role === "admin" || user.role === "site_admin";
  const selectedManagedSite = managedSites.find((item) => item.site_id === selectedSiteId) ?? null;
  const currentModel = modelVersions.find((item) => item.is_current) ?? modelVersions[modelVersions.length - 1] ?? null;
  const pendingReviewUpdates = modelUpdates.filter((item) => ["pending_review", "pending_upload"].includes(item.status ?? ""));
  const approvedUpdates = modelUpdates.filter((item) => item.status === "approved");
  const selectedModelUpdate = modelUpdates.find((item) => item.update_id === selectedModelUpdateId) ?? modelUpdates[0] ?? null;
  const selectedApprovalReport = selectedModelUpdate?.approval_report ?? null;
  const selectedReport = crossValidationReports.find((item) => item.cross_validation_id === selectedReportId) ?? null;
  const selectedReportConfusion = selectedReport ? sumCrossValidationConfusionMatrices(selectedReport.fold_results) : null;
  const selectedValidationRun = siteValidationRuns.find((item) => item.validation_id === selectedValidationId) ?? null;
  const baselineValidationRun = siteValidationRuns.find((item) => item.validation_id === baselineValidationId) ?? null;
  const compareValidationRun = siteValidationRuns.find((item) => item.validation_id === compareValidationId) ?? null;
  const rocEligibleRuns = siteValidationRuns.filter((item) => getValidationRunRocPoints(item).length > 0);
  const selectedRocRuns = rocValidationIds
    .map((validationId) => rocEligibleRuns.find((item) => item.validation_id === validationId) ?? null)
    .filter((item): item is SiteValidationRunRecord => item !== null);
  const rocSeries = selectedRocRuns.map((run, index) => ({
    run,
    color: ROC_CURVE_COLORS[index % ROC_CURVE_COLORS.length],
    points: getValidationRunRocPoints(run),
  }));
  const rocSelectionLimitReached = selectedRocRuns.length >= ROC_CURVE_COLORS.length;
  const rocCohortKeys = new Set(selectedRocRuns.map((run) => `${run.n_patients}:${run.n_cases}:${run.n_images}`));
  const rocHasCohortMismatch = rocCohortKeys.size > 1;
  const modelComparisonRows = Object.entries(
    siteValidationRuns.reduce<Record<string, { count: number; accuracy: number; sensitivity: number; specificity: number; f1: number; auroc: number; aurocCount: number }>>(
      (accumulator, run) => {
        const key = run.model_version || "unknown";
        const current = accumulator[key] ?? {
          count: 0,
          accuracy: 0,
          sensitivity: 0,
          specificity: 0,
          f1: 0,
          auroc: 0,
          aurocCount: 0,
        };
        current.count += 1;
        current.accuracy += run.accuracy ?? 0;
        current.sensitivity += run.sensitivity ?? 0;
        current.specificity += run.specificity ?? 0;
        current.f1 += run.F1 ?? 0;
        if (typeof run.AUROC === "number") {
          current.auroc += run.AUROC;
          current.aurocCount += 1;
        }
        accumulator[key] = current;
        return accumulator;
      },
      {},
    ),
  ).map(([modelVersion, metrics]) => ({
    modelVersion,
    count: metrics.count,
    accuracy: metrics.count ? metrics.accuracy / metrics.count : null,
    sensitivity: metrics.count ? metrics.sensitivity / metrics.count : null,
    specificity: metrics.count ? metrics.specificity / metrics.count : null,
    F1: metrics.count ? metrics.f1 / metrics.count : null,
    AUROC: metrics.aurocCount ? metrics.auroc / metrics.aurocCount : null,
  }));
  const initialProgress = initialJob?.result?.progress ?? null;
  const progressPercent = Math.max(0, Math.min(100, Math.round(initialProgress?.percent ?? 0)));
  const benchmarkProgress = benchmarkJob?.result?.progress ?? null;
  const benchmarkPercent = Math.max(0, Math.min(100, Math.round(benchmarkProgress?.percent ?? 0)));
  const crossValidationProgress = crossValidationJob?.result?.progress ?? null;
  const crossValidationPercent = Math.max(0, Math.min(100, Math.round(crossValidationProgress?.percent ?? 0)));

  const formatTrainingStage = (stage: string | null | undefined) => {
    switch (stage) {
      case "queued":
        return pick(locale, "Queued", "대기 중");
      case "preparing_data":
        return pick(locale, "Preparing data", "데이터 준비");
      case "preparing_component":
        return pick(locale, "Preparing component", "학습 데이터 준비");
      case "preparing_fold":
        return pick(locale, "Preparing fold", "fold 준비");
      case "training_component":
        return pick(locale, "Training", "학습 중");
      case "training_fold":
        return pick(locale, "Training fold", "fold 학습");
      case "registering_component":
        return pick(locale, "Registering model", "모델 등록");
      case "selecting_ensemble":
        return pick(locale, "Selecting ensemble weight", "앙상블 가중치 선택");
      case "finalizing":
        return pick(locale, "Finalizing", "마무리");
      case "completed":
        return pick(locale, "Completed", "완료");
      case "failed":
        return pick(locale, "Failed", "실패");
      default:
        return pick(locale, "In progress", "진행 중");
    }
  };

  const formatEmbeddingStage = (stage: string | null | undefined) => {
    switch (stage) {
      case "queued":
        return pick(locale, "Queued", "대기 중");
      case "running":
        return pick(locale, "Running", "실행 중");
      case "completed":
        return pick(locale, "Completed", "완료");
      case "failed":
        return pick(locale, "Failed", "실패");
      default:
        return pick(locale, "Idle", "유휴");
    }
  };

  const toggleRocValidationSelection = (validationId: string) => {
    setRocValidationIds((current) => {
      if (current.includes(validationId)) {
        return current.filter((item) => item !== validationId);
      }
      if (current.length >= ROC_CURVE_COLORS.length) {
        return current;
      }
      return [...current, validationId];
    });
  };

  return {
    locale,
    localeTag,
    common,
    section,
    setSection,
    toast,
    setToast,
    overview,
    setOverview,
    storageSettings,
    setStorageSettings,
    pendingRequests,
    setPendingRequests,
    reviewDrafts,
    setReviewDrafts,
    modelVersions,
    setModelVersions,
    modelUpdates,
    setModelUpdates,
    aggregations,
    setAggregations,
    projects,
    setProjects,
    managedSites,
    setManagedSites,
    managedUsers,
    setManagedUsers,
    siteComparison,
    setSiteComparison,
    siteValidationRuns,
    setSiteValidationRuns,
    selectedValidationId,
    setSelectedValidationId,
    baselineValidationId,
    setBaselineValidationId,
    compareValidationId,
    setCompareValidationId,
    rocValidationIds,
    setRocValidationIds,
    misclassifiedCases,
    setMisclassifiedCases,
    dashboardBusy,
    setDashboardBusy,
    bulkCsvFile,
    setBulkCsvFile,
    bulkFiles,
    setBulkFiles,
    bulkImportBusy,
    setBulkImportBusy,
    bulkImportResult,
    setBulkImportResult,
    projectForm,
    setProjectForm,
    siteForm,
    setSiteForm,
    instanceStorageRootForm,
    setInstanceStorageRootForm,
    siteStorageRootForm,
    setSiteStorageRootForm,
    editingSiteId,
    setEditingSiteId,
    userForm,
    setUserForm,
    initialBusy,
    setInitialBusy,
    initialResult,
    setInitialResult,
    initialJob,
    setInitialJob,
    benchmarkBusy,
    setBenchmarkBusy,
    benchmarkResult,
    setBenchmarkResult,
    benchmarkJob,
    setBenchmarkJob,
    crossValidationBusy,
    setCrossValidationBusy,
    crossValidationJob,
    setCrossValidationJob,
    siteValidationBusy,
    setSiteValidationBusy,
    embeddingStatus,
    setEmbeddingStatus,
    embeddingStatusBusy,
    setEmbeddingStatusBusy,
    embeddingBackfillBusy,
    setEmbeddingBackfillBusy,
    validationExportBusy,
    setValidationExportBusy,
    crossValidationExportBusy,
    setCrossValidationExportBusy,
    crossValidationReports,
    setCrossValidationReports,
    selectedReportId,
    setSelectedReportId,
    selectedModelUpdateId,
    setSelectedModelUpdateId,
    modelUpdateReviewNotes,
    setModelUpdateReviewNotes,
    selectedUpdatePreviewUrls,
    setSelectedUpdatePreviewUrls,
    aggregationBusy,
    setAggregationBusy,
    storageSettingsBusy,
    setStorageSettingsBusy,
    newVersionName,
    setNewVersionName,
    initialForm,
    setInitialForm,
    crossValidationForm,
    setCrossValidationForm,
    canAggregate,
    canManagePlatform,
    canManageStorageRoot,
    selectedManagedSite,
    currentModel,
    pendingReviewUpdates,
    approvedUpdates,
    selectedModelUpdate,
    selectedApprovalReport,
    selectedReport,
    selectedReportConfusion,
    selectedValidationRun,
    baselineValidationRun,
    compareValidationRun,
    rocEligibleRuns,
    selectedRocRuns,
    rocSeries,
    rocSelectionLimitReached,
    rocHasCohortMismatch,
    modelComparisonRows,
    initialProgress,
    progressPercent,
    benchmarkProgress,
    benchmarkPercent,
    crossValidationProgress,
    crossValidationPercent,
    formatTrainingStage,
    formatEmbeddingStage,
    toggleRocValidationSelection,
  };
}
