"use client";

import { memo, type ReactNode } from "react";

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
import type {
  CaseValidationResponse,
  CaseValidationCompareResponse,
  ModelVersionRecord,
} from "../../lib/api";
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
  formatProbability: (
    value: number | null | undefined,
    emptyLabel?: string,
  ) => string;
};

function toneClass(
  tone: "high" | "medium" | "low" | "neutral" | "match" | "mismatch",
): string {
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

function postMortemOutcomeLabel(
  locale: Locale,
  outcome: string | null | undefined,
): string {
  switch (
    String(outcome || "")
      .trim()
      .toLowerCase()
  ) {
    case "correct":
      return pick(locale, "Correct", "정답");
    case "incorrect":
      return pick(locale, "Incorrect", "오답");
    default:
      return pick(locale, "Unknown", "미확정");
  }
}

function postMortemSignalLabel(
  locale: Locale,
  signal: string | null | undefined,
): string {
  switch (
    String(signal || "")
      .trim()
      .toLowerCase()
  ) {
    case "hard_case_priority":
      return pick(locale, "Hard-case priority", "하드 케이스 우선");
    case "boundary_case_review":
      return pick(locale, "Boundary-case review", "경계 케이스 검토");
    case "low_quality_watch":
      return pick(locale, "Low-quality watch", "저품질 입력 주의");
    case "collect_more_reference_cases":
      return pick(locale, "Collect more references", "참조 케이스 추가 수집");
    case "label_review_or_multilabel_watch":
      return pick(locale, "Label / polymicrobial review", "라벨 / 다균종 검토");
    case "retain_as_reference":
      return pick(locale, "Reference case", "참조 케이스");
    case "correct_but_low_margin":
      return pick(locale, "Low-margin correct", "저여유 정답");
    default:
      return (
        String(signal || "")
          .trim()
          .replaceAll("_", " ") || pick(locale, "Unknown", "미확정")
      );
  }
}

function postMortemRootCauseLabel(
  locale: Locale,
  code: string | null | undefined,
): string {
  switch (
    String(code || "")
      .trim()
      .toLowerCase()
  ) {
    case "shortcut_suspected":
      return pick(locale, "Shortcut suspected", "shortcut 의심");
    case "domain_shift":
      return pick(locale, "Domain shift", "도메인 시프트");
    case "label_review_needed":
      return pick(locale, "Label review", "라벨 재검토");
    case "natural_boundary":
      return pick(locale, "Boundary case", "경계 케이스");
    case "low_quality":
      return pick(locale, "Low quality", "저품질 입력");
    case "data_sparse":
      return pick(locale, "Data sparse", "희소 데이터");
    default:
      return (
        String(code || "")
          .trim()
          .replaceAll("_", " ") || pick(locale, "Unknown", "미확정")
      );
  }
}

function postMortemActionLabel(
  locale: Locale,
  code: string | null | undefined,
): string {
  switch (
    String(code || "")
      .trim()
      .toLowerCase()
  ) {
    case "hard_case_train":
      return pick(locale, "Hard-case train", "하드케이스 학습");
    case "collect_more_cases":
      return pick(locale, "Collect more cases", "케이스 추가 수집");
    case "exclude_from_train":
      return pick(locale, "Exclude from train", "학습 제외");
    case "site_weight_watch":
      return pick(locale, "Site weight watch", "사이트 가중치 관찰");
    case "human_review":
      return pick(locale, "Human review", "사람 검토");
    default:
      return (
        String(code || "")
          .trim()
          .replaceAll("_", " ") || pick(locale, "Unknown", "미확정")
      );
  }
}

function formatRatio(
  value: number | null | undefined,
  emptyLabel: string,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return emptyLabel;
  }
  return `${Math.round(value * 100)}%`;
}

function formatScore(
  value: number | null | undefined,
  emptyLabel: string,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return emptyLabel;
  }
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function isInferenceOnlyValidation(
  validationMode: string | null | undefined,
  trueLabel: string | null | undefined,
): boolean {
  return (
    String(validationMode || "")
      .trim()
      .toLowerCase() === "inference_only" || trueLabel == null
  );
}

function ValidationPanelInner({
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
  const ensembleComponentCount =
    validationResult?.model_version.component_model_version_ids?.length ?? 0;
  const postMortem = validationResult?.post_mortem ?? null;
  const attentionScores =
    validationResult?.case_prediction?.instance_attention_scores ?? [];
  const topAttention = attentionScores.reduce<{
    image_path: string;
    source_image_path: string;
    view?: string | null;
    attention: number;
  } | null>(
    (current, item) =>
      current == null || item.attention > current.attention ? item : current,
    null,
  );
  const structuredAnalysis = postMortem?.structured_analysis ?? null;
  const structuredScores = structuredAnalysis?.scores ?? null;
  const predictionSnapshot =
    structuredAnalysis?.prediction_snapshot ??
    validationResult?.case_prediction?.prediction_snapshot ??
    null;
  const peerConsensus =
    structuredAnalysis?.peer_model_consensus ??
    predictionSnapshot?.peer_model_consensus ??
    null;
  const validationModelLabel =
    validationResult?.model_version.ensemble_mode === "weighted_average" &&
    validationResult.model_version.architecture === "multi_model_ensemble"
      ? pick(
          locale,
          `${Math.max(ensembleComponentCount, 1)}-model ensemble`,
          `${Math.max(ensembleComponentCount, 1)}모델 ensemble`,
        )
      : (validationResult?.model_version.architecture ?? common.notAvailable);
  const successfulComparisons = (modelCompareResult?.comparisons ?? []).filter(
    (
      item,
    ): item is NonNullable<typeof modelCompareResult>["comparisons"][number] & {
      summary: NonNullable<
        NonNullable<typeof modelCompareResult>["comparisons"][number]["summary"]
      >;
    } => Boolean(item.summary && !item.error),
  );
  const consensusCounts = successfulComparisons.reduce<Record<string, number>>(
    (accumulator, item) => {
      const label = item.summary.predicted_label ?? "unknown";
      accumulator[label] = (accumulator[label] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const consensusRankedLabels = Object.entries(consensusCounts).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
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
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  const consensusProbability =
    probabilityValues.length > 0
      ? probabilityValues.reduce((total, value) => total + value, 0) /
        probabilityValues.length
      : null;
  const inferenceOnlyValidation = isInferenceOnlyValidation(
    validationResult?.summary.validation_mode,
    validationResult?.summary.true_label,
  );
  const predictedLabelTitle = inferenceOnlyValidation
    ? pick(locale, "Pattern support", "패턴 지지")
    : pick(locale, "Predicted", "예측");
  const predictionConfidenceTitle = inferenceOnlyValidation
    ? pick(locale, "Support score", "지지 점수")
    : pick(locale, "Model confidence", "모델 신뢰도");
  const cultureLabelPlaceholder = inferenceOnlyValidation
    ? pick(locale, "Unavailable for inference-only analysis", "추론 전용 분석에서는 제공되지 않음")
    : pick(locale, "Pending or unrecorded", "미확정 또는 미기록");

  return (
    <>
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={validationPanelHeadClass}
          eyebrow={
            <div className={docSectionLabelClass}>
              {pick(locale, "Validation", "검증")}
            </div>
          }
          title={pick(locale, "Validation insight", "검증 인사이트")}
          titleAs="h4"
          description={pick(
            locale,
            "Run case-level validation to generate the saved prediction, crop artifacts, and reviewable confidence signals.",
            "케이스 단위 검증을 실행하면 저장 가능한 예측 결과와 crop artifact, 신뢰도 신호가 함께 생성됩니다.",
          )}
          aside={
            <div className={validationPanelActionsClass}>
              <span className={validationPanelIdClass}>
                {validationResult
                  ? validationResult.summary.validation_id
                  : pick(locale, "Not run yet", "아직 실행 안 됨")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={validationRunButtonClass}
                onClick={onRunValidation}
                disabled={
                  validationBusy || !hasSelectedCase || !canRunValidation
                }
              >
                {validationBusy
                  ? pick(locale, "Validating...", "검증 중...")
                  : pick(locale, "Run AI validation", "AI 검증 실행")}
              </Button>
            </div>
          }
        />

        {validationResult ? (
          <div className="grid gap-4">
            <div className="rounded-[22px] border border-border bg-surface-muted/80 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {!inferenceOnlyValidation ? (
                  <span
                    className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                      validationResult.summary.is_correct ? "match" : "mismatch",
                    )}`}
                  >
                    {validationResult.summary.is_correct
                      ? pick(locale, "Match", "일치")
                      : pick(locale, "Mismatch", "불일치")}
                  </span>
                ) : null}
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                    validationConfidenceTone,
                  )}`}
                >
                  {validationConfidence}% {pick(locale, "confidence", "신뢰도")}
                </span>
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                    "neutral",
                  )}`}
                >
                  {validationResult.execution_device}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                  <span className="block text-xs uppercase tracking-[0.08em] text-muted">
                    {predictedLabelTitle}
                  </span>
                  <strong className="mt-2 block text-lg font-semibold text-ink">
                    {validationResult.summary.predicted_label}
                  </strong>
                </div>
                {!inferenceOnlyValidation ? (
                  <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                    <span className="block text-xs uppercase tracking-[0.08em] text-muted">
                      {pick(locale, "Culture label", "배양 라벨")}
                    </span>
                    <strong className="mt-2 block text-lg font-semibold text-ink">
                      {validationResult.summary.true_label}
                    </strong>
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-border bg-dashed bg-surface-muted/30 px-4 py-3">
                    <span className="block text-xs uppercase tracking-[0.08em] text-muted">
                      {pick(locale, "Culture label", "배양 라벨")}
                    </span>
                    <strong className="mt-2 block text-sm font-medium text-muted">
                      {cultureLabelPlaceholder}
                    </strong>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">
                  {predictionConfidenceTitle}
                </span>
                <strong className="text-ink">
                  {formatProbability(
                    validationPredictedConfidence,
                    common.notAvailable,
                  )}
                </strong>
              </div>

              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand/10"
                aria-hidden="true"
              >
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
              <MetricItem
                value={validationResult.summary.predicted_label}
                label={predictedLabelTitle}
              />
              <MetricItem
                value={
                  inferenceOnlyValidation
                    ? cultureLabelPlaceholder
                    : validationResult.summary.true_label
                }
                label={pick(locale, "culture label", "배양 라벨")}
              />
              <MetricItem
                value={formatProbability(
                  validationPredictedConfidence,
                  common.notAvailable,
                )}
                label={
                  inferenceOnlyValidation
                    ? pick(locale, "support score", "지지 점수")
                    : pick(locale, "confidence", "신뢰도")
                }
              />
              <MetricItem
                value={validationResult.execution_device}
                label={pick(locale, "device", "디바이스")}
              />
              <MetricItem
                value={
                  validationResult.summary.case_aggregation ??
                  validationResult.model_version.case_aggregation ??
                  common.notAvailable
                }
                label={pick(locale, "visit aggregation", "visit 집계")}
              />
              <MetricItem
                value={
                  topAttention
                    ? `${Math.round(topAttention.attention * 100)}%`
                    : common.notAvailable
                }
                label={pick(locale, "top attention", "최고 attention")}
              />
            </MetricGrid>

            <p className="m-0 text-sm leading-6 text-muted">
              {pick(locale, "Model", "모델")}{" "}
              {validationResult.model_version.version_name} (
              {validationModelLabel}){" "}
              {validationResult.model_version.crop_mode
                ? pick(
                    locale,
                    `mode ${validationResult.model_version.crop_mode}`,
                    `모드 ${validationResult.model_version.crop_mode}`,
                  )
                : null}
              {validationResult.model_version.crop_mode ? " · " : ""}
              {(validationResult.summary.case_aggregation ??
              validationResult.model_version.case_aggregation)
                ? `${pick(locale, "aggregation", "집계")} ${
                    validationResult.summary.case_aggregation ??
                    validationResult.model_version.case_aggregation
                  } · `
                : ""}
              {inferenceOnlyValidation
                ? pick(
                    locale,
                    `${validationResult.summary.predicted_label} pattern support was estimated without a recorded culture label.`,
                    `기록된 배양 라벨 없이 ${validationResult.summary.predicted_label} 패턴 지지도를 추정한 결과입니다.`,
                  )
                : validationResult.summary.is_correct
                  ? pick(
                      locale,
                      "prediction matched culture",
                      "예측이 배양 결과와 일치합니다.",
                    )
                  : pick(
                      locale,
                      "prediction diverged from culture",
                      "예측이 배양 결과와 다릅니다.",
                    )}
            </p>

            {artifactContent}

            {postMortem ? (
              <Card
                as="div"
                variant="nested"
                className="grid gap-4 border border-border/80 p-4"
              >
                <SectionHeader
                  title={pick(
                    locale,
                    "Prediction post-mortem",
                    "예측 post-mortem",
                  )}
                  titleAs="h4"
                  description={pick(
                    locale,
                    "A structured review of why this prediction likely matched or missed the culture label.",
                    "이 예측이 왜 배양 라벨과 맞았거나 어긋났는지 구조화해 다시 정리한 결과입니다.",
                  )}
                  className={docSectionHeadClass}
                  aside={
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                          postMortem.outcome === "correct"
                            ? "match"
                            : postMortem.outcome === "incorrect"
                              ? "mismatch"
                              : "neutral",
                        )}`}
                      >
                        {postMortemOutcomeLabel(locale, postMortem.outcome)}
                      </span>
                      <span
                        className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                          "neutral",
                        )}`}
                      >
                        {postMortem.mode}
                      </span>
                    </div>
                  }
                />

                <MetricGrid columns={3}>
                  <MetricItem
                    value={postMortem.model ?? common.notAvailable}
                    label={pick(locale, "LLM model", "LLM 모델")}
                  />
                  <MetricItem
                    value={postMortem.generated_at ?? common.notAvailable}
                    label={pick(locale, "Generated", "생성 시각")}
                  />
                  <MetricItem
                    value={postMortemSignalLabel(
                      locale,
                      postMortem.learning_signal,
                    )}
                    label={pick(locale, "Learning signal", "학습 신호")}
                  />
                </MetricGrid>

                {predictionSnapshot ? (
                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-4 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(locale, "Prediction snapshot", "예측 스냅샷")}
                      titleAs="h4"
                      description={pick(
                        locale,
                        "Signals captured at prediction time before the post-mortem summary was generated.",
                        "post-mortem 요약을 만들기 전에 예측 시점에서 저장한 핵심 신호입니다.",
                      )}
                      className={docSectionHeadClass}
                    />
                    <MetricGrid columns={4}>
                      <MetricItem
                        value={formatProbability(
                          predictionSnapshot.prediction_probability,
                          common.notAvailable,
                        )}
                        label={pick(locale, "raw probability", "원시 확률")}
                      />
                      <MetricItem
                        value={formatRatio(
                          predictionSnapshot.predicted_confidence,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "predicted confidence",
                          "예측 신뢰도",
                        )}
                      />
                      <MetricItem
                        value={
                          predictionSnapshot.crop_mode ?? common.notAvailable
                        }
                        label={pick(locale, "crop mode", "crop 모드")}
                      />
                      <MetricItem
                        value={formatScore(
                          predictionSnapshot.representative_quality_score,
                          common.notAvailable,
                        )}
                        label={pick(locale, "Q-score", "Q-score")}
                      />
                    </MetricGrid>
                    <MetricGrid columns={3}>
                      <MetricItem
                        value={
                          predictionSnapshot.classifier_embedding
                            ?.embedding_id ?? common.notAvailable
                        }
                        label={pick(
                          locale,
                          "classifier embedding",
                          "classifier embedding",
                        )}
                      />
                      <MetricItem
                        value={
                          predictionSnapshot.dinov2_embedding?.embedding_id ??
                          common.notAvailable
                        }
                        label={pick(
                          locale,
                          "DINOv2 embedding",
                          "DINOv2 embedding",
                        )}
                      />
                      <MetricItem
                        value={formatRatio(
                          peerConsensus?.disagreement_score,
                          common.notAvailable,
                        )}
                        label={pick(locale, "peer disagreement", "모델 불일치")}
                      />
                    </MetricGrid>
                    <MetricGrid columns={4}>
                      <MetricItem
                        value={
                          predictionSnapshot.gradcam_cornea_path
                            ? pick(locale, "Available", "있음")
                            : predictionSnapshot.gradcam_path
                              ? pick(locale, "Legacy only", "기존 단일 CAM")
                              : common.notAvailable
                        }
                        label={pick(locale, "cornea CAM", "각막 CAM")}
                      />
                      <MetricItem
                        value={
                          predictionSnapshot.gradcam_lesion_path
                            ? pick(locale, "Available", "있음")
                            : common.notAvailable
                        }
                        label={pick(locale, "lesion CAM", "병변 CAM")}
                      />
                      <MetricItem
                        value={
                          predictionSnapshot.roi_crop_path
                            ? pick(locale, "Available", "있음")
                            : common.notAvailable
                        }
                        label={pick(locale, "cornea crop", "각막 crop")}
                      />
                      <MetricItem
                        value={
                          predictionSnapshot.lesion_crop_path
                            ? pick(locale, "Available", "있음")
                            : common.notAvailable
                        }
                        label={pick(locale, "lesion crop", "병변 crop")}
                      />
                    </MetricGrid>
                  </Card>
                ) : null}

                {structuredAnalysis && structuredScores ? (
                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-4 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(locale, "Structured analysis", "구조화 분석")}
                      titleAs="h4"
                      description={pick(
                        locale,
                        "Stored numeric scores, root-cause tags, and follow-up actions derived before the human-readable summary.",
                        "사람용 요약 이전 단계에서 계산된 수치 점수, 원인 태그, 후속 액션입니다.",
                      )}
                      className={docSectionHeadClass}
                    />
                    <MetricGrid columns={4}>
                      <MetricItem
                        value={formatRatio(
                          structuredScores.cam_overlap_score,
                          common.notAvailable,
                        )}
                        label={pick(locale, "CAM overlap", "CAM overlap")}
                      />
                      <MetricItem
                        value={formatRatio(
                          structuredScores.cam_cornea_overlap_score,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "Cornea CAM overlap",
                          "각막 CAM overlap",
                        )}
                      />
                      <MetricItem
                        value={formatRatio(
                          structuredScores.cam_lesion_overlap_score,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "Lesion CAM overlap",
                          "병변 CAM overlap",
                        )}
                      />
                      <MetricItem
                        value={formatRatio(
                          structuredScores.dino_true_label_purity,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "DINO true purity",
                          "DINO 정답 purity",
                        )}
                      />
                      <MetricItem
                        value={formatScore(
                          structuredScores.dino_mean_distance,
                          common.notAvailable,
                        )}
                        label={pick(locale, "DINO distance", "DINO 거리")}
                      />
                      <MetricItem
                        value={formatRatio(
                          structuredScores.multi_model_disagreement,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "model disagreement",
                          "모델 불일치",
                        )}
                      />
                      <MetricItem
                        value={formatScore(
                          structuredScores.image_quality_score,
                          common.notAvailable,
                        )}
                        label={pick(locale, "image quality", "이미지 품질")}
                      />
                      <MetricItem
                        value={formatRatio(
                          structuredScores.site_error_concentration,
                          common.notAvailable,
                        )}
                        label={pick(
                          locale,
                          "site concentration",
                          "사이트 집중도",
                        )}
                      />
                      <MetricItem
                        value={String(
                          structuredScores.similar_case_count ??
                            common.notAvailable,
                        )}
                        label={pick(locale, "similar cases", "유사 케이스")}
                      />
                      <MetricItem
                        value={String(
                          structuredScores.text_evidence_count ??
                            common.notAvailable,
                        )}
                        label={pick(locale, "text evidence", "텍스트 근거")}
                      />
                    </MetricGrid>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card as="div" variant="panel" className="grid gap-3 p-4">
                        <SectionHeader
                          title={pick(locale, "Root-cause tags", "원인 태그")}
                          titleAs="h4"
                          className={docSectionHeadClass}
                        />
                        <div className="flex flex-wrap gap-2">
                          {structuredAnalysis.root_cause_tags.length > 0 ? (
                            structuredAnalysis.root_cause_tags.map((tag) => (
                              <span
                                key={tag}
                                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass("mismatch")}`}
                              >
                                {postMortemRootCauseLabel(locale, tag)}
                              </span>
                            ))
                          ) : (
                            <div className={panelImageFallbackClass}>
                              {common.notAvailable}
                            </div>
                          )}
                        </div>
                      </Card>

                      <Card as="div" variant="panel" className="grid gap-3 p-4">
                        <SectionHeader
                          title={pick(locale, "Action tags", "액션 태그")}
                          titleAs="h4"
                          className={docSectionHeadClass}
                        />
                        <div className="flex flex-wrap gap-2">
                          {structuredAnalysis.action_tags.length > 0 ? (
                            structuredAnalysis.action_tags.map((tag) => (
                              <span
                                key={tag}
                                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass("medium")}`}
                              >
                                {postMortemActionLabel(locale, tag)}
                              </span>
                            ))
                          ) : (
                            <div className={panelImageFallbackClass}>
                              {common.notAvailable}
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>

                    {peerConsensus ? (
                      <Card as="div" variant="panel" className="grid gap-3 p-4">
                        <SectionHeader
                          title={pick(
                            locale,
                            "Peer-model consensus",
                            "peer-model 합의",
                          )}
                          titleAs="h4"
                          className={docSectionHeadClass}
                          description={pick(
                            locale,
                            "Cross-model comparison reused as an ambiguity signal for this case.",
                            "이 케이스의 애매함을 보기 위해 재사용한 다중 모델 비교 신호입니다.",
                          )}
                        />
                        <MetricGrid columns={4}>
                          <MetricItem
                            value={String(
                              peerConsensus.models_evaluated ??
                                common.notAvailable,
                            )}
                            label={pick(locale, "models", "모델 수")}
                          />
                          <MetricItem
                            value={
                              peerConsensus.leading_label ?? common.notAvailable
                            }
                            label={pick(locale, "leading label", "우세 라벨")}
                          />
                          <MetricItem
                            value={formatRatio(
                              peerConsensus.agreement_rate,
                              common.notAvailable,
                            )}
                            label={pick(locale, "agreement", "합의율")}
                          />
                          <MetricItem
                            value={formatScore(
                              peerConsensus.vote_entropy,
                              common.notAvailable,
                            )}
                            label={pick(
                              locale,
                              "vote entropy",
                              "의견 엔트로피",
                            )}
                          />
                        </MetricGrid>
                      </Card>
                    ) : null}
                  </Card>
                ) : null}

                {postMortem.llm_error ? (
                  <div className={panelImageFallbackClass}>
                    {pick(
                      locale,
                      `LLM generation failed and the local fallback post-mortem was used instead. ${postMortem.llm_error}`,
                      `LLM 생성에 실패하여 로컬 fallback post-mortem을 사용했습니다. ${postMortem.llm_error}`,
                    )}
                  </div>
                ) : null}

                <Card as="div" variant="panel" className="grid gap-3 p-4">
                  <SectionHeader
                    title={pick(locale, "Summary", "요약")}
                    titleAs="h4"
                    className={docSectionHeadClass}
                  />
                  <p className="m-0 text-sm leading-6 text-muted">
                    {postMortem.summary}
                  </p>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-3 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(locale, "Likely factors", "가능한 요인")}
                      titleAs="h4"
                      className={docSectionHeadClass}
                    />
                    <div className="grid gap-3">
                      {postMortem.likely_causes.length > 0 ? (
                        postMortem.likely_causes.map((entry, index) => (
                          <Card
                            key={`postmortem-cause-${index}`}
                            as="article"
                            variant="panel"
                            className="p-4"
                          >
                            <p className="m-0 text-sm leading-6 text-muted">
                              {entry}
                            </p>
                          </Card>
                        ))
                      ) : (
                        <div className={panelImageFallbackClass}>
                          {common.notAvailable}
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-3 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(locale, "Follow-up actions", "후속 조치")}
                      titleAs="h4"
                      className={docSectionHeadClass}
                    />
                    <div className="grid gap-3">
                      {postMortem.follow_up_actions.length > 0 ? (
                        postMortem.follow_up_actions.map((entry, index) => (
                          <Card
                            key={`postmortem-action-${index}`}
                            as="article"
                            variant="panel"
                            className="p-4"
                          >
                            <p className="m-0 text-sm leading-6 text-muted">
                              {entry}
                            </p>
                          </Card>
                        ))
                      ) : (
                        <div className={panelImageFallbackClass}>
                          {common.notAvailable}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-3 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(locale, "Supporting evidence", "지지 신호")}
                      titleAs="h4"
                      className={docSectionHeadClass}
                    />
                    <div className="grid gap-3">
                      {postMortem.supporting_evidence.length > 0 ? (
                        postMortem.supporting_evidence.map((entry, index) => (
                          <Card
                            key={`postmortem-support-${index}`}
                            as="article"
                            variant="panel"
                            className="p-4"
                          >
                            <p className="m-0 text-sm leading-6 text-muted">
                              {entry}
                            </p>
                          </Card>
                        ))
                      ) : (
                        <div className={panelImageFallbackClass}>
                          {common.notAvailable}
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card
                    as="div"
                    variant="nested"
                    className="grid gap-3 border border-border/80 p-4"
                  >
                    <SectionHeader
                      title={pick(
                        locale,
                        "Contradictory evidence",
                        "상충 신호",
                      )}
                      titleAs="h4"
                      className={docSectionHeadClass}
                    />
                    <div className="grid gap-3">
                      {postMortem.contradictory_evidence.length > 0 ? (
                        postMortem.contradictory_evidence.map(
                          (entry, index) => (
                            <Card
                              key={`postmortem-conflict-${index}`}
                              as="article"
                              variant="panel"
                              className="p-4"
                            >
                              <p className="m-0 text-sm leading-6 text-muted">
                                {entry}
                              </p>
                            </Card>
                          ),
                        )
                      ) : (
                        <div className={panelImageFallbackClass}>
                          {common.notAvailable}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <MetricGrid columns={2}>
                  <MetricItem
                    value={postMortem.uncertainty}
                    label={pick(locale, "Uncertainty", "불확실성")}
                  />
                  <MetricItem
                    value={postMortem.disclaimer}
                    label={pick(locale, "Disclaimer", "주의")}
                  />
                </MetricGrid>
              </Card>
            ) : null}
          </div>
        ) : (
          <div className={emptySurfaceClass}>
            {pick(
              locale,
              "Run validation from this panel to generate crop artifacts, Grad-CAM, and a saved case-level prediction.",
              "이 패널에서 검증을 실행하면 crop artifact, Grad-CAM, 저장 가능한 케이스 단위 예측이 생성됩니다.",
            )}
          </div>
        )}
      </Card>

      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          eyebrow={
            <div className={docSectionLabelClass}>
              {pick(locale, "Comparison", "비교")}
            </div>
          }
          title={pick(locale, "Multi-model analysis", "다중 모델 분석")}
          titleAs="h4"
          description={pick(
            locale,
            "AI validation refreshes this section with the selected latest models by default. You can keep or adjust the selection and re-run it anytime.",
            "AI 검증을 실행하면 이 섹션도 기본 선택된 최신 모델들로 함께 갱신됩니다. 필요하면 선택을 조정해 다시 실행할 수 있습니다.",
          )}
          aside={
            <Button
              variant="ghost"
              type="button"
              onClick={onRunModelCompare}
              disabled={
                modelCompareBusy ||
                !hasSelectedCase ||
                selectedCompareModelVersionIds.length === 0
              }
            >
              {modelCompareBusy
                ? pick(locale, "Comparing...", "비교 중...")
                : pick(locale, "Compare selected models", "선택 모델 비교")}
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2">
          {compareModelCandidates.map((modelVersion) => {
            const isActive = selectedCompareModelVersionIds.includes(
              modelVersion.version_id,
            );
            const label = String(
              modelVersion.version_name ||
                modelVersion.architecture ||
                modelVersion.version_id ||
                "",
            ).trim();
            const detail = [
              String(modelVersion.architecture || "").trim(),
              modelVersion.crop_mode
                ? String(modelVersion.crop_mode).trim()
                : "",
            ].filter(
              (value, index) =>
                value.length > 0 && (index !== 0 || value !== label),
            );
            return (
              <label
                key={modelVersion.version_id}
                title={[label, ...detail].join(" / ")}
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
                  onChange={(event) =>
                    onToggleModelVersion(
                      modelVersion.version_id,
                      event.target.checked,
                    )
                  }
                />
                <span className="flex flex-col leading-tight">
                  <span>{label}</span>
                  {detail.length > 0 ? (
                    <span className="text-[11px] opacity-80">
                      {detail.join(" / ")}
                    </span>
                  ) : null}
                </span>
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
                    "현재 선택된 다중 모델 분석 결과를 빠르게 요약한 값입니다.",
                  )}
                  aside={
                    <span
                      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                        consensusAgreementPercent !== null &&
                          consensusAgreementPercent >= 80
                          ? "high"
                          : consensusAgreementPercent !== null &&
                              consensusAgreementPercent >= 60
                            ? "medium"
                            : "low",
                      )}`}
                    >
                      {consensusAgreementPercent !== null
                        ? `${consensusAgreementPercent}% ${pick(locale, "agreement", "일치율")}`
                        : common.notAvailable}
                    </span>
                  }
                />
                <MetricGrid columns={4}>
                  <MetricItem
                    value={String(successfulComparisons.length)}
                    label={pick(locale, "models run", "실행 모델 수")}
                  />
                  <MetricItem
                    value={consensusLabel ?? common.notAvailable}
                    label={pick(locale, "leading label", "우세 라벨")}
                  />
                  <MetricItem
                    value={
                      consensusTop
                        ? `${consensusTop[1]} / ${successfulComparisons.length}`
                        : common.notAvailable
                    }
                    label={pick(locale, "vote", "득표")}
                  />
                  <MetricItem
                    value={formatProbability(
                      consensusProbability,
                      common.notAvailable,
                    )}
                    label={pick(locale, "avg fungal prob", "평균 진균 확률")}
                  />
                </MetricGrid>
              </Card>
            ) : null}
            {modelCompareResult.comparisons.map((item, index) => {
              const validationTone =
                item.summary?.validation_mode === "inference_only" ||
                item.summary?.is_correct == null
                  ? "neutral"
                  : item.summary.is_correct
                    ? "match"
                    : "mismatch";
              const validationLabel =
                item.summary?.validation_mode === "inference_only" ||
                  item.summary?.is_correct == null
                  ? pick(locale, "Inference-only", "추론 전용")
                  : item.summary.is_correct
                    ? pick(locale, "Match", "일치")
                    : pick(locale, "Mismatch", "불일치");
              return (
                <Card
                  key={
                    item.model_version?.version_id ??
                    item.model_version_id ??
                    `compare-${index}`
                  }
                  as="article"
                  variant="nested"
                  className="grid gap-3 p-4"
                >
                  <SectionHeader
                    className={docSectionHeadClass}
                    title={
                      item.model_version?.version_name ??
                      item.model_version?.architecture ??
                      item.model_version_id ??
                      common.notAvailable
                    }
                    titleAs="h4"
                    description={pick(
                      locale,
                      "Model comparison snapshot for the selected saved case.",
                      "선택된 저장 케이스에 대한 모델 비교 스냅샷입니다.",
                    )}
                    aside={
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral",
                          )}`}
                        >
                          {item.model_version?.architecture ??
                            common.notAvailable}
                        </span>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            validationTone,
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
                        <MetricItem
                          value={
                            item.summary?.predicted_label ?? common.notAvailable
                          }
                          label={
                            item.summary?.validation_mode === "inference_only"
                              ? pick(locale, "Pattern support", "패턴 지지")
                              : pick(locale, "Predicted", "예측")
                          }
                        />
                        <MetricItem
                          value={
                            item.summary?.validation_mode === "inference_only"
                              ? pick(locale, "Unavailable", "제공되지 않음")
                              : item.summary?.true_label ?? common.notAvailable
                          }
                          label={pick(locale, "Culture", "배양")}
                        />
                        <MetricItem
                          value={formatProbability(
                            item.summary?.prediction_probability,
                            common.notAvailable,
                          )}
                          label={
                            item.summary?.validation_mode === "inference_only"
                              ? pick(locale, "Support", "지지")
                              : pick(locale, "Confidence", "신뢰도")
                          }
                        />
                        <MetricItem
                          value={
                            item.summary?.validation_id ?? common.notAvailable
                          }
                          label={pick(locale, "Validation ID", "Validation ID")}
                        />
                      </MetricGrid>
                      <div className={docBadgeRowClass}>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral",
                          )}`}
                        >
                          {pick(locale, "Crop", "Crop")}{" "}
                          {item.model_version?.crop_mode ?? common.notAvailable}
                        </span>
                        <span
                          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${toneClass(
                            "neutral",
                          )}`}
                        >
                          {pick(locale, "Artifacts", "Artifacts")}{" "}
                          {item.artifact_availability?.gradcam
                            ? "Grad-CAM"
                            : pick(locale, "compare-only", "비교 전용")}
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

export const ValidationPanel = memo(ValidationPanelInner);
