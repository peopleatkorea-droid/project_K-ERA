"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, trainingProgressSettingsClass } from "../ui/workspace-patterns";
import type { CrossValidationReport, InitialTrainingBenchmarkResponse, InitialTrainingResponse, SiteJobRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
  { value: "dinov2", label: "DINOv2" },
  { value: "dinov2_mil", label: "DINOv2 Attention MIL" },
  { value: "dual_input_concat", label: "Dual-input Concat Fusion" },
];

const TRAINING_ARCHITECTURE_LABELS = new Map(TRAINING_ARCHITECTURE_OPTIONS.map((option) => [option.value, option.label]));
const BENCHMARK_PHASES = [
  {
    key: "main",
    title: { en: "Phase 1 · Main benchmark", ko: "1단계 · 메인 benchmark" },
    description: {
      en: "Six single-image baselines with one shared patient split.",
      ko: "하나의 patient split으로 6개 single-image baseline을 먼저 학습합니다.",
    },
    architectures: ["densenet121", "convnext_tiny", "vit", "swin", "efficientnet_v2_s", "dinov2"],
  },
  {
    key: "mil",
    title: { en: "Phase 2 · Visit-level extension", ko: "2단계 · visit-level 확장" },
    description: {
      en: "DINOv2 Attention MIL runs separately so visit-level aggregation is interpreted on its own.",
      ko: "visit-level 집계를 별도로 해석할 수 있도록 DINOv2 Attention MIL을 따로 실행합니다.",
    },
    architectures: ["dinov2_mil"],
  },
  {
    key: "fusion",
    title: { en: "Phase 3 · Paired-input extension", ko: "3단계 · paired-input 확장" },
    description: {
      en: "Dual-input Concat Fusion runs last with forced paired cornea + lesion crops.",
      ko: "Dual-input Concat Fusion은 각막 + 병변 paired crop을 강제로 적용해 마지막에 실행합니다.",
    },
    architectures: ["dual_input_concat"],
  },
] as const;
const BENCHMARK_ARCHITECTURE_OPTIONS = BENCHMARK_PHASES.flatMap((phase) =>
  phase.architectures.map((architecture) => ({
    value: architecture,
    label: TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture,
  }))
);
const BENCHMARK_MODEL_COUNT = BENCHMARK_ARCHITECTURE_OPTIONS.length;
const CASE_AGGREGATION_OPTIONS = [
  { value: "mean", label: "Mean" },
  { value: "logit_mean", label: "Logit mean" },
  { value: "quality_weighted_mean", label: "Quality-weighted mean" },
  { value: "attention_mil", label: "Attention MIL" },
];

type InitialTrainingForm = {
  architecture: string;
  execution_mode: "auto" | "cpu" | "gpu";
  crop_mode: "automated" | "manual" | "both" | "paired";
  case_aggregation: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
  epochs: number;
  learning_rate: number;
  batch_size: number;
  val_split: number;
  test_split: number;
  use_pretrained: boolean;
  regenerate_split: boolean;
};

type BenchmarkJobPayload = Partial<{
  architectures: string[];
  execution_mode: "auto" | "cpu" | "gpu" | string;
  crop_mode: "automated" | "manual" | "both" | string;
  case_aggregation: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil" | string;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  val_split: number;
  test_split: number;
  use_pretrained: boolean;
  regenerate_split: boolean;
}>;

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  selectedSiteId: string | null;
  selectedSiteLabel: string | null;
  selectedReport: CrossValidationReport | null;
  crossValidationExportBusy: boolean;
  initialForm: InitialTrainingForm;
  initialBusy: boolean;
  initialResult: InitialTrainingResponse | null;
  initialJob: SiteJobRecord | null;
  initialProgress: SiteJobRecord["result"] extends { progress?: infer T } ? T : unknown;
  progressPercent: number;
  benchmarkBusy: boolean;
  benchmarkResult: InitialTrainingBenchmarkResponse | null;
  benchmarkJob: SiteJobRecord | null;
  benchmarkProgress: SiteJobRecord["result"] extends { progress?: infer T } ? T : unknown;
  benchmarkPercent: number;
  setInitialForm: Dispatch<SetStateAction<InitialTrainingForm>>;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
  formatTrainingStage: (stage: string | null | undefined) => string;
  onExportSelectedReport: () => void;
  onCancelBenchmark: () => void;
  onCancelInitialTraining: () => void;
  onRunBenchmark: () => void;
  onRunInitialTraining: () => void;
  onResumeBenchmark: () => void;
};

type BenchmarkPhaseDefinition = (typeof BENCHMARK_PHASES)[number];

function getBenchmarkPhase(architecture: string | null | undefined): BenchmarkPhaseDefinition | null {
  const normalized = String(architecture || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return BENCHMARK_PHASES.find((phase) => phase.architectures.some((candidate) => candidate === normalized)) ?? null;
}

function getEstimatedRemainingSeconds(job: SiteJobRecord | null, percent: number): number | null {
  if (!job) {
    return null;
  }
  const normalizedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (normalizedPercent <= 0 || normalizedPercent >= 100) {
    return null;
  }
  const anchor = job.started_at ?? job.created_at;
  const startedAt = Date.parse(anchor);
  if (!Number.isFinite(startedAt)) {
    return null;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (elapsedSeconds <= 0) {
    return null;
  }
  const projectedTotalSeconds = elapsedSeconds / (normalizedPercent / 100);
  const remainingSeconds = Math.max(0, Math.round(projectedTotalSeconds - elapsedSeconds));
  return Number.isFinite(remainingSeconds) && remainingSeconds > 0 ? remainingSeconds : null;
}

function formatRemainingTime(seconds: number | null, locale: Locale, emptyLabel: string): string {
  if (seconds === null) {
    return emptyLabel;
  }
  if (seconds < 60) {
    return pick(locale, "<1 min", "<1분");
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  if (hours > 0) {
    return pick(locale, `${hours}h ${minutes}m`, `${hours}시간 ${minutes}분`);
  }
  return pick(locale, `${minutes} min`, `${minutes}분`);
}

function isBenchmarkResponse(
  response: unknown,
): response is {
  results: Array<{ architecture: string; status: string }>;
} {
  return Boolean(response && typeof response === "object" && Array.isArray((response as { results?: unknown }).results));
}

function getCompletedBenchmarkArchitectures(job: SiteJobRecord | null): string[] {
  if (!job) {
    return [];
  }
  const progressCompleted = Array.isArray(job.result?.progress?.completed_architectures)
    ? job.result?.progress?.completed_architectures.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const response = job.result?.response;
  const responseCompleted = isBenchmarkResponse(response)
    ? response.results
        .filter((entry) => entry.status === "completed" && typeof entry.architecture === "string")
        .map((entry) => entry.architecture)
    : [];
  return Array.from(new Set([...progressCompleted, ...responseCompleted]));
}

function getRemainingBenchmarkArchitectures(job: SiteJobRecord | null): string[] {
  if (!job) {
    return [];
  }
  const payloadArchitectures = Array.isArray((job.payload as BenchmarkJobPayload | undefined)?.architectures)
    ? ((job.payload as BenchmarkJobPayload).architectures ?? []).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const completedSet = new Set(getCompletedBenchmarkArchitectures(job));
  return payloadArchitectures.filter((architecture) => !completedSet.has(architecture));
}

function SummaryGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="rounded-[18px] border border-border bg-surface px-4 py-3">
          <strong className="block text-sm font-semibold text-ink">{item.label}</strong>
          <span className="mt-1 block text-sm leading-6 text-muted">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TrainingSection({
  locale,
  notAvailableLabel,
  selectedSiteId,
  selectedSiteLabel,
  selectedReport,
  crossValidationExportBusy,
  initialForm,
  initialBusy,
  initialResult,
  initialJob,
  initialProgress,
  progressPercent,
  benchmarkBusy,
  benchmarkResult,
  benchmarkJob,
  benchmarkProgress,
  benchmarkPercent,
  setInitialForm,
  formatMetric,
  formatTrainingStage,
  onExportSelectedReport,
  onCancelBenchmark,
  onCancelInitialTraining,
  onRunBenchmark,
  onRunInitialTraining,
  onResumeBenchmark,
}: Props) {
  const [benchmarkConfirmOpen, setBenchmarkConfirmOpen] = useState(false);
  const benchmarkModelLabels = BENCHMARK_ARCHITECTURE_OPTIONS.map((option) => option.label);
  const benchmarkPhaseGroups = BENCHMARK_PHASES.map((phase) => ({
    ...phase,
    titleLabel: pick(locale, phase.title.en, phase.title.ko),
    descriptionLabel: pick(locale, phase.description.en, phase.description.ko),
    labels: phase.architectures.map((architecture) => TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture),
  }));
  const benchmarkPayload = (benchmarkJob?.payload ?? {}) as BenchmarkJobPayload;
  const isDualInputArchitecture = initialForm.architecture === "dual_input_concat";
  const effectiveCropMode = isDualInputArchitecture ? "paired" : initialForm.crop_mode;
  const effectiveCaseAggregation = initialForm.architecture === "dinov2_mil" ? "attention_mil" : initialForm.case_aggregation;
  const benchmarkBaseCropMode = effectiveCropMode === "paired" ? "automated" : effectiveCropMode;
  const benchmarkCropLabel = pick(
    locale,
    benchmarkBaseCropMode === "manual"
      ? "Manual lesion crop + paired cornea + lesion"
      : benchmarkBaseCropMode === "both"
        ? "Both ensemble + paired cornea + lesion"
        : "Automated cornea crop + paired cornea + lesion",
    benchmarkBaseCropMode === "manual"
      ? "Manual 병변 crop + 각막 + 병변 paired"
      : benchmarkBaseCropMode === "both"
        ? "둘 다 앙상블 + 각막 + 병변 paired"
        : "Automated 각막 crop + 각막 + 병변 paired"
  );
  const benchmarkArchitectureCount =
    typeof (benchmarkProgress as { architecture_count?: number } | null)?.architecture_count === "number"
      ? (benchmarkProgress as { architecture_count: number }).architecture_count
      : Array.isArray(benchmarkPayload.architectures)
        ? benchmarkPayload.architectures.length
        : BENCHMARK_MODEL_COUNT;
  const benchmarkArchitectureIndex =
    typeof (benchmarkProgress as { architecture_index?: number } | null)?.architecture_index === "number"
      ? (benchmarkProgress as { architecture_index: number }).architecture_index
      : null;
  const benchmarkRemainingArchitectures = getRemainingBenchmarkArchitectures(benchmarkJob);
  const benchmarkRemainingCount =
    benchmarkRemainingArchitectures.length > 0
      ? benchmarkRemainingArchitectures.length
      : benchmarkArchitectureIndex !== null && benchmarkArchitectureCount
        ? Math.max(benchmarkArchitectureCount - benchmarkArchitectureIndex, 0)
      : null;
  const initialEtaLabel = formatRemainingTime(getEstimatedRemainingSeconds(initialJob, progressPercent), locale, notAvailableLabel);
  const benchmarkEtaLabel = formatRemainingTime(getEstimatedRemainingSeconds(benchmarkJob, benchmarkPercent), locale, notAvailableLabel);
  const benchmarkActive = ["queued", "running", "cancelling"].includes(String(benchmarkJob?.status || "").trim().toLowerCase());
  const initialActive = ["queued", "running", "cancelling"].includes(String(initialJob?.status || "").trim().toLowerCase());
  const currentBenchmarkPhase = getBenchmarkPhase((benchmarkProgress as { architecture?: string } | null)?.architecture ?? null);
  const canResumeBenchmark =
    benchmarkJob !== null &&
    !benchmarkActive &&
    ["cancelled", "failed", "completed"].includes(String(benchmarkJob.status || "").trim().toLowerCase()) &&
    benchmarkRemainingArchitectures.length > 0;
  const benchmarkRuntimeSummaryItems = [
    {
      label: pick(locale, "Execution", "실행"),
      value:
        typeof benchmarkPayload.execution_mode === "string"
          ? benchmarkPayload.execution_mode.toUpperCase()
          : initialForm.execution_mode.toUpperCase(),
    },
    {
      label: pick(locale, "Crop", "Crop"),
      value:
        typeof benchmarkPayload.crop_mode === "string"
          ? pick(
              locale,
              benchmarkPayload.crop_mode === "manual"
                ? "Manual lesion crop + paired cornea + lesion"
                : benchmarkPayload.crop_mode === "both"
                  ? "Both ensemble + paired cornea + lesion"
                  : "Automated cornea crop + paired cornea + lesion",
              benchmarkPayload.crop_mode === "manual"
                ? "Manual 병변 crop + 각막 + 병변 paired"
                : benchmarkPayload.crop_mode === "both"
                  ? "둘 다 앙상블 + 각막 + 병변 paired"
                  : "Automated 각막 crop + 각막 + 병변 paired"
            )
          : benchmarkCropLabel,
    },
    {
      label: pick(locale, "Visit agg", "Visit 집계"),
      value:
        typeof benchmarkPayload.case_aggregation === "string"
          ? benchmarkPayload.case_aggregation
          : initialForm.case_aggregation,
    },
    {
      label: pick(locale, "Epochs", "에폭"),
      value: String(typeof benchmarkPayload.epochs === "number" ? benchmarkPayload.epochs : initialForm.epochs),
    },
    {
      label: pick(locale, "Batch", "배치"),
      value: String(typeof benchmarkPayload.batch_size === "number" ? benchmarkPayload.batch_size : initialForm.batch_size),
    },
    {
      label: pick(locale, "LR", "학습률"),
      value: String(typeof benchmarkPayload.learning_rate === "number" ? benchmarkPayload.learning_rate : initialForm.learning_rate),
    },
    {
      label: pick(locale, "Validation", "검증 비율"),
      value: String(typeof benchmarkPayload.val_split === "number" ? benchmarkPayload.val_split : initialForm.val_split),
    },
    {
      label: pick(locale, "Test", "테스트 비율"),
      value: String(typeof benchmarkPayload.test_split === "number" ? benchmarkPayload.test_split : initialForm.test_split),
    },
    {
      label: pick(locale, "Init", "초기화"),
      value:
        typeof benchmarkPayload.use_pretrained === "boolean"
          ? benchmarkPayload.use_pretrained
            ? pick(locale, "pretrained", "사전학습")
            : pick(locale, "scratch", "처음부터")
          : initialForm.use_pretrained
            ? pick(locale, "pretrained", "사전학습")
            : pick(locale, "scratch", "처음부터"),
    },
    {
      label: pick(locale, "Split", "분할"),
      value:
        typeof benchmarkPayload.regenerate_split === "boolean"
          ? benchmarkPayload.regenerate_split
            ? pick(locale, "regenerate", "재생성")
            : pick(locale, "reuse", "재사용")
          : initialForm.regenerate_split
            ? pick(locale, "regenerate", "재생성")
            : pick(locale, "reuse", "재사용"),
    },
  ];
  const benchmarkSummaryItems = [
    { label: pick(locale, "Site", "병원"), value: selectedSiteLabel ?? notAvailableLabel },
    { label: pick(locale, "Execution", "실행"), value: initialForm.execution_mode.toUpperCase() },
    { label: pick(locale, "Crop", "Crop"), value: benchmarkCropLabel },
    {
      label: pick(locale, "Visit agg", "Visit 집계"),
      value: CASE_AGGREGATION_OPTIONS.find((option) => option.value === effectiveCaseAggregation)?.label ?? effectiveCaseAggregation,
    },
    { label: pick(locale, "Epochs", "에폭"), value: String(initialForm.epochs) },
    { label: pick(locale, "Batch", "배치"), value: String(initialForm.batch_size) },
    { label: pick(locale, "LR", "학습률"), value: String(initialForm.learning_rate) },
    { label: pick(locale, "Validation", "검증 비율"), value: String(initialForm.val_split) },
    { label: pick(locale, "Test", "테스트 비율"), value: String(initialForm.test_split) },
    { label: pick(locale, "Init", "초기화"), value: initialForm.use_pretrained ? pick(locale, "pretrained", "사전학습") : pick(locale, "scratch", "처음부터") },
    { label: pick(locale, "Split", "분할"), value: initialForm.regenerate_split ? pick(locale, "regenerate", "재생성") : pick(locale, "reuse", "재사용") },
  ];

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Initial training", "초기 학습")}</div>}
        title={pick(locale, "Register the next global baseline", "다음 글로벌 기준 모델 등록")}
        titleAs="h3"
        description={pick(
          locale,
          `Configure a single baseline run or queue one staged initial-training job: 6 single-image models first, then visit-level MIL, then paired-input fusion with one shared split.`,
          `단일 기준 모델을 학습하거나, 하나의 split으로 6개 single-image 모델을 먼저 학습한 뒤 visit-level MIL과 paired-input fusion을 이어서 실행하는 단계형 초기 학습을 선택할 수 있습니다.`
        )}
        aside={<span className={docSiteBadgeClass}>{selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}</span>}
      />

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" disabled={crossValidationExportBusy || !selectedReport} onClick={onExportSelectedReport}>
          {crossValidationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export selected report", "선택 리포트 내보내기")}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Field label={pick(locale, "Architecture", "아키텍처")}>
          <select
            value={initialForm.architecture}
            onChange={(event) =>
              setInitialForm((current) => ({
                ...current,
                architecture: event.target.value,
                crop_mode:
                  event.target.value === "dual_input_concat"
                    ? "paired"
                    : current.crop_mode === "paired"
                      ? "automated"
                      : current.crop_mode,
              }))
            }
          >
            {TRAINING_ARCHITECTURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={pick(locale, "Execution mode", "실행 모드")}>
          <select
            value={initialForm.execution_mode}
            onChange={(event) => setInitialForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}
          >
            <option value="auto">{pick(locale, "auto", "자동")}</option>
            <option value="cpu">CPU</option>
            <option value="gpu">GPU</option>
          </select>
        </Field>
        <Field label={pick(locale, "Crop mode", "Crop 모드")}>
          <select
            value={effectiveCropMode}
            disabled={isDualInputArchitecture}
            onChange={(event) =>
              setInitialForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" | "both" | "paired" }))
            }
          >
            <option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option>
            <option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option>
            <option value="both">{pick(locale, "Both ensemble", "둘 다 앙상블")}</option>
            {isDualInputArchitecture ? <option value="paired">{pick(locale, "Paired cornea + lesion", "각막 + 병변 paired")}</option> : null}
          </select>
        </Field>
        <Field label={pick(locale, "Visit aggregation", "Visit 집계 방식")}>
          <select
            value={effectiveCaseAggregation}
            disabled={initialForm.architecture === "dinov2_mil"}
            onChange={(event) =>
              setInitialForm((current) => ({
                ...current,
                case_aggregation: event.target.value as "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil",
              }))
            }
          >
            {CASE_AGGREGATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={pick(locale, "Epochs", "에폭")}>
          <input type="number" min={1} value={initialForm.epochs} onChange={(event) => setInitialForm((current) => ({ ...current, epochs: Number(event.target.value) }))} />
        </Field>
        <Field label={pick(locale, "Batch size", "배치 크기")}>
          <input type="number" min={1} value={initialForm.batch_size} onChange={(event) => setInitialForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} />
        </Field>
        <Field label={pick(locale, "Learning rate", "학습률")}>
          <input
            type="number"
            min={0.00001}
            step="0.00001"
            value={initialForm.learning_rate}
            onChange={(event) => setInitialForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Validation split", "검증 비율")}>
          <input
            type="number"
            min={0.1}
            max={0.4}
            step="0.05"
            value={initialForm.val_split}
            onChange={(event) => setInitialForm((current) => ({ ...current, val_split: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Test split", "테스트 비율")}>
          <input
            type="number"
            min={0.1}
            max={0.4}
            step="0.05"
            value={initialForm.test_split}
            onChange={(event) => setInitialForm((current) => ({ ...current, test_split: Number(event.target.value) }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
            initialForm.use_pretrained ? "border-brand/20 bg-brand-soft text-brand" : "border-border bg-surface text-muted"
          }`}
          type="button"
          onClick={() => setInitialForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}
        >
          {initialForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}
        </button>
        <button
          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
            !initialForm.regenerate_split ? "border-brand/20 bg-brand-soft text-brand" : "border-border bg-surface text-muted"
          }`}
          type="button"
          onClick={() => setInitialForm((current) => ({ ...current, regenerate_split: !current.regenerate_split }))}
        >
          {initialForm.regenerate_split ? pick(locale, "Regenerate split", "분할 재생성") : pick(locale, "Reuse split", "기존 분할 재사용")}
        </button>
      </div>

      <Card as="section" variant="nested" className="grid gap-4 p-5">
        <SectionHeader
          title={pick(locale, `Run ${BENCHMARK_MODEL_COUNT} staged baseline models in one job`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습`)}
          titleAs="h4"
          description={pick(
            locale,
            "One queued job runs Phase 1 main single-image baselines, Phase 2 visit-level MIL, and Phase 3 paired-input fusion. Dual-input concat always uses paired cornea + lesion crops.",
            "하나의 작업으로 1단계 main single-image baseline, 2단계 visit-level MIL, 3단계 paired-input fusion을 실행합니다. dual-input concat은 항상 각막 + 병변 paired crop을 사용합니다."
          )}
        />
        <div className="text-sm leading-6 text-muted">
          {pick(
            locale,
            "Progress shows the active phase, overall percent, current architecture, sequence, effective crop mode, and worker stage.",
            "진행 상황에는 현재 단계, 전체 퍼센트, 현재 아키텍처, 순서, 적용 crop 모드, 작업 단계가 함께 표시됩니다."
          )}
        </div>
        <div
          className="flex flex-wrap gap-2"
          aria-label={pick(locale, `${BENCHMARK_MODEL_COUNT}-model training architectures`, `${BENCHMARK_MODEL_COUNT}종 순차 학습 아키텍처`)}
        >
          {benchmarkModelLabels.map((label) => (
            <span key={label} className={docSiteBadgeClass}>
              {label}
            </span>
          ))}
        </div>
        <div className="grid gap-3" aria-label={pick(locale, "Staged benchmark phases", "단계형 benchmark 단계")}>
          {benchmarkPhaseGroups.map((phase) => (
            <div key={phase.key} className="rounded-[18px] border border-border bg-surface-muted/60 px-4 py-3">
              <div className="text-sm font-semibold text-ink">{phase.titleLabel}</div>
              <p className="mb-3 mt-1 text-sm leading-6 text-muted">{phase.descriptionLabel}</p>
              <div className="flex flex-wrap gap-2">
                {phase.labels.map((label) => (
                  <span key={`${phase.key}-${label}`} className={docSiteBadgeClass}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={benchmarkBusy || !selectedSiteId}
            onClick={() => setBenchmarkConfirmOpen(true)}
          >
            {benchmarkBusy
              ? pick(locale, `Training ${BENCHMARK_MODEL_COUNT} staged models...`, `${BENCHMARK_MODEL_COUNT}개 단계형 모델 학습 중...`)
              : pick(locale, `Run ${BENCHMARK_MODEL_COUNT}-model staged initial training`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 실행`)}
          </Button>
        </div>
      </Card>

      {benchmarkConfirmOpen ? (
        <div
          className="fixed inset-0 z-80 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={pick(locale, `${BENCHMARK_MODEL_COUNT}-model staged training confirmation`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 확인`)}
        >
          <Card as="div" variant="panel" className="w-full max-w-4xl grid gap-5 p-6">
            <SectionHeader
              title={pick(locale, `Confirm ${BENCHMARK_MODEL_COUNT}-model staged initial training`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 확인`)}
              titleAs="h4"
              description={pick(locale, "One queued job, three staged phases.", "하나의 작업으로 3단계 순차 실행합니다.")}
            />
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                `The current runtime settings will be applied across all three phases, with dual-input concat forced to paired cornea + lesion crops.`,
                `현재 실행 설정은 3단계 전체에 적용되며, dual-input concat은 각막 + 병변 paired crop으로 강제됩니다.`
              )}
            </p>
            <SummaryGrid items={benchmarkSummaryItems} />
            <div className="grid gap-3" aria-label={pick(locale, "Benchmark phases", "benchmark 단계")}>
              {benchmarkPhaseGroups.map((phase) => (
                <div key={`confirm-${phase.key}`} className="rounded-[18px] border border-border bg-surface-muted/60 px-4 py-3">
                  <div className="text-sm font-semibold text-ink">{phase.titleLabel}</div>
                  <p className="mb-3 mt-1 text-sm leading-6 text-muted">{phase.descriptionLabel}</p>
                  <div className="flex flex-wrap gap-2">
                    {phase.labels.map((label) => (
                      <span key={`confirm-${phase.key}-${label}`} className={docSiteBadgeClass}>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label={pick(locale, "Models to train", "학습 대상 모델")}>
              {benchmarkModelLabels.map((label) => (
                <span key={`confirm-${label}`} className={docSiteBadgeClass}>
                  {label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setBenchmarkConfirmOpen(false)}>
                {pick(locale, "Cancel", "취소")}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setBenchmarkConfirmOpen(false);
                  onRunBenchmark();
                }}
              >
                {pick(locale, `Start ${BENCHMARK_MODEL_COUNT}-model staged training`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 시작`)}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-surface-muted/70 p-4">
        <div>
          <strong className="block text-sm font-semibold text-ink">{pick(locale, "Single-model training", "단일 모델 초기 학습")}</strong>
          <p className="mt-1 text-sm leading-6 text-muted">
            {pick(locale, "Use this when you already know which architecture you want to train.", "특정 아키텍처를 지정해서 바로 초기 학습을 돌릴 때 사용합니다.")}
          </p>
        </div>
        <Button type="button" variant="primary" disabled={initialBusy || !selectedSiteId} onClick={onRunInitialTraining}>
          {initialBusy ? pick(locale, "Training...", "학습 중...") : pick(locale, "Run initial training", "초기 학습 실행")}
        </Button>
      </div>

      {initialJob ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Training progress", "학습 진행 상태")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{formatTrainingStage((initialProgress as { stage?: string } | null)?.stage ?? null)}</span>}
          />
          <div className="h-2.5 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
            <div className="h-full rounded-full bg-brand" style={{ width: `${progressPercent}%` }} />
          </div>
          <MetricGrid columns={4}>
            <MetricItem value={`${progressPercent}%`} label={pick(locale, "progress", "진행률")} />
            <MetricItem
              value={
                (initialProgress as { component_crop_mode?: string; crop_mode?: string } | null)?.component_crop_mode ??
                (initialProgress as { crop_mode?: string } | null)?.crop_mode ??
                notAvailableLabel
              }
              label={pick(locale, "mode", "모드")}
            />
            <MetricItem
              value={
                (initialProgress as { epoch?: number; epochs?: number } | null)?.epoch &&
                (initialProgress as { epoch?: number; epochs?: number } | null)?.epochs
                  ? `${(initialProgress as { epoch: number }).epoch} / ${(initialProgress as { epochs: number }).epochs}`
                  : notAvailableLabel
              }
              label={pick(locale, "epoch", "에폭")}
            />
            <MetricItem
              value={
                typeof (initialProgress as { val_acc?: number } | null)?.val_acc === "number"
                  ? (initialProgress as { val_acc: number }).val_acc.toFixed(3)
                  : notAvailableLabel
              }
              label={pick(locale, "val acc", "검증 정확도")}
            />
          </MetricGrid>
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(locale, "Estimated remaining time", "예상 남은 시간")}: {initialEtaLabel}
          </p>
          {initialActive ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={String(initialJob?.status || "").trim().toLowerCase() === "cancelling"}
                onClick={onCancelInitialTraining}
              >
                {String(initialJob?.status || "").trim().toLowerCase() === "cancelling"
                  ? pick(locale, "Stopping...", "중단 요청 중...")
                  : pick(locale, "Stop", "중단")}
              </Button>
            </div>
          ) : null}
          <p className="m-0 text-sm leading-6 text-muted">
            {(initialProgress as { message?: string } | null)?.message
              ? (initialProgress as { message: string }).message
              : pick(locale, "Waiting for the training worker to report progress.", "학습 작업 상태를 기다리는 중입니다.")}
          </p>
        </Card>
      ) : null}

      {benchmarkJob ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, `${BENCHMARK_MODEL_COUNT}-model staged training progress`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 진행 상태`)}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{formatTrainingStage((benchmarkProgress as { stage?: string } | null)?.stage ?? null)}</span>}
          />
          <div className="h-2.5 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
            <div className="h-full rounded-full bg-brand" style={{ width: `${benchmarkPercent}%` }} />
          </div>
          {currentBenchmarkPhase ? (
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(locale, "Current phase", "현재 단계")}: {pick(locale, currentBenchmarkPhase.title.en, currentBenchmarkPhase.title.ko)}
            </p>
          ) : null}
          <MetricGrid columns={4}>
            <MetricItem value={`${benchmarkPercent}%`} label={pick(locale, "progress", "진행률")} />
            <MetricItem value={(benchmarkProgress as { architecture?: string } | null)?.architecture ?? notAvailableLabel} label={pick(locale, "architecture", "아키텍처")} />
            <MetricItem
              value={
                (benchmarkProgress as { architecture_index?: number; architecture_count?: number } | null)?.architecture_index &&
                (benchmarkProgress as { architecture_index?: number; architecture_count?: number } | null)?.architecture_count
                  ? `${(benchmarkProgress as { architecture_index: number }).architecture_index} / ${(benchmarkProgress as { architecture_count: number }).architecture_count}`
                  : notAvailableLabel
              }
              label={pick(locale, "sequence", "순서")}
            />
            <MetricItem value={benchmarkRemainingCount !== null ? String(benchmarkRemainingCount) : notAvailableLabel} label={pick(locale, "remaining", "남은 모델")} />
          </MetricGrid>
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(locale, "Estimated remaining time", "예상 남은 시간")}: {benchmarkEtaLabel}
          </p>
          {benchmarkActive || canResumeBenchmark ? (
            <div className="flex flex-wrap justify-end gap-2">
              {benchmarkActive ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={String(benchmarkJob?.status || "").trim().toLowerCase() === "cancelling"}
                  onClick={onCancelBenchmark}
                >
                  {String(benchmarkJob?.status || "").trim().toLowerCase() === "cancelling"
                    ? pick(locale, "Stopping...", "중단 요청 중...")
                    : pick(locale, "Stop benchmark", "benchmark 중단")}
                </Button>
              ) : null}
              {canResumeBenchmark ? (
                <Button type="button" variant="primary" size="sm" onClick={onResumeBenchmark}>
                  {pick(
                    locale,
                    `Resume remaining (${benchmarkRemainingArchitectures.length})`,
                    `남은 항목 재시작 (${benchmarkRemainingArchitectures.length})`,
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className={trainingProgressSettingsClass} data-testid="training-progress-settings">
            <SectionHeader
              title={pick(locale, "Run settings", "실행 설정")}
              titleAs="h4"
              description={pick(locale, "Loaded from the queued job payload.", "실행된 job payload 기준")}
            />
            <SummaryGrid items={benchmarkRuntimeSummaryItems} />
          </div>
          <p className="m-0 text-sm leading-6 text-muted">
            {(benchmarkProgress as { message?: string } | null)?.message
              ? (benchmarkProgress as { message: string }).message
              : pick(
                  locale,
                  `Waiting for the ${BENCHMARK_MODEL_COUNT}-model staged training worker to report progress.`,
                  `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 작업 상태를 기다리는 중입니다.`
                )}
          </p>
        </Card>
      ) : null}

      {benchmarkResult ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, `${BENCHMARK_MODEL_COUNT}-model staged training summary`, `${BENCHMARK_MODEL_COUNT}종 단계형 초기 학습 요약`)}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{benchmarkResult.best_architecture ?? notAvailableLabel}</span>}
          />
          <div className="grid gap-2">
            <div className="grid gap-3 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm font-medium text-muted md:grid-cols-4">
              <span>{pick(locale, "architecture", "아키텍처")}</span>
              <span>{pick(locale, "status", "상태")}</span>
              <span>{pick(locale, "best val acc", "최고 검증 정확도")}</span>
              <span>{pick(locale, "version", "버전")}</span>
            </div>
            {benchmarkResult.results.map((entry) => (
              <div key={entry.architecture} className="grid gap-3 rounded-[18px] border border-border bg-surface-muted/80 px-4 py-3 text-sm md:grid-cols-4">
                <span>{entry.architecture}</span>
                <span>{entry.status}</span>
                <span>{formatMetric(entry.result?.best_val_acc, notAvailableLabel)}</span>
                <span>{entry.model_version?.version_name ?? notAvailableLabel}</span>
              </div>
            ))}
            {benchmarkResult.failures.map((entry) => (
              <div key={`failed-${entry.architecture}`} className="grid gap-3 rounded-[18px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm md:grid-cols-4">
                <span>{entry.architecture}</span>
                <span>{entry.status}</span>
                <span>{notAvailableLabel}</span>
                <span>{entry.error}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {initialResult ? (
        <MetricGrid columns={4}>
          <MetricItem value={initialResult.result.n_train_patients} label={pick(locale, "train patients", "학습 환자")} />
          <MetricItem value={initialResult.result.n_val_patients} label={pick(locale, "val patients", "검증 환자")} />
          <MetricItem value={initialResult.result.n_test_patients} label={pick(locale, "test patients", "테스트 환자")} />
          <MetricItem value={formatMetric(initialResult.result.best_val_acc, notAvailableLabel)} label={pick(locale, "best val acc", "최고 검증 정확도")} />
        </MetricGrid>
      ) : null}
    </Card>
  );
}
