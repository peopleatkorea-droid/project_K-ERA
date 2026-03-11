"use client";

import { useEffect, useRef, useState } from "react";

import { LocaleToggle, pick, translateApiError, translateRole, translateStatus, useI18n } from "../lib/i18n";
import {
  createAdminSite,
  createProject,
  downloadImportTemplate,
  fetchAccessRequests,
  fetchAdminOverview,
  fetchAdminSites,
  fetchAggregations,
  fetchCrossValidationReports,
  fetchImageBlob,
  fetchModelUpdates,
  fetchModelVersions,
  fetchProjects,
  fetchSiteComparison,
  fetchSiteValidations,
  fetchUsers,
  fetchValidationArtifactBlob,
  fetchValidationCases,
  reviewAccessRequest,
  runBulkImport,
  runCrossValidation,
  runFederatedAggregation,
  runInitialTraining,
  upsertManagedUser,
  type AccessRequestRecord,
  type AdminOverviewResponse,
  type AggregationRecord,
  type AuthUser,
  type BulkImportResponse,
  type CrossValidationReport,
  type InitialTrainingResponse,
  type ManagedSiteRecord,
  type ManagedUserRecord,
  type ModelUpdateRecord,
  type ModelVersionRecord,
  type ProjectRecord,
  type SiteComparisonRecord,
  type SiteRecord,
  type SiteSummary,
  type SiteValidationRunRecord,
  type ValidationCasePredictionRecord,
} from "../lib/api";

const DENSENET_OPTIONS = ["densenet121", "densenet161", "densenet169", "densenet201"];

type ReviewDraft = {
  assigned_role: string;
  assigned_site_id: string;
  reviewer_notes: string;
};

type WorkspaceSection =
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

function createUserForm(): UserFormState {
  return {
    username: "",
    full_name: "",
    password: "",
    role: "viewer",
    site_ids: [],
  };
}

export function AdminWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  theme,
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
  const [section, setSection] = useState<WorkspaceSection>("dashboard");
  const [toast, setToast] = useState<ToastState>(null);
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
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
  const [misclassifiedCases, setMisclassifiedCases] = useState<DashboardCasePreview[]>([]);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [bulkImportResult, setBulkImportResult] = useState<BulkImportResponse | null>(null);
  const [projectForm, setProjectForm] = useState({ name: "", description: "" });
  const [siteForm, setSiteForm] = useState({ project_id: "", site_code: "", display_name: "", hospital_name: "" });
  const [userForm, setUserForm] = useState<UserFormState>(() => createUserForm());
  const [initialBusy, setInitialBusy] = useState(false);
  const [initialResult, setInitialResult] = useState<InitialTrainingResponse | null>(null);
  const [crossValidationBusy, setCrossValidationBusy] = useState(false);
  const [crossValidationReports, setCrossValidationReports] = useState<CrossValidationReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [aggregationBusy, setAggregationBusy] = useState(false);
  const [newVersionName, setNewVersionName] = useState("");
  const dashboardPreviewUrlsRef = useRef<string[]>([]);
  const [initialForm, setInitialForm] = useState({
    architecture: "densenet121",
    execution_mode: "auto" as "auto" | "cpu" | "gpu",
    epochs: 30,
    learning_rate: 1e-4,
    batch_size: 16,
    val_split: 0.2,
    test_split: 0.2,
    use_pretrained: true,
    regenerate_split: false,
  });
  const [crossValidationForm, setCrossValidationForm] = useState({
    architecture: "densenet121",
    execution_mode: "auto" as "auto" | "cpu" | "gpu",
    num_folds: 5,
    epochs: 10,
    learning_rate: 1e-4,
    batch_size: 16,
    val_split: 0.2,
    use_pretrained: true,
  });

  const canAggregate = user.role === "admin";
  const canManagePlatform = user.role === "admin";
  const currentModel = modelVersions.find((item) => item.is_current) ?? modelVersions[modelVersions.length - 1] ?? null;
  const pendingUploadUpdates = modelUpdates.filter((item) => item.status === "pending_upload");
  const selectedReport = crossValidationReports.find((item) => item.cross_validation_id === selectedReportId) ?? null;
  const selectedValidationRun = siteValidationRuns.find((item) => item.validation_id === selectedValidationId) ?? null;
  const baselineValidationRun = siteValidationRuns.find((item) => item.validation_id === baselineValidationId) ?? null;
  const compareValidationRun = siteValidationRuns.find((item) => item.validation_id === compareValidationId) ?? null;
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
    siteRegistered: (siteId: string) => pick(locale, `Hospital ${siteId} registered.`, `${siteId} 병원을 등록했습니다.`),
    unableCreateSite: pick(locale, "Unable to create hospital.", "병원 생성에 실패했습니다."),
    usernameRequired: pick(locale, "Username is required.", "아이디는 필수입니다."),
    assignSiteRequired: pick(locale, "Assign at least one hospital for non-admin users.", "관리자가 아닌 사용자는 최소 한 개 이상의 병원을 지정해야 합니다."),
    userSaved: pick(locale, "User settings saved.", "사용자 설정을 저장했습니다."),
    unableSaveUser: pick(locale, "Unable to save user.", "사용자 저장에 실패했습니다."),
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
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [
          nextOverview,
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
      } catch (nextError) {
        if (!cancelled) {
          setToast({ tone: "error", message: describeError(nextError, copy.unableLoadOperations) });
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
      setMisclassifiedCases([]);
      return;
    }
    setSelectedValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setCompareValidationId((current) => current ?? siteValidationRuns[0]?.validation_id ?? null);
    setBaselineValidationId((current) => current ?? siteValidationRuns[1]?.validation_id ?? siteValidationRuns[0]?.validation_id ?? null);
  }, [siteValidationRuns]);

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

  async function refreshWorkspace(siteScoped = false) {
    const [
      nextOverview,
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
    try {
      const result = await runInitialTraining(selectedSiteId, token, initialForm);
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

  async function handleCrossValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: copy.selectSiteForCrossValidation });
      return;
    }
    setCrossValidationBusy(true);
    try {
      const result = await runCrossValidation(selectedSiteId, token, crossValidationForm);
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

  async function handleCreateSite() {
    const effectiveProjectId = siteForm.project_id || projects[0]?.project_id || "";
    if (!effectiveProjectId || !siteForm.site_code.trim() || !siteForm.display_name.trim()) {
      setToast({ tone: "error", message: copy.siteFieldsRequired });
      return;
    }
    try {
      const createdSite = await createAdminSite(token, { ...siteForm, project_id: effectiveProjectId });
      setSiteForm((current) => ({
        ...current,
        project_id: effectiveProjectId,
        site_code: "",
        display_name: "",
        hospital_name: "",
      }));
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(createdSite.site_id);
      setToast({ tone: "success", message: copy.siteRegistered(createdSite.site_id) });
    } catch (nextError) {
      setToast({ tone: "error", message: describeError(nextError, copy.unableCreateSite) });
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
        <div className="workspace-brand">
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
            <div><strong>{overview?.pending_model_updates ?? pendingUploadUpdates.length}</strong><span>{pick(locale, "pending updates", "대기 중 업데이트")}</span></div>
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
                    <div className="panel-card-head"><strong>{pick(locale, "Validation run comparison", "검증 실행 비교")}</strong><span>{siteValidationRuns.length} {pick(locale, "run(s)", "회")}</span></div>
                    {siteValidationRuns.length < 2 ? <div className="empty-surface">{pick(locale, "At least two hospital validation runs are required for run-to-run comparison.", "실행 간 비교를 하려면 병원 검증 이력이 2개 이상 필요합니다.")}</div> : <div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Baseline run", "기준 실행")}</span><select value={baselineValidationId ?? ""} onChange={(event) => setBaselineValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date, localeTag, common.notAvailable)}</option>)}</select></label><label className="inline-field"><span>{pick(locale, "Compare run", "비교 실행")}</span><select value={compareValidationId ?? ""} onChange={(event) => setCompareValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date, localeTag, common.notAvailable)}</option>)}</select></label></div><div className="panel-metric-grid"><div><strong>{formatMetric(compareValidationRun?.AUROC, common.notAvailable)}</strong><span>AUROC ({formatDelta(compareValidationRun?.AUROC, baselineValidationRun?.AUROC, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.accuracy, common.notAvailable)}</strong><span>{pick(locale, "accuracy", "정확도")} ({formatDelta(compareValidationRun?.accuracy, baselineValidationRun?.accuracy, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.sensitivity, common.notAvailable)}</strong><span>{pick(locale, "sensitivity", "민감도")} ({formatDelta(compareValidationRun?.sensitivity, baselineValidationRun?.sensitivity, common.notAvailable)})</span></div><div><strong>{formatMetric(compareValidationRun?.F1, common.notAvailable)}</strong><span>F1 ({formatDelta(compareValidationRun?.F1, baselineValidationRun?.F1, common.notAvailable)})</span></div></div></div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Validation run history", "검증 실행 이력")}</strong><span>{siteValidationRuns.length} {pick(locale, "stored", "저장됨")}</span></div>
                    {siteValidationRuns.length === 0 ? <div className="empty-surface">{pick(locale, "No validation history has been stored for this hospital yet.", "이 병원에는 아직 저장된 검증 이력이 없습니다.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "run date", "실행 일시")}</span><span>{pick(locale, "model", "모델")}</span><span>{pick(locale, "cases", "케이스")}</span><span>AUROC</span><span>{pick(locale, "accuracy", "정확도")}</span><span>F1</span></div>{siteValidationRuns.map((run) => <button key={run.validation_id} className={`ops-table-row ops-table-button ${selectedValidationId === run.validation_id ? "active" : ""}`} type="button" onClick={() => setSelectedValidationId(run.validation_id)}><span>{formatDateTime(run.run_date, localeTag, common.notAvailable)}</span><span>{run.model_version}</span><span>{run.n_cases}</span><span>{formatMetric(run.AUROC, common.notAvailable)}</span><span>{formatMetric(run.accuracy, common.notAvailable)}</span><span>{formatMetric(run.F1, common.notAvailable)}</span></button>)}</div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Representative misclassified cases", "대표 오분류 케이스")}</strong><span>{dashboardBusy ? common.loading : `${misclassifiedCases.length} ${pick(locale, "shown", "표시됨")}`}</span></div>
                    {misclassifiedCases.length === 0 ? <div className="empty-surface">{pick(locale, "No misclassified case preview is available for the selected validation run.", "선택한 검증 실행에 대한 오분류 미리보기가 없습니다.")}</div> : <div className="ops-gallery-grid">{misclassifiedCases.map((item) => <article key={`${item.patient_id}-${item.visit_date}`} className="ops-item"><div className="panel-card-head"><strong>{item.patient_id}</strong><span>{item.visit_date}</span></div><div className="panel-meta"><span>{item.true_label}</span><span>{item.predicted_label}</span><span>{formatMetric(item.prediction_probability, common.notAvailable)}</span></div><div className="ops-gallery-triptych"><div className="panel-image-card">{item.original_preview_url ? <img src={item.original_preview_url} alt={pick(locale, `${item.patient_id} original image`, `${item.patient_id} 원본 이미지`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Original unavailable", "원본을 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Original", "원본")}</strong></div></div><div className="panel-image-card">{item.roi_preview_url ? <img src={item.roi_preview_url} alt={pick(locale, `${item.patient_id} ROI`, `${item.patient_id} ROI`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "ROI unavailable", "ROI를 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "ROI", "ROI")}</strong></div></div><div className="panel-image-card">{item.gradcam_preview_url ? <img src={item.gradcam_preview_url} alt={pick(locale, `${item.patient_id} Grad-CAM`, `${item.patient_id} Grad-CAM`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Grad-CAM unavailable", "Grad-CAM을 표시할 수 없습니다")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong></div></div></div></article>)}</div>}
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
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>{pick(locale, "Architecture", "아키텍처")}</span><select value={initialForm.architecture} onChange={(event) => setInitialForm((current) => ({ ...current, architecture: event.target.value }))}>{DENSENET_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="inline-field"><span>{pick(locale, "Execution mode", "실행 모드")}</span><select value={initialForm.execution_mode} onChange={(event) => setInitialForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">{pick(locale, "auto", "자동")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Epochs", "에폭")}</span><input type="number" min={1} value={initialForm.epochs} onChange={(event) => setInitialForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Batch size", "배치 크기")}</span><input type="number" min={1} value={initialForm.batch_size} onChange={(event) => setInitialForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Learning rate", "학습률")}</span><input type="number" min={0.00001} step="0.00001" value={initialForm.learning_rate} onChange={(event) => setInitialForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Validation split", "검증 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.val_split} onChange={(event) => setInitialForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Test split", "테스트 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.test_split} onChange={(event) => setInitialForm((current) => ({ ...current, test_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${initialForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{initialForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button><button className={`toggle-pill ${initialForm.regenerate_split ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, regenerate_split: !current.regenerate_split }))}>{initialForm.regenerate_split ? pick(locale, "Regenerate split", "분할 재생성") : pick(locale, "Reuse split", "기존 분할 재사용")}</button></div>
              <div className="doc-footer"><div><strong>{pick(locale, "DenseNet + MedSAM crop only", "DenseNet + MedSAM crop 전용")}</strong><p>{pick(locale, "The existing Python pipeline still executes the actual training.", "실제 학습 실행은 기존 Python 파이프라인이 계속 담당합니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={initialBusy || !selectedSiteId} onClick={() => void handleInitialTraining()}>{initialBusy ? pick(locale, "Training...", "학습 중...") : pick(locale, "Run initial training", "초기 학습 실행")}</button></div>
              {initialResult ? <div className="panel-metric-grid"><div><strong>{initialResult.result.n_train_patients}</strong><span>{pick(locale, "train patients", "학습 환자")}</span></div><div><strong>{initialResult.result.n_val_patients}</strong><span>{pick(locale, "val patients", "검증 환자")}</span></div><div><strong>{initialResult.result.n_test_patients}</strong><span>{pick(locale, "test patients", "테스트 환자")}</span></div><div><strong>{formatMetric(initialResult.result.best_val_acc, common.notAvailable)}</strong><span>{pick(locale, "best val acc", "최고 검증 정확도")}</span></div></div> : null}
            </section>
          ) : null}
          {section === "cross_validation" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Cross-validation", "교차 검증")}</div><h3>{pick(locale, "Patient-level fold review", "환자 단위 fold 검토")}</h3></div><div className="doc-site-badge">{crossValidationReports.length} {pick(locale, "report(s)", "리포트")}</div></div>
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>{pick(locale, "Architecture", "아키텍처")}</span><select value={crossValidationForm.architecture} onChange={(event) => setCrossValidationForm((current) => ({ ...current, architecture: event.target.value }))}>{DENSENET_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="inline-field"><span>{pick(locale, "Execution mode", "실행 모드")}</span><select value={crossValidationForm.execution_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">{pick(locale, "auto", "자동")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
                <label className="inline-field"><span>{pick(locale, "Folds", "폴드 수")}</span><input type="number" min={3} max={5} value={crossValidationForm.num_folds} onChange={(event) => setCrossValidationForm((current) => ({ ...current, num_folds: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Epochs", "에폭")}</span><input type="number" min={1} value={crossValidationForm.epochs} onChange={(event) => setCrossValidationForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Batch size", "배치 크기")}</span><input type="number" min={1} value={crossValidationForm.batch_size} onChange={(event) => setCrossValidationForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Learning rate", "학습률")}</span><input type="number" min={0.00001} step="0.00001" value={crossValidationForm.learning_rate} onChange={(event) => setCrossValidationForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>{pick(locale, "Validation split", "검증 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={crossValidationForm.val_split} onChange={(event) => setCrossValidationForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${crossValidationForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setCrossValidationForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{crossValidationForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button></div>
              <div className="doc-footer"><div><strong>{pick(locale, "Saved reports stay selectable", "저장된 리포트 선택 가능")}</strong><p>{pick(locale, "Cross-validation JSON reports are read back from the existing validation workspace.", "교차 검증 JSON 리포트는 기존 검증 워크스페이스에서 다시 읽어옵니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={crossValidationBusy || !selectedSiteId} onClick={() => void handleCrossValidation()}>{crossValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run cross-validation", "교차 검증 실행")}</button></div>
              {crossValidationReports.length > 0 ? (
                <div className="ops-stack">
                  <label className="inline-field"><span>{pick(locale, "Saved report", "저장된 리포트")}</span><select value={selectedReportId ?? ""} onChange={(event) => setSelectedReportId(event.target.value)}>{crossValidationReports.map((report) => <option key={report.cross_validation_id} value={report.cross_validation_id}>{report.cross_validation_id} · {report.architecture} · {formatDateTime(report.created_at, localeTag, common.notAvailable)}</option>)}</select></label>
                  {selectedReport ? <div className="panel-metric-grid">{["AUROC", "accuracy", "sensitivity", "specificity", "F1"].map((metricName) => <div key={metricName}><strong>{formatMetric(selectedReport.aggregate_metrics[metricName]?.mean, common.notAvailable)}</strong><span>{metricName === "accuracy" ? pick(locale, "accuracy", "정확도") : metricName === "sensitivity" ? pick(locale, "sensitivity", "민감도") : metricName === "specificity" ? pick(locale, "specificity", "특이도") : metricName}</span></div>)}</div> : null}
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
                  {modelVersions.length === 0 ? <div className="empty-surface">{pick(locale, "No model version is registered yet.", "아직 등록된 모델 버전이 없습니다.")}</div> : <div className="ops-list">{modelVersions.slice().reverse().map((item) => <div key={item.version_id} className="ops-item"><div className="panel-card-head"><strong>{item.version_name}</strong><span>{item.architecture}</span></div><div className="panel-meta"><span>{item.is_current ? pick(locale, "current", "현재") : item.stage ?? pick(locale, "stored", "보관됨")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span><span>{item.ready ? pick(locale, "ready", "준비됨") : pick(locale, "pending", "대기 중")}</span></div></div>)}</div>}
                </section>
                <section className="ops-card">
                  <div className="panel-card-head"><strong>{pick(locale, "Model updates", "모델 업데이트")}</strong><span>{modelUpdates.length}</span></div>
                  {modelUpdates.length === 0 ? <div className="empty-surface">{pick(locale, "No model update has been recorded for the current filter.", "현재 필터에 기록된 모델 업데이트가 없습니다.")}</div> : <div className="ops-list">{modelUpdates.map((item) => <div key={item.update_id} className="ops-item"><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.status ?? pick(locale, "unknown", "알 수 없음")}</span></div><div className="panel-meta"><span>{item.site_id ?? pick(locale, "unknown hospital", "알 수 없는 병원")}</span><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span></div></div>)}</div>}
                </section>
              </div>
            </section>
          ) : null}
          {section === "management" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Management", "관리")}</div><h3>{pick(locale, "Projects, hospitals, and users", "프로젝트, 병원, 사용자 관리")}</h3></div><div className="doc-site-badge">{translateRole(locale, canManagePlatform ? "admin" : "site_admin")}</div></div>
              <div className="ops-stack">
                <div className="ops-dual-grid">
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Projects", "프로젝트")}</strong><span>{projects.length}</span></div>
                    {projects.length === 0 ? <div className="empty-surface">{pick(locale, "No project has been registered yet.", "아직 등록된 프로젝트가 없습니다.")}</div> : <div className="ops-list">{projects.map((project) => <div key={project.project_id} className="ops-item"><div className="panel-card-head"><strong>{project.name}</strong><span>{project.site_ids.length} {pick(locale, "hospital(s)", "병원")}</span></div><div className="panel-meta"><span>{project.project_id}</span><span>{formatDateTime(project.created_at, localeTag, common.notAvailable)}</span></div></div>)}</div>}
                    {canManagePlatform ? <div className="ops-stack"><label className="inline-field"><span>{pick(locale, "Project name", "프로젝트 이름")}</span><input value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="notes-field"><span>{pick(locale, "Description", "설명")}</span><textarea rows={3} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label><button className="primary-workspace-button" type="button" onClick={() => void handleCreateProject()}>{pick(locale, "Create project", "프로젝트 생성")}</button></div> : null}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>{pick(locale, "Hospitals", "병원")}</strong><span>{managedSites.length}</span></div>
                    {managedSites.length === 0 ? <div className="empty-surface">{pick(locale, "No hospital is visible to this account.", "이 계정에서 볼 수 있는 병원이 없습니다.")}</div> : <div className="ops-list">{managedSites.map((site) => <div key={site.site_id} className="ops-item"><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || pick(locale, "No hospital name", "병원명 없음")}</span></div></div>)}</div>}
                    {canManagePlatform ? (
                      <div className="ops-stack">
                        <label className="inline-field">
                          <span>{pick(locale, "Project", "프로젝트")}</span>
                          <select
                            value={siteForm.project_id || projects[0]?.project_id || ""}
                            onChange={(event) => setSiteForm((current) => ({ ...current, project_id: event.target.value }))}
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
                            />
                          </label>
                          <label className="inline-field">
                            <span>{pick(locale, "App display name", "앱 표시명")}</span>
                            <input
                              value={siteForm.display_name}
                              onChange={(event) => setSiteForm((current) => ({ ...current, display_name: event.target.value }))}
                              placeholder={pick(locale, "Jeju National University Hospital", "제주대병원")}
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
                            placeholder={pick(locale, "Jeju National University Hospital", "제주대학교병원")}
                          />
                        </label>
                        <p className="muted">
                          {pick(locale, "The official hospital name is stored as the formal institution name.", "공식 병원명은 정식 기관명으로 저장됩니다.")}
                        </p>
                        <button className="primary-workspace-button" type="button" onClick={() => void handleCreateSite()} disabled={projects.length === 0}>
                          {pick(locale, "Register hospital", "병원 등록")}
                        </button>
                      </div>
                    ) : null}
                  </section>
                </div>
                {canManagePlatform ? <section className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Users and access", "사용자 및 접근 권한")}</strong><span>{managedUsers.length}</span></div>{managedUsers.length === 0 ? <div className="empty-surface">{pick(locale, "No user record has been created yet.", "아직 생성된 사용자 레코드가 없습니다.")}</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "username", "아이디")}</span><span>{pick(locale, "full name", "이름")}</span><span>{pick(locale, "role", "역할")}</span><span>{pick(locale, "hospitals", "병원")}</span></div>{managedUsers.map((managedUser) => <button key={managedUser.user_id} className="ops-table-row ops-table-button" type="button" onClick={() => setUserForm({ username: managedUser.username, full_name: managedUser.full_name, password: "", role: managedUser.role, site_ids: managedUser.site_ids ?? [] })}><span>{managedUser.username}</span><span>{managedUser.full_name}</span><span>{translateRole(locale, managedUser.role)}</span><span>{(managedUser.site_ids ?? []).join(", ") || pick(locale, "all", "전체")}</span></button>)}</div>}<div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Username", "아이디")}</span><input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} /></label><label className="inline-field"><span>{pick(locale, "Full name", "이름")}</span><input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} /></label></div><div className="ops-form-grid"><label className="inline-field"><span>{pick(locale, "Password", "비밀번호")}</span><input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={pick(locale, "Leave blank to keep existing password", "기존 비밀번호를 유지하려면 비워두세요")} /></label><label className="inline-field"><span>{pick(locale, "Role", "역할")}</span><select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="admin">{translateRole(locale, "admin")}</option><option value="site_admin">{translateRole(locale, "site_admin")}</option><option value="researcher">{translateRole(locale, "researcher")}</option><option value="viewer">{translateRole(locale, "viewer")}</option></select></label></div><label className="inline-field"><span>{pick(locale, "Accessible hospitals", "접근 가능한 병원")}</span><select multiple value={userForm.site_ids} onChange={(event) => setUserForm((current) => ({ ...current, site_ids: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{managedSites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label><div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => setUserForm(createUserForm())}>{pick(locale, "Reset", "초기화")}</button><button className="primary-workspace-button" type="button" onClick={() => void handleSaveUser()}>{pick(locale, "Save user", "사용자 저장")}</button></div></div></section> : null}
              </div>
            </section>
          ) : null}
          {section === "federation" && canAggregate ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">{pick(locale, "Federation", "연합학습")}</div><h3>{pick(locale, "Aggregate pending hospital deltas", "대기 중 병원 델타 집계")}</h3></div><div className="doc-site-badge">{pendingUploadUpdates.length} {pick(locale, "pending", "대기")}</div></div>
              <label className="inline-field"><span>{pick(locale, "Optional version name", "선택적 버전 이름")}</span><input value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} placeholder="global-densenet-fedavg-20260311" /></label>
              <div className="doc-footer"><div><strong>{pick(locale, "Aggregate the full pending queue", "대기열 전체 집계")}</strong><p>{pick(locale, "The API currently aggregates all pending deltas that share one architecture and base model.", "현재 API는 같은 아키텍처와 기준 모델을 공유하는 모든 대기 delta를 집계합니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={aggregationBusy || pendingUploadUpdates.length === 0} onClick={() => void handleAggregation()}>{aggregationBusy ? pick(locale, "Aggregating...", "집계 중...") : pick(locale, "Run FedAvg aggregation", "FedAvg 집계 실행")}</button></div>
              <div className="ops-dual-grid">
                <section className="ops-card">{pendingUploadUpdates.length === 0 ? <div className="empty-surface">{pick(locale, "No pending updates are available for aggregation.", "집계할 대기 중 업데이트가 없습니다.")}</div> : <div className="ops-list">{pendingUploadUpdates.map((item) => <div key={item.update_id} className="ops-item"><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.site_id}</span></div><div className="panel-meta"><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{item.n_cases ?? 0} {pick(locale, "cases", "케이스")}</span><span>{formatDateTime(item.created_at, localeTag, common.notAvailable)}</span></div></div>)}</div>}</section>
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
