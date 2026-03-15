"use client";

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
  } = state;
  const {
    handleReview,
    handleInitialTraining,
    handleBenchmarkTraining,
    handleCrossValidation,
    handleSiteValidation,
    handleRefreshEmbeddingStatus,
    handleEmbeddingBackfill,
    handleExportValidationReport,
    handleExportCrossValidationReport,
    handleAggregation,
    handleDeleteModelVersion,
    handleModelUpdateReview,
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
            <DashboardSection
              locale={locale}
              loadingLabel={common.loading}
              notAvailableLabel={common.notAvailable}
              selectedSiteId={selectedSiteId}
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
              reviewDrafts={reviewDrafts}
              sites={sites}
              setReviewDrafts={setReviewDrafts}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              onReview={(requestId, decision) => void handleReview(requestId, decision)}
            />
          ) : null}
          {section === "training" ? (
            <TrainingSection
              locale={locale}
              notAvailableLabel={common.notAvailable}
              selectedSiteId={selectedSiteId}
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
              onRunBenchmark={() => void handleBenchmarkTraining()}
              onRunInitialTraining={() => void handleInitialTraining()}
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
              modelVersions={modelVersions}
              currentModel={currentModel}
              modelUpdates={modelUpdates}
              selectedModelUpdate={selectedModelUpdate}
              selectedApprovalReport={selectedApprovalReport}
              selectedUpdatePreviewUrls={selectedUpdatePreviewUrls}
              modelUpdateReviewNotes={modelUpdateReviewNotes}
              setSelectedModelUpdateId={setSelectedModelUpdateId}
              setModelUpdateReviewNotes={setModelUpdateReviewNotes}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              formatWeightPercent={formatWeightPercent}
              formatMetric={formatMetric}
              formatQualityRecommendation={(recommendation) => formatQualityRecommendation(locale, recommendation)}
              translateQualityFlag={(flag) => translateQualityFlag(locale, flag)}
              onDeleteModelVersion={(version) => void handleDeleteModelVersion(version)}
              onModelUpdateReview={(decision) => void handleModelUpdateReview(decision)}
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
              selectedSiteId={selectedSiteId}
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
              aggregations={aggregations}
              newVersionName={newVersionName}
              aggregationBusy={aggregationBusy}
              setNewVersionName={setNewVersionName}
              formatDateTime={(value, emptyLabel = common.notAvailable) => formatDateTime(value, localeTag, emptyLabel)}
              onAggregation={() => void handleAggregation()}
            />
          ) : null}
        </div>
      </section>
      {toast ? <div className={`workspace-toast tone-${toast.tone}`}><strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong><span>{toast.message}</span></div> : null}
    </main>
  );
}
