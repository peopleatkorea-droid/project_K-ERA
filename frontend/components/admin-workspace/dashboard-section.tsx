"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { pick, type Locale } from "../../lib/i18n";
import {
  type AiClinicEmbeddingStatusResponse,
  type SiteComparisonRecord,
  type SiteValidationRunRecord,
  type ValidationCasePredictionRecord,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";

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
  selectedSiteLabel: string | null;
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
  formatDelta: (
    nextValue: number | null | undefined,
    baselineValue: number | null | undefined,
    emptyLabel?: string
  ) => string;
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

function Panel({
  title,
  subtitle,
  description,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card as="section" variant="nested" className="flex flex-col gap-4 p-5 sm:p-6">
      <SectionHeader
        titleAs="h4"
        className="gap-3"
        title={title}
        description={description}
        aside={
          subtitle || actions ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 max-[900px]:justify-start">
              {subtitle ? (
                <span className="inline-flex min-h-9 max-w-full items-center rounded-full border border-border bg-white/55 px-3 py-1 text-left text-[0.78rem] font-medium text-muted whitespace-normal break-words [overflow-wrap:anywhere] dark:bg-white/4">
                  {subtitle}
                </span>
              ) : null}
              {actions}
            </div>
          ) : null
        }
      />
      {children}
    </Card>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dashed border-border bg-surface-muted/60 px-4 py-5 text-sm leading-6 text-muted">
      {children}
    </div>
  );
}

function DetailRow({ items }: { items: Array<ReactNode | null | undefined> }) {
  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visibleItems.map((item, index) => (
        <span
          key={index}
          className="inline-flex min-h-9 max-w-full items-center rounded-full border border-border bg-white/55 px-3 py-1 text-left text-[0.78rem] font-medium text-muted whitespace-normal break-words [overflow-wrap:anywhere] dark:bg-white/4"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function Metrics({
  items,
  columns = 3,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <MetricGrid columns={columns}>
      {items.map((item) => (
        <MetricItem key={String(item.label)} value={item.value} label={item.label} />
      ))}
    </MetricGrid>
  );
}

export function DashboardSection({
  locale,
  loadingLabel,
  notAvailableLabel,
  selectedSiteId,
  selectedSiteLabel,
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
    <Card as="section" variant="surface" className="flex flex-col gap-6 p-6 sm:p-7">
      <SectionHeader
        className="gap-4"
        eyebrow={
          <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-muted/80 px-3 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
            {pick(locale, "Dashboard", "대시보드")}
          </span>
        }
        title={pick(locale, "Validation trends, comparison, and misclassifications", "검증 추이, 비교, 오분류 사례")}
        description={pick(
          locale,
          "Track the current hospital's validation history, ROC behavior, and AI Clinic embedding readiness in one view.",
          "현재 병원의 검증 이력, ROC 비교, AI Clinic 임베딩 상태를 한 화면에서 확인합니다."
        )}
        aside={
          <span className="inline-flex min-h-10 items-center rounded-full border border-border bg-white/55 px-4 text-sm font-medium text-muted dark:bg-white/4">
            {selectedSiteLabel ?? pick(locale, "Select a hospital", "병원을 선택하세요")}
          </span>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={validationExportBusy || !selectedValidationRun}
          onClick={onExportValidationReport}
        >
          {validationExportBusy
            ? pick(locale, "Exporting...", "내보내는 중...")
            : pick(locale, "Export validation JSON", "검증 JSON 내보내기")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={siteValidationBusy || !selectedSiteId}
          onClick={onRunSiteValidation}
        >
          {siteValidationBusy
            ? pick(locale, "Running...", "실행 중...")
            : pick(locale, "Run hospital validation", "병원 검증 실행")}
        </Button>
      </div>

      {selectedSiteId ? (
        <div className="grid gap-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              title={pick(locale, "Latest hospital validation", "최신 병원 검증")}
              subtitle={
                selectedValidationRun
                  ? formatDateTime(selectedValidationRun.run_date)
                  : pick(locale, "No run yet", "실행 이력 없음")
              }
            >
              {selectedValidationRun ? (
                <Metrics
                  columns={3}
                  items={[
                    { value: selectedValidationRun.model_version, label: pick(locale, "model", "모델") },
                    { value: formatMetric(selectedValidationRun.AUROC, notAvailableLabel), label: "AUROC" },
                    { value: formatMetric(selectedValidationRun.accuracy, notAvailableLabel), label: pick(locale, "accuracy", "정확도") },
                    { value: formatMetric(selectedValidationRun.sensitivity, notAvailableLabel), label: pick(locale, "sensitivity", "민감도") },
                    { value: formatMetric(selectedValidationRun.specificity, notAvailableLabel), label: pick(locale, "specificity", "특이도") },
                    { value: formatMetric(selectedValidationRun.F1, notAvailableLabel), label: "F1" },
                  ]}
                />
              ) : (
                <EmptyState>
                  {pick(
                    locale,
                    "No hospital-level validation has been recorded for this hospital yet.",
                    "이 병원에는 아직 병원 단위 검증 이력이 없습니다."
                  )}
                </EmptyState>
              )}
            </Panel>

            <Panel
              title={pick(locale, "Hospital comparison", "병원 비교")}
              subtitle={`${siteComparison.length} ${pick(locale, "hospital(s)", "병원")}`}
            >
              {siteComparison.length === 0 ? (
                <EmptyState>
                  {pick(locale, "No hospital comparison data is available yet.", "아직 병원 비교 데이터가 없습니다.")}
                </EmptyState>
              ) : (
                <div className="grid gap-3">
                  {siteComparison.slice(0, 6).map((item) => (
                    <Card
                      key={item.site_id}
                      as="article"
                      variant="interactive"
                      className="flex flex-col gap-3 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <strong className="text-sm font-semibold text-ink">{item.hospital_name || item.display_name}</strong>
                        </div>
                        <span className="rounded-full border border-border bg-white/55 px-3 py-1 text-[0.76rem] font-medium text-muted dark:bg-white/4">
                          {item.run_count} {pick(locale, "run(s)", "회")}
                        </span>
                      </div>
                      <DetailRow
                        items={[
                          `AUROC ${formatMetric(item.AUROC, notAvailableLabel)}`,
                          `${pick(locale, "Acc", "정확도")} ${formatMetric(item.accuracy, notAvailableLabel)}`,
                        ]}
                      />
                    </Card>
                  ))}
                </div>
              )}
            </Panel>
          </div>
          <Panel
            title={pick(locale, "AI Clinic embedding status", "AI Clinic 임베딩 상태")}
            subtitle={embeddingStatus?.model_version.version_name ?? currentModelVersionName ?? notAvailableLabel}
            actions={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={embeddingStatusBusy || !selectedSiteId}
                  onClick={onRefreshEmbeddingStatus}
                >
                  {embeddingStatusBusy ? loadingLabel : pick(locale, "Refresh status", "상태 새로고침")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={embeddingBackfillBusy || !selectedSiteId || !(embeddingStatus?.needs_backfill ?? false)}
                  onClick={onEmbeddingBackfill}
                >
                  {embeddingBackfillBusy
                    ? pick(locale, "Queuing...", "대기열 등록 중...")
                    : pick(locale, "Backfill missing embeddings", "누락 임베딩 채우기")}
                </Button>
              </>
            }
          >
            {embeddingStatus ? (
              <div className="grid gap-4">
                <Metrics
                  columns={3}
                  items={[
                    {
                      value: embeddingStatus.missing_image_count,
                      label: pick(locale, "images missing embeddings", "임베딩 누락 이미지"),
                    },
                    {
                      value: embeddingStatus.missing_case_count,
                      label: pick(locale, "cases missing embeddings", "임베딩 누락 케이스"),
                    },
                    { value: embeddingStatus.total_images, label: pick(locale, "total images", "전체 이미지") },
                    { value: embeddingStatus.total_cases, label: pick(locale, "total cases", "전체 케이스") },
                    {
                      value: embeddingStatus.vector_index.classifier_available
                        ? pick(locale, "Ready", "준비됨")
                        : pick(locale, "Missing", "없음"),
                      label: pick(locale, "classifier index", "classifier 인덱스"),
                    },
                    {
                      value: embeddingStatus.needs_backfill
                        ? pick(locale, "Action needed", "조치 필요")
                        : pick(locale, "Healthy", "정상"),
                      label: pick(locale, "status", "상태"),
                    },
                  ]}
                />

                <Card as="div" variant="panel" className="grid gap-2.5 p-4 text-sm leading-6 text-muted">
                  <p className="m-0">
                    {pick(
                      locale,
                      "Missing counts are calculated against the current model version cache.",
                      "누락 수치는 현재 모델 버전 캐시 기준으로 계산됩니다."
                    )}
                  </p>
                  <p className="m-0">
                    {embeddingStatus.vector_index.dinov2_embedding_available
                      ? embeddingStatus.vector_index.dinov2_index_available
                        ? pick(locale, "DINOv2 index is available.", "DINOv2 인덱스를 사용할 수 있습니다.")
                        : pick(locale, "DINOv2 embeddings exist but the index is missing.", "DINOv2 임베딩은 있지만 인덱스가 없습니다.")
                      : pick(locale, "No DINOv2 embedding cache has been created yet.", "아직 DINOv2 임베딩 캐시가 생성되지 않았습니다.")}
                  </p>
                </Card>

                {embeddingStatus.active_job ? (
                  <Card as="div" variant="panel" className="grid gap-3 p-4">
                    <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
                      <div className="grid gap-1">
                        <strong className="text-sm font-semibold text-ink">
                          {pick(locale, "Latest embedding backfill job", "최근 임베딩 백필 작업")}
                        </strong>
                        <span className="text-[0.82rem] text-muted">{embeddingStatus.active_job.job_id}</span>
                      </div>
                      <span className="rounded-full border border-border bg-white/55 px-3 py-1 text-[0.76rem] font-medium text-muted dark:bg-white/4">
                        {formatEmbeddingStage(embeddingStatus.active_job.status)}
                      </span>
                    </div>
                    <DetailRow
                      items={[
                        embeddingStatus.active_job.result?.progress?.message ??
                          pick(locale, "No progress message yet.", "아직 진행 메시지가 없습니다."),
                        `${pick(locale, "Progress", "진행률")} ${Math.max(
                          0,
                          Math.min(100, Math.round(embeddingStatus.active_job.result?.progress?.percent ?? 0))
                        )}%`,
                      ]}
                    />
                  </Card>
                ) : (
                  <EmptyState>
                    {pick(
                      locale,
                      "No embedding backfill job has been recorded for this hospital yet.",
                      "이 병원에는 아직 임베딩 백필 작업 이력이 없습니다."
                    )}
                  </EmptyState>
                )}
              </div>
            ) : (
              <EmptyState>
                {embeddingStatusBusy
                  ? loadingLabel
                  : pick(locale, "Embedding status is not available yet.", "임베딩 상태를 아직 불러오지 못했습니다.")}
              </EmptyState>
            )}
          </Panel>

          <Panel
            title={pick(locale, "Model version comparison", "모델 버전 비교")}
            subtitle={`${modelComparisonRows.length} ${pick(locale, "version(s)", "버전")}`}
          >
            {modelComparisonRows.length === 0 ? (
              <EmptyState>
                {pick(
                  locale,
                  "Run a hospital validation first to build comparison history.",
                  "비교 이력을 만들려면 먼저 병원 검증을 실행하세요."
                )}
              </EmptyState>
            ) : (
              <div className="grid gap-2">
                <div className="hidden grid-cols-[minmax(0,1.4fr)_0.6fr_repeat(4,minmax(0,0.72fr))] gap-3 px-4 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted md:grid">
                  <span>{pick(locale, "model", "모델")}</span>
                  <span>{pick(locale, "runs", "실행")}</span>
                  <span>AUROC</span>
                  <span>{pick(locale, "accuracy", "정확도")}</span>
                  <span>{pick(locale, "sensitivity", "민감도")}</span>
                  <span>F1</span>
                </div>
                {modelComparisonRows.map((item) => (
                  <Card
                    key={item.modelVersion}
                    as="div"
                    variant="panel"
                    className="grid gap-2 p-4 md:grid-cols-[minmax(0,1.4fr)_0.6fr_repeat(4,minmax(0,0.72fr))] md:items-center md:gap-3 [&>*]:min-w-0"
                  >
                    <strong className="min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">{item.modelVersion}</strong>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{item.count}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(item.AUROC, notAvailableLabel)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(item.accuracy, notAvailableLabel)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(item.sensitivity, notAvailableLabel)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(item.F1, notAvailableLabel)}</span>
                  </Card>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={pick(locale, "ROC curve comparison", "ROC 곡선 비교")}
            subtitle={`${selectedRocRuns.length} ${pick(locale, "selected", "선택됨")}`}
            description={pick(
              locale,
              "Select up to five validation runs. Use runs built from the same hospital cohort for fair comparison.",
              "최대 다섯 개의 검증 실행을 선택할 수 있습니다. 공정한 비교를 위해 같은 병원 코호트에서 만든 실행을 사용하세요."
            )}
          >
            {rocEligibleRuns.length === 0 ? (
              <EmptyState>
                {pick(
                  locale,
                  "No saved validation run contains ROC curve data yet.",
                  "ROC 곡선 데이터가 저장된 검증 실행이 아직 없습니다."
                )}
              </EmptyState>
            ) : (
              <div className="grid gap-4">
                <DetailRow
                  items={[
                    rocHasCohortMismatch
                      ? pick(
                          locale,
                          "Selected runs have different patient or case counts.",
                          "선택한 실행의 환자 수 또는 케이스 수가 다릅니다."
                        )
                      : pick(
                          locale,
                          "Selected runs currently share the same patient, case, and image counts.",
                          "선택한 실행은 현재 같은 환자, 케이스, 이미지 수를 공유합니다."
                        ),
                  ]}
                />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rocEligibleRuns.map((run) => {
                    const isActive = rocValidationIds.includes(run.validation_id);
                    const isDisabled = !isActive && rocSelectionLimitReached;
                    return (
                      <button
                        key={run.validation_id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => toggleRocValidationSelection(run.validation_id)}
                        className={cn(
                          "grid min-w-0 gap-1.5 rounded-[20px] border px-4 py-4 text-left transition duration-150 ease-out",
                          isActive
                            ? "border-brand/30 bg-brand-soft/80 shadow-card"
                            : "border-border bg-white/55 hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted dark:bg-white/4",
                          isDisabled && "cursor-not-allowed opacity-55"
                        )}
                      >
                        <strong className="min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">{run.model_version}</strong>
                        <span className="min-w-0 break-words text-[0.82rem] text-muted [overflow-wrap:anywhere]">{formatDateTime(run.run_date)}</span>
                        <span className="min-w-0 break-words text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                          {pick(locale, "Cases", "케이스")} {run.n_cases} · AUROC{" "}
                          {formatMetric(run.AUROC, notAvailableLabel)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {rocSeries.length === 0 ? (
                  <EmptyState>
                    {pick(locale, "Select at least one validation run to draw the ROC chart.", "ROC 차트를 그리려면 검증 실행을 하나 이상 선택하세요.")}
                  </EmptyState>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                    <Card as="div" variant="panel" className="p-4 sm:p-5">
                      <svg
                        viewBox={`0 0 ${ROC_CHART_WIDTH} ${ROC_CHART_HEIGHT}`}
                        className="h-auto w-full"
                        role="img"
                        aria-label={pick(locale, "ROC curve comparison chart", "ROC 곡선 비교 차트")}
                      >
                        {ROC_AXIS_TICKS.map((tick) => {
                          const x =
                            ROC_CHART_PADDING.left +
                            tick * (ROC_CHART_WIDTH - ROC_CHART_PADDING.left - ROC_CHART_PADDING.right);
                          const y =
                            ROC_CHART_HEIGHT -
                            ROC_CHART_PADDING.bottom -
                            tick * (ROC_CHART_HEIGHT - ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom);
                          return (
                            <g key={tick}>
                              <line
                                x1={ROC_CHART_PADDING.left}
                                y1={y}
                                x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right}
                                y2={y}
                                stroke="var(--border-subtle)"
                                strokeWidth="1"
                              />
                              <line
                                x1={x}
                                y1={ROC_CHART_PADDING.top}
                                x2={x}
                                y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom}
                                stroke="var(--border-subtle)"
                                strokeWidth="1"
                              />
                              <text x={ROC_CHART_PADDING.left - 10} y={y + 4} textAnchor="end" fill="var(--text-secondary)" fontSize="12">
                                {tick.toFixed(1)}
                              </text>
                              <text x={x} y={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom + 18} textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
                                {tick.toFixed(1)}
                              </text>
                            </g>
                          );
                        })}
                        <line
                          x1={ROC_CHART_PADDING.left}
                          y1={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom}
                          x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right}
                          y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom}
                          stroke="var(--text-tertiary)"
                          strokeWidth="1.5"
                        />
                        <line
                          x1={ROC_CHART_PADDING.left}
                          y1={ROC_CHART_PADDING.top}
                          x2={ROC_CHART_PADDING.left}
                          y2={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom}
                          stroke="var(--text-tertiary)"
                          strokeWidth="1.5"
                        />
                        <line
                          x1={ROC_CHART_PADDING.left}
                          y1={ROC_CHART_HEIGHT - ROC_CHART_PADDING.bottom}
                          x2={ROC_CHART_WIDTH - ROC_CHART_PADDING.right}
                          y2={ROC_CHART_PADDING.top}
                          stroke="var(--text-tertiary)"
                          strokeWidth="1.5"
                          strokeDasharray="6 6"
                          opacity="0.7"
                        />
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
                        <text
                          x={(ROC_CHART_WIDTH + ROC_CHART_PADDING.left - ROC_CHART_PADDING.right) / 2}
                          y={ROC_CHART_HEIGHT - 8}
                          textAnchor="middle"
                          fill="var(--text-secondary)"
                          fontSize="12"
                        >
                          1-Specificity
                        </text>
                        <text
                          x={18}
                          y={(ROC_CHART_HEIGHT + ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom) / 2}
                          textAnchor="middle"
                          transform={`rotate(-90 18 ${(ROC_CHART_HEIGHT + ROC_CHART_PADDING.top - ROC_CHART_PADDING.bottom) / 2})`}
                          fill="var(--text-secondary)"
                          fontSize="12"
                        >
                          Sensitivity
                        </text>
                      </svg>
                    </Card>

                    <div className="grid gap-3">
                      {rocSeries.map((series) => (
                        <Card
                          key={series.run.validation_id}
                          as="div"
                          variant="panel"
                          className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 p-4"
                        >
                          <span
                            className="mt-1 block h-3 w-3 rounded-full"
                            style={{ backgroundColor: series.color }}
                            aria-hidden="true"
                          />
                          <div className="grid gap-1">
                            <strong className="min-w-0 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">{series.run.model_version}</strong>
                            <span className="min-w-0 break-words text-[0.82rem] text-muted [overflow-wrap:anywhere]">{formatDateTime(series.run.run_date)}</span>
                            <span className="min-w-0 break-words text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                              AUC = {formatMetric(series.run.AUROC, notAvailableLabel)} · {pick(locale, "Cases", "케이스")}{" "}
                              {series.run.n_cases}
                            </span>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel
            title={pick(locale, "Validation run comparison", "검증 실행 비교")}
            subtitle={`${siteValidationRuns.length} ${pick(locale, "run(s)", "회")}`}
          >
            {siteValidationRuns.length < 2 ? (
              <EmptyState>
                {pick(
                  locale,
                  "At least two hospital validation runs are required for run-to-run comparison.",
                  "실행 간 비교를 하려면 병원 검증 이력이 두 개 이상 필요합니다."
                )}
              </EmptyState>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field as="div" label={pick(locale, "Baseline run", "기준 실행")}>
                    <select
                      value={baselineValidationId ?? ""}
                      onChange={(event) => setBaselineValidationId(event.target.value)}
                    >
                      {siteValidationRuns.map((run) => (
                        <option key={run.validation_id} value={run.validation_id}>
                          {run.model_version} · {formatDateTime(run.run_date)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field as="div" label={pick(locale, "Compare run", "비교 실행")}>
                    <select
                      value={compareValidationId ?? ""}
                      onChange={(event) => setCompareValidationId(event.target.value)}
                    >
                      {siteValidationRuns.map((run) => (
                        <option key={run.validation_id} value={run.validation_id}>
                          {run.model_version} · {formatDateTime(run.run_date)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Metrics
                  columns={4}
                  items={[
                    {
                      value: formatMetric(compareValidationRun?.AUROC, notAvailableLabel),
                      label: `AUROC (${formatDelta(compareValidationRun?.AUROC, baselineValidationRun?.AUROC, notAvailableLabel)})`,
                    },
                    {
                      value: formatMetric(compareValidationRun?.accuracy, notAvailableLabel),
                      label: `${pick(locale, "accuracy", "정확도")} (${formatDelta(
                        compareValidationRun?.accuracy,
                        baselineValidationRun?.accuracy,
                        notAvailableLabel
                      )})`,
                    },
                    {
                      value: formatMetric(compareValidationRun?.sensitivity, notAvailableLabel),
                      label: `${pick(locale, "sensitivity", "민감도")} (${formatDelta(
                        compareValidationRun?.sensitivity,
                        baselineValidationRun?.sensitivity,
                        notAvailableLabel
                      )})`,
                    },
                    {
                      value: formatMetric(compareValidationRun?.F1, notAvailableLabel),
                      label: `F1 (${formatDelta(compareValidationRun?.F1, baselineValidationRun?.F1, notAvailableLabel)})`,
                    },
                  ]}
                />
              </div>
            )}
          </Panel>
          <Panel
            title={pick(locale, "Validation run history", "검증 실행 이력")}
            subtitle={`${siteValidationRuns.length} ${pick(locale, "stored", "저장됨")}`}
          >
            {siteValidationRuns.length === 0 ? (
              <EmptyState>
                {pick(locale, "No validation history has been stored for this hospital yet.", "이 병원에는 아직 저장된 검증 이력이 없습니다.")}
              </EmptyState>
            ) : (
              <div className="grid gap-2">
                <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_0.6fr_repeat(3,minmax(0,0.7fr))] gap-3 px-4 text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted md:grid">
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
                    type="button"
                    onClick={() => setSelectedValidationId(run.validation_id)}
                    className={cn(
                      "grid gap-2 rounded-[20px] border px-4 py-4 text-left transition duration-150 ease-out md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_0.6fr_repeat(3,minmax(0,0.7fr))] md:items-center md:gap-3 [&>*]:min-w-0",
                      selectedValidationId === run.validation_id
                        ? "border-brand/30 bg-brand-soft/80 shadow-card"
                        : "border-border bg-white/55 hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted dark:bg-white/4"
                    )}
                  >
                    <span className="min-w-0 break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">{formatDateTime(run.run_date)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{run.model_version}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{run.n_cases}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(run.AUROC, notAvailableLabel)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(run.accuracy, notAvailableLabel)}</span>
                    <span className="min-w-0 break-words text-sm text-muted [overflow-wrap:anywhere]">{formatMetric(run.F1, notAvailableLabel)}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={pick(locale, "Representative misclassified cases", "대표 오분류 사례")}
            subtitle={dashboardBusy ? loadingLabel : `${misclassifiedCases.length} ${pick(locale, "shown", "표시됨")}`}
          >
            {misclassifiedCases.length === 0 ? (
              <EmptyState>
                {pick(
                  locale,
                  "No misclassified case preview is available for the selected validation run.",
                  "선택한 검증 실행에 대해 표시할 오분류 사례가 없습니다."
                )}
              </EmptyState>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {misclassifiedCases.map((item) => (
                  <Card
                    key={`${item.patient_id}-${item.visit_date}`}
                    as="article"
                    variant="panel"
                    className="grid gap-4 p-4"
                  >
                    <div className="flex items-start justify-between gap-3 max-[720px]:flex-col">
                      <div className="grid gap-1">
                        <strong className="text-sm font-semibold text-ink">{item.patient_id}</strong>
                        <span className="text-[0.82rem] text-muted">{item.visit_date}</span>
                      </div>
                      <DetailRow
                        items={[
                          item.true_label,
                          item.predicted_label,
                          formatMetric(item.prediction_probability, notAvailableLabel),
                        ]}
                      />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        {
                          label: pick(locale, "Original", "원본"),
                          alt: pick(locale, `${item.patient_id} original image`, `${item.patient_id} 원본 이미지`),
                          src: item.original_preview_url,
                          fallback: pick(locale, "Original unavailable", "원본 미리보기가 없습니다."),
                        },
                        {
                          label: pick(locale, "Cornea crop", "각막 crop"),
                          alt: pick(locale, `${item.patient_id} cornea crop`, `${item.patient_id} 각막 crop`),
                          src: item.roi_preview_url,
                          fallback: pick(locale, "Cornea crop unavailable", "각막 crop 미리보기가 없습니다."),
                        },
                        {
                          label: pick(locale, "Grad-CAM", "Grad-CAM"),
                          alt: pick(locale, `${item.patient_id} Grad-CAM`, `${item.patient_id} Grad-CAM`),
                          src: item.gradcam_preview_url,
                          fallback: pick(locale, "Grad-CAM unavailable", "Grad-CAM 미리보기가 없습니다."),
                        },
                      ].map((preview) => (
                        <Card key={preview.label} as="div" variant="nested" className="overflow-hidden">
                          {preview.src ? (
                            <img src={preview.src} alt={preview.alt} className="aspect-[1.08] w-full object-cover" />
                          ) : (
                            <div className="flex aspect-[1.08] items-center justify-center px-4 text-center text-sm text-muted">
                              {preview.fallback}
                            </div>
                          )}
                          <div className="border-t border-border px-3 py-2.5 text-sm font-medium text-ink">
                            {preview.label}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <EmptyState>
          {pick(locale, "Select a hospital to open the advanced dashboard.", "고급 대시보드를 열려면 병원을 선택하세요.")}
        </EmptyState>
      )}
    </Card>
  );
}
