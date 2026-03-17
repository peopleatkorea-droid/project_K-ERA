"use client";

import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  docBadgeRowClass,
  docSectionHeadClass,
  docSectionLabelClass,
  emptySurfaceClass,
  panelImageFallbackClass,
  panelMetricGridClass,
  validationPanelActionsClass,
  validationPanelHeadClass,
  validationPanelIdClass,
  validationRunButtonClass,
} from "../ui/workspace-patterns";
import type { CaseValidationResponse, CaseValidationCompareResponse, ModelVersionRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  common: { notAvailable: string };
  validationResult: CaseValidationResponse | null;
  validationBusy: boolean;
  canRunValidation: boolean;
  hasSelectedCase: boolean;
  validationConfidence: number;
  validationConfidenceTone: "high" | "medium" | "low";
  validationPredictedConfidence: number | null;
  onRunValidation: () => void;
  artifactContent: ReactNode;
  modelCompareBusy: boolean;
  selectedCompareModelVersionIds: string[];
  compareModelCandidates: ModelVersionRecord[];
  onToggleModelVersion: (versionId: string, checked: boolean) => void;
  onRunModelCompare: () => void;
  modelCompareResult: CaseValidationCompareResponse | null;
  formatProbability: (value: number | null | undefined, emptyLabel?: string) => string;
};

function toneClass(tone: "high" | "medium" | "low" | "neutral" | "match" | "mismatch"): string {
  switch (tone) {
    case "high":
    case "match":
      return "border-emerald-500/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "medium":
      return "border-amber-500/15 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "low":
    case "mismatch":
      return "border-rose-500/15 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    default:
      return "border-border bg-surface-muted text-muted";
  }
}

export function ValidationPanel({
  locale,
  common,
  validationResult,
  validationBusy,
  canRunValidation,
  hasSelectedCase,
  validationConfidence,
  validationConfidenceTone,
  validationPredictedConfidence,
  onRunValidation,
  artifactContent,
  modelCompareBusy,
  selectedCompareModelVersionIds,
  compareModelCandidates,
  onToggleModelVersion,
  onRunModelCompare,
  modelCompareResult,
  formatProbability,
}: Props) {
  const validationModelLabel =
    validationResult?.model_version.ensemble_mode === "weighted_average" &&
    validationResult.model_version.architecture === "multi_model_ensemble"
      ? pick(locale, "5-model ensemble", "5모델 ensemble")
      : validationResult?.model_version.architecture ?? common.notAvailable;
  const successfulComparisons = (modelCompareResult?.comparisons ?? []).filter(
    (item): item is NonNullable<typeof modelCompareResult>["comparisons"][number] & { summary: NonNullable<NonNullable<typeof modelCompareResult>["comparisons"][number]["summary"]> } =>
      Boolean(item.summary && !item.error)
  );
  const consensusCounts = successfulComparisons.reduce<Record<string, number>>((accumulator, item) => {
    const label = item.summary.predicted_label ?? "unknown";
    accumulator[label] = (accumulator[label] ?? 0) + 1;
    return accumulator;
  }, {});
  const consensusRankedLabels = Object.entries(consensusCounts).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
  const consensusTop = consensusRankedLabels[0] ?? null;
  const consensusSecond = consensusRankedLabels[1] ?? null;
  const consensusAgreementPercent =
    consensusTop && successfulComparisons.length > 0
      ? Math.round((consensusTop[1] / successfulComparisons.length) * 100)
      : null;
  const consensusLabel =
    consensusTop == null
      ? null
      : consensusSecond && consensusSecond[1] === consensusTop[1]
        ? pick(locale, "Split decision", "의견 분산")
        : consensusTop[0];
  const probabilityValues = successfulComparisons
    .map((item) => item.summary.prediction_probability)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const consensusProbability =
    probabilityValues.length > 0
      ? probabilityValues.reduce((total, value) => total + value, 0) / probabilityValues.length
      : null;

  return (
    <>
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={validationPanelHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Validation", "검증")}</div>}
          title={pick(locale, "Validation insight", "검증 인사이트")}
          titleAs="h4"
          description={pick(
            locale,
            "Run case-level validation to generate the saved prediction, crop artifacts, and reviewable confidence signals.",
            "케이스 단위 검증을 실행하면 저장 가능한 예측 결과와 crop artifact, 신뢰도 신호가 함께 생성됩니다."
          )}
          aside={
            <div className={validationPanelActionsClass}>
              <span className={validationPanelIdClass}>
                {validationResult ? validationResult.summary.validation_id : pick(locale, "Not run yet", "아직 실행 안 됨")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={validationRunButtonClass}
                onClick={onRunValidation}
                disabled={validationBusy || !hasSelectedCase || !canRunValidation}
              >
                {validationBusy ? pick(locale, "Validating...", "검증 중...") : pick(locale, "Run AI validation", "AI 검증 실행")}
              </Button>
            </div>
          }
        />

        {validationResult ? (
          <div className="grid gap-4">
            <div className="rounded-[22px] border border-border bg-surface-muted/80 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                    validationResult.summary.is_correct ? "match" : "mismatch"
                  )}`}
                >
                  {validationResult.summary.is_correct ? pick(locale, "Match", "일치") : pick(locale, "Mismatch", "불일치")}
                </span>
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                    validationConfidenceTone
                  )}`}
                >
                  {validationConfidence}% {pick(locale, "confidence", "신뢰도")}
                </span>
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                    "neutral"
                  )}`}
                >
                  {validationResult.execution_device}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                  <span className="block text-xs uppercase tracking-[0.08em] text-muted">
                    {pick(locale, "Predicted", "예측")}
                  </span>
                  <strong className="mt-2 block text-lg font-semibold text-ink">
                    {validationResult.summary.predicted_label}
                  </strong>
                </div>
                <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                  <span className="block text-xs uppercase tracking-[0.08em] text-muted">
                    {pick(locale, "Culture label", "배양 라벨")}
                  </span>
                  <strong className="mt-2 block text-lg font-semibold text-ink">
                    {validationResult.summary.true_label}
                  </strong>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{pick(locale, "Model confidence", "모델 신뢰도")}</span>
                <strong className="text-ink">
                  {formatProbability(validationPredictedConfidence, common.notAvailable)}
                </strong>
              </div>

              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${
                    validationConfidenceTone === "high"
                      ? "bg-emerald-500"
                      : validationConfidenceTone === "medium"
                        ? "bg-amber-500"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${validationConfidence}%` }}
                />
              </div>
            </div>

            <MetricGrid className={panelMetricGridClass}>
              <MetricItem value={validationResult.summary.predicted_label} label={pick(locale, "predicted", "예측값")} />
              <MetricItem value={validationResult.summary.true_label} label={pick(locale, "culture label", "배양 라벨")} />
              <MetricItem
                value={formatProbability(validationPredictedConfidence, common.notAvailable)}
                label={pick(locale, "confidence", "신뢰도")}
              />
              <MetricItem value={validationResult.execution_device} label={pick(locale, "device", "디바이스")} />
            </MetricGrid>

            <p className="m-0 text-sm leading-6 text-muted">
              {pick(locale, "Model", "모델")} {validationResult.model_version.version_name} (
              {validationModelLabel}){" "}
              {validationResult.model_version.crop_mode
                ? pick(locale, `mode ${validationResult.model_version.crop_mode}`, `모드 ${validationResult.model_version.crop_mode}`)
                : null}
              {validationResult.model_version.crop_mode ? " · " : ""}
              {validationResult.summary.is_correct
                ? pick(locale, "prediction matched culture", "예측이 배양 결과와 일치합니다.")
                : pick(locale, "prediction diverged from culture", "예측이 배양 결과와 다릅니다.")}
            </p>

            {artifactContent}
          </div>
        ) : (
          <div className={emptySurfaceClass}>
            {pick(
              locale,
              "Run validation from this panel to generate crop artifacts, Grad-CAM, and a saved case-level prediction.",
              "이 패널에서 검증을 실행하면 crop artifact, Grad-CAM, 저장 가능한 케이스 단위 예측이 생성됩니다."
            )}
          </div>
        )}
      </Card>

      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Comparison", "비교")}</div>}
          title={pick(locale, "Multi-model analysis", "다중 모델 분석")}
          titleAs="h4"
          description={pick(
            locale,
            "AI validation refreshes this section with the selected latest models by default. You can keep or adjust the selection and re-run it anytime.",
            "AI 검증을 실행하면 이 섹션도 기본 선택된 최신 모델들로 함께 갱신됩니다. 필요하면 선택을 조정해 다시 실행할 수 있습니다."
          )}
          aside={
            <Button
              variant="ghost"
              type="button"
              onClick={onRunModelCompare}
              disabled={modelCompareBusy || !hasSelectedCase || selectedCompareModelVersionIds.length === 0}
            >
              {modelCompareBusy ? pick(locale, "Comparing...", "비교 중...") : pick(locale, "Compare selected models", "선택 모델 비교")}
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2">
          {compareModelCandidates.map((modelVersion) => {
            const isActive = selectedCompareModelVersionIds.includes(modelVersion.version_id);
            return (
              <label
                key={modelVersion.version_id}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-brand/20 bg-brand-soft text-brand"
                    : "border-border bg-surface text-muted hover:text-ink"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isActive}
                  onChange={(event) => onToggleModelVersion(modelVersion.version_id, event.target.checked)}
                />
                <span>{modelVersion.architecture}</span>
              </label>
            );
          })}
        </div>

        {modelCompareResult ? (
          <div className="grid gap-4">
            {successfulComparisons.length > 1 ? (
              <Card as="article" variant="nested" className="grid gap-3 p-4">
                <SectionHeader
                  className={docSectionHeadClass}
                  title={pick(locale, "Consensus snapshot", "합의 요약")}
                  titleAs="h4"
                  description={pick(
                    locale,
                    "A quick readout from the currently selected multi-model analysis.",
                    "현재 선택된 다중 모델 분석 결과를 빠르게 요약한 값입니다."
                  )}
                  aside={
                    <span
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                        consensusAgreementPercent !== null && consensusAgreementPercent >= 80
                          ? "high"
                          : consensusAgreementPercent !== null && consensusAgreementPercent >= 60
                            ? "medium"
                            : "low"
                      )}`}
                    >
                      {consensusAgreementPercent !== null
                        ? `${consensusAgreementPercent}% ${pick(locale, "agreement", "일치율")}`
                        : common.notAvailable}
                    </span>
                  }
                />
                <MetricGrid columns={4}>
                  <MetricItem value={String(successfulComparisons.length)} label={pick(locale, "models run", "실행 모델 수")} />
                  <MetricItem value={consensusLabel ?? common.notAvailable} label={pick(locale, "leading label", "우세 라벨")} />
                  <MetricItem
                    value={consensusTop ? `${consensusTop[1]} / ${successfulComparisons.length}` : common.notAvailable}
                    label={pick(locale, "vote", "득표")}
                  />
                  <MetricItem
                    value={formatProbability(consensusProbability, common.notAvailable)}
                    label={pick(locale, "avg fungal prob", "평균 진균 확률")}
                  />
                </MetricGrid>
              </Card>
            ) : null}
            {modelCompareResult.comparisons.map((item, index) => {
              const validationTone = item.summary?.is_correct == null ? "neutral" : item.summary.is_correct ? "match" : "mismatch";
              const validationLabel =
                item.summary?.is_correct == null
                  ? pick(locale, "Pending", "대기 중")
                  : item.summary.is_correct
                    ? pick(locale, "Match", "일치")
                    : pick(locale, "Mismatch", "불일치");
              return (
                <Card
                  key={item.model_version?.version_id ?? item.model_version_id ?? `compare-${index}`}
                  as="article"
                  variant="nested"
                  className="grid gap-3 p-4"
                >
                  <SectionHeader
                    className={docSectionHeadClass}
                    title={item.model_version?.version_name ?? item.model_version?.architecture ?? item.model_version_id ?? common.notAvailable}
                    titleAs="h4"
                    description={pick(locale, "Model comparison snapshot for the selected saved case.", "선택된 저장 케이스에 대한 모델 비교 스냅샷입니다.")}
                    aside={
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral"
                          )}`}
                        >
                          {item.model_version?.architecture ?? common.notAvailable}
                        </span>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            validationTone
                          )}`}
                        >
                          {pick(locale, "Validation", "검증")} {validationLabel}
                        </span>
                      </div>
                    }
                  />
                  {item.error ? (
                    <div className={panelImageFallbackClass}>{item.error}</div>
                  ) : (
                    <>
                      <MetricGrid columns={4}>
                        <MetricItem value={item.summary?.predicted_label ?? common.notAvailable} label={pick(locale, "Predicted", "예측")} />
                        <MetricItem value={item.summary?.true_label ?? common.notAvailable} label={pick(locale, "Culture", "배양")} />
                        <MetricItem
                          value={formatProbability(item.summary?.prediction_probability, common.notAvailable)}
                          label={pick(locale, "Confidence", "신뢰도")}
                        />
                        <MetricItem value={item.summary?.validation_id ?? common.notAvailable} label={pick(locale, "Validation ID", "Validation ID")} />
                      </MetricGrid>
                      <div className={docBadgeRowClass}>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral"
                          )}`}
                        >
                          {pick(locale, "Crop", "Crop")} {item.model_version?.crop_mode ?? common.notAvailable}
                        </span>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral"
                          )}`}
                        >
                          {pick(locale, "Artifacts", "Artifacts")}{" "}
                          {item.artifact_availability?.gradcam ? "Grad-CAM" : pick(locale, "compare-only", "비교 전용")}
                        </span>
                      </div>
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        ) : null}
      </Card>
    </>
  );
}
