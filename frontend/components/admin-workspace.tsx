"use client";

import { useEffect, useRef, useState } from "react";

import { LocaleToggle, pick, translateApiError, translateRole, translateStatus, useI18n } from "../lib/i18n";
import {
  createAdminSite,
  createProject,
  downloadImportTemplate,
  fetchAccessRequests,
  fetchAdminOverview,
  fetchStorageSettings,
  fetchAdminSites,
  fetchAggregations,
  fetchCrossValidationReports,
  deleteModelVersion,
  fetchImageBlob,
  fetchModelUpdateArtifactBlob,
  fetchModelUpdates,
  fetchModelVersions,
  fetchProjects,
  fetchSiteJob,
  fetchSiteComparison,
  fetchSiteValidations,
  fetchUsers,
  fetchValidationArtifactBlob,
  fetchValidationCases,
  migrateAdminSiteStorageRoot,
  reviewAccessRequest,
  reviewModelUpdate,
  runBulkImport,
  runCrossValidation,
  runFederatedAggregation,
  runInitialTraining,
  runInitialTrainingBenchmark,
  runSiteValidation,
  updateAdminSite,
  updateAdminSiteStorageRoot,
  updateStorageSettings,
  upsertManagedUser,
  type AccessRequestRecord,
  type AdminOverviewResponse,
  type AggregationRecord,
  type AuthUser,
  type BulkImportResponse,
  type CrossValidationFoldRecord,
  type CrossValidationReport,
  type InitialTrainingBenchmarkResponse,
  type InitialTrainingResponse,
  type SiteJobRecord,
  type ManagedSiteRecord,
  type ManagedUserRecord,
  type ModelUpdateRecord,
  type ModelVersionRecord,
  type ProjectRecord,
  type SiteComparisonRecord,
  type SiteRecord,
  type SiteSummary,
  type StorageSettingsRecord,
  type SiteValidationRunRecord,
  type ValidationCasePredictionRecord,
} from "../lib/api";

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "cnn", label: "CNN" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "densenet121", label: "DenseNet121" },
  { value: "densenet161", label: "DenseNet161" },
  { value: "densenet169", label: "DenseNet169" },
  { value: "densenet201", label: "DenseNet201" },
];
const BENCHMARK_ARCHITECTURES = ["vit", "swin", "convnext_tiny", "densenet121"];

const ROC_CURVE_COLORS = ["#2a8f5b", "#f39c12", "#2e6cff", "#8f2bb3", "#d64545"];
const ROC_CHART_WIDTH = 420;
const ROC_CHART_HEIGHT = 320;
const ROC_CHART_PADDING = { top: 18, right: 18, bottom: 42, left: 48 };
const ROC_AXIS_TICKS = [0, 0.25, 0.5, 0.75, 1];

type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

export type WorkspaceSection =
  | "dashboard"
  | "imports"
  | "requests"
  | "training"
  | "cross_validation"
  | "registry"
  | "management"
  | "federation";

type UserFormState = {
  username: string;
  full_name: string;
  password: string;
  role: string;
  site_ids: string[];
};

type DashboardCasePreview = ValidationCasePredictionRecord & {
  original_preview_url: string | null;
  roi_preview_url: string | null;
  gradcam_preview_url: string | null;
};

type AdminWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  theme: "dark" | "light";
  initialSection?: WorkspaceSection;
  onSelectSite: (siteId: string) => void;
  onOpenCanvas: () => void;
  onLogout: () => void;
  onRefreshSites: () => Promise<void>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
  onToggleTheme: () => void;
};

type ToastState = { tone: "success" | "error"; message: string } | null;

function formatDateTime(value: string | null | undefined, localeTag = "en-US", emptyLabel = "n/a"): string {
  if (!value) return emptyLabel;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(localeTag, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMetric(value: number | null | undefined, emptyLabel = "n/a"): string {
  return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(3) : emptyLabel;
}

function formatDelta(nextValue: number | null | undefined, baselineValue: number | null | undefined, emptyLabel = "n/a"): string {
  if (typeof nextValue !== "number" || typeof baselineValue !== "number") {
    return emptyLabel;
  }
  const delta = nextValue - baselineValue;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatWeightPercent(value: number | null | undefined) {
  return typeof value === "number" && !Number.isNaN(value) ? `${Math.round(value * 100)}%` : "n/a";
}

function getFoldConfusionMatrix(fold: CrossValidationFoldRecord | null | undefined): number[][] | null {
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

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function buildRocPath(points: Array<{ x: number; y: number }>): string {
  const plotWidth = ROC_CHART_WIDTH - ROC_CHART_PADDING.left - ROC_CHART_PADDING.right;
  const plotHeight = ROC_CHART_HEIGHT - ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom;
  return points
    .map((point, index) => {
      const x = ROC_CHART_PADDING.left + point.x * plotWidth;
      const y = ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom - point.y * plotHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function getDefaultRocSelection(runs: SiteValidationRunRecord[]): string[] {
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

function createUserForm(): UserFormState {
  return {
    username: "",
    full_name: "",
    password: "",
    role: "viewer",
    site_ids: [],
  };
}

function createSiteForm(projectId = "") {
  return {
    project_id: projectId,
    site_code: "",
    display_name: "",
    hospital_name: "",
  };
}

function formatQualityRecommendation(locale: "en" | "ko", recommendation: string | null | undefined): string {
  switch (recommendation) {
    case "approve_candidate":
      return pick(locale, "Approve candidate", "승인 권장");
    case "needs_review":
      return pick(locale, "Needs review", "추가 검토");
    case "reject_candidate":
      return pick(locale, "Reject candidate", "반려 권장");
    default:
      return pick(locale, "Unrated", "미평가");
  }
}

function translateQualityFlag(locale: "en" | "ko", flag: string): string {
  const labels: Record<string, [string, string]> = {
    brightness_out_of_range: ["Brightness out of range", "밝기 범위 이탈"],
    low_contrast: ["Low contrast", "대비 부족"],
    low_edge_density: ["Low edge density", "경계 정보 부족"],
    crop_ratio_missing: ["Crop ratio missing", "crop 비율 없음"],
    crop_too_tight: ["Crop too tight", "crop 너무 좁음"],
    crop_too_wide: ["Crop too wide", "crop 너무 넓음"],
    validation_mismatch: ["Validation mismatch", "검증 불일치"],
    delta_invalid: ["Delta invalid", "delta 이상"],
    delta_missing: ["Delta missing", "delta 없음"],
    polymicrobial_excluded: ["Polymicrobial excluded", "다균종 학습 제외"],
  };
  const pair = labels[flag];
  return pair ? pick(locale, pair[0], pair[1]) : flag;
}

export function AdminWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  theme,
  initialSection,
  onSelectSite,
  onOpenCanvas,
  onLogout,
  onRefreshSites,
  onSiteDataChanged,
  onToggleTheme,
}: AdminWorkspaceProps) {
  const { locale, localeTag, common } = useI18n();
  const describeError = (nextError: unknown, fallback: string) =>
    nextError instanceof Error ? translateApiError(locale, nextError.message) : fallback;
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
  const [validationExportBusy, setValidationExportBusy] = useState(false);
  const [crossValidationExportBusy, setCrossValidationExportBusy] = useState(false);
  const [crossValidationReports, setCrossValidationReports] = useState<CrossValidationReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedModelUpdateId, setSelectedModelUpdateId] = useState<string | null>(null);
  const [modelUpdateReviewNotes, setModelUpdateReviewNotes] = useState<Record<string, string>>({});
  const [selectedUpdatePreviewUrls, setSelectedUpdatePreviewUrls] = useState<{
    source: string | null;
    roi: string | null;
    mask: string | null;
  }>({
    source: null,
    roi: null,
    mask: null,
  });
  const [aggregationBusy, setAggregationBusy] = useState(false);
  const [storageSettingsBusy, setStorageSettingsBusy] = useState(false);
  const [newVersionName, setNewVersionName] = useState("");
  const dashboardPreviewUrlsRef = useRef<string[]>([]);
  const modelUpdatePreviewUrlsRef = useRef<string[]>([]);
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
      {}
    )
  ).map(([modelVersion, metrics]) => ({
    modelVersion,
    count: metrics.count,
    accuracy: metrics.count ? metrics.accuracy / metrics.count : null,
    sensitivity: metrics.count ? metrics.sensitivity / metrics.count : null,
    specificity: metrics.count ? metrics.specificity / metrics.count : null,
    F1: metrics.count ? metrics.f1 / metrics.count : null,
    AUROC: metrics.aurocCount ? metrics.auroc / metrics.aurocCount : null,
  }));
  const copy = {
    unableLoadOperations: pick(locale, "Unable to load operations.", "운영 화면을 불러오지 못했습니다."),
    unableLoadStorageSettings: pick(locale, "Unable to load storage settings.", "저장 경로 설정을 불러오지 못했습니다."),
    unableLoadMisclassified: pick(locale, "Unable to load misclassified cases.", "오분류 케이스를 불러오지 못했습니다."),
    requestReviewed: (decision: "approved" | "rejected") =>
      pick(locale, `Request ${decision}.`, `요청이 ${decision === "approved" ? "승인" : "반려"} 처리되었습니다.`),
    unableReview: pick(locale, "Unable to review request.", "요청 검토에 실패했습니다."),
    selectSiteForInitial: pick(locale, "Select a hospital before starting initial training.", "초기 학습을 시작하려면 병원을 선택하세요."),
    registeredVersion: (name: string) => pick(locale, `Registered ${name}.`, `${name} 버전을 등록했습니다.`),
    initialTrainingFailed: pick(locale, "Initial training failed.", "초기 학습에 실패했습니다."),
    selectSiteForCrossValidation: pick(locale, "Select a hospital before running cross-validation.", "교차 검증을 실행하려면 병원을 선택하세요."),
    savedReport: (reportId: string) => pick(locale, `Saved report ${reportId}.`, `${reportId} 리포트를 저장했습니다.`),
    crossValidationFailed: pick(locale, "Cross-validation failed.", "교차 검증에 실패했습니다."),
    createdVersion: (name: string) => pick(locale, `Created ${name}.`, `${name} 버전을 생성했습니다.`),
    aggregationFailed: pick(locale, "Federated aggregation failed.", "연합 집계에 실패했습니다."),
    updateReviewed: (decision: "approved" | "rejected") =>
      pick(locale, `Update ${decision}.`, `업데이트를 ${decision === "approved" ? "승인" : "반려"}했습니다.`),
    updateReviewFailed: pick(locale, "Unable to review model update.", "모델 업데이트 검토에 실패했습니다."),
    modelDeleted: (name: string) => pick(locale, `Deleted ${name}.`, `${name} 모델을 삭제했습니다.`),
    modelDeleteFailed: pick(locale, "Unable to delete the model.", "모델 삭제에 실패했습니다."),
    selectSiteForTemplate: pick(locale, "Select a hospital before downloading the template.", "템플릿을 내려받으려면 병원을 선택하세요."),
    templateDownloadFailed: pick(locale, "Template download failed.", "템플릿 다운로드에 실패했습니다."),
    selectSiteForImport: pick(locale, "Select a hospital before importing.", "임포트를 하려면 병원을 선택하세요."),
    chooseCsvFirst: pick(locale, "Choose a CSV file first.", "먼저 CSV 파일을 선택하세요."),
    importedImages: (count: number, siteId: string) => pick(locale, `Imported ${count} images into hospital ${siteId}.`, `병원 ${siteId}에 이미지 ${count}개를 임포트했습니다.`),
    bulkImportFailed: pick(locale, "Bulk import failed.", "대량 임포트에 실패했습니다."),
    projectNameRequired: pick(locale, "Project name is required.", "프로젝트 이름은 필수입니다."),
    projectRegistered: pick(locale, "Project registered.", "프로젝트를 등록했습니다."),
    unableCreateProject: pick(locale, "Unable to create project.", "프로젝트 생성에 실패했습니다."),
    siteFieldsRequired: pick(locale, "Project, hospital code, and app display name are required.", "프로젝트, 병원 코드, 앱 표시명은 필수입니다."),
    siteNameRequired: pick(locale, "App display name is required.", "앱 표시명은 필수입니다."),
    siteRegistered: (siteId: string) => pick(locale, `Hospital ${siteId} registered.`, `${siteId} 병원을 등록했습니다.`),
    unableCreateSite: pick(locale, "Unable to create hospital.", "병원 생성에 실패했습니다."),
    siteUpdated: (siteId: string) => pick(locale, `Updated hospital ${siteId}.`, `${siteId} 병원 정보를 수정했습니다.`),
    unableUpdateSite: pick(locale, "Unable to update hospital.", "병원 수정에 실패했습니다."),
    storageRootSaved: pick(locale, "Default storage root saved.", "기본 저장 경로를 저장했습니다."),
    unableSaveStorageRoot: pick(locale, "Unable to save storage root.", "저장 경로 저장에 실패했습니다."),
    selectedSiteStorageRootSaved: (siteId: string) =>
      pick(locale, `Saved storage root for ${siteId}.`, `${siteId}의 저장 경로를 저장했습니다.`),
    unableSaveSelectedSiteStorageRoot: pick(locale, "Unable to save the selected hospital storage root.", "선택한 병원의 저장 경로 저장에 실패했습니다."),
    selectedSiteStorageMigrated: (siteId: string) =>
      pick(locale, `Migrated stored files for ${siteId}.`, `${siteId}의 저장 파일을 새 경로로 이동했습니다.`),
    unableMigrateSelectedSiteStorageRoot: pick(locale, "Unable to migrate the selected hospital storage root.", "선택한 병원의 저장 경로 마이그레이션에 실패했습니다."),
    selectSiteForStorageRoot: pick(locale, "Select a hospital before changing its storage root.", "저장 경로를 바꾸려면 먼저 병원을 선택하세요."),
    usernameRequired: pick(locale, "Username is required.", "아이디는 필수입니다."),
    assignSiteRequired: pick(locale, "Assign at least one hospital for non-admin users.", "관리자가 아닌 사용자는 최소 한 개 이상의 병원을 지정해야 합니다."),
    userSaved: pick(locale, "User settings saved.", "사용자 설정을 저장했습니다."),
    unableSaveUser: pick(locale, "Unable to save user.", "사용자 저장에 실패했습니다."),
    initialTrainingMissingResult: pick(locale, "Training finished without a result payload.", "학습이 끝났지만 결과를 받지 못했습니다."),
    crossValidationMissingResult: pick(locale, "Cross-validation finished without a report payload.", "교차 검증이 끝났지만 리포트를 받지 못했습니다."),
  };
  const initialProgress = initialJob?.result?.progress ?? null;
  const progressPercent = Math.max(0, Math.min(100, Math.round(initialProgress?.percent ?? 0)));
  const benchmarkProgress = benchmarkJob?.result?.progress ?? null;
  const benchmarkPercent = Math.max(0, Math.min(100, Math.round(benchmarkProgress?.percent ?? 0)));
  const crossValidationProgress = crossValidationJob?.result?.progress ?? null;
  const crossValidationPercent = Math.max(0, Math.min(100, Math.round(crossValidationProgress?.percent ?? 0)));
  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection]);
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

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    return () => {
      for (const url of dashboardPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      for (const url of modelUpdatePreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [
          nextOverview,
          nextStorageSettings,
          nextRequests,
          nextVersions,
          nextUpdates,
          nextAggregations,
          nextProjects,
          nextManagedSites,
          nextManagedUsers,
          nextSiteComparison,
          nextCrossValidationReports,
          nextSiteValidationRuns,
        ] = await Promise.all([
          fetchAdminOverview(token),
          fetchStorageSettings(token),
          fetchAccessRequests(token, "pending"),
          fetchModelVersions(token),
          fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
          canAggregate ? fetchAggregations(token) : Promise.resolve([]),
          fetchProjects(token),
          fetchAdminSites(token),
          canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
          fetchSiteComparison(token),
          selectedSiteId ? fetchCrossValidationReports(selectedSiteId, token) : Promise.resolve([]),
          selectedSiteId ? fetchSiteValidations(selectedSiteId, token) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setOverview(nextOverview);
        setStorageSettings(nextStorageSettings);
        setPendingRequests(nextRequests);
        setModelVersions(nextVersions);
        setModelUpdates(nextUpdates);
        setAggregations(nextAggregations);
        setProjects(nextProjects);
        setManagedSites(nextManagedSites);
        setManagedUsers(nextManagedUsers);
        setSiteComparison(nextSiteComparison);
        setCrossValidationReports(nextCrossValidationReports);
        setSelectedReportId((current) => current ?? nextCrossValidationReports[0]?.cross_validation_id ?? null);
        setSiteValidationRuns(nextSiteValidationRuns);
        setInstanceStorageRootForm((current) => current || nextStorageSettings.storage_root);
        setSiteStorageRootForm((current) => {
          if (current) {
            return current;
          }
          const activeSite = nextManagedSites.find((item) => item.site_id === selectedSiteId) ?? nextManagedSites[0];
          return activeSite?.local_storage_root ?? "";
        });
        setSiteForm((current) => ({
          ...current,
          project_id: current.project_id || nextProjects[0]?.project_id || "",
        }));
        setReviewDrafts((current) => {
          const next = { ...current };
          for (const item of nextRequests) {
            next[item.request_id] = next[item.request_id] ?? {
              assigned_role: item.requested_role,
              assigned_site_id: item.requested_site_id,
              reviewer_notes: "",
            };
          }
          return next;
        });
        setModelUpdateReviewNotes((current) => {
          const next = { ...current };
          for (const item of nextUpdates) {
            if (next[item.update_id] === undefined) {
              next[item.update_id] = item.reviewer_notes ?? "";
            }
          }
          return next;
        });
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadStorageSettings) });
        }
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [token, selectedSiteId, canAggregate, canManagePlatform]);

  useEffect(() => {
    if (!siteValidationRuns.length) {
      setSelectedValidationId(null);
      setBaselineValidationId(null);
      setCompareValidationId(null);
      setRocValidationIds([]);
      setMisclassifiedCases([]);
      return;
    }
    setSelectedValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setCompareValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setBaselineValidationId((current) => current ?? siteValidationRuns[1]?.validation_id ?? siteValidationRuns[0]?.validation_id ?? null);
    setRocValidationIds((current) => {
      const validIds = current.filter((validationId) =>
        siteValidationRuns.some((run) => run.validation_id === validationId && getValidationRunRocPoints(run).length > 0)
      );
      return validIds.length ? validIds : getDefaultRocSelection(siteValidationRuns);
    });
  }, [siteValidationRuns]);

  useEffect(() => {
    if (!modelUpdates.length) {
      setSelectedModelUpdateId(null);
      return;
    }
    setSelectedModelUpdateId((current) =>
      current && modelUpdates.some((item) => item.update_id === current) ? current : modelUpdates[0]?.update_id ?? null
    );
  }, [modelUpdates]);

  useEffect(() => {
    for (const url of dashboardPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    dashboardPreviewUrlsRef.current = [];
    if (!selectedSiteId || !selectedValidationId) {
      setMisclassifiedCases([]);
      return;
    }

    const currentSiteId = selectedSiteId;
    const currentValidationId = selectedValidationId;
    let cancelled = false;
    async function loadMisclassifiedCases() {
      setDashboardBusy(true);
      try {
        const cases = await fetchValidationCases(currentSiteId, currentValidationId, token, {
          misclassified_only: true,
          limit: 4,
        });
        const nextCases = await Promise.all(
          cases.map(async (item) => {
            let originalPreviewUrl: string | null = null;
            let roiPreviewUrl: string | null = null;
            let gradcamPreviewUrl: string | null = null;

            if (item.representative_image_id) {
              try {
                const blob = await fetchImageBlob(currentSiteId, item.representative_image_id, token);
                originalPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(originalPreviewUrl);
              } catch {
                originalPreviewUrl = null;
              }
            }
            if (item.roi_crop_available) {
              try {
                const blob = await fetchValidationArtifactBlob(
                  currentSiteId,
                  currentValidationId,
                  item.patient_id,
                  item.visit_date,
                  "roi_crop",
                  token
                );
                roiPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(roiPreviewUrl);
              } catch {
                roiPreviewUrl = null;
              }
            }
            if (item.gradcam_available) {
              try {
                const blob = await fetchValidationArtifactBlob(
                  currentSiteId,
                  currentValidationId,
                  item.patient_id,
                  item.visit_date,
                  "gradcam",
                  token
                );
                gradcamPreviewUrl = URL.createObjectURL(blob);
                dashboardPreviewUrlsRef.current.push(gradcamPreviewUrl);
              } catch {
                gradcamPreviewUrl = null;
              }
            }

            return {
              ...item,
              original_preview_url: originalPreviewUrl,
              roi_preview_url: roiPreviewUrl,
              gradcam_preview_url: gradcamPreviewUrl,
            };
          })
        );
        if (cancelled) return;
        setMisclassifiedCases(nextCases);
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadMisclassified) });
        }
      } finally {
        if (!cancelled) {
          setDashboardBusy(false);
        }
      }
    }
    void loadMisclassifiedCases();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, selectedValidationId, token]);

  useEffect(() => {
    for (const url of modelUpdatePreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    modelUpdatePreviewUrlsRef.current = [];
    setSelectedUpdatePreviewUrls({ source: null, roi: null, mask: null });
    if (!selectedModelUpdate) {
      return;
    }

    let cancelled = false;
    async function loadModelUpdatePreviews() {
      const nextUrls = { source: null as string | null, roi: null as string | null, mask: null as string | null };
      const artifactKinds: Array<["source" | "roi" | "mask", "source_thumbnail" | "roi_thumbnail" | "mask_thumbnail"]> = [
        ["source", "source_thumbnail"],
        ["roi", "roi_thumbnail"],
        ["mask", "mask_thumbnail"],
      ];
      for (const [key, artifactKind] of artifactKinds) {
        try {
          const blob = await fetchModelUpdateArtifactBlob(selectedModelUpdate.update_id, artifactKind, token);
          const url = URL.createObjectURL(blob);
          modelUpdatePreviewUrlsRef.current.push(url);
          nextUrls[key] = url;
        } catch {
          nextUrls[key] = null;
        }
      }
      if (!cancelled) {
        setSelectedUpdatePreviewUrls(nextUrls);
      }
    }

    void loadModelUpdatePreviews();
    return () => {
      cancelled = true;
    };
  }, [selectedModelUpdate, token]);

  useEffect(() => {
    if (storageSettings) {
      setInstanceStorageRootForm(storageSettings.storage_root);
    }
  }, [storageSettings]);

  useEffect(() => {
    setSiteStorageRootForm(selectedManagedSite?.local_storage_root ?? "");
  }, [selectedManagedSite?.site_id, selectedManagedSite?.local_storage_root]);

  async function refreshWorkspace(siteScoped = false) {
    const [
      nextOverview,
      nextStorageSettings,
      nextVersions,
      nextUpdates,
      nextAggregations,
      nextProjects,
      nextManagedSites,
      nextManagedUsers,
      nextSiteComparison,
      nextCrossValidationReports,
      nextSiteValidationRuns,
      nextRequests,
    ] = await Promise.all([
      fetchAdminOverview(token),
      fetchStorageSettings(token),
      fetchModelVersions(token),
      fetchModelUpdates(token, { site_id: selectedSiteId ?? undefined }),
      canAggregate ? fetchAggregations(token) : Promise.resolve([]),
      fetchProjects(token),
      fetchAdminSites(token),
      canManagePlatform ? fetchUsers(token) : Promise.resolve([]),
      fetchSiteComparison(token),
      selectedSiteId ? fetchCrossValidationReports(selectedSiteId, token) : Promise.resolve([]),
      selectedSiteId ? fetchSiteValidations(selectedSiteId, token) : Promise.resolve([]),
      fetchAccessRequests(token, "pending"),
    ]);
    setOverview(nextOverview);
    setStorageSettings(nextStorageSettings);
    setModelVersions(nextVersions);
    setModelUpdates(nextUpdates);
    setAggregations(nextAggregations);
    setProjects(nextProjects);
    setManagedSites(nextManagedSites);
    setManagedUsers(nextManagedUsers);
    setSiteComparison(nextSiteComparison);
    setCrossValidationReports(nextCrossValidationReports);
    setSiteValidationRuns(nextSiteValidationRuns);
    setPendingRequests(nextRequests);
    setInstanceStorageRootForm(nextStorageSettings.storage_root);
    if (siteScoped && selectedSiteId) {
      await onSiteDataChanged(selectedSiteId);
    }
  }

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    const draft = reviewDrafts[requestId];
    try {
      await reviewAccessRequest(requestId, token, {
        decision,
        assigned_role: draft?.assigned_role,
        assigned_site_id: draft?.assigned_site_id,
        reviewer_notes: draft?.reviewer_notes,
      });
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.requestReviewed(decision) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableReview) });
    }
  }

  async function handleInitialTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setInitialBusy(true);
    setInitialJob(null);
    try {
      const started = await runInitialTraining(selectedSiteId, token, initialForm);
      setInitialJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setInitialJob(latestJob);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.initialTrainingFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("result" in result)) {
        throw new Error(copy.initialTrainingMissingResult);
      }
      setInitialResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({ tone: "success", message: copy.registeredVersion(result.result.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.initialTrainingFailed) });
    } finally {
      setInitialBusy(false);
    }
  }

  async function handleBenchmarkTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForInitial });
      return;
    }
    setBenchmarkBusy(true);
    setBenchmarkJob(null);
    try {
      const started = await runInitialTrainingBenchmark(selectedSiteId, token, {
        architectures: BENCHMARK_ARCHITECTURES,
        execution_mode: initialForm.execution_mode,
        crop_mode: initialForm.crop_mode,
        epochs: initialForm.epochs,
        learning_rate: initialForm.learning_rate,
        batch_size: initialForm.batch_size,
        val_split: initialForm.val_split,
        test_split: initialForm.test_split,
        use_pretrained: initialForm.use_pretrained,
        regenerate_split: initialForm.regenerate_split,
      });
      setBenchmarkJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setBenchmarkJob(latestJob);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || pick(locale, "Benchmark training failed.", "벤치마크 학습에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!result || !("results" in result)) {
        throw new Error(pick(locale, "Benchmark training result is missing.", "벤치마크 학습 결과가 없습니다."));
      }
      setBenchmarkResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({
        tone: "success",
        message: pick(locale, `Benchmark completed for ${result.results.length} architecture(s).`, `${result.results.length}개 아키텍처 벤치마크가 완료되었습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Benchmark training failed.", "벤치마크 학습에 실패했습니다.")),
      });
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function handleCrossValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCrossValidation });
      return;
    }
    setCrossValidationBusy(true);
    setCrossValidationJob(null);
    try {
      const started = await runCrossValidation(selectedSiteId, token, crossValidationForm);
      setCrossValidationJob(started.job);
      let latestJob = started.job;
      while (latestJob.status === "queued" || latestJob.status === "running") {
        await sleep(1000);
        latestJob = await fetchSiteJob(selectedSiteId, latestJob.job_id, token);
        setCrossValidationJob(latestJob);
      }
      if (latestJob.status === "failed") {
        throw new Error(latestJob.result?.error || copy.crossValidationFailed);
      }
      const result = latestJob.result?.response;
      if (!result || !("report" in result)) {
        throw new Error(copy.crossValidationMissingResult);
      }
      const nextReports = [result.report, ...crossValidationReports.filter((item) => item.cross_validation_id !== result.report.cross_validation_id)];
      setCrossValidationReports(nextReports);
      setSelectedReportId(result.report.cross_validation_id);
      setToast({ tone: "success", message: copy.savedReport(result.report.cross_validation_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.crossValidationFailed) });
    } finally {
      setCrossValidationBusy(false);
    }
  }

  async function handleSiteValidation() {
    if (!selectedSiteId) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a hospital before running hospital validation.", "병원 검증을 실행하려면 병원을 선택하세요."),
      });
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
        throw new Error(latestJob.result?.error || pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다."));
      }
      const result = latestJob.result?.response;
      if (!result || !("summary" in result)) {
        throw new Error(pick(locale, "Hospital validation finished without a saved report.", "병원 검증이 끝났지만 저장된 리포트를 받지 못했습니다."));
      }
      setSiteValidationRuns((current) => [
        result.summary,
        ...current.filter((item) => item.validation_id !== result.summary.validation_id),
      ]);
      setSelectedValidationId(result.summary.validation_id);
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({
        tone: "success",
        message: pick(locale, `Saved validation ${result.summary.validation_id}.`, `${result.summary.validation_id} 검증 결과를 저장했습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Hospital validation failed.", "병원 검증에 실패했습니다.")),
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

  async function handleExportValidationReport() {
    if (!selectedSiteId || !selectedValidationId || !selectedValidationRun) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a validation run before exporting.", "내보내기 전에 검증 실행을 선택하세요."),
      });
      return;
    }
    setValidationExportBusy(true);
    try {
      const casePredictions = await fetchValidationCases(selectedSiteId, selectedValidationId, token);
      const payload = {
        summary: selectedValidationRun,
        case_predictions: casePredictions,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedValidationId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({
        tone: "success",
        message: pick(locale, `Exported ${selectedValidationId}.json.`, `${selectedValidationId}.json 파일을 내보냈습니다.`),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(nextError, pick(locale, "Validation report export failed.", "검증 리포트 내보내기에 실패했습니다.")),
      });
    } finally {
      setValidationExportBusy(false);
    }
  }

  async function handleExportCrossValidationReport() {
    if (!selectedReport) {
      setToast({
        tone: "error",
        message: pick(locale, "Select a cross-validation report before exporting.", "내보내기 전에 교차 검증 리포트를 선택하세요."),
      });
      return;
    }
    setCrossValidationExportBusy(true);
    try {
      const blob = new Blob([JSON.stringify(selectedReport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${selectedReport.cross_validation_id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({
        tone: "success",
        message: pick(
          locale,
          `Exported ${selectedReport.cross_validation_id}.json.`,
          `${selectedReport.cross_validation_id}.json 파일을 내보냈습니다.`,
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(locale, "Cross-validation report export failed.", "교차 검증 리포트 내보내기에 실패했습니다."),
        ),
      });
    } finally {
      setCrossValidationExportBusy(false);
    }
  }

  async function handleAggregation() {
    setAggregationBusy(true);
    try {
      const result = await runFederatedAggregation(token, { new_version_name: newVersionName.trim() || undefined });
      setNewVersionName("");
      await refreshWorkspace();
      setSection("registry");
      setToast({ tone: "success", message: copy.createdVersion(result.aggregation.new_version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.aggregationFailed) });
    } finally {
      setAggregationBusy(false);
    }
  }

  async function handleDeleteModelVersion(version: ModelVersionRecord) {
    const confirmed = window.confirm(
      pick(
        locale,
        `Delete model ${version.version_name}?`,
        `${version.version_name} 모델을 삭제할까요?`
      )
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteModelVersion(version.version_id, token);
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.modelDeleted(version.version_name) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.modelDeleteFailed) });
    }
  }

  async function handleModelUpdateReview(decision: "approved" | "rejected") {
    if (!selectedModelUpdate) {
      return;
    }
    try {
      await reviewModelUpdate(selectedModelUpdate.update_id, token, {
        decision,
        reviewer_notes: modelUpdateReviewNotes[selectedModelUpdate.update_id] ?? "",
      });
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.updateReviewed(decision) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.updateReviewFailed) });
    }
  }

  async function handleDownloadImportTemplate() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForTemplate });
      return;
    }
    try {
      const blob = await downloadImportTemplate(selectedSiteId, token);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "kera_import_template.csv";
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.templateDownloadFailed) });
    }
  }

  async function handleBulkImport() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForImport });
      return;
    }
    if (!bulkCsvFile) {
      setToast({ tone: "error", message: copy.chooseCsvFirst });
      return;
    }
    setBulkImportBusy(true);
    try {
      const result = await runBulkImport(selectedSiteId, token, { csvFile: bulkCsvFile, files: bulkFiles });
      setBulkImportResult(result);
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({ tone: "success", message: copy.importedImages(result.imported_images, selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.bulkImportFailed) });
    } finally {
      setBulkImportBusy(false);
    }
  }

  async function handleCreateProject() {
    if (!projectForm.name.trim()) {
      setToast({ tone: "error", message: copy.projectNameRequired });
      return;
    }
    try {
      const createdProject = await createProject(token, projectForm);
      setProjectForm({ name: "", description: "" });
      setSiteForm((current) => ({ ...current, project_id: createdProject.project_id }));
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.projectRegistered });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableCreateProject) });
    }
  }

  function resetSiteForm(projectId = siteForm.project_id || projects[0]?.project_id || "") {
    setEditingSiteId(null);
    setSiteForm(createSiteForm(projectId));
  }

  function handleEditSite(site: ManagedSiteRecord) {
    setEditingSiteId(site.site_id);
    setSiteForm({
      project_id: site.project_id,
      site_code: site.site_id,
      display_name: site.display_name,
      hospital_name: site.hospital_name ?? "",
    });
  }

  async function handleCreateSite() {
    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || "";
    if (!effectiveProjectId || !siteForm.site_code.trim() || !siteForm.display_name.trim()) {
      setToast({ tone: "error", message: copy.siteFieldsRequired });
      return;
    }
    try {
      const createdSite = await createAdminSite(token, { ...siteForm, project_id: effectiveProjectId });
      resetSiteForm(effectiveProjectId);
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(createdSite.site_id);
      setToast({ tone: "success", message: copy.siteRegistered(createdSite.site_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableCreateSite) });
    }
  }

  async function handleUpdateSite() {
    if (!editingSiteId || !siteForm.display_name.trim()) {
      setToast({ tone: "error", message: copy.siteNameRequired });
      return;
    }
    try {
      const updatedSite = await updateAdminSite(editingSiteId, token, {
        display_name: siteForm.display_name,
        hospital_name: siteForm.hospital_name,
      });
      resetSiteForm(updatedSite.project_id);
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(updatedSite.site_id);
      setToast({ tone: "success", message: copy.siteUpdated(updatedSite.site_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableUpdateSite) });
    }
  }

  async function handleSaveStorageRoot() {
    if (!instanceStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      const nextSettings = await updateStorageSettings(token, {
        storage_root: instanceStorageRootForm,
      });
      setStorageSettings(nextSettings);
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.storageRootSaved });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleSaveSelectedSiteStorageRoot() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForStorageRoot });
      return;
    }
    if (!siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableSaveSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await updateAdminSiteStorageRoot(selectedSiteId, token, {
        storage_root: siteStorageRootForm,
      });
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.selectedSiteStorageRootSaved(selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveSelectedSiteStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleMigrateSelectedSiteStorageRoot() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForStorageRoot });
      return;
    }
    if (!siteStorageRootForm.trim()) {
      setToast({ tone: "error", message: copy.unableMigrateSelectedSiteStorageRoot });
      return;
    }
    setStorageSettingsBusy(true);
    try {
      await migrateAdminSiteStorageRoot(selectedSiteId, token, {
        storage_root: siteStorageRootForm,
      });
      await refreshWorkspace(true);
      setToast({ tone: "success", message: copy.selectedSiteStorageMigrated(selectedSiteId) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableMigrateSelectedSiteStorageRoot) });
    } finally {
      setStorageSettingsBusy(false);
    }
  }

  async function handleSaveUser() {
    if (!userForm.username.trim()) {
      setToast({ tone: "error", message: copy.usernameRequired });
      return;
    }
    if (userForm.role !== "admin" && userForm.site_ids.length === 0) {
      setToast({ tone: "error", message: copy.assignSiteRequired });
      return;
    }
    try {
      await upsertManagedUser(token, userForm);
      setUserForm(createUserForm());
      await refreshWorkspace();
      setToast({ tone: "success", message: copy.userSaved });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableSaveUser) });
    }
  }

  return (
    <main className="workspace-shell" data-workspace-theme={theme}>
      <div className="workspace-noise" />
      <aside className="workspace-rail">
        <div className="workspace-brand workspace-brand-rail">
          <div>
            <div className="workspace-kicker">{pick(locale, "Operations", "운영")}</div>
            <h1>{pick(locale, "K-ERA Control", "K-ERA 운영")}</h1>
          </div>
          <button className="ghost-button" type="button" onClick={onOpenCanvas}>{pick(locale, "Case canvas", "케이스 캔버스")}</button>
        </div>
        <section className="workspace-card rail-section">
          <div className="rail-section-head"><span className="rail-label">{pick(locale, "Hospitals", "병원")}</span><strong>{sites.length} {pick(locale, "linked", "연결됨")}</strong></div>
          <div className="rail-site-list">
            {sites.map((site) => (
              <button key={site.site_id} className={`rail-site-button ${selectedSiteId === site.site_id ? "active" : ""}`} type="button" onClick={() => onSelectSite(site.site_id)}>
                <strong>{site.display_name}</strong><span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="workspace-card rail-section">
          <div className="rail-section-head"><span className="rail-label">{pick(locale, "Sections", "섹션")}</span></div>
          <div className="ops-nav-list">
            {[
              ["dashboard", pick(locale, "Dashboard", "대시보드")],
              ["imports", pick(locale, "Bulk import", "대량 임포트")],
              ["requests", pick(locale, "Access requests", "접근 요청")],
              ["training", pick(locale, "Initial training", "초기 학습")],
              ["cross_validation", pick(locale, "Cross-validation", "교차 검증")],
              ["registry", pick(locale, "Model registry", "모델 레지스트리")],
              ["management", pick(locale, "Management", "관리")],
              ...(canAggregate ? [["federation", pick(locale, "Federation", "연합학습")]] : []),
            ].map(([value, label]) => (
              <button key={value} className={`ops-nav-button ${section === value ? "active" : ""}`} type="button" onClick={() => setSection(value as typeof section)}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="workspace-card rail-section">
          <div className="panel-metric-grid rail-metric-grid">
            <div><strong>{overview?.pending_access_requests ?? pendingRequests.length}</strong><span>{pick(locale, "pending access", "대기 중 접근 요청")}</span></div>
            <div><strong>{overview?.pending_model_updates ?? pendingReviewUpdates.length}</strong><span>{pick(locale, "pending updates", "대기 중 업데이트")}</span></div>
            <div><strong>{overview?.model_version_count ?? modelVersions.length}</strong><span>{pick(locale, "models", "모델")}</span></div>
            <div><strong>{overview?.current_model_version ?? currentModel?.version_name ?? common.notAvailable}</strong><span>{pick(locale, "current model", "현재 모델")}</span></div>
          </div>
          {summary ? <div className="ops-site-summary"><div className="panel-meta"><span>{selectedSiteId}</span><span>{summary.n_patients} {pick(locale, "patients", "환자")}</span><span>{summary.n_images} {pick(locale, "images", "이미지")}</span></div></div> : null}
        </section>
      </aside>
      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-kicker">{pick(locale, "Control plane", "컨트롤 플레인")}</div>
            <h2>{pick(locale, "Operate import, review, training, and model movement from the web workspace", "웹 워크스페이스에서 임포트, 승인 검토, 학습, 모델 이동을 운영")}</h2>
            <p>{pick(locale, `Logged in as ${user.full_name} (${translateRole(locale, user.role)}). Admin and hospital operations now stay in this web workspace.`, `${user.full_name} (${translateRole(locale, user.role)}) 계정으로 로그인됨. 관리자 및 병원 운영 흐름이 이제 이 웹 워크스페이스 안에서 처리됩니다.`)}</p>
          </div>
          <div className="workspace-actions">
            <LocaleToggle />
            <button className="ghost-button" type="button" onClick={onToggleTheme}>
              {theme === "dark" ? pick(locale, "Light mode", "라이트 모드") : pick(locale, "Dark mode", "다크 모드")}
            </button>
            <button className="ghost-button" type="button" onClick={onOpenCanvas}>{pick(locale, "Open case canvas", "케이스 캔버스 열기")}</button>
            <button className="primary-workspace-button" type="button" onClick={onLogout}>{pick(locale, "Log out", "로그아웃")}</button>
          </div>
        </header>
        <div className="ops-main-stack">
          {section === "dashboard" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Dashboard", "대시보드")}</div><h3>{pick(locale, "Validation trends, comparison, and misclassifications", "검증 추이, 비교, 오분류 검토")}</h3></div><div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div></div>
              <div className="workspace-actions section-launch-actions">
                <button className="ghost-button compact-ghost-button" type="button" disabled={validationExportBusy || !selectedValidationRun} onClick={() => void handleExportValidationReport()}>
                  {validationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export validation JSON", "검증 JSON 내보내기")}
                </button>
                <button className="primary-workspace-button" type="button" disabled={siteValidationBusy || !selectedSiteId} onClick={() => void handleSiteValidation()}>
                  {siteValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run hospital validation", "병원 검증 실행")}
                </button>
              </div>
              {selectedSiteId ? (
                <div className="ops-stack">
                  <div className="ops-dual-grid">
                    <section className="ops-card">
                      <div className="panel-card-head"><strong>{pick(locale, "Latest hospital validation", "최신 병원 검증")}</strong><span>{selectedValidationRun ? formatDateTime(selectedValidationRun.run_date, localeTag, common.notAvailable) : pick(locale, "No run yet", "실행 이력 없음")}</span></div>
                      {selectedValidationRun ? <div className="panel-metric-grid"><div><strong>{selectedValidationRun.model_version}</strong><span>{pick(locale, "model", "모델")}</span></div><div><strong>{formatMetric(selectedValidationRun.AUROC, common.notAvailable)}</strong><span>AUROC</span></div><div><strong>{formatMetric(selectedValidationRun.accuracy, common.notAvailable)}</strong><span>{pick(locale, "accuracy", "정확도")}</span></div><div><strong>{formatMetric(selectedValidationRun.sensitivity, common.notAvailable)}</strong><span>{pick(locale, "sensitivity", "민감도")}</span></div><div><strong>{formatMetric(selectedValidationRun.specificity, common.notAvailable)}</strong><span>{pick(locale, "specificity", "특이도")}</span></div><div><strong>{formatMetric(selectedValidationRun.F1, common.notAvailable)}</strong><span>F1</span></div></div> : <div className="empty-surface">{pick(locale, "No hospital-level validation has been recorded for this hospital yet.", "이 병원에는 아직 병원 단위 검증 기록이 없습니다.")}</div>}
                    </section>
                    <section className="ops-card">
                      <div className="panel-card-head"><strong>{pick(locale, "Hospital comparison", "병원 비교")}</strong><span>{siteComparison.length} {pick(locale, "hospital(s)", "병원")}</span></div>
                      {siteComparison.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital comparison data is available yet.", "아직 병원 비교 데이터가 없습니다.")}</div> : <div className="ops-list">{siteComparison.slice(0, 6).map((item) => <div key={item.site_id} className="ops-item"><div className="panel-card-head"><strong>{item.display_name}</strong><span>{item.run_count} {pick(locale, "run(s)", "회")}</span></div><div className="panel-meta"><span>{item.site_id}</span><span>AUROC {formatMetric(item.AUROC, common.notAvailable)}</span><span>{pick(locale, "Acc", "정확도")} {formatMetric(item.accuracy, common.notAvailable)}</span></div></div>)}</div>}
                    </section>
                  </div>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Model version comparison", "모델 버전 비교")}</strong><span>{modelComparisonRows.length} {pick(locale, "version(s)", "버전")}</span></div>
                    {modelComparisonRows.length === 0 ? <div className="empty-surface">{pick(locale, "Run a hospital validation first to build comparison history.", "비교 이력을 만들려면 먼저 병원 검증을 실행하세요.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "model", "모델")}</span><span>{pick(locale, "runs", "실행 수")}</span><span>AUROC</span><span>{pick(locale, "accuracy", "정확도")}</span><span>{pick(locale, "sensitivity", "민감도")}</span><span>F1</span></div>{modelComparisonRows.map((item) => <div key={item.modelVersion} className="ops-table-row"><span>{item.modelVersion}</span><span>{item.count}</span><span>{formatMetric(item.AUROC, common.notAvailable)}</span><span>{formatMetric(item.accuracy, common.notAvailable)}</span><span>{formatMetric(item.sensitivity, common.notAvailable)}</span><span>{formatMetric(item.F1, common.notAvailable)}</span></div>)}</div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "ROC curve comparison", "ROC 커브 비교")}</strong><span>{selectedRocRuns.length} {pick(locale, "selected", "선택됨")}</span></div>
                    {rocEligibleRuns.length === 0 ? (
                      <div className="empty-surface">{pick(locale, "No saved validation run contains ROC curve data yet.", "저장된 검증 실행 중 ROC 커브 데이터가 있는 항목이 아직 없습니다.")}</div>
                    ) : (
                      <div className="roc-compare-stack">
                        <div className="panel-meta">
                          <span>{pick(locale, "Select up to five validation runs. For fair model comparison, use runs generated from the same hospital cohort.", "검증 실행은 최대 5개까지 선택할 수 있습니다. 공정한 모델 비교를 위해 같은 병원 코호트에서 생성된 실행을 사용하세요.")}</span>
                          <span>{rocHasCohortMismatch ? pick(locale, "Selected runs have different patient/case counts.", "선택한 실행의 환자 수 또는 케이스 수가 서로 다릅니다.") : pick(locale, "Selected runs currently share the same patient/case/image counts.", "선택한 실행의 환자 수, 케이스 수, 이미지 수가 현재 동일합니다.")}</span>
                        </div>
                        <div className="roc-run-grid">
                          {rocEligibleRuns.map((run) => {
                            const isActive = rocValidationIds.includes(run.validation_id);
                            const isDisabled = !isActive && rocSelectionLimitReached;
                            return (
                              <button
                                key={run.validation_id}
                                className={`roc-run-button ${isActive ? "active" : ""}`}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => toggleRocValidationSelection(run.validation_id)}
                              >
                                <strong>{run.model_version}</strong>
                                <span>{formatDateTime(run.run_date, localeTag, common.notAvailable)}</span>
                                <span>{pick(locale, "Cases", "케이스")} {run.n_cases} · AUROC {formatMetric(run.AUROC, common.notAvailable)}</span>
                              </button>
                            );
                          })}
                        </div>
                        {rocSeries.length === 0 ? (
                          <div className="empty-surface">{pick(locale, "Select at least one validation run to draw the ROC chart.", "ROC 차트를 그리려면 검증 실행을 하나 이상 선택하세요.")}</div>
                        ) : (
                          <div className="roc-compare-layout">
                            <div className="roc-chart-shell">
                              <svg viewBox={`0 0 ${ROC_CHART_WIDTH} ${ROC_CHART_HEIGHT}`} className="roc-chart" role="img" aria-label={pick(locale, "ROC curve comparison chart", "ROC 커브 비교 차트")}>
                                {ROC_AXIS_TICKS.map((tick) => {
                                  const x = ROC_CHART_PADDING.left + tick * (ROC_CHART_WIDTH - ROC_CHART_PADDING.left - ROC_CHART_PADDING.right);
                                  const y = ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom - tick * (ROC_CHART_HEIGHT - ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom);
                                  return (
                                    <g key={tick}>
                                      <line className="roc-grid-line" x1={ROC_CHART_PADDING.left} y1={y} x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right} y2={y} />
                                      <line className="roc-grid-line" x1={x} y1={ROC_CHART_PADDING.top} x2={x} y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom} />
                                      <text className="roc-axis-tick" x={ROC_CHART_PADDING.left - 10} y={y + 4} textAnchor="end">{tick.toFixed(1)}</text>
                                      <text className="roc-axis-tick" x={x} y={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom + 18} textAnchor="middle">{tick.toFixed(1)}</text>
                                    </g>
                                  );
                                })}
                                <line className="roc-axis-line" x1={ROC_CHART_PADDING.left} y1={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom} x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right} y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom} />
                                <line className="roc-axis-line" x1={ROC_CHART_PADDING.left} y1={ROC_CHART_PADDING.top} x2={ROC_CHART_PADDING.left} y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom} />
                                <line className="roc-reference-line" x1={ROC_CHART_PADDING.left} y1={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom} x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right} y2={ROC_CHART_PADDING.top} />
                                {rocSeries.map((series) => (
                                  <path
                                    key={series.run.validation_id}
                                    d={buildRocPath(series.points)}
                                    fill="none"
                                    stroke={series.color}
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ))}
                                <text className="roc-axis-label" x={(ROC_CHART_WIDTH + ROC_CHART_PADDING.left - ROC_CHART_PADDING.right) / 2} y={ROC_CHART_HEIGHT - 8} textAnchor="middle">
                                  1-Specificity
                                </text>
                                <text
                                  className="roc-axis-label"
                                  x={18}
                                  y={(ROC_CHART_HEIGHT + ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom) / 2}
                                  textAnchor="middle"
                                  transform={`rotate(-90 18 ${(ROC_CHART_HEIGHT + ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom) / 2})`}
                                >
                                  Sensitivity
                                </text>
                              </svg>
                            </div>
                            <div className="roc-legend-list">
                              {rocSeries.map((series) => (
                                <div key={series.run.validation_id} className="roc-legend-item">
                                  <span className="roc-legend-swatch" style={{ backgroundColor: series.color }} aria-hidden="true" />
                                  <div>
                                    <strong>{series.run.model_version}</strong>
                                    <span>{formatDateTime(series.run.run_date, localeTag, common.notAvailable)}</span>
                                    <span>AUC = {formatMetric(series.run.AUROC, common.notAvailable)} · {pick(locale, "Cases", "케이스")} {series.run.n_cases}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Validation run comparison", "검증 실행 비교")}</strong><span>{siteValidationRuns.length} {pick(locale, "run(s)", "회")}</span></div>
                    {siteValidationRuns.length < 2 ? <div className="empty-surface">{pick(locale, "At least two hospital validation runs are required for run-to-run comparison.", "실행 간 비교를 하려면 병원 검증 이력이 2개 이상 필요합니다.")}</div> : <div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Baseline run", "기준 실행")}</span><select value={baselineValidationId ?? ""} onChange={(event) => setBaselineValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date, localeTag, common.notAvailable)}</option>)}</select></label><label className="inline-field"><span>{pick(locale, "Compare run", "비교 실행")}</span><select value={compareValidationId ?? ""} onChange={(event) => setCompareValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date, localeTag, common.notAvailable)}</option>)}</select></label></div><div className="panel-metric-grid"><div><strong>{formatMetric(compareValidationRun?.AUROC, common.notAvailable)}</strong><span>AUROC ({formatDelta(compareValidationRun?.AUROC, baselineValidationRun?.AUROC, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.accuracy, common.notAvailable)}</strong><span>{pick(locale, "accuracy", "정확도")} ({formatDelta(compareValidationRun?.accuracy, baselineValidationRun?.accuracy, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.sensitivity, common.notAvailable)}</strong><span>{pick(locale, "sensitivity", "민감도")} ({formatDelta(compareValidationRun?.sensitivity, baselineValidationRun?.sensitivity, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.F1, common.notAvailable)}</strong><span>F1 ({formatDelta(compareValidationRun?.F1, baselineValidationRun?.F1, common.notAvailable)})</span></div></div></div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Validation run history", "검증 실행 이력")}</strong><span>{siteValidationRuns.length} {pick(locale, "stored", "저장됨")}</span></div>
                    {siteValidationRuns.length === 0 ? <div className="empty-surface">{pick(locale, "No validation history has been stored for this hospital yet.", "이 병원에는 아직 저장된 검증 이력이 없습니다.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "run date", "실행 일시")}</span><span>{pick(locale, "model", "모델")}</span><span>{pick(locale, "cases", "케이스")}</span><span>AUROC</span><span>{pick(locale, "accuracy", "정확도")}</span><span>F1</span></div>{siteValidationRuns.map((run) => <button key={run.validation_id} className={`ops-table-row ops-table-button ${selectedValidationId === run.validation_id ? "active" : ""}`} type="button" onClick={() => setSelectedValidationId(run.validation_id)}><span>{formatDateTime(run.run_date, localeTag, common.notAvailable)}</span><span>{run.model_version}</span><span>{run.n_cases}</span><span>{formatMetric(run.AUROC, common.notAvailable)}</span><span>{formatMetric(run.accuracy, common.notAvailable)}</span><span>{formatMetric(run.F1, common.notAvailable)}</span></button>)}</div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Representative misclassified cases", "대표 오분류 케이스")}</strong><span>{dashboardBusy ? common.loading : `${misclassifiedCases.length} ${pick(locale, "shown", "표시됨")}`}</span></div>
                    {misclassifiedCases.length === 0 ? <div className="empty-surface">{pick(locale, "No misclassified case preview is available for the selected validation run.", "선택한 검증 실행에 대한 오분류 미리보기가 없습니다.")}</div> : <div className="ops-gallery-grid">{misclassifiedCases.map((item) => <article key={`${item.patient_id}-${item.visit_date}`} className="ops-item"><div className="panel-card-head"><strong>{item.patient_id}</strong><span>{item.visit_date}</span></div><div className="panel-meta"><span>{item.true_label}</span><span>{item.predicted_label}</span><span>{formatMetric(item.prediction_probability, common.notAvailable)}</span></div><div className="ops-gallery-triptych"><div className="panel-image-card">{item.original_preview_url ? <img src={item.original_preview_url} alt={pick(locale, `${item.patient_id} original image`, `${item.patient_id} 원본 이미지`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Original unavailable", "원본을 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Original", "원본")}</strong></div></div><div className="panel-image-card">{item.roi_preview_url ? <img src={item.roi_preview_url} alt={pick(locale, `${item.patient_id} cornea crop`, `${item.patient_id} 각막 crop`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Cornea crop unavailable", "각막 crop을 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Cornea crop", "각막 crop")}</strong></div></div><div className="panel-image-card">{item.gradcam_preview_url ? <img src={item.gradcam_preview_url} alt={pick(locale, `${item.patient_id} Grad-CAM`, `${item.patient_id} Grad-CAM`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Grad-CAM unavailable", "Grad-CAM을 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong></div></div></div></article>)}</div>}
                  </section>
                </div>
              ) : <div className="empty-surface">{pick(locale, "Select a hospital to open the advanced dashboard.", "고급 대시보드를 열려면 병원을 선택하세요.")}</div>}
            </section>
          ) : null}
          {section === "imports" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Bulk import", "대량 임포트")}</div><h3>{pick(locale, "CSV + image ZIP migration", "CSV + 이미지 ZIP 이전")}</h3></div><div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div></div>
              <div className="ops-stack">
                <div className="panel-meta"><span>{pick(locale, "1. Download the CSV template", "1. CSV 템플릿 다운로드")}</span><span>{pick(locale, "2. Match image filenames with ZIP entries", "2. 이미지 파일명을 ZIP 항목과 맞추기")}</span><span>{pick(locale, "3. Start with 2-3 patients before a full backfill", "3. 전체 이전 전에 2~3명 환자로 먼저 검증")}</span></div>
                <div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => void handleDownloadImportTemplate()} disabled={!selectedSiteId}>{pick(locale, "Download CSV template", "CSV 템플릿 다운로드")}</button></div>
                <div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Metadata CSV", "메타데이터 CSV")}</span><input type="file" accept=".csv" onChange={(event) => setBulkCsvFile(event.target.files?.[0] ?? null)} /></label><label className="inline-field"><span>{pick(locale, "Image ZIP or raw images", "이미지 ZIP 또는 원본 이미지")}</span><input type="file" accept=".zip,.jpg,.jpeg,.png" multiple onChange={(event) => setBulkFiles(Array.from(event.target.files ?? []))} /></label></div>
                <div className="doc-footer"><div><strong>{pick(locale, "Legacy backfill only", "레거시 백필 전용")}</strong><p>{pick(locale, "Daily case entry should stay in the document-style case canvas.", "일상 케이스 입력은 문서형 케이스 캔버스에서 계속 진행하는 것이 좋습니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={bulkImportBusy || !selectedSiteId || !bulkCsvFile} onClick={() => void handleBulkImport()}>{bulkImportBusy ? pick(locale, "Importing...", "임포트 중...") : pick(locale, "Run bulk import", "대량 임포트 실행")}</button></div>
                {bulkImportResult ? <div className="ops-stack"><div className="panel-metric-grid"><div><strong>{bulkImportResult.rows_received}</strong><span>{pick(locale, "rows received", "수신 행 수")}</span></div><div><strong>{bulkImportResult.files_received}</strong><span>{pick(locale, "files read", "읽은 파일 수")}</span></div><div><strong>{bulkImportResult.created_patients}</strong><span>{pick(locale, "patients created", "생성된 환자 수")}</span></div><div><strong>{bulkImportResult.created_visits}</strong><span>{pick(locale, "visits created", "생성된 방문 수")}</span></div><div><strong>{bulkImportResult.imported_images}</strong><span>{pick(locale, "images imported", "임포트된 이미지 수")}</span></div><div><strong>{bulkImportResult.skipped_images}</strong><span>{pick(locale, "images skipped", "건너뛴 이미지 수")}</span></div></div>{bulkImportResult.errors.length > 0 ? <div className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Import warnings", "임포트 경고")}</strong><span>{bulkImportResult.errors.length}</span></div><div className="ops-list">{bulkImportResult.errors.map((item) => <div key={item} className="ops-item">{item}</div>)}</div></div> : null}</div> : null}
              </div>
            </section>
          ) : null}
          {section === "requests" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Access review", "접근 검토")}</div><h3>{pick(locale, "Institution approval queue", "기관 승인 대기열")}</h3></div><div className="doc-site-badge">{pendingRequests.length} {pick(locale, "pending", "대기")}</div></div>
              {pendingRequests.length === 0 ? <div className="empty-surface">{pick(locale, "No pending access requests are assigned to this account.", "이 계정에 할당된 대기 중 접근 요청이 없습니다.")}</div> : (
                <div className="ops-list">
                  {pendingRequests.map((request) => {
                    const draft = reviewDrafts[request.request_id] ?? { assigned_role: request.requested_role, assigned_site_id: request.requested_site_id, reviewer_notes: "" };
                    return (
                      <article key={request.request_id} className="ops-card">
                        <div className="panel-card-head"><strong>{request.email}</strong><span>{formatDateTime(request.created_at, localeTag, common.notAvailable)}</span></div>
                        <div className="panel-meta"><span>{request.requested_site_id}</span><span>{translateRole(locale, request.requested_role)}</span><span>{translateStatus(locale, request.status)}</span></div>
                        {request.message ? <p>{request.message}</p> : null}
                        <div className="ops-form-grid">
                          <label className="inline-field"><span>{pick(locale, "Assigned role", "부여 역할")}</span><select value={draft.assigned_role} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, assigned_role: event.target.value } }))}><option value="site_admin">{translateRole(locale, "site_admin")}</option><option value="researcher">{translateRole(locale, "researcher")}</option><option value="viewer">{translateRole(locale, "viewer")}</option></select></label>
                          <label className="inline-field"><span>{pick(locale, "Assigned hospital", "부여 병원")}</span><select value={draft.assigned_site_id} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, assigned_site_id: event.target.value } }))}>{sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label>
                        </div>
                        <label className="notes-field"><span>{pick(locale, "Reviewer note", "검토 메모")}</span><textarea rows={3} value={draft.reviewer_notes} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, reviewer_notes: event.target.value } }))} /></label>
                        <div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => void handleReview(request.request_id, "rejected")}>{pick(locale, "Reject", "반려")}</button><button className="primary-workspace-button" type="button" onClick={() => void handleReview(request.request_id, "approved")}>{pick(locale, "Approve", "승인")}</button></div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
          {section === "training" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Initial training", "초기 학습")}</div><h3>{pick(locale, "Register the next global baseline", "다음 글로벌 기준 모델 등록")}</h3></div><div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div></div>
              <div className="workspace-actions section-launch-actions">
                <button className="ghost-button compact-ghost-button" type="button" disabled={crossValidationExportBusy || !selectedReport} onClick={() => void handleExportCrossValidationReport()}>
                  {crossValidationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export selected report", "선택 리포트 내보내기")}
                </button>
              </div>
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>{pick(locale, "Architecture", "아키텍처")}</span><select value={initialForm.architecture} onChange={(event) => setInitialForm((current) => ({ ...current, architecture: event.target.value }))}>{TRAINING_ARCHITECTURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="inline-field"><span>{pick(locale, "Execution mode", "실행 모드")}</span><select value={initialForm.execution_mode} onChange={(event) => setInitialForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">{pick(locale, "auto", "자동")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Crop mode", "Crop 모드")}</span><select value={initialForm.crop_mode} onChange={(event) => setInitialForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" | "both" }))}><option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option><option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option><option value="both">{pick(locale, "Both ensemble", "둘 다 앙상블")}</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Epochs", "에폭")}</span><input type="number" min={1} value={initialForm.epochs} onChange={(event) => setInitialForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Batch size", "배치 크기")}</span><input type="number" min={1} value={initialForm.batch_size} onChange={(event) => setInitialForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Learning rate", "학습률")}</span><input type="number" min={0.00001} step="0.00001" value={initialForm.learning_rate} onChange={(event) => setInitialForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Validation split", "검증 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.val_split} onChange={(event) => setInitialForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Test split", "테스트 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.test_split} onChange={(event) => setInitialForm((current) => ({ ...current, test_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${initialForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{initialForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button><button className={`toggle-pill ${!initialForm.regenerate_split ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, regenerate_split: !current.regenerate_split }))}>{initialForm.regenerate_split ? pick(locale, "Regenerate split", "분할 재생성") : pick(locale, "Reuse split", "기존 분할 재사용")}</button></div>
              <div className="doc-footer"><div><strong>{pick(locale, "DenseNet / ConvNeXt / Swin / ViT benchmark ready", "DenseNet / ConvNeXt / Swin / ViT 벤치마크 지원")}</strong><p>{pick(locale, "Single-model training and 4-model benchmark both reuse the Python training pipeline.", "단일 학습과 4모델 벤치마크 모두 기존 Python 학습 파이프라인을 재사용합니다.")}</p></div><div className="workspace-actions"><button className="ghost-button" type="button" disabled={benchmarkBusy || !selectedSiteId} onClick={() => void handleBenchmarkTraining()}>{benchmarkBusy ? pick(locale, "Benchmarking...", "벤치마크 중...") : pick(locale, "Run 4-model benchmark", "4모델 벤치마크 실행")}</button><button className="primary-workspace-button" type="button" disabled={initialBusy || !selectedSiteId} onClick={() => void handleInitialTraining()}>{initialBusy ? pick(locale, "Training...", "학습 중...") : pick(locale, "Run initial training", "초기 학습 실행")}</button></div></div>
              {initialJob ? (
                <div className="ops-card training-progress-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Training progress", "학습 진행 상태")}</strong>
                    <span>{formatTrainingStage(initialProgress?.stage)}</span>
                  </div>
                  <div className="training-progress-bar" aria-hidden="true">
                    <div className="training-progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="panel-metric-grid training-progress-grid">
                    <div><strong>{progressPercent}%</strong><span>{pick(locale, "progress", "진행률")}</span></div>
                    <div><strong>{initialProgress?.component_crop_mode ?? initialProgress?.crop_mode ?? common.notAvailable}</strong><span>{pick(locale, "mode", "모드")}</span></div>
                    <div><strong>{initialProgress?.epoch && initialProgress?.epochs ? `${initialProgress.epoch} / ${initialProgress.epochs}` : common.notAvailable}</strong><span>{pick(locale, "epoch", "에폭")}</span></div>
                    <div><strong>{typeof initialProgress?.val_acc === "number" ? initialProgress.val_acc.toFixed(3) : common.notAvailable}</strong><span>{pick(locale, "val acc", "검증 정확도")}</span></div>
                  </div>
                  <p className="training-progress-copy">
                    {initialProgress?.message
                      ? initialProgress.message
                      : pick(locale, "Waiting for the training worker to report progress.", "학습 작업 상태를 기다리는 중입니다.")}
                  </p>
                </div>
              ) : null}
              {benchmarkJob ? (
                <div className="ops-card training-progress-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Benchmark progress", "벤치마크 진행 상태")}</strong>
                    <span>{formatTrainingStage(benchmarkProgress?.stage)}</span>
                  </div>
                  <div className="training-progress-bar" aria-hidden="true">
                    <div className="training-progress-fill" style={{ width: `${benchmarkPercent}%` }} />
                  </div>
                  <div className="panel-metric-grid training-progress-grid">
                    <div><strong>{benchmarkPercent}%</strong><span>{pick(locale, "progress", "진행률")}</span></div>
                    <div><strong>{benchmarkProgress?.architecture ?? common.notAvailable}</strong><span>{pick(locale, "architecture", "아키텍처")}</span></div>
                    <div><strong>{benchmarkProgress?.architecture_index && benchmarkProgress?.architecture_count ? `${benchmarkProgress.architecture_index} / ${benchmarkProgress.architecture_count}` : common.notAvailable}</strong><span>{pick(locale, "sequence", "순서")}</span></div>
                    <div><strong>{benchmarkProgress?.component_crop_mode ?? benchmarkProgress?.crop_mode ?? common.notAvailable}</strong><span>{pick(locale, "mode", "모드")}</span></div>
                  </div>
                  <p className="training-progress-copy">
                    {benchmarkProgress?.message
                      ? benchmarkProgress.message
                      : pick(locale, "Waiting for the benchmark worker to report progress.", "벤치마크 작업 상태를 기다리는 중입니다.")}
                  </p>
                </div>
              ) : null}
              {benchmarkResult ? <div className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Benchmark summary", "벤치마크 요약")}</strong><span>{benchmarkResult.best_architecture ?? common.notAvailable}</span></div><div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "architecture", "아키텍처")}</span><span>{pick(locale, "status", "상태")}</span><span>{pick(locale, "best val acc", "최고 검증 정확도")}</span><span>{pick(locale, "version", "버전")}</span></div>{benchmarkResult.results.map((entry) => <div key={entry.architecture} className="ops-table-row"><span>{entry.architecture}</span><span>{entry.status}</span><span>{formatMetric(entry.result?.best_val_acc, common.notAvailable)}</span><span>{entry.model_version?.version_name ?? common.notAvailable}</span></div>)}{benchmarkResult.failures.map((entry) => <div key={`failed-${entry.architecture}`} className="ops-table-row"><span>{entry.architecture}</span><span>{entry.status}</span><span>{common.notAvailable}</span><span>{entry.error}</span></div>)}</div></div> : null}
              {initialResult ? <div className="panel-metric-grid"><div><strong>{initialResult.result.n_train_patients}</strong><span>{pick(locale, "train patients", "학습 환자")}</span></div><div><strong>{initialResult.result.n_val_patients}</strong><span>{pick(locale, "val patients", "검증 환자")}</span></div><div><strong>{initialResult.result.n_test_patients}</strong><span>{pick(locale, "test patients", "테스트 환자")}</span></div><div><strong>{formatMetric(initialResult.result.best_val_acc, common.notAvailable)}</strong><span>{pick(locale, "best val acc", "최고 검증 정확도")}</span></div></div> : null}
            </section>
          ) : null}
          {section === "cross_validation" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Cross-validation", "교차 검증")}</div><h3>{pick(locale, "Patient-level fold review", "환자 단위 fold 검토")}</h3></div><div className="doc-site-badge">{crossValidationReports.length} {pick(locale, "report(s)", "리포트")}</div></div>
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>{pick(locale, "Architecture", "아키텍처")}</span><select value={crossValidationForm.architecture} onChange={(event) => setCrossValidationForm((current) => ({ ...current, architecture: event.target.value }))}>{TRAINING_ARCHITECTURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="inline-field"><span>{pick(locale, "Execution mode", "실행 모드")}</span><select value={crossValidationForm.execution_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">{pick(locale, "auto", "자동")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Crop mode", "Crop 모드")}</span><select value={crossValidationForm.crop_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" }))}><option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option><option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Folds", "폴드 수")}</span><input type="number" min={3} max={5} value={crossValidationForm.num_folds} onChange={(event) => setCrossValidationForm((current) => ({ ...current, num_folds: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Epochs", "에폭")}</span><input type="number" min={1} value={crossValidationForm.epochs} onChange={(event) => setCrossValidationForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Batch size", "배치 크기")}</span><input type="number" min={1} value={crossValidationForm.batch_size} onChange={(event) => setCrossValidationForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Learning rate", "학습률")}</span><input type="number" min={0.00001} step="0.00001" value={crossValidationForm.learning_rate} onChange={(event) => setCrossValidationForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Validation split", "검증 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={crossValidationForm.val_split} onChange={(event) => setCrossValidationForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${crossValidationForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setCrossValidationForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{crossValidationForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button></div>
              <div className="doc-footer"><div><strong>{pick(locale, "Saved reports stay selectable", "저장된 리포트 선택 가능")}</strong><p>{pick(locale, "Cross-validation JSON reports are read back from the existing validation workspace.", "교차 검증 JSON 리포트는 기존 검증 워크스페이스에서 다시 읽어옵니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={crossValidationBusy || !selectedSiteId} onClick={() => void handleCrossValidation()}>{crossValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run cross-validation", "교차 검증 실행")}</button></div>
              {crossValidationJob ? (
                <div className="ops-card training-progress-card">
                  <div className="panel-card-head">
                    <strong>{pick(locale, "Cross-validation progress", "교차 검증 진행 상태")}</strong>
                    <span>{formatTrainingStage(crossValidationProgress?.stage)}</span>
                  </div>
                  <div className="training-progress-bar" aria-hidden="true">
                    <div className="training-progress-fill" style={{ width: `${crossValidationPercent}%` }} />
                  </div>
                  <div className="panel-metric-grid training-progress-grid">
                    <div><strong>{crossValidationPercent}%</strong><span>{pick(locale, "progress", "진행률")}</span></div>
                    <div><strong>{crossValidationProgress?.fold_index && crossValidationProgress?.num_folds ? `${crossValidationProgress.fold_index} / ${crossValidationProgress.num_folds}` : common.notAvailable}</strong><span>{pick(locale, "fold", "fold")}</span></div>
                    <div><strong>{crossValidationProgress?.epoch && crossValidationProgress?.epochs ? `${crossValidationProgress.epoch} / ${crossValidationProgress.epochs}` : common.notAvailable}</strong><span>{pick(locale, "epoch", "에폭")}</span></div>
                    <div><strong>{typeof crossValidationProgress?.val_acc === "number" ? crossValidationProgress.val_acc.toFixed(3) : common.notAvailable}</strong><span>{pick(locale, "val acc", "검증 정확도")}</span></div>
                  </div>
                  <p className="training-progress-copy">
                    {crossValidationProgress?.message
                      ? crossValidationProgress.message
                      : pick(locale, "Waiting for the cross-validation worker to report progress.", "교차 검증 작업 상태를 기다리는 중입니다.")}
                  </p>
                </div>
              ) : null}
              {crossValidationReports.length > 0 ? (
                <div className="ops-stack">
                  <label className="inline-field"><span>{pick(locale, "Saved report", "저장된 리포트")}</span><select value={selectedReportId ?? ""} onChange={(event) => setSelectedReportId(event.target.value)}>{crossValidationReports.map((report) => <option key={report.cross_validation_id} value={report.cross_validation_id}>{report.cross_validation_id} · {report.architecture} · {formatDateTime(report.created_at, localeTag, common.notAvailable)}</option>)}</select></label>
                  {selectedReport ? <div className="panel-metric-grid">{["AUROC", "accuracy", "sensitivity", "specificity", "F1"].map((metricName) => <div key={metricName}><strong>{formatMetric(selectedReport.aggregate_metrics[metricName]?.mean, common.notAvailable)}</strong><span>{metricName === "accuracy" ? pick(locale, "accuracy", "정확도") : metricName === "sensitivity" ? pick(locale, "sensitivity", "민감도") : metricName === "specificity" ? pick(locale, "specificity", "특이도") : metricName}</span></div>)}</div> : null}
                  {selectedReport && selectedReportConfusion ? (
                    <div className="ops-dual-grid">
                      <section className="ops-card">
                        <div className="panel-card-head">
                          <strong>{pick(locale, "Confusion matrix", "Confusion matrix")}</strong>
                          <span>{pick(locale, "Aggregated across folds", "전체 fold 합산")}</span>
                        </div>
                        <div className="ops-table">
                          <div className="ops-table-row ops-table-head">
                            <span>{pick(locale, "actual / predicted", "실제 / 예측")}</span>
                            <span>{pick(locale, "bacterial", "세균")}</span>
                            <span>{pick(locale, "fungal", "진균")}</span>
                          </div>
                          <div className="ops-table-row">
                            <span>{pick(locale, "bacterial", "세균")}</span>
                            <span>{selectedReportConfusion[0][0]}</span>
                            <span>{selectedReportConfusion[0][1]}</span>
                          </div>
                          <div className="ops-table-row">
                            <span>{pick(locale, "fungal", "진균")}</span>
                            <span>{selectedReportConfusion[1][0]}</span>
                            <span>{selectedReportConfusion[1][1]}</span>
                          </div>
                        </div>
                      </section>
                      <section className="ops-card">
                        <div className="panel-card-head">
                          <strong>{pick(locale, "Fold-by-fold matrix", "fold별 matrix")}</strong>
                          <span>{selectedReport.fold_results.length} {pick(locale, "folds", "fold")}</span>
                        </div>
                        <div className="ops-table">
                          <div className="ops-table-row ops-table-head">
                            <span>{pick(locale, "fold", "fold")}</span>
                            <span>{pick(locale, "TN / FP", "TN / FP")}</span>
                            <span>{pick(locale, "FN / TP", "FN / TP")}</span>
                          </div>
                          {selectedReport.fold_results.map((fold) => {
                            const matrix = getFoldConfusionMatrix(fold);
                            return (
                              <div key={fold.fold_index} className="ops-table-row">
                                <span>{fold.fold_index}</span>
                                <span>{matrix ? `${matrix[0][0]} / ${matrix[0][1]}` : common.notAvailable}</span>
                                <span>{matrix ? `${matrix[1][0]} / ${matrix[1][1]}` : common.notAvailable}</span>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  ) : null}
                </div>
              ) : <div className="empty-surface">{pick(locale, "No cross-validation report has been saved for this hospital yet.", "이 병원에는 아직 저장된 교차 검증 리포트가 없습니다.")}</div>}
            </section>
          ) : null}
          {section === "registry" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Registry", "레지스트리")}</div><h3>{pick(locale, "Model versions and update flow", "모델 버전 및 업데이트 흐름")}</h3></div><div className="doc-site-badge">{modelVersions.length} {pick(locale, "model(s)", "모델")}</div></div>
              <div className="ops-dual-grid">
                <section className="ops-card">
                  <div className="panel-card-head"><strong>{pick(locale, "Model versions", "모델 버전")}</strong><span>{currentModel?.version_name ?? common.notAvailable}</span></div>
                  {modelVersions.length === 0 ? <div className="empty-surface">{pick(locale, "No model version is registered yet.", "아직 등록된 모델 버전이 없습니다.")}</div> : <div className="ops-list">{modelVersions.slice().reverse().map((item) => <div key={item.version_id} className={`ops-item ${item.is_current ? "ops-item-active" : ""}`}><div className="panel-card-head"><strong>{item.version_name}</strong><span>{item.architecture}</span></div><div className="panel-meta"><span>{item.is_current ? pick(locale, "current", "현재") : item.stage ?? pick(locale, "stored", "보관됨")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span><span>{item.ready ? pick(locale, "ready", "준비됨") : pick(locale, "pending", "대기 중")}</span></div>{item.ensemble_weights ? <div className="panel-meta"><span>{pick(locale, "Ensemble", "앙상블")}</span><span>{pick(locale, "Automated", "Automated")} {formatWeightPercent(item.ensemble_weights.automated)}</span><span>{pick(locale, "Manual", "Manual")} {formatWeightPercent(item.ensemble_weights.manual)}</span></div> : null}{canManagePlatform ? <div className="workspace-actions"><button className="ghost-button compact-ghost-button" type="button" disabled={item.is_current} onClick={() => void handleDeleteModelVersion(item)}>{pick(locale, "Delete model", "모델 삭제")}</button></div> : null}</div>)}</div>}
                </section>
                <section className="ops-card">
                  <div className="panel-card-head"><strong>{pick(locale, "Model updates", "모델 업데이트")}</strong><span>{modelUpdates.length}</span></div>
                  {modelUpdates.length === 0 ? <div className="empty-surface">{pick(locale, "No model update has been recorded for the current filter.", "현재 필터에 기록된 모델 업데이트가 없습니다.")}</div> : <div className="ops-list">{modelUpdates.map((item) => <button key={item.update_id} className="ops-item ops-table-button" type="button" onClick={() => setSelectedModelUpdateId(item.update_id)}><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.status ?? pick(locale, "unknown", "알 수 없음")}</span></div><div className="panel-meta"><span>{item.site_id ?? pick(locale, "unknown hospital", "알 수 없는 병원")}</span><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span></div></button>)}</div>}
                </section>
              </div>
              {selectedModelUpdate ? (
                <section className="ops-card">
                  <div className="panel-card-head"><strong>{pick(locale, "Selected update", "선택한 업데이트")}</strong><span>{selectedModelUpdate.status ?? common.notAvailable}</span></div>
                  <div className="panel-meta"><span>{selectedModelUpdate.site_id ?? common.notAvailable}</span><span>{selectedModelUpdate.case_reference_id ?? common.notAvailable}</span><span>{selectedModelUpdate.architecture ?? common.notAvailable}</span></div>
                  {selectedModelUpdate.quality_summary ? (
                    <section className="update-quality-card">
                      <div className="panel-card-head">
                        <strong>{pick(locale, "Automatic quality summary", "자동 품질 요약")}</strong>
                        <span>{formatQualityRecommendation(locale, selectedModelUpdate.quality_summary.recommendation)}</span>
                      </div>
                      <p className="update-quality-help">
                        {pick(
                          locale,
                          "Image 25 + crop 25 + delta 25 + validation 25. Policy mismatch or invalid delta lowers the recommendation.",
                          "이미지 25 + crop 25 + delta 25 + 검증 25점 기준입니다. 정책 불일치나 delta 이상이 있으면 권장 수준이 내려갑니다.",
                        )}
                      </p>
                      <div className="panel-metric-grid">
                        <div><strong>{selectedModelUpdate.quality_summary.quality_score ?? common.notAvailable}</strong><span>{pick(locale, "quality score", "품질 점수")}</span></div>
                        <div><strong>{selectedModelUpdate.quality_summary.image_quality?.score ?? common.notAvailable}</strong><span>{pick(locale, "image", "이미지")}</span></div>
                        <div><strong>{selectedModelUpdate.quality_summary.crop_quality?.score ?? common.notAvailable}</strong><span>{pick(locale, "crop", "crop")}</span></div>
                        <div><strong>{selectedModelUpdate.quality_summary.delta_quality?.score ?? common.notAvailable}</strong><span>{pick(locale, "delta", "delta")}</span></div>
                        <div><strong>{selectedModelUpdate.quality_summary.validation_consistency?.status ?? common.notAvailable}</strong><span>{pick(locale, "validation", "검증")}</span></div>
                        <div><strong>{selectedModelUpdate.quality_summary.delta_quality?.l2_norm ?? common.notAvailable}</strong><span>{pick(locale, "delta norm", "delta norm")}</span></div>
                      </div>
                      <div className="panel-meta">
                        <span>{pick(locale, "Brightness", "밝기")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.mean_brightness, common.notAvailable)}</span>
                        <span>{pick(locale, "Contrast", "대비")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.contrast_stddev, common.notAvailable)}</span>
                        <span>{pick(locale, "Edge density", "경계 밀도")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.edge_density, common.notAvailable)}</span>
                        <span>{pick(locale, "Crop ratio", "crop 비율")}: {formatMetric(selectedModelUpdate.quality_summary.crop_quality?.roi_area_ratio, common.notAvailable)}</span>
                      </div>
                      {selectedModelUpdate.quality_summary.validation_consistency?.predicted_label ? (
                        <div className="panel-meta">
                          <span>{pick(locale, "Predicted", "예측")}: {selectedModelUpdate.quality_summary.validation_consistency.predicted_label}</span>
                          <span>{pick(locale, "Culture", "배양")}: {selectedModelUpdate.quality_summary.validation_consistency.true_label ?? common.notAvailable}</span>
                          <span>{pick(locale, "Confidence", "신뢰도")}: {formatMetric(selectedModelUpdate.quality_summary.validation_consistency.prediction_probability, common.notAvailable)}</span>
                        </div>
                      ) : null}
                      {selectedModelUpdate.quality_summary.risk_flags && selectedModelUpdate.quality_summary.risk_flags.length > 0 ? (
                        <div className="review-checklist-tags">
                          {selectedModelUpdate.quality_summary.risk_flags.map((flag) => (
                            <span key={flag} className="review-checklist-tag quality-risk-tag">{translateQualityFlag(locale, flag)}</span>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                  <div className="ops-gallery-triptych">
                    <div className="panel-image-card">{selectedUpdatePreviewUrls.source ? <img src={selectedUpdatePreviewUrls.source} alt="Source thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Source unavailable", "원본 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Source", "원본")}</strong></div></div>
                    <div className="panel-image-card">{selectedUpdatePreviewUrls.roi ? <img src={selectedUpdatePreviewUrls.roi} alt="Cornea crop thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Cornea crop unavailable", "각막 crop 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Cornea crop", "각막 crop")}</strong></div></div>
                    <div className="panel-image-card">{selectedUpdatePreviewUrls.mask ? <img src={selectedUpdatePreviewUrls.mask} alt="Mask thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Mask unavailable", "Mask 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>Mask</strong></div></div>
                  </div>
                  <div className="panel-metric-grid">
                    <div><strong>{selectedApprovalReport?.case_summary?.image_count ?? 0}</strong><span>{pick(locale, "images", "이미지 수")}</span></div>
                    <div><strong>{selectedApprovalReport?.case_summary?.representative_view ?? common.notAvailable}</strong><span>{pick(locale, "representative view", "대표 view")}</span></div>
                    <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.source?.mean_brightness, common.notAvailable)}</strong><span>{pick(locale, "source brightness", "원본 밝기")}</span></div>
                    <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.source?.edge_density, common.notAvailable)}</strong><span>{pick(locale, "source edge", "원본 edge")}</span></div>
                    <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.roi_crop?.contrast_stddev, common.notAvailable)}</strong><span>{pick(locale, "Cornea crop contrast", "각막 crop 대비")}</span></div>
                    <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.roi_area_ratio, common.notAvailable)}</strong><span>{pick(locale, "Cornea crop area ratio", "각막 crop 면적 비율")}</span></div>
                  </div>
                  <div className="panel-meta">
                    <span>{pick(locale, "EXIF removed", "EXIF 제거")}: {selectedApprovalReport?.privacy_controls?.upload_exif_removed ? pick(locale, "yes", "예") : pick(locale, "no", "아니오")}</span>
                    <span>{pick(locale, "Filename policy", "파일명 정책")}: {selectedApprovalReport?.privacy_controls?.stored_filename_policy ?? common.notAvailable}</span>
                    <span>{pick(locale, "Media policy", "미디어 정책")}: {selectedApprovalReport?.privacy_controls?.review_media_policy ?? common.notAvailable}</span>
                  </div>
                  <div className="review-checklist">
                    <div className="review-checklist-block">
                      <strong>{pick(locale, "Approval criteria", "승인 기준")}</strong>
                      <ul>
                        <li>{pick(locale, "Culture result and organism label are clear.", "배양 결과와 입력 균종이 명확합니다.")}</li>
                        <li>{pick(locale, "The lesion is clearly visible in the representative and supporting images.", "대표 이미지와 보조 이미지에서 병변이 충분히 식별됩니다.")}</li>
                        <li>{pick(locale, "Cornea or lesion crop appropriately covers the lesion and surrounding cornea.", "각막 또는 병변 crop이 병변과 주변 각막을 적절히 포함합니다.")}</li>
                        <li>{pick(locale, "The case matches the current training policy and is not a duplicate contribution.", "현재 학습 정책에 맞고 중복 기여가 아닙니다.")}</li>
                      </ul>
                    </div>
                    <div className="review-checklist-block">
                      <strong>{pick(locale, "Rejection criteria", "반려 기준")}</strong>
                      <ul>
                        <li>{pick(locale, "The culture result or organism label is uncertain.", "배양 결과 또는 균종 라벨이 불확실합니다.")}</li>
                        <li>{pick(locale, "Image quality is too poor to interpret the lesion.", "이미지 품질이 낮아 병변 해석이 어렵습니다.")}</li>
                        <li>{pick(locale, "The lesion box, mask, or crop result is inappropriate.", "병변 박스, mask, 또는 crop 결과가 부적절합니다.")}</li>
                        <li>{pick(locale, "The case conflicts with the current training policy or violates privacy rules.", "현재 학습 정책과 맞지 않거나 개인정보 정책을 위반합니다.")}</li>
                      </ul>
                    </div>
                    <div className="review-checklist-block">
                      <strong>{pick(locale, "Short rejection reasons", "짧은 반려 사유")}</strong>
                      <div className="review-checklist-tags">
                        {[
                          pick(locale, "Label uncertain", "라벨 불확실"),
                          pick(locale, "Image quality issue", "이미지 품질 불량"),
                          pick(locale, "Crop quality issue", "crop 품질 불량"),
                          pick(locale, "Duplicate contribution", "중복 기여"),
                          pick(locale, "Policy mismatch", "학습 정책과 불일치"),
                          pick(locale, "Policy violation", "정책 위반"),
                        ].map((reason) => (
                          <span key={reason} className="review-checklist-tag">{reason}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <label className="notes-field"><span>{pick(locale, "Reviewer note", "검토 메모")}</span><textarea rows={3} value={modelUpdateReviewNotes[selectedModelUpdate.update_id] ?? ""} onChange={(event) => setModelUpdateReviewNotes((current) => ({ ...current, [selectedModelUpdate.update_id]: event.target.value }))} /></label>
                  <div className="workspace-actions">
                    <button className="ghost-button" type="button" onClick={() => void handleModelUpdateReview("rejected")}>{pick(locale, "Reject update", "업데이트 반려")}</button>
                    <button className="primary-workspace-button" type="button" onClick={() => void handleModelUpdateReview("approved")}>{pick(locale, "Approve update", "업데이트 승인")}</button>
                  </div>
                </section>
              ) : null}
            </section>
          ) : null}
          {section === "management" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Management", "관리")}</div><h3>{pick(locale, "Projects, hospitals, and users", "프로젝트, 병원, 사용자 관리")}</h3></div><div className="doc-site-badge">{translateRole(locale, canManagePlatform ? "admin" : "site_admin")}</div></div>
              <div className="ops-stack">
                {canManageStorageRoot ? (
                  <div className="ops-dual-grid">
                    <section className="ops-card">
                      <div className="panel-card-head">
                        <strong>{pick(locale, "Default storage root", "기본 저장 경로")}</strong>
                        <span>{storageSettings?.uses_custom_root ? pick(locale, "custom", "사용자 지정") : pick(locale, "default", "기본값")}</span>
                      </div>
                      <div className="storage-settings-grid">
                        <label className="inline-field">
                          <span>{pick(locale, "Folder path", "폴더 경로")}</span>
                          <input
                            value={instanceStorageRootForm}
                            onChange={(event) => setInstanceStorageRootForm(event.target.value)}
                            placeholder="D:\\KERA_DATA"
                          />
                        </label>
                        <div className="storage-settings-copy">
                          <p>{pick(locale, "Used as the default root when a new hospital is created.", "새 병원을 만들 때 기본 저장 루트로 사용됩니다.")}</p>
                          <div className="storage-settings-meta">
                            <strong>{pick(locale, "Current default", "현재 기본값")}</strong>
                            <span>{storageSettings?.default_storage_root ?? common.notAvailable}</span>
                          </div>
                        </div>
                      </div>
                      <div className="storage-settings-actions">
                        <button className="ghost-button" type="button" onClick={() => setInstanceStorageRootForm(storageSettings?.default_storage_root ?? "")}>
                          {pick(locale, "Use built-in default", "기본 경로 사용")}
                        </button>
                        <button className="primary-workspace-button" type="button" onClick={() => void handleSaveStorageRoot()} disabled={storageSettingsBusy}>
                          {storageSettingsBusy ? pick(locale, "Saving...", "저장 중...") : pick(locale, "Save default root", "기본 경로 저장")}
                        </button>
                      </div>
                    </section>
                    <section className="ops-card">
                      <div className="panel-card-head">
                        <strong>{pick(locale, "Selected hospital storage root", "선택한 병원 저장 경로")}</strong>
                        <span>{selectedSiteId ?? common.notAvailable}</span>
                      </div>
                      {selectedManagedSite ? (
                        <>
                          <div className="storage-settings-grid">
                            <label className="inline-field">
                              <span>{pick(locale, "Folder path", "폴더 경로")}</span>
                              <input
                                value={siteStorageRootForm}
                                onChange={(event) => setSiteStorageRootForm(event.target.value)}
                                placeholder="D:\\HospitalAData\\JNUH"
                              />
                            </label>
                            <div className="storage-settings-copy">
                              <p>{pick(locale, "This changes where new files for the selected hospital will be written.", "선택한 병원의 새 파일이 저장될 경로를 바꿉니다.")}</p>
                              <p>{pick(locale, "For safety, the app only allows this before any patient, visit, or image exists for the hospital.", "안전을 위해 환자, 방문, 이미지가 하나도 없을 때만 변경할 수 있습니다.")}</p>
                              <div className="storage-settings-meta">
                                <strong>{pick(locale, "Current root", "현재 경로")}</strong>
                                <span>{selectedManagedSite.local_storage_root ?? common.notAvailable}</span>
                              </div>
                              <div className="storage-settings-meta">
                                <strong>{pick(locale, "Current hospital data", "현재 병원 데이터")}</strong>
                                <span>{summary ? `${summary.n_patients}/${summary.n_visits}/${summary.n_images}` : common.notAvailable}</span>
                              </div>
                            </div>
                          </div>
                          <div className="storage-settings-actions">
                            <button className="ghost-button" type="button" onClick={() => setSiteStorageRootForm(selectedManagedSite.local_storage_root ?? "")}>
                              {pick(locale, "Reset", "초기화")}
                            </button>
                            <button
                              className="primary-workspace-button"
                              type="button"
                              onClick={() => void handleSaveSelectedSiteStorageRoot()}
                              disabled={storageSettingsBusy || Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0))}
                            >
                              {storageSettingsBusy ? pick(locale, "Saving...", "저장 중...") : pick(locale, "Save hospital root", "병원 경로 저장")}
                            </button>
                            <button
                              className="primary-workspace-button"
                              type="button"
                              onClick={() => void handleMigrateSelectedSiteStorageRoot()}
                              disabled={storageSettingsBusy || !Boolean(summary && (summary.n_patients > 0 || summary.n_visits > 0 || summary.n_images > 0))}
                            >
                              {storageSettingsBusy ? pick(locale, "Migrating...", "이동 중...") : pick(locale, "Migrate existing data", "기존 데이터 이동")}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="empty-surface">{pick(locale, "Select a hospital to review or change its storage path.", "저장 경로를 확인하거나 변경하려면 병원을 선택하세요.")}</div>
                      )}
                    </section>
                  </div>
                ) : null}
                {canManagePlatform ? (
                  <>
                    <div className="ops-dual-grid">
                      <section className="ops-card">
                        <div className="panel-card-head"><strong>{pick(locale, "Projects", "프로젝트")}</strong><span>{projects.length}</span></div>
                        {projects.length === 0 ? <div className="empty-surface">{pick(locale, "No project has been registered yet.", "아직 등록된 프로젝트가 없습니다.")}</div> : <div className="ops-list">{projects.map((project) => <div key={project.project_id} className="ops-item"><div className="panel-card-head"><strong>{project.name}</strong><span>{project.site_ids.length} {pick(locale, "hospital(s)", "병원")}</span></div><div className="panel-meta"><span>{project.project_id}</span><span>{formatDateTime(project.created_at, localeTag, common.notAvailable)}</span></div></div>)}</div>}
                      </section>
                      <section className="ops-card">
                        <div className="panel-card-head"><strong>{pick(locale, "New project", "프로젝트 생성")}</strong><span>{pick(locale, "Create", "생성")}</span></div>
                        <div className="ops-stack">
                          <label className="inline-field"><span>{pick(locale, "Project name", "프로젝트 이름")}</span><input value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label>
                          <label className="notes-field"><span>{pick(locale, "Description", "설명")}</span><textarea rows={3} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label>
                          <div className="workspace-actions">
                            <button className="primary-workspace-button" type="button" onClick={() => void handleCreateProject()}>{pick(locale, "Create project", "프로젝트 생성")}</button>
                          </div>
                        </div>
                      </section>
                    </div>
                    <div className="ops-dual-grid">
                      <section className="ops-card">
                        <div className="panel-card-head"><strong>{pick(locale, "Hospitals", "병원")}</strong><span>{managedSites.length}</span></div>
                        {managedSites.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div> : <div className="ops-list">{managedSites.map((site) => <button key={site.site_id} className="ops-item ops-table-button" type="button" onClick={() => handleEditSite(site)}><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}</span></div></button>)}</div>}
                      </section>
                      <section className="ops-card">
                        <div className="panel-card-head"><strong>{editingSiteId ? pick(locale, "Edit hospital", "병원 수정") : pick(locale, "Register hospital", "병원 등록")}</strong><span>{editingSiteId ?? pick(locale, "new", "신규")}</span></div>
                        <div className="ops-stack">
                          <div className="panel-meta">
                            <span>{editingSiteId ? pick(locale, `Editing ${editingSiteId}`, `${editingSiteId} 수정 중`) : pick(locale, "Registering a new hospital", "새 병원 등록")}</span>
                            <span>{pick(locale, "Hospital code remains immutable after creation.", "병원 코드는 생성 후 수정하지 않습니다.")}</span>
                          </div>
                          <label className="inline-field">
                            <span>{pick(locale, "Project", "프로젝트")}</span>
                            <select
                              value={siteForm.project_id || projects[0]?.project_id || ""}
                              onChange={(event) => setSiteForm((current) => ({ ...current, project_id: event.target.value }))}
                              disabled={Boolean(editingSiteId)}
                            >
                              {projects.map((project) => (
                                <option key={project.project_id} value={project.project_id}>
                                  {project.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="ops-form-grid">
                            <label className="inline-field">
                              <span>{pick(locale, "Hospital code", "병원 코드")}</span>
                              <input
                                value={siteForm.site_code}
                                onChange={(event) => setSiteForm((current) => ({ ...current, site_code: event.target.value }))}
                                placeholder={pick(locale, "e.g. JNUH", "예: JNUH")}
                                disabled={Boolean(editingSiteId)}
                              />
                            </label>
                            <label className="inline-field">
                              <span>{pick(locale, "App display name", "앱 표시명")}</span>
                              <input
                                value={siteForm.display_name}
                                onChange={(event) => setSiteForm((current) => ({ ...current, display_name: event.target.value }))}
                                placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대병원")}
                              />
                            </label>
                          </div>
                          <p className="muted">
                            {pick(locale, "The app display name is the short label shown in lists and sidebars.", "앱 표시명은 목록과 사이드바에 보이는 짧은 이름입니다.")}
                          </p>
                          <label className="inline-field">
                            <span>{pick(locale, "Official hospital name", "공식 병원명")}</span>
                            <input
                              value={siteForm.hospital_name}
                              onChange={(event) => setSiteForm((current) => ({ ...current, hospital_name: event.target.value }))}
                              placeholder={pick(locale, "Jeju National University Hospital", "예: 제주대학교병원")}
                            />
                          </label>
                          <p className="muted">
                            {pick(locale, "The official hospital name is stored as the formal institution name.", "공식 병원명은 정식 기관명으로 저장됩니다.")}
                          </p>
                          <div className="workspace-actions">
                            <button className="ghost-button" type="button" onClick={() => resetSiteForm()}>{pick(locale, "Reset", "초기화")}</button>
                            <button className="primary-workspace-button" type="button" onClick={() => void (editingSiteId ? handleUpdateSite() : handleCreateSite())} disabled={projects.length === 0}>
                              {editingSiteId ? pick(locale, "Save hospital", "병원 저장") : pick(locale, "Register hospital", "병원 등록")}
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </>
                ) : (
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Hospitals", "병원")}</strong><span>{managedSites.length}</span></div>
                    {managedSites.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div> : <div className="ops-list">{managedSites.map((site) => <div key={site.site_id} className="ops-item"><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}</span></div></div>)}</div>}
                  </section>
                )}
                {canManagePlatform ? <section className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Users and access", "사용자 및 접근 권한")}</strong><span>{managedUsers.length}</span></div>{managedUsers.length === 0 ? <div className="empty-surface">{pick(locale, "No user record has been created yet.", "아직 생성된 사용자 레코드가 없습니다.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "username", "아이디")}</span><span>{pick(locale, "full name", "이름")}</span><span>{pick(locale, "role", "역할")}</span><span>{pick(locale, "hospitals", "병원")}</span></div>{managedUsers.map((managedUser) => <button key={managedUser.user_id} className="ops-table-row ops-table-button" type="button" onClick={() => setUserForm({ username: managedUser.username, full_name: managedUser.full_name, password: "", role: managedUser.role, site_ids: managedUser.site_ids ?? [] })}><span>{managedUser.username}</span><span>{managedUser.full_name}</span><span>{translateRole(locale, managedUser.role)}</span><span>{(managedUser.site_ids ?? []).join(", ") || pick(locale, "all", "전체")}</span></button>)}</div>}<div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Username", "아이디")}</span><input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} /></label><label className="inline-field"><span>{pick(locale, "Full name", "이름")}</span><input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} /></label></div><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Password", "비밀번호")}</span><input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={pick(locale, "Leave blank to keep existing password", "기존 비밀번호를 유지하려면 비워두세요")} /></label><label className="inline-field"><span>{pick(locale, "Role", "역할")}</span><select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="admin">{translateRole(locale, "admin")}</option><option value="site_admin">{translateRole(locale, "site_admin")}</option><option value="researcher">{translateRole(locale, "researcher")}</option><option value="viewer">{translateRole(locale, "viewer")}</option></select></label></div><label className="inline-field"><span>{pick(locale, "Accessible hospitals", "접근 가능한 병원")}</span><select multiple value={userForm.site_ids} onChange={(event) => setUserForm((current) => ({ ...current, site_ids: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{managedSites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label><div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => setUserForm(createUserForm())}>{pick(locale, "Reset", "초기화")}</button><button className="primary-workspace-button" type="button" onClick={() => void handleSaveUser()}>{pick(locale, "Save user", "사용자 저장")}</button></div></div></section> : null}
              </div>
            </section>
          ) : null}
          {section === "federation" && canAggregate ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Federation", "연합학습")}</div><h3>{pick(locale, "Aggregate approved hospital deltas", "승인된 병원 델타 집계")}</h3></div><div className="doc-site-badge">{approvedUpdates.length} {pick(locale, "approved", "승인됨")}</div></div>
              <label className="inline-field"><span>{pick(locale, "Optional version name", "선택적 버전 이름")}</span><input value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} placeholder="global-densenet-fedavg-20260311" /></label>
              <div className="doc-footer"><div><strong>{pick(locale, "Aggregate the full approved queue", "승인 대기열 전체 집계")}</strong><p>{pick(locale, "The API now aggregates only approved deltas that share one architecture and base model.", "이제 API는 같은 아키텍처와 기준 모델을 공유하는 승인된 delta만 집계합니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={aggregationBusy || approvedUpdates.length === 0} onClick={() => void handleAggregation()}>{aggregationBusy ? pick(locale, "Aggregating...", "집계 중...") : pick(locale, "Run FedAvg aggregation", "FedAvg 집계 실행")}</button></div>
              <div className="ops-dual-grid">
                <section className="ops-card">{approvedUpdates.length === 0 ? <div className="empty-surface">{pick(locale, "No approved updates are available for aggregation.", "집계할 승인된 업데이트가 없습니다.")}</div> : <div className="ops-list">{approvedUpdates.map((item) => <div key={item.update_id} className="ops-item"><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.site_id}</span></div><div className="panel-meta"><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{item.n_cases ?? 0} {pick(locale, "cases", "케이스")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span></div></div>)}</div>}</section>
                <section className="ops-card">{aggregations.length === 0 ? <div className="empty-surface">{pick(locale, "No aggregation record has been registered yet.", "아직 등록된 집계 기록이 없습니다.")}</div> : <div className="ops-list">{aggregations.map((item) => <div key={item.aggregation_id} className="ops-item"><div className="panel-card-head"><strong>{item.new_version_name}</strong><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span></div><div className="panel-meta"><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{item.total_cases ?? 0} {pick(locale, "cases", "케이스")}</span><span>{Object.keys(item.site_weights ?? {}).length} {pick(locale, "hospitals", "병원")}</span></div></div>)}</div>}</section>
              </div>
            </section>
          ) : null}
        </div>
      </section>
      {toast ? <div className={`workspace-toast tone-${toast.tone}`}><strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong><span>{toast.message}</span></div> : null}
    </main>
  );
}
