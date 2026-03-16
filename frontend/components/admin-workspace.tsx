"use client";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { MetricGrid, MetricItem } from "./ui/metric-grid";
import { SectionHeader } from "./ui/section-header";
import {
  docSectionLabelClass,
  docSiteBadgeClass,
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
              aside={<span className={docSiteBadgeClass}>{`${sites.length} ${pick(locale, "linked", "연결됨")}`}</span>}
            />
            <div className="grid gap-2">
            {sites.map((site) => (
              <button key={site.site_id} className={railSiteButtonClass(selectedSiteId === site.site_id)} type="button" onClick={() => onSelectSite(site.site_id)}>
                <strong>{site.display_name}</strong><span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
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
              <MetricItem value={overview?.pending_model_updates ?? pendingReviewUpdates.length} label={pick(locale, "Pending updates", "?湲??낅뜲?댄듃")} />
              <MetricItem value={overview?.model_version_count ?? modelVersions.length} label={pick(locale, "Models", "紐⑤뜽")} />
              <MetricItem value={overview?.current_model_version ?? currentModel?.version_name ?? common.notAvailable} label={pick(locale, "Current model", "?꾩옱 紐⑤뜽")} />
            </MetricGrid>
            {summary ? (
              <div className="grid gap-2 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
                <div className="font-medium text-ink">{selectedSiteId}</div>
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
      {toast ? <div className={workspaceToastClass(toast.tone)}><strong>{toast.tone === "success" ? common.saved : common.actionNeeded}</strong><span>{toast.message}</span></div> : null}
    </main>
  );
}




