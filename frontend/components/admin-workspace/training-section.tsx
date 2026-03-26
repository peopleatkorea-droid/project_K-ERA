"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { TrainingPaperFigures } from "./training-paper-figures";
import { docSectionLabelClass, docSiteBadgeClass, trainingProgressSettingsClass } from "../ui/workspace-patterns";
import type { CrossValidationReport, InitialTrainingBenchmarkResponse, InitialTrainingResponse, SiteJobRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS = [
  { value: "lesion_guided_fusion__efficientnet_v2_s", label: "LGF EfficientNetV2-S" },
  { value: "lesion_guided_fusion__densenet121", label: "LGF DenseNet121" },
  { value: "lesion_guided_fusion__convnext_tiny", label: "LGF ConvNeXt-Tiny" },
  { value: "lesion_guided_fusion__vit", label: "LGF ViT" },
  { value: "lesion_guided_fusion__swin", label: "LGF Swin" },
  { value: "lesion_guided_fusion__dinov2", label: "LGF DINOv2" },
];

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
  { value: "dinov2", label: "DINOv2" },
  { value: "dinov2_mil", label: "DINOv2 Attention MIL" },
  { value: "swin_mil", label: "Swin Attention MIL" },
  { value: "dual_input_concat", label: "Dual-input Concat Fusion" },
  ...LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS,
];

const TRAINING_ARCHITECTURE_LABELS = new Map(TRAINING_ARCHITECTURE_OPTIONS.map((option) => [option.value, option.label]));
const ATTENTION_MIL_ARCHITECTURES = new Set(["dinov2_mil", "swin_mil"]);
const BASELINE_BENCHMARK_PHASES = [
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
      en: "Swin Attention MIL runs separately so visit-level aggregation is interpreted on its own.",
      ko: "visit-level 집계를 별도로 해석할 수 있도록 Swin Attention MIL을 따로 실행합니다.",
    },
    architectures: ["swin_mil"],
  },
  {
    key: "fusion",
    title: { en: "Phase 3 · Paired-input extension", ko: "3단계 · paired-input 확장" },
    description: {
      en: "LGF Swin runs last with forced paired cornea + lesion crops.",
      ko: "LGF Swin은 각막 + 병변 paired crop을 강제로 적용해 마지막에 실행합니다.",
    },
    architectures: ["lesion_guided_fusion__swin"],
  },
] as const;
const BENCHMARK_SUITES = [
  {
    key: "baseline_8",
    heading: {
      en: "Run 8 staged baseline models in one job",
      ko: "8개 baseline 단계형 학습을 한 번에 실행",
    },
    description: {
      en: "One queued job runs 6 single-image baselines first, then Swin-based visit-level MIL, then LGF Swin fusion.",
      ko: "하나의 queued job으로 6개 single-image baseline, Swin 기반 visit-level MIL, LGF Swin fusion을 순차 실행합니다.",
    },
    confirmDescription: {
      en: "The current runtime settings apply across all three phases, with LGF Swin forced to paired cornea + lesion crops.",
      ko: "현재 runtime 설정을 3개 phase에 공통 적용하고, LGF Swin은 paired cornea + lesion crop으로 고정합니다.",
    },
    progressDescription: {
      en: "Progress shows the active phase, overall percent, current architecture, sequence, effective crop mode, and worker stage.",
      ko: "진행상황에는 현재 phase, 전체 percent, 현재 architecture, 순서, crop mode, worker stage가 함께 표시됩니다.",
    },
    waitingDescription: {
      en: "Waiting for the staged benchmark worker to report progress.",
      ko: "단계형 benchmark worker의 진행상황을 기다리는 중입니다.",
    },
    startLabel: { en: "Run 8-model staged initial training", ko: "8개 단계형 초기 학습 실행" },
    confirmLabel: { en: "8-model staged training confirmation", ko: "8개 단계형 학습 확인" },
    confirmTitle: { en: "Confirm 8-model staged initial training", ko: "8개 단계형 초기 학습 확인" },
    confirmStartLabel: { en: "Start 8-model staged training", ko: "8개 단계형 학습 시작" },
    architectures: ["densenet121", "convnext_tiny", "vit", "swin", "efficientnet_v2_s", "dinov2", "swin_mil", "lesion_guided_fusion__swin"],
    phases: BASELINE_BENCHMARK_PHASES,
  },
  {
    key: "lesion_guided_6",
    heading: {
      en: "Run lesion-guided fusion 6-model set",
      ko: "Lesion-guided fusion 6종 세트 실행",
    },
    description: {
      en: "Shared paired cornea + lesion training with six lesion-guided fusion backbones using the current initialization setting.",
      ko: "paired cornea + lesion 입력으로 lesion-guided fusion 6개 backbone을 현재 초기화 설정으로 순차 학습합니다.",
    },
    confirmDescription: {
      en: "This suite always uses paired cornea + lesion crops. Initialization follows the current pretrained or scratch toggle.",
      ko: "이 세트는 항상 paired cornea + lesion crop을 사용하고, 초기화는 현재 사전학습/처음부터 설정을 그대로 따릅니다.",
    },
    progressDescription: {
      en: "Progress shows the current lesion-guided fusion backbone, overall percent, sequence, and worker stage.",
      ko: "진행상황에는 현재 lesion-guided fusion backbone, 전체 percent, 순서, worker stage가 표시됩니다.",
    },
    waitingDescription: {
      en: "Waiting for the lesion-guided fusion benchmark worker to report progress.",
      ko: "lesion-guided fusion benchmark worker의 진행상황을 기다리는 중입니다.",
    },
    startLabel: { en: "Run LGF 6-model training", ko: "LGF 6종 학습 실행" },
    confirmLabel: { en: "LGF 6-model training confirmation", ko: "LGF 6종 학습 확인" },
    confirmTitle: { en: "Confirm LGF 6-model training", ko: "LGF 6종 학습 확인" },
    confirmStartLabel: { en: "Start LGF 6-model training", ko: "LGF 6종 학습 시작" },
    architectures: LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS.map((option) => option.value),
    phases: [
      {
        key: "lgf",
        title: { en: "Phase 1 · LGF backbones", ko: "1단계 · LGF backbone" },
        description: {
          en: "All six lesion-guided fusion backbones run sequentially with paired crops and the current initialization setting.",
          ko: "6개 lesion-guided fusion backbone을 paired crop과 현재 초기화 설정으로 순차 실행합니다.",
        },
        architectures: LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS.map((option) => option.value),
      },
    ],
  },
  {
    key: "lesion_guided_ssl_6",
    heading: {
      en: "Run lesion-guided fusion + SSL 6-model set",
      ko: "Lesion-guided fusion + SSL 6종 세트 실행",
    },
    description: {
      en: "Shared paired cornea + lesion training with six lesion-guided fusion backbones initialized from the latest local SSL encoders.",
      ko: "paired cornea + lesion 입력으로 lesion-guided fusion 6개 backbone을 최신 local SSL encoder 초기값으로 순차 학습합니다.",
    },
    confirmDescription: {
      en: "This suite always uses paired cornea + lesion crops and resolves the latest matching local SSL checkpoint for each backbone.",
      ko: "이 세트는 항상 paired cornea + lesion crop을 사용하고 각 backbone마다 최신 local SSL checkpoint를 자동 연결합니다.",
    },
    progressDescription: {
      en: "Progress shows the current lesion-guided fusion backbone, overall percent, sequence, and worker stage.",
      ko: "진행상황에는 현재 lesion-guided fusion backbone, 전체 percent, 순서, worker stage가 표시됩니다.",
    },
    waitingDescription: {
      en: "Waiting for the lesion-guided fusion + SSL benchmark worker to report progress.",
      ko: "lesion-guided fusion + SSL benchmark worker의 진행상황을 기다리는 중입니다.",
    },
    startLabel: { en: "Run LGF + SSL 6-model training", ko: "LGF + SSL 6종 학습 실행" },
    confirmLabel: { en: "LGF + SSL 6-model training confirmation", ko: "LGF + SSL 6종 학습 확인" },
    confirmTitle: { en: "Confirm LGF + SSL 6-model training", ko: "LGF + SSL 6종 학습 확인" },
    confirmStartLabel: { en: "Start LGF + SSL 6-model training", ko: "LGF + SSL 6종 학습 시작" },
    architectures: LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS.map((option) => option.value),
    phases: [
      {
        key: "lgf_ssl",
        title: { en: "Phase 1 · LGF + SSL backbones", ko: "1단계 · LGF + SSL backbone" },
        description: {
          en: "All six lesion-guided fusion backbones run sequentially with paired crops and SSL-pretrained encoders.",
          ko: "6개 lesion-guided fusion backbone을 paired crop과 SSL pretrained encoder로 순차 실행합니다.",
        },
        architectures: LESION_GUIDED_FUSION_ARCHITECTURE_OPTIONS.map((option) => option.value),
      },
    ],
  },
] as const;
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
  execution_device: string;
  crop_mode: "automated" | "manual" | "both" | string;
  case_aggregation: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil" | string;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  val_split: number;
  test_split: number;
  use_pretrained: boolean;
  pretraining_source: "imagenet" | "scratch" | "ssl" | string;
  ssl_checkpoint_path: string;
  benchmark_suite_key: string;
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
  onClearBenchmarkHistory: () => void;
  onCancelInitialTraining: () => void;
  onRefreshBenchmarkStatus: () => void;
  onRunBenchmark: () => void;
  onRunLesionGuidedInitBenchmark: () => void;
  onRunLesionGuidedBenchmark: () => void;
  onRunInitialTraining: () => void;
  onResumeBenchmark: () => void;
};

type BenchmarkSuiteDefinition = (typeof BENCHMARK_SUITES)[number];
type BenchmarkPhaseDefinition = BenchmarkSuiteDefinition["phases"][number];

function isDualInputArchitectureValue(architecture: string | null | undefined): boolean {
  const normalized = String(architecture || "").trim().toLowerCase();
  return normalized === "dual_input_concat" || normalized.startsWith("lesion_guided_fusion__");
}

function getBenchmarkSuiteByKey(key: string | null | undefined): BenchmarkSuiteDefinition | null {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return BENCHMARK_SUITES.find((suite) => suite.key === normalized) ?? null;
}

function getBenchmarkSuiteByArchitectures(architectures: string[] | null | undefined): BenchmarkSuiteDefinition | null {
  const normalizedArchitectures = (architectures ?? []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (normalizedArchitectures.length === 0) {
    return null;
  }
  return (
    BENCHMARK_SUITES.find((suite) => {
      if (suite.architectures.length !== normalizedArchitectures.length) {
        return false;
      }
      const suiteSet = new Set(suite.architectures.map((item) => item.toLowerCase()));
      return normalizedArchitectures.every((item) => suiteSet.has(item));
    }) ?? null
  );
}

function getBenchmarkPhase(
  suite: BenchmarkSuiteDefinition | null,
  architecture: string | null | undefined,
): BenchmarkPhaseDefinition | null {
  if (!suite) {
    return null;
  }
  const normalized = String(architecture || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return suite.phases.find((phase) => phase.architectures.some((candidate) => candidate === normalized)) ?? null;
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

function formatExecutionDeviceLabel(device: string | null | undefined, locale: Locale, emptyLabel: string): string {
  const normalized = String(device || "").trim().toLowerCase();
  if (!normalized) {
    return emptyLabel;
  }
  if (normalized.startsWith("cuda")) {
    return pick(locale, "GPU (CUDA)", "GPU (CUDA)");
  }
  if (normalized === "cpu") {
    return "CPU";
  }
  if (normalized === "mps") {
    return "MPS";
  }
  if (normalized === "auto") {
    return pick(locale, "Auto", "자동");
  }
  return normalized.toUpperCase();
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

function resolveArchitectureLabel(architecture: string | null | undefined) {
  const normalized = String(architecture || "").trim();
  return (TRAINING_ARCHITECTURE_LABELS.get(normalized) ?? normalized) || "n/a";
}

function isLesionGuidedBenchmarkSuiteKey(key: string | null | undefined) {
  const normalized = String(key || "").trim().toLowerCase();
  return normalized === "lesion_guided_6" || normalized === "lesion_guided_ssl_6";
}

function isLesionGuidedSslBenchmarkSuiteKey(key: string | null | undefined) {
  return String(key || "").trim().toLowerCase() === "lesion_guided_ssl_6";
}

function benchmarkEntryMetric(
  entry: InitialTrainingBenchmarkResponse["results"][number],
  metricName: string,
): number | null {
  const rawValue = entry.result?.test_metrics?.[metricName];
  return typeof rawValue === "number" ? rawValue : null;
}

function compareBenchmarkEntries(
  left: InitialTrainingBenchmarkResponse["results"][number],
  right: InitialTrainingBenchmarkResponse["results"][number],
) {
  return (
    (benchmarkEntryMetric(right, "balanced_accuracy") ?? -1) - (benchmarkEntryMetric(left, "balanced_accuracy") ?? -1) ||
    (benchmarkEntryMetric(right, "AUROC") ?? -1) - (benchmarkEntryMetric(left, "AUROC") ?? -1) ||
    ((right.result?.best_val_acc ?? -1) - (left.result?.best_val_acc ?? -1))
  );
}

function resolveBenchmarkCropLabel(
  locale: Locale,
  suite: BenchmarkSuiteDefinition | null,
  cropMode: string | null | undefined,
): string {
  if (isLesionGuidedBenchmarkSuiteKey(suite?.key)) {
    return pick(locale, "Paired cornea + lesion", "Paired cornea + lesion");
  }
  const normalizedCropMode = String(cropMode || "").trim().toLowerCase() || "automated";
  return pick(
    locale,
    normalizedCropMode === "manual"
      ? "Manual lesion crop + paired cornea + lesion"
      : normalizedCropMode === "both"
        ? "Both ensemble + paired cornea + lesion"
        : "Automated cornea crop + paired cornea + lesion",
    normalizedCropMode === "manual"
      ? "Manual 병변 crop + 각막 + 병변 paired"
      : normalizedCropMode === "both"
        ? "둘 다 앙상블 + 각막 + 병변 paired"
        : "Automated 각막 crop + 각막 + 병변 paired",
  );
}

function resolveBenchmarkInitLabel(
  locale: Locale,
  pretrainingSource: string | null | undefined,
  usePretrained: boolean | null | undefined,
): string {
  const normalizedSource = String(pretrainingSource || "").trim().toLowerCase();
  if (normalizedSource === "ssl") {
    return pick(locale, "SSL pretrained", "SSL 사전학습");
  }
  if (normalizedSource === "scratch") {
    return pick(locale, "scratch", "처음부터");
  }
  if (normalizedSource === "imagenet") {
    return pick(locale, "pretrained", "사전학습");
  }
  return usePretrained ? pick(locale, "pretrained", "사전학습") : pick(locale, "scratch", "처음부터");
}

function SummaryGrid({
  items,
  compact = false,
}: {
  items: Array<{ label: string; value: string }>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2 xl:grid-cols-6" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-5"}>
      {items.map((item) => (
        <div
          key={`${item.label}-${item.value}`}
          className={`${compact && item.value.length > 20 ? "sm:col-span-2 xl:col-span-2 " : ""}rounded-[18px] border border-border bg-surface ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}
        >
          <strong className={`block font-semibold text-ink ${compact ? "text-[0.72rem] tracking-[0.04em]" : "text-sm"}`}>{item.label}</strong>
          <span className={`mt-1 block break-words text-muted ${compact ? "text-sm leading-5" : "text-sm leading-6"}`}>{item.value}</span>
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
  onClearBenchmarkHistory,
  onCancelInitialTraining,
  onRefreshBenchmarkStatus,
  onRunBenchmark,
  onRunLesionGuidedInitBenchmark,
  onRunLesionGuidedBenchmark,
  onRunInitialTraining,
  onResumeBenchmark,
}: Props) {
  const [benchmarkConfirmSuiteKey, setBenchmarkConfirmSuiteKey] = useState<string | null>(null);
  const benchmarkPayload = (benchmarkJob?.payload ?? {}) as BenchmarkJobPayload;
  const benchmarkResponseSuiteKey =
    typeof (benchmarkResult as (InitialTrainingBenchmarkResponse & { benchmark_suite_key?: string | null }) | null)?.benchmark_suite_key === "string"
      ? (benchmarkResult as InitialTrainingBenchmarkResponse & { benchmark_suite_key?: string | null }).benchmark_suite_key
      : typeof (benchmarkJob?.result?.response as { benchmark_suite_key?: string | null } | undefined)?.benchmark_suite_key === "string"
        ? (benchmarkJob?.result?.response as { benchmark_suite_key?: string | null }).benchmark_suite_key
        : null;
  const resolvedBenchmarkResult =
    benchmarkResult ??
    (isBenchmarkResponse(benchmarkJob?.result?.response) ? benchmarkJob.result.response : null);
  const activeBenchmarkSuite =
    getBenchmarkSuiteByKey(benchmarkPayload.benchmark_suite_key) ??
    getBenchmarkSuiteByKey(benchmarkResponseSuiteKey) ??
    getBenchmarkSuiteByArchitectures(
      Array.isArray(benchmarkPayload.architectures)
        ? benchmarkPayload.architectures
        : Array.isArray(resolvedBenchmarkResult?.architectures)
          ? resolvedBenchmarkResult.architectures
          : null,
    ) ??
    getBenchmarkSuiteByKey("baseline_8");
  const baselineBenchmarkSuite = getBenchmarkSuiteByKey("baseline_8");
  const lesionGuidedBenchmarkSuite = getBenchmarkSuiteByKey("lesion_guided_6");
  const lesionGuidedSslBenchmarkSuite = getBenchmarkSuiteByKey("lesion_guided_ssl_6");
  const confirmBenchmarkSuite = getBenchmarkSuiteByKey(benchmarkConfirmSuiteKey);
  const isDualInputArchitecture = isDualInputArchitectureValue(initialForm.architecture);
  const effectiveCropMode = isDualInputArchitecture ? "paired" : initialForm.crop_mode;
  const effectiveCaseAggregation = ATTENTION_MIL_ARCHITECTURES.has(initialForm.architecture) ? "attention_mil" : initialForm.case_aggregation;
  const benchmarkBaseCropMode = effectiveCropMode === "paired" ? "automated" : effectiveCropMode;
  const baselineBenchmarkCropLabel = resolveBenchmarkCropLabel(locale, baselineBenchmarkSuite, benchmarkBaseCropMode);
  const lesionGuidedBenchmarkCropLabel = resolveBenchmarkCropLabel(locale, lesionGuidedBenchmarkSuite, "paired");
  const benchmarkCropLabel = resolveBenchmarkCropLabel(locale, activeBenchmarkSuite, benchmarkPayload.crop_mode ?? benchmarkBaseCropMode);
  const benchmarkArchitectureCount =
    typeof (benchmarkProgress as { architecture_count?: number } | null)?.architecture_count === "number"
      ? (benchmarkProgress as { architecture_count: number }).architecture_count
      : Array.isArray(benchmarkPayload.architectures)
        ? benchmarkPayload.architectures.length
        : activeBenchmarkSuite?.architectures.length ?? 0;
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
  const initialExecutionDevice = formatExecutionDeviceLabel(
    typeof initialJob?.payload?.execution_device === "string"
      ? initialJob.payload.execution_device
      : initialResult?.execution_device,
    locale,
    notAvailableLabel,
  );
  const benchmarkExecutionDevice = formatExecutionDeviceLabel(
    typeof benchmarkPayload.execution_device === "string"
      ? benchmarkPayload.execution_device
      : resolvedBenchmarkResult?.execution_device,
    locale,
    notAvailableLabel,
  );
  const benchmarkActive = ["queued", "running", "cancelling"].includes(String(benchmarkJob?.status || "").trim().toLowerCase());
  const initialActive = ["queued", "running", "cancelling"].includes(String(initialJob?.status || "").trim().toLowerCase());
  const currentBenchmarkPhase = getBenchmarkPhase(activeBenchmarkSuite, (benchmarkProgress as { architecture?: string } | null)?.architecture ?? null);
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
      label: pick(locale, "Device", "실행 장치"),
      value: benchmarkExecutionDevice,
    },
    {
      label: pick(locale, "Crop", "Crop"),
      value:
        typeof benchmarkPayload.crop_mode === "string"
          ? resolveBenchmarkCropLabel(locale, activeBenchmarkSuite, benchmarkPayload.crop_mode)
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
      value: resolveBenchmarkInitLabel(locale, benchmarkPayload.pretraining_source, benchmarkPayload.use_pretrained),
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
    {
      label: pick(locale, "Crop", "Crop"),
      value:
        isLesionGuidedBenchmarkSuiteKey(confirmBenchmarkSuite?.key)
          ? lesionGuidedBenchmarkCropLabel
          : baselineBenchmarkCropLabel,
    },
    {
      label: pick(locale, "Visit agg", "Visit 집계"),
      value: CASE_AGGREGATION_OPTIONS.find((option) => option.value === effectiveCaseAggregation)?.label ?? effectiveCaseAggregation,
    },
    { label: pick(locale, "Epochs", "에폭"), value: String(initialForm.epochs) },
    { label: pick(locale, "Batch", "배치"), value: String(initialForm.batch_size) },
    { label: pick(locale, "LR", "학습률"), value: String(initialForm.learning_rate) },
    { label: pick(locale, "Validation", "검증 비율"), value: String(initialForm.val_split) },
    { label: pick(locale, "Test", "테스트 비율"), value: String(initialForm.test_split) },
    {
      label: pick(locale, "Init", "초기화"),
      value:
        isLesionGuidedSslBenchmarkSuiteKey(confirmBenchmarkSuite?.key)
          ? resolveBenchmarkInitLabel(locale, "ssl", true)
          : resolveBenchmarkInitLabel(locale, undefined, initialForm.use_pretrained),
    },
    { label: pick(locale, "Split", "분할"), value: initialForm.regenerate_split ? pick(locale, "regenerate", "재생성") : pick(locale, "reuse", "재사용") },
  ];
  const benchmarkSortedResults = resolvedBenchmarkResult ? [...resolvedBenchmarkResult.results].sort(compareBenchmarkEntries) : [];
  const benchmarkBestTestEntry = benchmarkSortedResults[0] ?? null;

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Initial training", "초기 학습")}</div>}
        title={pick(locale, "Register the next global baseline", "다음 글로벌 기준 모델 등록")}
        titleAs="h3"
        description={pick(
          locale,
          "Configure a single baseline run or queue either the staged baseline benchmark or the lesion-guided fusion + SSL benchmark.",
          "단일 기준 모델을 학습하거나, 단계형 baseline benchmark 또는 lesion-guided fusion + SSL benchmark를 queued job으로 실행할 수 있습니다."
        )}
        aside={<span className={docSiteBadgeClass}>{selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}</span>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-surface-muted/70 px-4 py-3">
        <div className="text-sm leading-6 text-muted">
          {resolvedBenchmarkResult
            ? pick(
                locale,
                "The latest benchmark summary is available. Open the paper-figure panel here.",
                "최근 benchmark 요약이 준비되어 있습니다. 여기서 바로 논문용 패널을 열 수 있습니다."
              )
            : pick(
                locale,
                "If the latest benchmark summary is missing, refresh status first.",
                "최근 benchmark 요약이 안 보이면 먼저 상태 새로 고침을 누르세요."
              )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={crossValidationExportBusy || !selectedReport} onClick={onExportSelectedReport}>
            {crossValidationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export selected report", "선택 리포트 내보내기")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={benchmarkBusy} onClick={onRefreshBenchmarkStatus}>
            {benchmarkBusy ? pick(locale, "Refreshing...", "새로 고치는 중...") : pick(locale, "Refresh status", "상태 새로 고침")}
          </Button>
          {resolvedBenchmarkResult ? (
            <TrainingPaperFigures
              locale={locale}
              benchmarkResult={resolvedBenchmarkResult}
              selectedSiteLabel={selectedSiteLabel}
              notAvailableLabel={notAvailableLabel}
              formatMetric={formatMetric}
            />
          ) : null}
        </div>
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
                  isDualInputArchitectureValue(event.target.value)
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
            disabled={ATTENTION_MIL_ARCHITECTURES.has(initialForm.architecture)}
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
          className="inline-flex min-h-10 cursor-default items-center rounded-full border border-brand/20 bg-brand-soft px-4 text-sm font-semibold text-brand transition disabled:opacity-100"
          type="button"
          disabled
        >
          {pick(locale, "Always regenerate split", "항상 현재 데이터로 분할 재생성")}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {[baselineBenchmarkSuite, lesionGuidedBenchmarkSuite, lesionGuidedSslBenchmarkSuite]
          .filter((suite): suite is BenchmarkSuiteDefinition => Boolean(suite))
          .map((suite) => {
          const phaseGroups = suite.phases.map((phase) => ({
            ...phase,
            titleLabel: pick(locale, phase.title.en, phase.title.ko),
            descriptionLabel: pick(locale, phase.description.en, phase.description.ko),
            labels: phase.architectures.map((architecture) => TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture),
          }));
          const isLesionGuidedSuite = isLesionGuidedBenchmarkSuiteKey(suite.key);
          const isLesionGuidedSslSuite = isLesionGuidedSslBenchmarkSuiteKey(suite.key);
          return (
            <Card key={suite.key} as="section" variant="nested" className="grid gap-4 p-5">
              <SectionHeader title={pick(locale, suite.heading.en, suite.heading.ko)} titleAs="h4" description={pick(locale, suite.description.en, suite.description.ko)} />
              <div className="text-sm leading-6 text-muted">{pick(locale, suite.progressDescription.en, suite.progressDescription.ko)}</div>
              <div className="flex flex-wrap gap-2" aria-label={pick(locale, "Benchmark suite architectures", "benchmark suite 아키텍처")}>
                {suite.architectures.map((architecture) => (
                  <span key={`${suite.key}-${architecture}`} className={docSiteBadgeClass}>
                    {TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture}
                  </span>
                ))}
              </div>
              <div className="grid gap-3" aria-label={pick(locale, "Staged benchmark phases", "단계형 benchmark 단계")}>
                {phaseGroups.map((phase) => (
                  <div key={`${suite.key}-${phase.key}`} className="rounded-[18px] border border-border bg-surface-muted/60 px-4 py-3">
                    <div className="text-sm font-semibold text-ink">{phase.titleLabel}</div>
                    <p className="mb-3 mt-1 text-sm leading-6 text-muted">{phase.descriptionLabel}</p>
                    <div className="flex flex-wrap gap-2">
                      {phase.labels.map((label) => (
                        <span key={`${suite.key}-${phase.key}-${label}`} className={docSiteBadgeClass}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-[18px] border border-border bg-surface-muted/55 px-4 py-3 text-sm leading-6 text-muted">
                <strong className="block text-ink">{pick(locale, "Effective crop mode", "실제 crop mode")}</strong>
                <span>{isLesionGuidedSuite ? lesionGuidedBenchmarkCropLabel : baselineBenchmarkCropLabel}</span>
                <br />
                <strong className="block pt-2 text-ink">{pick(locale, "Initialization", "초기화")}</strong>
                <span>
                  {isLesionGuidedSslSuite
                    ? resolveBenchmarkInitLabel(locale, "ssl", true)
                    : resolveBenchmarkInitLabel(locale, undefined, initialForm.use_pretrained)}
                </span>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  disabled={benchmarkBusy || !selectedSiteId}
                  onClick={() => setBenchmarkConfirmSuiteKey(suite.key)}
                >
                  {benchmarkBusy
                    ? pick(locale, "Training benchmark suite...", "benchmark suite 학습 중...")
                    : pick(locale, suite.startLabel.en, suite.startLabel.ko)}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {confirmBenchmarkSuite ? (
        <div
          className="fixed inset-0 z-80 overflow-y-auto bg-black/45 p-4 backdrop-blur-sm md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={pick(locale, confirmBenchmarkSuite.confirmLabel.en, confirmBenchmarkSuite.confirmLabel.ko)}
        >
          <Card as="div" variant="panel" className="mx-auto my-4 grid w-full max-w-[min(94vw,1480px)] gap-4 p-5 md:p-6">
            <div className="grid gap-3">
              <SectionHeader
                title={pick(locale, confirmBenchmarkSuite.confirmTitle.en, confirmBenchmarkSuite.confirmTitle.ko)}
                titleAs="h4"
                description={pick(locale, "One queued job runs this suite sequentially.", "하나의 queued job으로 이 suite를 순차 실행합니다.")}
              />
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(locale, confirmBenchmarkSuite.confirmDescription.en, confirmBenchmarkSuite.confirmDescription.ko)}
              </p>
            </div>
            <div className="grid gap-4">
              <SummaryGrid items={benchmarkSummaryItems} compact />
              <div className="rounded-[18px] border border-border bg-surface-muted/55 px-4 py-3">
                <div className="mb-2 text-sm font-semibold text-ink">{pick(locale, "Models to train", "학습 대상 모델")}</div>
                <div className="flex flex-wrap gap-2" aria-label={pick(locale, "Models to train", "학습 대상 모델")}>
                  {confirmBenchmarkSuite.architectures.map((architecture) => (
                    <span key={`confirm-${architecture}`} className={docSiteBadgeClass}>
                      {TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-3" aria-label={pick(locale, "Benchmark phases", "benchmark 단계")}>
              {confirmBenchmarkSuite.phases.map((phase) => (
                <div key={`confirm-${confirmBenchmarkSuite.key}-${phase.key}`} className="rounded-[18px] border border-border bg-surface-muted/60 px-4 py-3">
                  <div className="text-sm font-semibold text-ink">{pick(locale, phase.title.en, phase.title.ko)}</div>
                  <p className="mb-2 mt-1 text-sm leading-6 text-muted">{pick(locale, phase.description.en, phase.description.ko)}</p>
                  <div className="flex flex-wrap gap-2">
                    {phase.architectures.map((architecture) => (
                      <span key={`confirm-${phase.key}-${architecture}`} className={docSiteBadgeClass}>
                        {TRAINING_ARCHITECTURE_LABELS.get(architecture) ?? architecture}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
              <Button type="button" variant="ghost" onClick={() => setBenchmarkConfirmSuiteKey(null)}>
                {pick(locale, "Cancel", "취소")}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  const nextSuiteKey = confirmBenchmarkSuite.key;
                  setBenchmarkConfirmSuiteKey(null);
                  if (nextSuiteKey === "lesion_guided_6") {
                    onRunLesionGuidedInitBenchmark();
                    return;
                  }
                  if (nextSuiteKey === "lesion_guided_ssl_6") {
                    onRunLesionGuidedBenchmark();
                    return;
                  }
                  onRunBenchmark();
                }}
              >
                {pick(locale, confirmBenchmarkSuite.confirmStartLabel.en, confirmBenchmarkSuite.confirmStartLabel.ko)}
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
            {pick(locale, "Execution device", "실행 장치")}: {initialExecutionDevice}
          </p>
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
            title={pick(locale, "Benchmark training progress", "Benchmark 학습 진행 상태")}
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
            <MetricItem
              value={resolveArchitectureLabel((benchmarkProgress as { architecture?: string } | null)?.architecture ?? notAvailableLabel)}
              label={pick(locale, "architecture", "아키텍처")}
            />
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
            {pick(locale, "Execution device", "실행 장치")}: {benchmarkExecutionDevice}
          </p>
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(locale, "Estimated remaining time", "예상 남은 시간")}: {benchmarkEtaLabel}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={benchmarkBusy} onClick={onRefreshBenchmarkStatus}>
              {benchmarkBusy ? pick(locale, "Refreshing...", "새로 고치는 중...") : pick(locale, "Refresh status", "상태 새로 고침")}
            </Button>
            {!benchmarkActive ? (
              <Button type="button" variant="ghost" size="sm" disabled={benchmarkBusy} onClick={onClearBenchmarkHistory}>
                {pick(locale, "Delete benchmark records", "benchmark 기록 삭제")}
              </Button>
            ) : null}
            {benchmarkActive || canResumeBenchmark ? (
              <>
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
              </>
            ) : null}
          </div>
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
                  activeBenchmarkSuite?.waitingDescription.en ?? "Waiting for the benchmark worker to report progress.",
                  activeBenchmarkSuite?.waitingDescription.ko ?? "benchmark worker의 진행상황을 기다리는 중입니다.",
                )}
          </p>
        </Card>
      ) : null}

      {resolvedBenchmarkResult ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Benchmark training summary", "Benchmark 학습 요약")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{resolveArchitectureLabel(resolvedBenchmarkResult.best_architecture)}</span>}
          />
          <MetricGrid columns={4}>
            <MetricItem value={resolvedBenchmarkResult.results.length} label={pick(locale, "completed", "완료 모델")} />
            <MetricItem value={resolvedBenchmarkResult.failures.length} label={pick(locale, "failed", "실패 모델")} />
            <MetricItem value={resolveArchitectureLabel(resolvedBenchmarkResult.best_architecture)} label={pick(locale, "best val", "val 최고")} />
            <MetricItem value={resolveArchitectureLabel(benchmarkBestTestEntry?.architecture)} label={pick(locale, "best test", "test 최고")} />
          </MetricGrid>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={benchmarkBusy} onClick={onRefreshBenchmarkStatus}>
              {benchmarkBusy ? pick(locale, "Refreshing...", "새로 고치는 중...") : pick(locale, "Refresh status", "상태 새로 고침")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={benchmarkBusy || benchmarkActive} onClick={onClearBenchmarkHistory}>
              {pick(locale, "Delete benchmark records", "benchmark 기록 삭제")}
            </Button>
            <TrainingPaperFigures
              locale={locale}
              benchmarkResult={resolvedBenchmarkResult}
              selectedSiteLabel={selectedSiteLabel}
              notAvailableLabel={notAvailableLabel}
              formatMetric={formatMetric}
            />
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[980px] gap-2">
              <div className="grid gap-3 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm font-medium text-muted md:grid-cols-[1.35fr_0.8fr_0.9fr_0.9fr_0.9fr_1fr_1.6fr]">
                <span>{pick(locale, "architecture", "아키텍처")}</span>
                <span>{pick(locale, "status", "상태")}</span>
                <span>{pick(locale, "best val acc", "최고 검증 정확도")}</span>
                <span>{pick(locale, "test acc", "테스트 정확도")}</span>
                <span>AUROC</span>
                <span>{pick(locale, "balanced acc", "균형 정확도")}</span>
                <span>{pick(locale, "version", "버전")}</span>
              </div>
              {benchmarkSortedResults.map((entry) => {
                const isValBest = entry.architecture === resolvedBenchmarkResult.best_architecture;
                const isTestBest = entry.architecture === benchmarkBestTestEntry?.architecture;
                return (
                  <div
                    key={entry.architecture}
                    className={`grid gap-3 rounded-[18px] border px-4 py-3 text-sm md:grid-cols-[1.35fr_0.8fr_0.9fr_0.9fr_0.9fr_1fr_1.6fr] ${
                      isValBest || isTestBest
                        ? "border-brand/20 bg-brand-soft/40"
                        : "border-border bg-surface-muted/80"
                    }`}
                  >
                    <div className="grid gap-1">
                      <span className="font-medium text-ink">{resolveArchitectureLabel(entry.architecture)}</span>
                      <div className="flex flex-wrap gap-2">
                        {isValBest ? <span className={docSiteBadgeClass}>{pick(locale, "best val", "val 최고")}</span> : null}
                        {isTestBest ? <span className={docSiteBadgeClass}>{pick(locale, "best test", "test 최고")}</span> : null}
                      </div>
                    </div>
                    <span>{entry.status}</span>
                    <span>{formatMetric(entry.result?.best_val_acc, notAvailableLabel)}</span>
                    <span>{formatMetric(benchmarkEntryMetric(entry, "accuracy"), notAvailableLabel)}</span>
                    <span>{formatMetric(benchmarkEntryMetric(entry, "AUROC"), notAvailableLabel)}</span>
                    <span>{formatMetric(benchmarkEntryMetric(entry, "balanced_accuracy"), notAvailableLabel)}</span>
                    <span className="break-words">{entry.model_version?.version_name ?? notAvailableLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            {resolvedBenchmarkResult.failures.map((entry) => (
              <div key={`failed-${entry.architecture}`} className="grid gap-3 rounded-[18px] border border-danger/20 bg-danger/5 px-4 py-3 text-sm md:grid-cols-[1fr_0.8fr_3fr]">
                <span>{resolveArchitectureLabel(entry.architecture)}</span>
                <span>{entry.status}</span>
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
