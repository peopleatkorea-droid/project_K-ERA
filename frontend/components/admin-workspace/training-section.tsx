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
];

const BENCHMARK_MODEL_COUNT = TRAINING_ARCHITECTURE_OPTIONS.length;

type InitialTrainingForm = {
  architecture: string;
  execution_mode: "auto" | "cpu" | "gpu";
  crop_mode: "automated" | "manual" | "both";
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
  onRunBenchmark: () => void;
  onRunInitialTraining: () => void;
};

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
  onRunBenchmark,
  onRunInitialTraining,
}: Props) {
  const [benchmarkConfirmOpen, setBenchmarkConfirmOpen] = useState(false);
  const benchmarkModelLabels = TRAINING_ARCHITECTURE_OPTIONS.map((option) => option.label);
  const benchmarkPayload = (benchmarkJob?.payload ?? {}) as BenchmarkJobPayload;
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
  const benchmarkRemainingCount =
    benchmarkArchitectureIndex !== null && benchmarkArchitectureCount
      ? Math.max(benchmarkArchitectureCount - benchmarkArchitectureIndex, 0)
      : null;
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
      value: typeof benchmarkPayload.crop_mode === "string" ? benchmarkPayload.crop_mode : initialForm.crop_mode,
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
    { label: pick(locale, "Crop", "Crop"), value: initialForm.crop_mode },
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
          "Configure a single baseline run or queue a five-model sequential initial-training run with the same data split and crop policy.",
          "단일 기준 모델을 학습하거나, 같은 split과 crop 정책으로 5종 순차 초기 학습을 실행할 수 있습니다."
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
          <select value={initialForm.architecture} onChange={(event) => setInitialForm((current) => ({ ...current, architecture: event.target.value }))}>
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
            value={initialForm.crop_mode}
            onChange={(event) => setInitialForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" | "both" }))}
          >
            <option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option>
            <option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option>
            <option value="both">{pick(locale, "Both ensemble", "둘 다 앙상블")}</option>
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
          title={pick(locale, `Run ${BENCHMARK_MODEL_COUNT} sequential baseline models in one job`, `${BENCHMARK_MODEL_COUNT}종 순차 초기 학습`)}
          titleAs="h4"
          description={pick(
            locale,
            "DenseNet121, ConvNeXt-Tiny, ViT, Swin, and EfficientNetV2-S are trained sequentially with the current runtime settings.",
            "DenseNet121, ConvNeXt-Tiny, ViT, Swin, EfficientNetV2-S를 현재 실행 설정으로 순차 학습합니다."
          )}
        />
        <div className="text-sm leading-6 text-muted">
          {pick(
            locale,
            "Progress shows overall percent, current architecture, sequence, mode, and worker stage.",
            "진행 상황에는 전체 퍼센트, 현재 아키텍처, 순서, 모드, 작업 단계가 함께 표시됩니다."
          )}
        </div>
        <div className="flex flex-wrap gap-2" aria-label={pick(locale, "Five-model training architectures", "5종 순차 학습 아키텍처")}>
          {benchmarkModelLabels.map((label) => (
            <span key={label} className={docSiteBadgeClass}>
              {label}
            </span>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="primary" disabled={benchmarkBusy || !selectedSiteId} onClick={() => setBenchmarkConfirmOpen(true)}>
            {benchmarkBusy ? pick(locale, `Training ${BENCHMARK_MODEL_COUNT} models...`, `${BENCHMARK_MODEL_COUNT}개 모델 학습 중...`) : pick(locale, `Run ${BENCHMARK_MODEL_COUNT}-model initial training`, `${BENCHMARK_MODEL_COUNT}종 순차 초기 학습 실행`)}
          </Button>
        </div>
      </Card>

      {benchmarkConfirmOpen ? (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={pick(locale, "Five-model training confirmation", "5종 순차 초기 학습 확인")}>
          <Card as="div" variant="panel" className="w-full max-w-4xl grid gap-5 p-6">
            <SectionHeader
              title={pick(locale, `Confirm ${BENCHMARK_MODEL_COUNT}-model initial training`, `${BENCHMARK_MODEL_COUNT}종 순차 초기 학습 확인`)}
              titleAs="h4"
              description={pick(locale, "One queued job, sequential execution.", "하나의 작업으로 순차 실행됩니다.")}
            />
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "The current initial-training settings will be applied to all five architectures.",
                "현재 초기 학습 설정이 5개 아키텍처 전체에 동일하게 적용됩니다."
              )}
            </p>
            <SummaryGrid items={benchmarkSummaryItems} />
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
                {pick(locale, "Start 5-model training", "5종 순차 초기 학습 시작")}
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
            {(initialProgress as { message?: string } | null)?.message
              ? (initialProgress as { message: string }).message
              : pick(locale, "Waiting for the training worker to report progress.", "학습 작업 상태를 기다리는 중입니다.")}
          </p>
        </Card>
      ) : null}

      {benchmarkJob ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Five-model training progress", "5종 순차 초기 학습 진행 상태")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{formatTrainingStage((benchmarkProgress as { stage?: string } | null)?.stage ?? null)}</span>}
          />
          <div className="h-2.5 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
            <div className="h-full rounded-full bg-brand" style={{ width: `${benchmarkPercent}%` }} />
          </div>
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
              : pick(locale, "Waiting for the five-model training worker to report progress.", "5종 순차 초기 학습 작업 상태를 기다리는 중입니다.")}
          </p>
        </Card>
      ) : null}

      {benchmarkResult ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Five-model training summary", "5종 순차 초기 학습 요약")}
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
