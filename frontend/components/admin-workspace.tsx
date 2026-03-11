"use client";

import { useEffect, useRef, useState } from "react";

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
  onSelectSite: (siteId: string) => void;
  onOpenCanvas: () => void;
  onLogout: () => void;
  onRefreshSites: () => Promise<void>;
  onSiteDataChanged: (siteId: string) => Promise<void>;
};

type ToastState = { tone: "success" | "error"; message: string } | null;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMetric(value: number | null | undefined): string {
  return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(3) : "n/a";
}

function formatDelta(nextValue: number | null | undefined, baselineValue: number | null | undefined): string {
  if (typeof nextValue !== "number" || typeof baselineValue !== "number") {
    return "n/a";
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
  onSelectSite,
  onOpenCanvas,
  onLogout,
  onRefreshSites,
  onSiteDataChanged,
}: AdminWorkspaceProps) {
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
          setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to load operations." });
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
          setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to load misclassified cases." });
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
      setToast({ tone: "success", message: `Request ${decision}.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to review request." });
    }
  }

  async function handleInitialTraining() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before starting initial training." });
      return;
    }
    setInitialBusy(true);
    try {
      const result = await runInitialTraining(selectedSiteId, token, initialForm);
      setInitialResult(result);
      await refreshWorkspace(true);
      setSection("registry");
      setToast({ tone: "success", message: `Registered ${result.result.version_name}.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Initial training failed." });
    } finally {
      setInitialBusy(false);
    }
  }

  async function handleCrossValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before running cross-validation." });
      return;
    }
    setCrossValidationBusy(true);
    try {
      const result = await runCrossValidation(selectedSiteId, token, crossValidationForm);
      const nextReports = [result.report, ...crossValidationReports.filter((item) => item.cross_validation_id !== result.report.cross_validation_id)];
      setCrossValidationReports(nextReports);
      setSelectedReportId(result.report.cross_validation_id);
      setToast({ tone: "success", message: `Saved report ${result.report.cross_validation_id}.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Cross-validation failed." });
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
      setToast({ tone: "success", message: `Created ${result.aggregation.new_version_name}.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Federated aggregation failed." });
    } finally {
      setAggregationBusy(false);
    }
  }

  async function handleDownloadImportTemplate() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before downloading the template." });
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
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Template download failed." });
    }
  }

  async function handleBulkImport() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before importing." });
      return;
    }
    if (!bulkCsvFile) {
      setToast({ tone: "error", message: "Choose a CSV file first." });
      return;
    }
    setBulkImportBusy(true);
    try {
      const result = await runBulkImport(selectedSiteId, token, { csvFile: bulkCsvFile, files: bulkFiles });
      setBulkImportResult(result);
      await refreshWorkspace(true);
      setSection("dashboard");
      setToast({ tone: "success", message: `Imported ${result.imported_images} images into ${selectedSiteId}.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Bulk import failed." });
    } finally {
      setBulkImportBusy(false);
    }
  }

  async function handleCreateProject() {
    if (!projectForm.name.trim()) {
      setToast({ tone: "error", message: "Project name is required." });
      return;
    }
    try {
      await createProject(token, projectForm);
      setProjectForm({ name: "", description: "" });
      await refreshWorkspace();
      setToast({ tone: "success", message: "Project registered." });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to create project." });
    }
  }

  async function handleCreateSite() {
    if (!siteForm.project_id || !siteForm.site_code.trim() || !siteForm.display_name.trim()) {
      setToast({ tone: "error", message: "Project, site code, and display name are required." });
      return;
    }
    try {
      const createdSite = await createAdminSite(token, siteForm);
      setSiteForm((current) => ({ ...current, site_code: "", display_name: "", hospital_name: "" }));
      await onRefreshSites();
      await refreshWorkspace();
      onSelectSite(createdSite.site_id);
      setToast({ tone: "success", message: `Site ${createdSite.site_id} registered.` });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to create site." });
    }
  }

  async function handleSaveUser() {
    if (!userForm.username.trim()) {
      setToast({ tone: "error", message: "Username is required." });
      return;
    }
    if (userForm.role !== "admin" && userForm.site_ids.length === 0) {
      setToast({ tone: "error", message: "Assign at least one site for non-admin users." });
      return;
    }
    try {
      await upsertManagedUser(token, userForm);
      setUserForm(createUserForm());
      await refreshWorkspace();
      setToast({ tone: "success", message: "User settings saved." });
    } catch (nextError) {
      setToast({ tone: "error", message: nextError instanceof Error ? nextError.message : "Unable to save user." });
    }
  }

  return (
    <main className="workspace-shell" data-workspace-theme="dark">
      <div className="workspace-noise" />
      <aside className="workspace-rail">
        <div className="workspace-brand">
          <div>
            <div className="workspace-kicker">Operations</div>
            <h1>K-ERA Control</h1>
          </div>
          <button className="ghost-button" type="button" onClick={onOpenCanvas}>Case canvas</button>
        </div>
        <section className="workspace-card rail-section">
          <div className="rail-section-head"><span className="rail-label">Sites</span><strong>{sites.length} linked</strong></div>
          <div className="rail-site-list">
            {sites.map((site) => (
              <button key={site.site_id} className={`rail-site-button ${selectedSiteId === site.site_id ? "active" : ""}`} type="button" onClick={() => onSelectSite(site.site_id)}>
                <strong>{site.display_name}</strong><span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="workspace-card rail-section">
          <div className="rail-section-head"><span className="rail-label">Sections</span></div>
          <div className="ops-nav-list">
            {[
              ["dashboard", "Dashboard"],
              ["imports", "Bulk import"],
              ["requests", "Access requests"],
              ["training", "Initial training"],
              ["cross_validation", "Cross-validation"],
              ["registry", "Model registry"],
              ["management", "Management"],
              ...(canAggregate ? [["federation", "Federation"]] : []),
            ].map(([value, label]) => (
              <button key={value} className={`ops-nav-button ${section === value ? "active" : ""}`} type="button" onClick={() => setSection(value as typeof section)}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className="workspace-card rail-section">
          <div className="panel-metric-grid rail-metric-grid">
            <div><strong>{overview?.pending_access_requests ?? pendingRequests.length}</strong><span>pending access</span></div>
            <div><strong>{overview?.pending_model_updates ?? pendingUploadUpdates.length}</strong><span>pending updates</span></div>
            <div><strong>{overview?.model_version_count ?? modelVersions.length}</strong><span>models</span></div>
            <div><strong>{overview?.current_model_version ?? currentModel?.version_name ?? "n/a"}</strong><span>current model</span></div>
          </div>
          {summary ? <div className="ops-site-summary"><div className="panel-meta"><span>{selectedSiteId}</span><span>{summary.n_patients} patients</span><span>{summary.n_images} images</span></div></div> : null}
        </section>
      </aside>
      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-kicker">Control plane</div>
            <h2>Operate import, review, training, and model movement from the web workspace</h2>
            <p>Logged in as {user.full_name} ({user.role}). Admin and site operations now stay in React/FastAPI.</p>
          </div>
          <div className="workspace-actions">
            <button className="ghost-button" type="button" onClick={onOpenCanvas}>Open case canvas</button>
            <button className="primary-workspace-button" type="button" onClick={onLogout}>Log out</button>
          </div>
        </header>
        <div className="ops-main-stack">
          {section === "dashboard" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Dashboard</div><h3>Validation trends, comparison, and misclassifications</h3></div><div className="doc-site-badge">{selectedSiteId ?? "Select a site"}</div></div>
              {selectedSiteId ? (
                <div className="ops-stack">
                  <div className="ops-dual-grid">
                    <section className="ops-card">
                      <div className="panel-card-head"><strong>Latest site validation</strong><span>{selectedValidationRun ? formatDateTime(selectedValidationRun.run_date) : "No run yet"}</span></div>
                      {selectedValidationRun ? <div className="panel-metric-grid"><div><strong>{selectedValidationRun.model_version}</strong><span>model</span></div><div><strong>{formatMetric(selectedValidationRun.AUROC)}</strong><span>AUROC</span></div><div><strong>{formatMetric(selectedValidationRun.accuracy)}</strong><span>accuracy</span></div><div><strong>{formatMetric(selectedValidationRun.sensitivity)}</strong><span>sensitivity</span></div><div><strong>{formatMetric(selectedValidationRun.specificity)}</strong><span>specificity</span></div><div><strong>{formatMetric(selectedValidationRun.F1)}</strong><span>F1</span></div></div> : <div className="empty-surface">No site-level validation has been recorded for this site yet.</div>}
                    </section>
                    <section className="ops-card">
                      <div className="panel-card-head"><strong>Site comparison</strong><span>{siteComparison.length} site(s)</span></div>
                      {siteComparison.length === 0 ? <div className="empty-surface">No site comparison data is available yet.</div> : <div className="ops-list">{siteComparison.slice(0, 6).map((item) => <div key={item.site_id} className="ops-item"><div className="panel-card-head"><strong>{item.display_name}</strong><span>{item.run_count} run(s)</span></div><div className="panel-meta"><span>{item.site_id}</span><span>AUROC {formatMetric(item.AUROC)}</span><span>Acc {formatMetric(item.accuracy)}</span></div></div>)}</div>}
                    </section>
                  </div>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Model version comparison</strong><span>{modelComparisonRows.length} version(s)</span></div>
                    {modelComparisonRows.length === 0 ? <div className="empty-surface">Run a site validation first to build comparison history.</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>model</span><span>runs</span><span>AUROC</span><span>accuracy</span><span>sensitivity</span><span>F1</span></div>{modelComparisonRows.map((item) => <div key={item.modelVersion} className="ops-table-row"><span>{item.modelVersion}</span><span>{item.count}</span><span>{formatMetric(item.AUROC)}</span><span>{formatMetric(item.accuracy)}</span><span>{formatMetric(item.sensitivity)}</span><span>{formatMetric(item.F1)}</span></div>)}</div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Validation run comparison</strong><span>{siteValidationRuns.length} run(s)</span></div>
                    {siteValidationRuns.length < 2 ? <div className="empty-surface">At least two site validation runs are required for run-to-run comparison.</div> : <div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>Baseline run</span><select value={baselineValidationId ?? ""} onChange={(event) => setBaselineValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date)}</option>)}</select></label><label className="inline-field"><span>Compare run</span><select value={compareValidationId ?? ""} onChange={(event) => setCompareValidationId(event.target.value)}>{siteValidationRuns.map((run) => <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date)}</option>)}</select></label></div><div className="panel-metric-grid"><div><strong>{formatMetric(compareValidationRun?.AUROC)}</strong><span>AUROC ({formatDelta(compareValidationRun?.AUROC, baselineValidationRun?.AUROC)})</span></div><div><strong>{formatMetric(compareValidationRun?.accuracy)}</strong><span>accuracy ({formatDelta(compareValidationRun?.accuracy, baselineValidationRun?.accuracy)})</span></div><div><strong>{formatMetric(compareValidationRun?.sensitivity)}</strong><span>sensitivity ({formatDelta(compareValidationRun?.sensitivity, baselineValidationRun?.sensitivity)})</span></div><div><strong>{formatMetric(compareValidationRun?.F1)}</strong><span>F1 ({formatDelta(compareValidationRun?.F1, baselineValidationRun?.F1)})</span></div></div></div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Validation run history</strong><span>{siteValidationRuns.length} stored</span></div>
                    {siteValidationRuns.length === 0 ? <div className="empty-surface">No validation history has been stored for this site yet.</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>run date</span><span>model</span><span>cases</span><span>AUROC</span><span>accuracy</span><span>F1</span></div>{siteValidationRuns.map((run) => <button key={run.validation_id} className={`ops-table-row ops-table-button ${selectedValidationId === run.validation_id ? "active" : ""}`} type="button" onClick={() => setSelectedValidationId(run.validation_id)}><span>{formatDateTime(run.run_date)}</span><span>{run.model_version}</span><span>{run.n_cases}</span><span>{formatMetric(run.AUROC)}</span><span>{formatMetric(run.accuracy)}</span><span>{formatMetric(run.F1)}</span></button>)}</div>}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Representative misclassified cases</strong><span>{dashboardBusy ? "Loading..." : `${misclassifiedCases.length} shown`}</span></div>
                    {misclassifiedCases.length === 0 ? <div className="empty-surface">No misclassified case preview is available for the selected validation run.</div> : <div className="ops-gallery-grid">{misclassifiedCases.map((item) => <article key={`${item.patient_id}-${item.visit_date}`} className="ops-item"><div className="panel-card-head"><strong>{item.patient_id}</strong><span>{item.visit_date}</span></div><div className="panel-meta"><span>{item.true_label}</span><span>{item.predicted_label}</span><span>{formatMetric(item.prediction_probability)}</span></div><div className="ops-gallery-triptych"><div className="panel-image-card">{item.original_preview_url ? <img src={item.original_preview_url} alt={`${item.patient_id} original`} className="panel-image-preview" /> : <div className="panel-image-fallback">Original unavailable</div>}<div className="panel-image-copy"><strong>Original</strong></div></div><div className="panel-image-card">{item.roi_preview_url ? <img src={item.roi_preview_url} alt={`${item.patient_id} roi`} className="panel-image-preview" /> : <div className="panel-image-fallback">ROI unavailable</div>}<div className="panel-image-copy"><strong>ROI</strong></div></div><div className="panel-image-card">{item.gradcam_preview_url ? <img src={item.gradcam_preview_url} alt={`${item.patient_id} gradcam`} className="panel-image-preview" /> : <div className="panel-image-fallback">Grad-CAM unavailable</div>}<div className="panel-image-copy"><strong>Grad-CAM</strong></div></div></div></article>)}</div>}
                  </section>
                </div>
              ) : <div className="empty-surface">Select a site to open the advanced dashboard.</div>}
            </section>
          ) : null}
          {section === "imports" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Bulk import</div><h3>CSV + image ZIP migration</h3></div><div className="doc-site-badge">{selectedSiteId ?? "Select a site"}</div></div>
              <div className="ops-stack">
                <div className="panel-meta"><span>1. Download the CSV template</span><span>2. Match image filenames with ZIP entries</span><span>3. Start with 2-3 patients before a full backfill</span></div>
                <div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => void handleDownloadImportTemplate()} disabled={!selectedSiteId}>Download CSV template</button></div>
                <div className="ops-form-grid"><label className="inline-field"><span>Metadata CSV</span><input type="file" accept=".csv" onChange={(event) => setBulkCsvFile(event.target.files?.[0] ?? null)} /></label><label className="inline-field"><span>Image ZIP or raw images</span><input type="file" accept=".zip,.jpg,.jpeg,.png" multiple onChange={(event) => setBulkFiles(Array.from(event.target.files ?? []))} /></label></div>
                <div className="doc-footer"><div><strong>Legacy backfill only</strong><p>Daily case entry should stay in the document-style case canvas.</p></div><button className="primary-workspace-button" type="button" disabled={bulkImportBusy || !selectedSiteId || !bulkCsvFile} onClick={() => void handleBulkImport()}>{bulkImportBusy ? "Importing..." : "Run bulk import"}</button></div>
                {bulkImportResult ? <div className="ops-stack"><div className="panel-metric-grid"><div><strong>{bulkImportResult.rows_received}</strong><span>rows received</span></div><div><strong>{bulkImportResult.files_received}</strong><span>files read</span></div><div><strong>{bulkImportResult.created_patients}</strong><span>patients created</span></div><div><strong>{bulkImportResult.created_visits}</strong><span>visits created</span></div><div><strong>{bulkImportResult.imported_images}</strong><span>images imported</span></div><div><strong>{bulkImportResult.skipped_images}</strong><span>images skipped</span></div></div>{bulkImportResult.errors.length > 0 ? <div className="ops-card"><div className="panel-card-head"><strong>Import warnings</strong><span>{bulkImportResult.errors.length}</span></div><div className="ops-list">{bulkImportResult.errors.map((item) => <div key={item} className="ops-item">{item}</div>)}</div></div> : null}</div> : null}
              </div>
            </section>
          ) : null}
          {section === "requests" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Access review</div><h3>Institution approval queue</h3></div><div className="doc-site-badge">{pendingRequests.length} pending</div></div>
              {pendingRequests.length === 0 ? <div className="empty-surface">No pending access requests are assigned to this account.</div> : (
                <div className="ops-list">
                  {pendingRequests.map((request) => {
                    const draft = reviewDrafts[request.request_id] ?? { assigned_role: request.requested_role, assigned_site_id: request.requested_site_id, reviewer_notes: "" };
                    return (
                      <article key={request.request_id} className="ops-card">
                        <div className="panel-card-head"><strong>{request.email}</strong><span>{formatDateTime(request.created_at)}</span></div>
                        <div className="panel-meta"><span>{request.requested_site_id}</span><span>{request.requested_role}</span><span>{request.status}</span></div>
                        {request.message ? <p>{request.message}</p> : null}
                        <div className="ops-form-grid">
                          <label className="inline-field"><span>Assigned role</span><select value={draft.assigned_role} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, assigned_role: event.target.value } }))}><option value="site_admin">site_admin</option><option value="researcher">researcher</option><option value="viewer">viewer</option></select></label>
                          <label className="inline-field"><span>Assigned site</span><select value={draft.assigned_site_id} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, assigned_site_id: event.target.value } }))}>{sites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label>
                        </div>
                        <label className="notes-field"><span>Reviewer note</span><textarea rows={3} value={draft.reviewer_notes} onChange={(event) => setReviewDrafts((current) => ({ ...current, [request.request_id]: { ...draft, reviewer_notes: event.target.value } }))} /></label>
                        <div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => void handleReview(request.request_id, "rejected")}>Reject</button><button className="primary-workspace-button" type="button" onClick={() => void handleReview(request.request_id, "approved")}>Approve</button></div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
          {section === "training" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Initial training</div><h3>Register the next global baseline</h3></div><div className="doc-site-badge">{selectedSiteId ?? "Select a site"}</div></div>
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>Architecture</span><select value={initialForm.architecture} onChange={(event) => setInitialForm((current) => ({ ...current, architecture: event.target.value }))}>{DENSENET_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="inline-field"><span>Execution mode</span><select value={initialForm.execution_mode} onChange={(event) => setInitialForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">auto</option><option value="cpu">cpu</option><option value="gpu">gpu</option></select></label>
                <label className="inline-field"><span>Epochs</span><input type="number" min={1} value={initialForm.epochs} onChange={(event) => setInitialForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Batch size</span><input type="number" min={1} value={initialForm.batch_size} onChange={(event) => setInitialForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Learning rate</span><input type="number" min={0.00001} step="0.00001" value={initialForm.learning_rate} onChange={(event) => setInitialForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Validation split</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.val_split} onChange={(event) => setInitialForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Test split</span><input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.test_split} onChange={(event) => setInitialForm((current) => ({ ...current, test_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${initialForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{initialForm.use_pretrained ? "Pretrained init" : "Scratch init"}</button><button className={`toggle-pill ${initialForm.regenerate_split ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, regenerate_split: !current.regenerate_split }))}>{initialForm.regenerate_split ? "Regenerate split" : "Reuse split"}</button></div>
              <div className="doc-footer"><div><strong>DenseNet + MedSAM crop only</strong><p>The existing Python pipeline still executes the actual training.</p></div><button className="primary-workspace-button" type="button" disabled={initialBusy || !selectedSiteId} onClick={() => void handleInitialTraining()}>{initialBusy ? "Training..." : "Run initial training"}</button></div>
              {initialResult ? <div className="panel-metric-grid"><div><strong>{initialResult.result.n_train_patients}</strong><span>train patients</span></div><div><strong>{initialResult.result.n_val_patients}</strong><span>val patients</span></div><div><strong>{initialResult.result.n_test_patients}</strong><span>test patients</span></div><div><strong>{formatMetric(initialResult.result.best_val_acc)}</strong><span>best val acc</span></div></div> : null}
            </section>
          ) : null}
          {section === "cross_validation" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Cross-validation</div><h3>Patient-level fold review</h3></div><div className="doc-site-badge">{crossValidationReports.length} report(s)</div></div>
              <div className="ops-form-grid ops-form-grid-wide">
                <label className="inline-field"><span>Architecture</span><select value={crossValidationForm.architecture} onChange={(event) => setCrossValidationForm((current) => ({ ...current, architecture: event.target.value }))}>{DENSENET_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="inline-field"><span>Execution mode</span><select value={crossValidationForm.execution_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">auto</option><option value="cpu">cpu</option><option value="gpu">gpu</option></select></label>
                <label className="inline-field"><span>Folds</span><input type="number" min={3} max={5} value={crossValidationForm.num_folds} onChange={(event) => setCrossValidationForm((current) => ({ ...current, num_folds: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Epochs</span><input type="number" min={1} value={crossValidationForm.epochs} onChange={(event) => setCrossValidationForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Batch size</span><input type="number" min={1} value={crossValidationForm.batch_size} onChange={(event) => setCrossValidationForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Learning rate</span><input type="number" min={0.00001} step="0.00001" value={crossValidationForm.learning_rate} onChange={(event) => setCrossValidationForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
                <label className="inline-field"><span>Validation split</span><input type="number" min={0.1} max={0.4} step="0.05" value={crossValidationForm.val_split} onChange={(event) => setCrossValidationForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
              </div>
              <div className="workspace-actions"><button className={`toggle-pill ${crossValidationForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setCrossValidationForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{crossValidationForm.use_pretrained ? "Pretrained init" : "Scratch init"}</button></div>
              <div className="doc-footer"><div><strong>Saved reports stay selectable</strong><p>Cross-validation JSON reports are read back from the existing validation workspace.</p></div><button className="primary-workspace-button" type="button" disabled={crossValidationBusy || !selectedSiteId} onClick={() => void handleCrossValidation()}>{crossValidationBusy ? "Running..." : "Run cross-validation"}</button></div>
              {crossValidationReports.length > 0 ? (
                <div className="ops-stack">
                  <label className="inline-field"><span>Saved report</span><select value={selectedReportId ?? ""} onChange={(event) => setSelectedReportId(event.target.value)}>{crossValidationReports.map((report) => <option key={report.cross_validation_id} value={report.cross_validation_id}>{report.cross_validation_id} · {report.architecture} · {formatDateTime(report.created_at)}</option>)}</select></label>
                  {selectedReport ? <div className="panel-metric-grid">{["AUROC", "accuracy", "sensitivity", "specificity", "F1"].map((metricName) => <div key={metricName}><strong>{formatMetric(selectedReport.aggregate_metrics[metricName]?.mean)}</strong><span>{metricName}</span></div>)}</div> : null}
                </div>
              ) : <div className="empty-surface">No cross-validation report has been saved for this site yet.</div>}
            </section>
          ) : null}
          {section === "registry" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Registry</div><h3>Model versions and update flow</h3></div><div className="doc-site-badge">{modelVersions.length} model(s)</div></div>
              <div className="ops-dual-grid">
                <section className="ops-card">
                  <div className="panel-card-head"><strong>Model versions</strong><span>{currentModel?.version_name ?? "n/a"}</span></div>
                  {modelVersions.length === 0 ? <div className="empty-surface">No model version is registered yet.</div> : <div className="ops-list">{modelVersions.slice().reverse().map((item) => <div key={item.version_id} className="ops-item"><div className="panel-card-head"><strong>{item.version_name}</strong><span>{item.architecture}</span></div><div className="panel-meta"><span>{item.is_current ? "current" : item.stage ?? "stored"}</span><span>{formatDateTime(item.created_at)}</span><span>{item.ready ? "ready" : "pending"}</span></div></div>)}</div>}
                </section>
                <section className="ops-card">
                  <div className="panel-card-head"><strong>Model updates</strong><span>{modelUpdates.length}</span></div>
                  {modelUpdates.length === 0 ? <div className="empty-surface">No model update has been recorded for the current filter.</div> : <div className="ops-list">{modelUpdates.map((item) => <div key={item.update_id} className="ops-item"><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.status ?? "unknown"}</span></div><div className="panel-meta"><span>{item.site_id ?? "unknown site"}</span><span>{item.architecture ?? "unknown architecture"}</span><span>{formatDateTime(item.created_at)}</span></div></div>)}</div>}
                </section>
              </div>
            </section>
          ) : null}
          {section === "management" ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Management</div><h3>Projects, sites, and users</h3></div><div className="doc-site-badge">{canManagePlatform ? "admin" : "site_admin"}</div></div>
              <div className="ops-stack">
                <div className="ops-dual-grid">
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Projects</strong><span>{projects.length}</span></div>
                    {projects.length === 0 ? <div className="empty-surface">No project has been registered yet.</div> : <div className="ops-list">{projects.map((project) => <div key={project.project_id} className="ops-item"><div className="panel-card-head"><strong>{project.name}</strong><span>{project.site_ids.length} site(s)</span></div><div className="panel-meta"><span>{project.project_id}</span><span>{formatDateTime(project.created_at)}</span></div></div>)}</div>}
                    {canManagePlatform ? <div className="ops-stack"><label className="inline-field"><span>Project name</span><input value={projectForm.name} onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="notes-field"><span>Description</span><textarea rows={3} value={projectForm.description} onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))} /></label><button className="primary-workspace-button" type="button" onClick={() => void handleCreateProject()}>Create project</button></div> : null}
                  </section>
                  <section className="ops-card">
                    <div className="panel-card-head"><strong>Sites</strong><span>{managedSites.length}</span></div>
                    {managedSites.length === 0 ? <div className="empty-surface">No site is visible to this account.</div> : <div className="ops-list">{managedSites.map((site) => <div key={site.site_id} className="ops-item"><div className="panel-card-head"><strong>{site.display_name}</strong><span>{site.project_id}</span></div><div className="panel-meta"><span>{site.site_id}</span><span>{site.hospital_name || "No hospital name"}</span></div></div>)}</div>}
                    {canManagePlatform ? <div className="ops-stack"><label className="inline-field"><span>Project</span><select value={siteForm.project_id} onChange={(event) => setSiteForm((current) => ({ ...current, project_id: event.target.value }))}>{projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label><div className="ops-form-grid"><label className="inline-field"><span>Site code</span><input value={siteForm.site_code} onChange={(event) => setSiteForm((current) => ({ ...current, site_code: event.target.value }))} /></label><label className="inline-field"><span>Display name</span><input value={siteForm.display_name} onChange={(event) => setSiteForm((current) => ({ ...current, display_name: event.target.value }))} /></label></div><label className="inline-field"><span>Hospital name</span><input value={siteForm.hospital_name} onChange={(event) => setSiteForm((current) => ({ ...current, hospital_name: event.target.value }))} /></label><button className="primary-workspace-button" type="button" onClick={() => void handleCreateSite()}>Register site</button></div> : null}
                  </section>
                </div>
                {canManagePlatform ? <section className="ops-card"><div className="panel-card-head"><strong>Users and access</strong><span>{managedUsers.length}</span></div>{managedUsers.length === 0 ? <div className="empty-surface">No user record has been created yet.</div> : <div className="ops-table"><div className="ops-table-row ops-table-head"><span>username</span><span>full name</span><span>role</span><span>sites</span></div>{managedUsers.map((managedUser) => <button key={managedUser.user_id} className="ops-table-row ops-table-button" type="button" onClick={() => setUserForm({ username: managedUser.username, full_name: managedUser.full_name, password: "", role: managedUser.role, site_ids: managedUser.site_ids ?? [] })}><span>{managedUser.username}</span><span>{managedUser.full_name}</span><span>{managedUser.role}</span><span>{(managedUser.site_ids ?? []).join(", ") || "all"}</span></button>)}</div>}<div className="ops-stack"><div className="ops-form-grid"><label className="inline-field"><span>Username</span><input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} /></label><label className="inline-field"><span>Full name</span><input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} /></label></div><div className="ops-form-grid"><label className="inline-field"><span>Password</span><input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder="Leave blank to keep existing password" /></label><label className="inline-field"><span>Role</span><select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}><option value="admin">admin</option><option value="site_admin">site_admin</option><option value="researcher">researcher</option><option value="viewer">viewer</option></select></label></div><label className="inline-field"><span>Accessible sites</span><select multiple value={userForm.site_ids} onChange={(event) => setUserForm((current) => ({ ...current, site_ids: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{managedSites.map((site) => <option key={site.site_id} value={site.site_id}>{site.display_name}</option>)}</select></label><div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => setUserForm(createUserForm())}>Reset</button><button className="primary-workspace-button" type="button" onClick={() => void handleSaveUser()}>Save user</button></div></div></section> : null}
              </div>
            </section>
          ) : null}
          {section === "federation" && canAggregate ? (
            <section className="doc-surface">
              <div className="doc-title-row"><div><div className="doc-eyebrow">Federation</div><h3>Aggregate pending site deltas</h3></div><div className="doc-site-badge">{pendingUploadUpdates.length} pending</div></div>
              <label className="inline-field"><span>Optional version name</span><input value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} placeholder="global-densenet-fedavg-20260311" /></label>
              <div className="doc-footer"><div><strong>Aggregate the full pending queue</strong><p>The API currently aggregates all pending deltas that share one architecture and base model.</p></div><button className="primary-workspace-button" type="button" disabled={aggregationBusy || pendingUploadUpdates.length === 0} onClick={() => void handleAggregation()}>{aggregationBusy ? "Aggregating..." : "Run FedAvg aggregation"}</button></div>
              <div className="ops-dual-grid">
                <section className="ops-card">{pendingUploadUpdates.length === 0 ? <div className="empty-surface">No pending updates are available for aggregation.</div> : <div className="ops-list">{pendingUploadUpdates.map((item) => <div key={item.update_id} className="ops-item"><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.site_id}</span></div><div className="panel-meta"><span>{item.architecture ?? "unknown architecture"}</span><span>{item.n_cases ?? 0} cases</span><span>{formatDateTime(item.created_at)}</span></div></div>)}</div>}</section>
                <section className="ops-card">{aggregations.length === 0 ? <div className="empty-surface">No aggregation record has been registered yet.</div> : <div className="ops-list">{aggregations.map((item) => <div key={item.aggregation_id} className="ops-item"><div className="panel-card-head"><strong>{item.new_version_name}</strong><span>{formatDateTime(item.created_at)}</span></div><div className="panel-meta"><span>{item.architecture ?? "unknown architecture"}</span><span>{item.total_cases ?? 0} cases</span><span>{Object.keys(item.site_weights ?? {}).length} sites</span></div></div>)}</div>}</section>
              </div>
            </section>
          ) : null}
        </div>
      </section>
      {toast ? <div className={`workspace-toast tone-${toast.tone}`}><strong>{toast.tone === "success" ? "Saved" : "Action needed"}</strong><span>{toast.message}</span></div> : null}
    </main>
  );
}
