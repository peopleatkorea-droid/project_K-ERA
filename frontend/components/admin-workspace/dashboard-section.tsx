"use client";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { pick, type Locale } from "../../lib/i18n";
import {
  type AiClinicEmbeddingStatusResponse,
  type SiteComparisonRecord,
  type SiteValidationRunRecord,
  type ValidationCasePredictionRecord,
} from "../../lib/api";

const ROC_CHART_WIDTH = 420;
const ROC_CHART_HEIGHT = 320;
const ROC_CHART_PADDING = { top: 18, right: 18, bottom: 42, left: 48 };
const ROC_AXIS_TICKS = [0, 0.25, 0.5, 0.75, 1];

export type DashboardCasePreview = ValidationCasePredictionRecord & {
  original_preview_url: string | null;
  roi_preview_url: string | null;
  gradcam_preview_url: string | null;
};

type DashboardModelComparisonRow = {
  modelVersion: string;
  count: number;
  accuracy: number | null;
  sensitivity: number | null;
  specificity: number | null;
  F1: number | null;
  AUROC: number | null;
};

type DashboardRocSeries = {
  run: SiteValidationRunRecord;
  color: string;
  points: Array<{ x: number; y: number }>;
};

type DashboardSectionProps = {
  locale: Locale;
  loadingLabel: string;
  notAvailableLabel: string;
  selectedSiteId: string | null;
  selectedValidationRun: SiteValidationRunRecord | null;
  validationExportBusy: boolean;
  siteValidationBusy: boolean;
  siteComparison: SiteComparisonRecord[];
  embeddingStatus: AiClinicEmbeddingStatusResponse | null;
  embeddingStatusBusy: boolean;
  embeddingBackfillBusy: boolean;
  currentModelVersionName: string | null;
  modelComparisonRows: DashboardModelComparisonRow[];
  rocEligibleRuns: SiteValidationRunRecord[];
  rocValidationIds: string[];
  selectedRocRuns: SiteValidationRunRecord[];
  rocSeries: DashboardRocSeries[];
  rocSelectionLimitReached: boolean;
  rocHasCohortMismatch: boolean;
  siteValidationRuns: SiteValidationRunRecord[];
  baselineValidationId: string | null;
  compareValidationId: string | null;
  baselineValidationRun: SiteValidationRunRecord | null;
  compareValidationRun: SiteValidationRunRecord | null;
  selectedValidationId: string | null;
  misclassifiedCases: DashboardCasePreview[];
  dashboardBusy: boolean;
  formatDateTime: (value: string | null | undefined) => string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
  formatDelta: (nextValue: number | null | undefined, baselineValue: number | null | undefined, emptyLabel?: string) => string;
  formatEmbeddingStage: (stage: string | null | undefined) => string;
  setBaselineValidationId: (validationId: string | null) => void;
  setCompareValidationId: (validationId: string | null) => void;
  setSelectedValidationId: (validationId: string) => void;
  toggleRocValidationSelection: (validationId: string) => void;
  onExportValidationReport: () => void;
  onRunSiteValidation: () => void;
  onRefreshEmbeddingStatus: () => void;
  onEmbeddingBackfill: () => void;
};

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

export function DashboardSection({
  locale,
  loadingLabel,
  notAvailableLabel,
  selectedSiteId,
  selectedValidationRun,
  validationExportBusy,
  siteValidationBusy,
  siteComparison,
  embeddingStatus,
  embeddingStatusBusy,
  embeddingBackfillBusy,
  currentModelVersionName,
  modelComparisonRows,
  rocEligibleRuns,
  rocValidationIds,
  selectedRocRuns,
  rocSeries,
  rocSelectionLimitReached,
  rocHasCohortMismatch,
  siteValidationRuns,
  baselineValidationId,
  compareValidationId,
  baselineValidationRun,
  compareValidationRun,
  selectedValidationId,
  misclassifiedCases,
  dashboardBusy,
  formatDateTime,
  formatMetric,
  formatDelta,
  formatEmbeddingStage,
  setBaselineValidationId,
  setCompareValidationId,
  setSelectedValidationId,
  toggleRocValidationSelection,
  onExportValidationReport,
  onRunSiteValidation,
  onRefreshEmbeddingStatus,
  onEmbeddingBackfill,
}: DashboardSectionProps) {
  return (
    <Card as="section" variant="surface" className="doc-surface">
      <SectionHeader
        className="doc-title-row"
        eyebrow={<div className="doc-eyebrow">{pick(locale, "Dashboard", "대시보드")}</div>}
        title={pick(locale, "Validation trends, comparison, and misclassifications", "검증 추이, 비교, 오분류 검토")}
        aside={<div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>}
      />
      <div className="workspace-actions section-launch-actions">
        <Button
          className="ghost-button compact-ghost-button"
          type="button"
          variant="ghost"
          size="sm"
          disabled={validationExportBusy || !selectedValidationRun}
          onClick={onExportValidationReport}
        >
          {validationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export validation JSON", "검증 JSON 내보내기")}
        </Button>
        <Button
          className="primary-workspace-button"
          type="button"
          variant="primary"
          disabled={siteValidationBusy || !selectedSiteId}
          onClick={onRunSiteValidation}
        >
          {siteValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run hospital validation", "병원 검증 실행")}
        </Button>
      </div>
      {selectedSiteId ? (
        <div className="ops-stack">
          <div className="ops-dual-grid">
            <Card as="section" variant="nested" className="ops-card">
              <div className="panel-card-head">
                <strong>{pick(locale, "Latest hospital validation", "최신 병원 검증")}</strong>
                <span>{selectedValidationRun ? formatDateTime(selectedValidationRun.run_date) : pick(locale, "No run yet", "실행 이력 없음")}</span>
              </div>
              {selectedValidationRun ? (
                <div className="panel-metric-grid">
                  <div><strong>{selectedValidationRun.model_version}</strong><span>{pick(locale, "model", "모델")}</span></div>
                  <div><strong>{formatMetric(selectedValidationRun.AUROC, notAvailableLabel)}</strong><span>AUROC</span></div>
                  <div><strong>{formatMetric(selectedValidationRun.accuracy, notAvailableLabel)}</strong><span>{pick(locale, "accuracy", "정확도")}</span></div>
                  <div><strong>{formatMetric(selectedValidationRun.sensitivity, notAvailableLabel)}</strong><span>{pick(locale, "sensitivity", "민감도")}</span></div>
                  <div><strong>{formatMetric(selectedValidationRun.specificity, notAvailableLabel)}</strong><span>{pick(locale, "specificity", "특이도")}</span></div>
                  <div><strong>{formatMetric(selectedValidationRun.F1, notAvailableLabel)}</strong><span>F1</span></div>
                </div>
              ) : (
                <div className="empty-surface">{pick(locale, "No hospital-level validation has been recorded for this hospital yet.", "이 병원에는 아직 병원 단위 검증 기록이 없습니다.")}</div>
              )}
            </Card>
            <Card as="section" variant="nested" className="ops-card">
              <div className="panel-card-head">
                <strong>{pick(locale, "Hospital comparison", "병원 비교")}</strong>
                <span>{siteComparison.length} {pick(locale, "hospital(s)", "병원")}</span>
              </div>
              {siteComparison.length === 0 ? (
                <div className="empty-surface">{pick(locale, "No hospital comparison data is available yet.", "아직 병원 비교 데이터가 없습니다.")}</div>
              ) : (
                <div className="ops-list">
                  {siteComparison.slice(0, 6).map((item) => (
                    <div key={item.site_id} className="ops-item">
                      <div className="panel-card-head">
                        <strong>{item.display_name}</strong>
                        <span>{item.run_count} {pick(locale, "run(s)", "회")}</span>
                      </div>
                      <div className="panel-meta">
                        <span>{item.site_id}</span>
                        <span>AUROC {formatMetric(item.AUROC, notAvailableLabel)}</span>
                        <span>{pick(locale, "Acc", "정확도")} {formatMetric(item.accuracy, notAvailableLabel)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <Card as="section" variant="nested" className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "AI Clinic embedding status", "AI Clinic 임베딩 상태")}</strong>
              <span>{embeddingStatus?.model_version.version_name ?? currentModelVersionName ?? notAvailableLabel}</span>
            </div>
            <div className="workspace-actions">
              <Button
                className="ghost-button"
                type="button"
                variant="ghost"
                disabled={embeddingStatusBusy || !selectedSiteId}
                onClick={onRefreshEmbeddingStatus}
              >
                {embeddingStatusBusy ? loadingLabel : pick(locale, "Refresh status", "상태 새로고침")}
              </Button>
              <Button
                className="primary-workspace-button"
                type="button"
                variant="primary"
                disabled={embeddingBackfillBusy || !selectedSiteId || !(embeddingStatus?.needs_backfill ?? false)}
                onClick={onEmbeddingBackfill}
              >
                {embeddingBackfillBusy ? pick(locale, "Queuing...", "대기열 등록 중...") : pick(locale, "Backfill missing embeddings", "누락 임베딩 전체 생성")}
              </Button>
            </div>
            {embeddingStatus ? (
              <div className="ops-stack embedding-status-grid">
                <div className="panel-metric-grid">
                  <div><strong>{embeddingStatus.missing_image_count}</strong><span>{pick(locale, "images missing embeddings", "임베딩 누락 이미지")}</span></div>
                  <div><strong>{embeddingStatus.missing_case_count}</strong><span>{pick(locale, "cases missing embeddings", "임베딩 누락 케이스")}</span></div>
                  <div><strong>{embeddingStatus.total_images}</strong><span>{pick(locale, "total images", "전체 이미지")}</span></div>
                  <div><strong>{embeddingStatus.total_cases}</strong><span>{pick(locale, "total cases", "전체 케이스")}</span></div>
                  <div><strong>{embeddingStatus.vector_index.classifier_available ? pick(locale, "Ready", "준비됨") : pick(locale, "Missing", "없음")}</strong><span>{pick(locale, "classifier index", "classifier 인덱스")}</span></div>
                  <div><strong>{embeddingStatus.needs_backfill ? pick(locale, "Action needed", "조치 필요") : pick(locale, "Healthy", "정상")}</strong><span>{pick(locale, "status", "상태")}</span></div>
                </div>
                <div className="panel-meta">
                  <span>{pick(locale, "Missing counts are calculated against the current model version cache.", "누락 수치는 현재 모델 버전 캐시 기준으로 계산됩니다.")}</span>
                  <span>
                    {embeddingStatus.vector_index.dinov2_embedding_available
                      ? embeddingStatus.vector_index.dinov2_index_available
                        ? pick(locale, "DINOv2 index is available.", "DINOv2 인덱스가 준비되어 있습니다.")
                        : pick(locale, "DINOv2 embeddings exist but the index is missing.", "DINOv2 임베딩은 있지만 인덱스가 없습니다.")
                      : pick(locale, "No DINOv2 embedding cache has been created yet.", "아직 DINOv2 임베딩 캐시가 생성되지 않았습니다.")}
                  </span>
                </div>
                {embeddingStatus.active_job ? (
                  <div className="ops-item">
                    <div className="panel-card-head">
                      <strong>{pick(locale, "Latest embedding backfill job", "최근 임베딩 백필 작업")}</strong>
                      <span>{formatEmbeddingStage(embeddingStatus.active_job.status)}</span>
                    </div>
                    <div className="panel-meta">
                      <span>{embeddingStatus.active_job.job_id}</span>
                      <span>{embeddingStatus.active_job.result?.progress?.message ?? pick(locale, "No progress message yet.", "아직 진행 메시지가 없습니다.")}</span>
                      <span>{pick(locale, "Progress", "진행률")} {Math.max(0, Math.min(100, Math.round(embeddingStatus.active_job.result?.progress?.percent ?? 0)))}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-surface">{pick(locale, "No embedding backfill job has been recorded for this hospital yet.", "이 병원에는 아직 임베딩 백필 작업 기록이 없습니다.")}</div>
                )}
              </div>
            ) : (
              <div className="empty-surface">{embeddingStatusBusy ? loadingLabel : pick(locale, "Embedding status is not available yet.", "임베딩 상태를 아직 불러오지 못했습니다.")}</div>
            )}
          </Card>
          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "Model version comparison", "모델 버전 비교")}</strong>
              <span>{modelComparisonRows.length} {pick(locale, "version(s)", "버전")}</span>
            </div>
            {modelComparisonRows.length === 0 ? (
              <div className="empty-surface">{pick(locale, "Run a hospital validation first to build comparison history.", "비교 이력을 만들려면 먼저 병원 검증을 실행하세요.")}</div>
            ) : (
              <div className="ops-table">
                <div className="ops-table-row ops-table-head">
                  <span>{pick(locale, "model", "모델")}</span>
                  <span>{pick(locale, "runs", "실행 수")}</span>
                  <span>AUROC</span>
                  <span>{pick(locale, "accuracy", "정확도")}</span>
                  <span>{pick(locale, "sensitivity", "민감도")}</span>
                  <span>F1</span>
                </div>
                {modelComparisonRows.map((item) => (
                  <div key={item.modelVersion} className="ops-table-row">
                    <span>{item.modelVersion}</span>
                    <span>{item.count}</span>
                    <span>{formatMetric(item.AUROC, notAvailableLabel)}</span>
                    <span>{formatMetric(item.accuracy, notAvailableLabel)}</span>
                    <span>{formatMetric(item.sensitivity, notAvailableLabel)}</span>
                    <span>{formatMetric(item.F1, notAvailableLabel)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "ROC curve comparison", "ROC 커브 비교")}</strong>
              <span>{selectedRocRuns.length} {pick(locale, "selected", "선택됨")}</span>
            </div>
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
                        <span>{formatDateTime(run.run_date)}</span>
                        <span>{pick(locale, "Cases", "케이스")} {run.n_cases} · AUROC {formatMetric(run.AUROC, notAvailableLabel)}</span>
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
                            <span>{formatDateTime(series.run.run_date)}</span>
                            <span>AUC = {formatMetric(series.run.AUROC, notAvailableLabel)} · {pick(locale, "Cases", "케이스")} {series.run.n_cases}</span>
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
            <div className="panel-card-head">
              <strong>{pick(locale, "Validation run comparison", "검증 실행 비교")}</strong>
              <span>{siteValidationRuns.length} {pick(locale, "run(s)", "회")}</span>
            </div>
            {siteValidationRuns.length < 2 ? (
              <div className="empty-surface">{pick(locale, "At least two hospital validation runs are required for run-to-run comparison.", "실행 간 비교를 하려면 병원 검증 이력이 2개 이상 필요합니다.")}</div>
            ) : (
              <div className="ops-stack">
                <div className="ops-form-grid">
                  <label className="inline-field">
                    <span>{pick(locale, "Baseline run", "기준 실행")}</span>
                    <select value={baselineValidationId ?? ""} onChange={(event) => setBaselineValidationId(event.target.value)}>
                      {siteValidationRuns.map((run) => (
                        <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-field">
                    <span>{pick(locale, "Compare run", "비교 실행")}</span>
                    <select value={compareValidationId ?? ""} onChange={(event) => setCompareValidationId(event.target.value)}>
                      {siteValidationRuns.map((run) => (
                        <option key={run.validation_id} value={run.validation_id}>{run.model_version} · {formatDateTime(run.run_date)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="panel-metric-grid">
                  <div><strong>{formatMetric(compareValidationRun?.AUROC, notAvailableLabel)}</strong><span>AUROC ({formatDelta(compareValidationRun?.AUROC, baselineValidationRun?.AUROC, notAvailableLabel)})</span></div>
                  <div><strong>{formatMetric(compareValidationRun?.accuracy, notAvailableLabel)}</strong><span>{pick(locale, "accuracy", "정확도")} ({formatDelta(compareValidationRun?.accuracy, baselineValidationRun?.accuracy, notAvailableLabel)})</span></div>
                  <div><strong>{formatMetric(compareValidationRun?.sensitivity, notAvailableLabel)}</strong><span>{pick(locale, "sensitivity", "민감도")} ({formatDelta(compareValidationRun?.sensitivity, baselineValidationRun?.sensitivity, notAvailableLabel)})</span></div>
                  <div><strong>{formatMetric(compareValidationRun?.F1, notAvailableLabel)}</strong><span>F1 ({formatDelta(compareValidationRun?.F1, baselineValidationRun?.F1, notAvailableLabel)})</span></div>
                </div>
              </div>
            )}
          </section>
          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "Validation run history", "검증 실행 이력")}</strong>
              <span>{siteValidationRuns.length} {pick(locale, "stored", "저장됨")}</span>
            </div>
            {siteValidationRuns.length === 0 ? (
              <div className="empty-surface">{pick(locale, "No validation history has been stored for this hospital yet.", "이 병원에는 아직 저장된 검증 이력이 없습니다.")}</div>
            ) : (
              <div className="ops-table">
                <div className="ops-table-row ops-table-head">
                  <span>{pick(locale, "run date", "실행 일시")}</span>
                  <span>{pick(locale, "model", "모델")}</span>
                  <span>{pick(locale, "cases", "케이스")}</span>
                  <span>AUROC</span>
                  <span>{pick(locale, "accuracy", "정확도")}</span>
                  <span>F1</span>
                </div>
                {siteValidationRuns.map((run) => (
                  <button
                    key={run.validation_id}
                    className={`ops-table-row ops-table-button ${selectedValidationId === run.validation_id ? "active" : ""}`}
                    type="button"
                    onClick={() => setSelectedValidationId(run.validation_id)}
                  >
                    <span>{formatDateTime(run.run_date)}</span>
                    <span>{run.model_version}</span>
                    <span>{run.n_cases}</span>
                    <span>{formatMetric(run.AUROC, notAvailableLabel)}</span>
                    <span>{formatMetric(run.accuracy, notAvailableLabel)}</span>
                    <span>{formatMetric(run.F1, notAvailableLabel)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "Representative misclassified cases", "대표 오분류 케이스")}</strong>
              <span>{dashboardBusy ? loadingLabel : `${misclassifiedCases.length} ${pick(locale, "shown", "표시됨")}`}</span>
            </div>
            {misclassifiedCases.length === 0 ? (
              <div className="empty-surface">{pick(locale, "No misclassified case preview is available for the selected validation run.", "선택한 검증 실행에 대한 오분류 미리보기가 없습니다.")}</div>
            ) : (
              <div className="ops-gallery-grid">
                {misclassifiedCases.map((item) => (
                  <article key={`${item.patient_id}-${item.visit_date}`} className="ops-item">
                    <div className="panel-card-head">
                      <strong>{item.patient_id}</strong>
                      <span>{item.visit_date}</span>
                    </div>
                    <div className="panel-meta">
                      <span>{item.true_label}</span>
                      <span>{item.predicted_label}</span>
                      <span>{formatMetric(item.prediction_probability, notAvailableLabel)}</span>
                    </div>
                    <div className="ops-gallery-triptych">
                      <div className="panel-image-card">
                        {item.original_preview_url ? <img src={item.original_preview_url} alt={pick(locale, `${item.patient_id} original image`, `${item.patient_id} 원본 이미지`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Original unavailable", "원본을 표시할 수 없습니다")}</div>}
                        <div className="panel-image-copy"><strong>{pick(locale, "Original", "원본")}</strong></div>
                      </div>
                      <div className="panel-image-card">
                        {item.roi_preview_url ? <img src={item.roi_preview_url} alt={pick(locale, `${item.patient_id} cornea crop`, `${item.patient_id} 각막 crop`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Cornea crop unavailable", "각막 crop을 표시할 수 없습니다")}</div>}
                        <div className="panel-image-copy"><strong>{pick(locale, "Cornea crop", "각막 crop")}</strong></div>
                      </div>
                      <div className="panel-image-card">
                        {item.gradcam_preview_url ? <img src={item.gradcam_preview_url} alt={pick(locale, `${item.patient_id} Grad-CAM`, `${item.patient_id} Grad-CAM`)} className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Grad-CAM unavailable", "Grad-CAM을 표시할 수 없습니다")}</div>}
                        <div className="panel-image-copy"><strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong></div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="empty-surface">{pick(locale, "Select a hospital to open the advanced dashboard.", "고급 대시보드를 열려면 병원을 선택하세요.")}</div>
      )}
    </Card>
  );
}
