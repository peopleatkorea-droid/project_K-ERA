"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { MetricGrid, MetricItem } from "./ui/metric-grid";
import { SectionHeader } from "./ui/section-header";
import {
  docSectionLabelClass,
  docSiteBadgeClass,
  emptySurfaceClass,
  railActivityItemClass,
  railActivityListClass,
  railSiteButtonClass,
  researchLaunchActionsClass,
  researchLaunchCopyClass,
  researchLaunchStripClass,
  workspaceHeaderClass,
  workspaceKickerClass,
  workspaceMainClass,
  workspaceNoiseClass,
  workspaceRailClass,
  workspaceShellClass,
  workspaceToastClass,
} from "./ui/workspace-patterns";
import { CrossValidationSection } from "./admin-workspace/cross-validation-section";
import { DashboardSection } from "./admin-workspace/dashboard-section";
import { FederationSection } from "./admin-workspace/federation-section";
import { ImportsSection } from "./admin-workspace/imports-section";
import { ManagementSection } from "./admin-workspace/management-section";
import { RequestsSection } from "./admin-workspace/requests-section";
import { RegistrySection } from "./admin-workspace/registry-section";
import { TrainingSection } from "./admin-workspace/training-section";
import { getFoldConfusionMatrix, useAdminWorkspaceState } from "./admin-workspace/use-admin-workspace-state";
import { useAdminWorkspaceController } from "./admin-workspace/use-admin-workspace-controller";
import { LocaleToggle, pick, translateRole } from "../lib/i18n";
import { type AuthUser, type SiteRecord, type SiteSummary } from "../lib/api";
import { cn } from "../lib/cn";
import { filterVisibleSites, getSiteDisplayName } from "../lib/site-labels";

export type WorkspaceSection =
  | "dashboard"
  | "imports"
  | "requests"
  | "training"
  | "cross_validation"
  | "registry"
  | "management"
  | "federation";

type AdminWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  sitesBusy?: boolean;
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

function formatWeightPercent(value: number | null | undefined) {
  return typeof value === "number" && !Number.isNaN(value) ? `${Math.round(value * 100)}%` : "n/a";
}

function formatQualityRecommendation(locale: "en" | "ko", recommendation: string | null | undefined): string {
  switch (recommendation) {
    case "approve_candidate":
      return pick(locale, "Approve candidate", "?뱀씤 沅뚯옣");
    case "needs_review":
      return pick(locale, "Needs review", "추가 검토");
    case "reject_candidate":
      return pick(locale, "Reject candidate", "諛섎젮 沅뚯옣");
    default:
      return pick(locale, "Unrated", "誘명룊媛");
  }
}

function translateQualityFlag(locale: "en" | "ko", flag: string): string {
  const labels: Record<string, [string, string]> = {
    brightness_out_of_range: ["Brightness out of range", "諛앷린 踰붿쐞 ?댄깉"],
    low_contrast: ["Low contrast", "대비 부족"],
    low_edge_density: ["Low edge density", "경계 정보 부족"],
    crop_ratio_missing: ["Crop ratio missing", "crop 鍮꾩쑉 ?놁쓬"],
    crop_too_tight: ["Crop too tight", "crop ?덈Т 醫곸쓬"],
    crop_too_wide: ["Crop too wide", "crop ?덈Т ?볦쓬"],
    validation_mismatch: ["Validation mismatch", "검증 불일치"],
    delta_invalid: ["Delta invalid", "delta ?댁긽"],
    delta_missing: ["Delta missing", "delta ?놁쓬"],
    polymicrobial_excluded: ["Polymicrobial excluded", "?ㅺ퇏醫??숈뒿 ?쒖쇅"],
  };
  const pair = labels[flag];
  return pair ? pick(locale, pair[0], pair[1]) : flag;
}

export function AdminWorkspace({
  token,
  user,
  sites,
  sitesBusy = false,
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
  const visibleSites = filterVisibleSites(sites);
  const state = useAdminWorkspaceState({
    user,
    initialSection,
    selectedSiteId,
  });
  const {
    locale,
    localeTag,
    common,
    section,
    setSection,
    toast,
    toastHistory,
    clearToastHistory,
    overview,
    setOverview,
    storageSettings,
    setStorageSettings,
    pendingRequests,
    setPendingRequests,
    autoApprovedRequests,
    setAutoApprovedRequests,
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
    institutionSyncBusy,
    institutionSyncStatus,
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
    publishingModelVersionId,
    publishingModelUpdateId,
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
    updateThresholdAlerts,
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
  } = state;
  const visibleManagedSites = filterVisibleSites(managedSites);
  const visibleRailSites = visibleSites.length > 0 ? visibleSites : visibleManagedSites;
  const {
    handleInstitutionSync,
    handleReview,
    handleInitialTraining,
    handleCancelInitialTraining,
    handleBenchmarkTraining,
    handleCancelBenchmarkTraining,
    handleResumeBenchmarkTraining,
    handleCrossValidation,
    handleSiteValidation,
    handleRefreshEmbeddingStatus,
    handleEmbeddingBackfill,
    handleExportValidationReport,
    handleExportCrossValidationReport,
    handleAggregation,
    handleAggregationAllReady,
    handleDeleteModelVersion,
    handlePublishModelVersion,
    handleModelUpdateReview,
    handlePublishModelUpdate,
    handleDownloadImportTemplate,
    handleBulkImport,
    handleCreateProject,
    handleEditSite,
    handleResetSiteForm,
    handleSaveSite,
    handleSaveStorageRoot,
    handleSaveSelectedSiteStorageRoot,
    handleMigrateSelectedSiteStorageRoot,
    handleResetUserForm,
    handleSaveUser,
  } = useAdminWorkspaceController({
    state,
    token,
    selectedSiteId,
    initialSection,
    onRefreshSites,
    onSiteDataChanged,
    onSelectSite,
  });
  const selectedSiteRecord = visibleRailSites.find((site) => site.site_id === selectedSiteId) ?? selectedManagedSite ?? null;
  const selectedSiteLabel = selectedSiteId ? getSiteDisplayName(selectedSiteRecord, selectedSiteId) : null;
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const alertsPanelRef = useRef<HTMLDivElement | null>(null);
  const alertsCopy = {
    recentAlerts: pick(locale, "Recent alerts", "최근 알림"),
    recentAlertsCopy: pick(locale, "Transient toasts stay here for this session.", "짧게 사라지는 토스트도 현재 세션에서는 여기 남겨둡니다."),
    noAlertsYet: pick(locale, "No alerts yet in this session.", "현재 세션에는 아직 알림이 없습니다."),
    clearAlerts: pick(locale, "Clear alerts", "알림 비우기"),
    alertsKept: pick(locale, "kept", "보관"),
  };

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




  return (
    <main className={workspaceShellClass} data-workspace-theme={theme}>
      <div className={workspaceNoiseClass} />
      <aside className={workspaceRailClass}>
        <div className="grid gap-5">
          <div className="grid gap-3">
            <div className={workspaceKickerClass}>{pick(locale, "Operations", "?댁쁺")}</div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="m-0 font-serif text-[1.95rem] leading-none tracking-[-0.05em] text-ink">
                  {pick(locale, "K-ERA Control", "K-ERA ?댁쁺")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {pick(
                    locale,
                    "Review import, approval, training, and model movement from one operations rail.",
                    "?꾪룷?? ?뱀씤, ?숈뒿, 紐⑤뜽 ?대룞???섎굹???댁쁺 ?덉씪?먯꽌 ?ㅻ９?덈떎."
                  )}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenCanvas}>
                {pick(locale, "Case canvas", "케이스 캔버스")}
              </Button>
            </div>
          </div>

          <Card as="section" variant="nested" className="grid gap-4 p-4">
            <SectionHeader
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Hospitals", "蹂묒썝")}</div>}
              title={pick(locale, "Linked sites", "?곌껐??蹂묒썝")}
              titleAs="h4"
              aside={
                <span className={docSiteBadgeClass}>
                  {sitesBusy && visibleRailSites.length === 0
                    ? pick(locale, "Loading...", "불러오는 중...")
                    : `${visibleRailSites.length} ${pick(locale, "linked", "연결됨")}`}
                </span>
              }
            />
            <div className="grid gap-2">
            {visibleRailSites.length > 0 ? (
              visibleRailSites.map((site) => (
                <button key={site.site_id} className={railSiteButtonClass(selectedSiteId === site.site_id)} type="button" onClick={() => onSelectSite(site.site_id)}>
                  <strong className="min-w-0 break-words [overflow-wrap:anywhere]">{getSiteDisplayName(site)}</strong>
                </button>
              ))
            ) : (
              <div className="rounded-[18px] border border-border/80 bg-surface-muted/80 px-4 py-3 text-sm text-muted">
                {sitesBusy
                  ? pick(locale, "Loading linked hospitals...", "연결된 병원을 불러오는 중...")
                  : pick(locale, "No linked hospital is available yet.", "연결된 병원이 아직 없습니다.")}
              </div>
            )}
            </div>
          </Card>

          <Card as="section" variant="nested" className="grid gap-4 p-4">
            <SectionHeader
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Sections", "?뱀뀡")}</div>}
              title={pick(locale, "Operations flow", "?댁쁺 ?먮쫫")}
              titleAs="h4"
            />
            <div className="grid gap-2">
            {[
              ["dashboard", pick(locale, "Dashboard", "대시보드")],
              ["imports", pick(locale, "Bulk import", "대량 임포트")],
              ["requests", pick(locale, "Access requests", "?묎렐 ?붿껌")],
              ["training", pick(locale, "Initial training", "珥덇린 ?숈뒿")],
              ["cross_validation", pick(locale, "Cross-validation", "교차 검증")],
              ["registry", pick(locale, "Model registry", "모델 레지스트리")],
              ["management", pick(locale, "Management", "관리")],
              ...(canAggregate ? [["federation", pick(locale, "Federation", "?고빀?숈뒿")]] : []),
            ].map(([value, label]) => (
              <button
                key={value}
                className={cn(
                  "w-full rounded-[18px] border border-border bg-white/6 px-4 py-3 text-left text-sm font-medium text-ink transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted/80",
                  section === value && "active",
                  section === value && "border-brand/20 bg-brand-soft/70 shadow-card"
                )}
                type="button"
                onClick={() => setSection(value as typeof section)}
              >
                {label}
              </button>
            ))}
            </div>
          </Card>

          <Card as="section" variant="nested" className="grid gap-4 p-4">
            <SectionHeader
              eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Snapshot", "?붿빟")}</div>}
              title={pick(locale, "Queue overview", "?湲곗뿴 媛쒖슂")}
              titleAs="h4"
            />
            <MetricGrid columns={2}>
              <MetricItem value={overview?.pending_access_requests ?? pendingRequests.length} label={pick(locale, "Pending access", "?湲??묎렐 ?붿껌")} />
              <MetricItem value={overview?.auto_approved_access_requests ?? autoApprovedRequests.length} label={pick(locale, "Auto-approved access", "자동 승인 접근")} />
              <MetricItem value={overview?.pending_model_updates ?? pendingReviewUpdates.length} label={pick(locale, "Pending updates", "?湲??낅뜲?댄듃")} />
              <MetricItem value={overview?.model_version_count ?? modelVersions.length} label={pick(locale, "Models", "紐⑤뜽")} />
              <MetricItem value={overview?.current_model_version ?? currentModel?.version_name ?? common.notAvailable} label={pick(locale, "Current model", "?꾩옱 紐⑤뜽")} />
            </MetricGrid>
            {overview?.federation_setup ? (
              <div className="grid gap-2 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
                <div className="font-medium text-ink">
                  {overview.federation_setup.control_plane_split_enabled && overview.federation_setup.control_plane_backend !== "sqlite"
                    ? pick(locale, "Federation-ready control plane", "연합학습용 control plane")
                    : pick(locale, "Single-node control plane", "단일 노드 control plane")}
                </div>
                <div>
                  {pick(locale, "Control plane", "Control plane")}: {overview.federation_setup.control_plane_backend} /{" "}
                  {overview.federation_setup.control_plane_split_enabled
                    ? pick(locale, "split", "분리됨")
                    : pick(locale, "shared with data plane", "data plane과 공유")}
                </div>
                <div>
                  {pick(locale, "Artifacts", "아티팩트")}:{" "}
                  {overview.federation_setup.uses_default_control_plane_artifact_dir
                    ? pick(locale, "default local path", "기본 로컬 경로")
                    : pick(locale, "custom path configured", "커스텀 경로 설정됨")}
                </div>
                <div>
                  {pick(locale, "Model delivery", "모델 배포")}: {overview.federation_setup.model_distribution_mode}
                </div>
                <div>
                  {pick(locale, "Auto publish", "자동 발행")}:{" "}
                  {overview.federation_setup.onedrive_auto_publish_enabled
                    ? pick(locale, "configured", "설정됨")
                    : pick(locale, "not configured", "미설정")}
                </div>
              </div>
            ) : null}
            {updateThresholdAlerts.length > 0 ? (
              <div className="grid gap-2 rounded-[18px] border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                <div className="font-medium">
                  {pick(
                    locale,
                    `${updateThresholdAlerts.length} contribution threshold alert(s) are active.`,
                    `${updateThresholdAlerts.length}개의 기여 임계치 알림이 활성화되어 있습니다.`
                  )}
                </div>
                <div className="text-amber-900/80 dark:text-amber-100/80">
                  {pick(
                    locale,
                    "Open Federation to review architecture lanes that have reached 10 or more contributed cases.",
                    "Federation에서 10개 이상 기여 케이스가 쌓인 아키텍처 lane을 확인하세요."
                  )}
                </div>
              </div>
            ) : null}
            {summary ? (
              <div className="grid gap-2 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
                <div className="font-medium text-ink">{selectedSiteLabel ?? common.notAvailable}</div>
                <div>{`${summary.n_patients} ${pick(locale, "patients", "?섏옄")} / ${summary.n_images} ${pick(locale, "images", "?대?吏")}`}</div>
              </div>
            ) : null}
          </Card>
        </div>
      </aside>
      <section className={workspaceMainClass}>
        <SectionHeader
          className={workspaceHeaderClass}
          eyebrow={<div className={workspaceKickerClass}>{pick(locale, "Control plane", "운영 허브")}</div>}
          title={pick(locale, "Operate import, review, training, and model movement from the web workspace", "???뚰겕?ㅽ럹?댁뒪?먯꽌 ?꾪룷?? ?뱀씤 寃?? ?숈뒿, 紐⑤뜽 ?대룞???댁쁺")}
          titleAs="h2"
          description={pick(
            locale,
            `Logged in as ${user.full_name} (${translateRole(locale, user.role)}). Admin and hospital operations now stay in this web workspace.`,
            `${user.full_name} (${translateRole(locale, user.role)}) 怨꾩젙?쇰줈 濡쒓렇?몃맖. 愿由ъ옄 諛?蹂묒썝 ?댁쁺 ?먮쫫???댁젣 ?????뚰겕?ㅽ럹?댁뒪 ?덉뿉??泥섎━?⑸땲??`
          )}
          aside={
            <div className="flex flex-wrap items-center justify-end gap-3">
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
                  {alertsCopy.recentAlerts}
                </Button>
                {alertsPanelOpen ? (
                  <Card
                    as="section"
                    variant="nested"
                    role="dialog"
                    aria-label={alertsCopy.recentAlerts}
                    className="absolute right-0 top-full z-40 mt-3 grid w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-4 border border-border/80 bg-surface p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <strong className="text-sm font-semibold text-ink">{alertsCopy.recentAlerts}</strong>
                        <p className="m-0 text-sm leading-6 text-muted">{alertsCopy.recentAlertsCopy}</p>
                      </div>
                      <div className="grid gap-2 justify-items-end">
                        <span className={docSiteBadgeClass}>{`${toastHistory.length} ${alertsCopy.alertsKept}`}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={clearToastHistory} disabled={toastHistory.length === 0}>
                          {alertsCopy.clearAlerts}
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
                    ) : (
                      <div className={emptySurfaceClass}>{alertsCopy.noAlertsYet}</div>
                    )}
                  </Card>
                ) : null}
              </div>
              <LocaleToggle />
              <Button type="button" variant="ghost" onClick={onToggleTheme}>
                {theme === "dark" ? pick(locale, "Light mode", "?쇱씠??紐⑤뱶") : pick(locale, "Dark mode", "?ㅽ겕 紐⑤뱶")}
              </Button>
              <Button type="button" variant="ghost" onClick={onOpenCanvas}>
                {pick(locale, "Open case canvas", "耳?댁뒪 罹붾쾭???닿린")}
              </Button>
              <Button type="button" variant="primary" onClick={onLogout}>
                {pick(locale, "Log out", "濡쒓렇?꾩썐")}
              </Button>
            </div>
          }
        />
        <Card as="section" variant="nested" className={researchLaunchStripClass}>
          <div className={researchLaunchCopyClass}>
            <div className={docSectionLabelClass}>{pick(locale, "Research runs", "연구 실행")}</div>
            <strong>{pick(locale, "Open training and validation tools directly", "학습과 검증 도구를 바로 열기")}</strong>
            <span>{pick(locale, "You no longer need to find the Python CLI manually.", "You no longer need to find the Python CLI manually.")}</span>
          </div>
          <div className={researchLaunchActionsClass}>
            <Button variant="ghost" type="button" onClick={() => setSection("training")}>
              {pick(locale, "Initial training", "초기 학습")}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setSection("cross_validation")}>
              {pick(locale, "Cross-validation", "교차 검증")}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setSection("dashboard")}>
              {pick(locale, "Hospital validation", "병원 검증")}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setSection("cross_validation")}>
              {pick(locale, "Report export", "Report export")}
            </Button>
          </div>
        </Card>
        <div className="grid gap-4">
          {section === "dashboard" ? (
            <DashboardSection
              locale={locale}
              loadingLabel={common.loading}
              notAvailableLabel={common.notAvailable}
              selectedSiteId={selectedSiteId}
              selectedSiteLabel={selectedSiteLabel}
              selectedValidationRun={selectedValidationRun}
              validationExportBusy={validationExportBusy}
              siteValidationBusy={siteValidationBusy}
              siteComparison={siteComparison}
              embeddingStatus={embeddingStatus}
              embeddingStatusBusy={embeddingStatusBusy}
              embeddingBackfillBusy={embeddingBackfillBusy}
              currentModelVersionName={currentModel?.version_name ?? null}
              modelComparisonRows={modelComparisonRows}
              rocEligibleRuns={rocEligibleRuns}
              rocValidationIds={rocValidationIds}
              selectedRocRuns={selectedRocRuns}
              rocSeries={rocSeries}
              rocSelectionLimitReached={rocSelectionLimitReached}
              rocHasCohortMismatch={rocHasCohortMismatch}
              siteValidationRuns={siteValidationRuns}
              baselineValidationId={baselineValidationId}
              compareValidationId={compareValidationId}
              baselineValidationRun={baselineValidationRun}
              compareValidationRun={compareValidationRun}
              selectedValidationId={selectedValidationId}
              misclassifiedCases={misclassifiedCases}
              dashboardBusy={dashboardBusy}
              formatDateTime={(value) => formatDateTime(value, localeTag, common.notAvailable)}
              formatMetric={formatMetric}
              formatDelta={formatDelta}
              formatEmbeddingStage={formatEmbeddingStage}
              setBaselineValidationId={setBaselineValidationId}
              setCompareValidationId={setCompareValidationId}
              setSelectedValidationId={setSelectedValidationId}
              toggleRocValidationSelection={toggleRocValidationSelection}
              onExportValidationReport={() => void handleExportValidationReport()}
              onRunSiteValidation={() => void handleSiteValidation()}
              onRefreshEmbeddingStatus={() => void handleRefreshEmbeddingStatus()}
              onEmbeddingBackfill={() => void handleEmbeddingBackfill()}
            />
          ) : null}
          {section === "imports" ? (
            <ImportsSection
              locale={locale}
              selectedSiteId={selectedSiteId}
              selectedSiteLabel={selectedSiteLabel}
              bulkCsvFile={bulkCsvFile}
              bulkImportBusy={bulkImportBusy}
              bulkImportResult={bulkImportResult}
              setBulkCsvFile={setBulkCsvFile}
              setBulkFiles={setBulkFiles}
              onDownloadTemplate={() => void handleDownloadImportTemplate()}
              onRunBulkImport={() => void handleBulkImport()}
            />
          ) : null}
          {section === "requests" ? (
            <RequestsSection
                locale={locale}
                notAvailableLabel={common.notAvailable}
                pendingRequests={pendingRequests}
                autoApprovedRequests={autoApprovedRequests}
              reviewDrafts={reviewDrafts}
              canManagePlatform={canManagePlatform}
              institutionSyncBusy={institutionSyncBusy}
              institutionSyncStatus={institutionSyncStatus}
              projects={projects}
              sites={visibleSites}
              setReviewDrafts={setReviewDrafts}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              onInstitutionSync={() => void handleInstitutionSync()}
              onReview={(requestId, decision) => void handleReview(requestId, decision)}
            />
          ) : null}
          {section === "training" ? (
            <TrainingSection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              selectedSiteId={selectedSiteId}
              selectedSiteLabel={selectedSiteLabel}
              selectedReport={selectedReport}
              crossValidationExportBusy={crossValidationExportBusy}
              initialForm={initialForm}
              initialBusy={initialBusy}
              initialResult={initialResult}
              initialJob={initialJob}
              initialProgress={initialProgress}
              progressPercent={progressPercent}
              benchmarkBusy={benchmarkBusy}
              benchmarkResult={benchmarkResult}
              benchmarkJob={benchmarkJob}
              benchmarkProgress={benchmarkProgress}
              benchmarkPercent={benchmarkPercent}
              setInitialForm={setInitialForm}
              formatMetric={formatMetric}
              formatTrainingStage={formatTrainingStage}
              onExportSelectedReport={() => void handleExportCrossValidationReport()}
              onCancelBenchmark={() => void handleCancelBenchmarkTraining()}
              onCancelInitialTraining={() => void handleCancelInitialTraining()}
              onRunBenchmark={() => void handleBenchmarkTraining()}
              onRunInitialTraining={() => void handleInitialTraining()}
              onResumeBenchmark={() => void handleResumeBenchmarkTraining()}
            />
          ) : null}
          {section === "cross_validation" ? (
            <CrossValidationSection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              selectedSiteId={selectedSiteId}
              crossValidationReports={crossValidationReports}
              selectedReportId={selectedReportId}
              selectedReport={selectedReport}
              selectedReportConfusion={selectedReportConfusion}
              crossValidationForm={crossValidationForm}
              crossValidationBusy={crossValidationBusy}
              crossValidationJob={crossValidationJob}
              crossValidationProgress={crossValidationProgress}
              crossValidationPercent={crossValidationPercent}
              setCrossValidationForm={setCrossValidationForm}
              setSelectedReportId={setSelectedReportId}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              formatMetric={formatMetric}
              formatTrainingStage={formatTrainingStage}
              getFoldConfusionMatrix={getFoldConfusionMatrix}
              onRunCrossValidation={() => void handleCrossValidation()}
            />
          ) : null}
          {section === "registry" ? (
            <RegistrySection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              canManagePlatform={canManagePlatform}
              autoPublishEnabled={Boolean(overview?.federation_setup?.onedrive_auto_publish_enabled)}
              modelVersions={modelVersions}
              currentModel={currentModel}
              modelUpdates={modelUpdates}
              selectedModelUpdate={selectedModelUpdate}
              selectedApprovalReport={selectedApprovalReport}
              selectedUpdatePreviewUrls={selectedUpdatePreviewUrls}
              publishingModelVersionId={publishingModelVersionId}
              publishingModelUpdateId={publishingModelUpdateId}
              modelUpdateReviewNotes={modelUpdateReviewNotes}
              setSelectedModelUpdateId={setSelectedModelUpdateId}
              setModelUpdateReviewNotes={setModelUpdateReviewNotes}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              formatWeightPercent={formatWeightPercent}
              formatMetric={formatMetric}
              formatQualityRecommendation={(recommendation) => formatQualityRecommendation(locale, recommendation)}
              translateQualityFlag={(flag) => translateQualityFlag(locale, flag)}
              onDeleteModelVersion={(version) => void handleDeleteModelVersion(version)}
              onPublishModelVersion={(version) => void handlePublishModelVersion(version)}
              onModelUpdateReview={(decision) => void handleModelUpdateReview(decision)}
              onPublishModelUpdate={() => void handlePublishModelUpdate()}
            />
          ) : null}
          {section === "management" ? (
            <ManagementSection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              canManagePlatform={canManagePlatform}
              canManageStorageRoot={canManageStorageRoot}
              storageSettings={storageSettings}
              storageSettingsBusy={storageSettingsBusy}
              instanceStorageRootForm={instanceStorageRootForm}
              siteStorageRootForm={siteStorageRootForm}
              selectedSiteLabel={selectedSiteLabel}
              selectedManagedSite={selectedManagedSite}
              summary={summary}
              projects={projects}
              managedSites={managedSites}
              managedUsers={managedUsers}
              siteForm={siteForm}
              editingSiteId={editingSiteId}
              projectForm={projectForm}
              userForm={userForm}
              setInstanceStorageRootForm={setInstanceStorageRootForm}
              setSiteStorageRootForm={setSiteStorageRootForm}
              setProjectForm={setProjectForm}
              setSiteForm={setSiteForm}
              setUserForm={setUserForm}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              onSaveStorageRoot={() => void handleSaveStorageRoot()}
              onSaveSelectedSiteStorageRoot={() => void handleSaveSelectedSiteStorageRoot()}
              onMigrateSelectedSiteStorageRoot={() => void handleMigrateSelectedSiteStorageRoot()}
              onCreateProject={() => void handleCreateProject()}
              onEditSite={handleEditSite}
              onResetSiteForm={() => handleResetSiteForm()}
              onSaveSite={() => void handleSaveSite()}
              onResetUserForm={() => handleResetUserForm()}
              onSaveUser={() => void handleSaveUser()}
            />
          ) : null}
          {section === "federation" && canAggregate ? (
            <FederationSection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              approvedUpdates={approvedUpdates}
              updateThresholdAlerts={updateThresholdAlerts}
              aggregations={aggregations}
              newVersionName={newVersionName}
              aggregationBusy={aggregationBusy}
              setNewVersionName={setNewVersionName}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              onAggregation={(updateIds) => void handleAggregation(updateIds)}
              onAggregationAllReady={() => void handleAggregationAllReady()}
            />
          ) : null}
        </div>
      </section>
      {toast ? <div className={workspaceToastClass(toast.tone)}><strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong><span>{toast.message}</span></div> : null}
    </main>
  );
}




