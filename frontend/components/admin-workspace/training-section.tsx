"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import type { CrossValidationReport, InitialTrainingBenchmarkResponse, InitialTrainingResponse, SiteJobRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
];

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

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  selectedSiteId: string | null;
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

export function TrainingSection({
  locale,
  notAvailableLabel,
  selectedSiteId,
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
  return (
    <Card as="section" variant="surface" className="doc-surface">
      <SectionHeader
        className="doc-title-row"
        eyebrow={<div className="doc-eyebrow">{pick(locale, "Initial training", "초기 학습")}</div>}
        title={pick(locale, "Register the next global baseline", "다음 글로벌 기준 모델 등록")}
        aside={<div className="doc-site-badge">{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</div>}
      />
      <div className="workspace-actions section-launch-actions">
        <Button
          className="ghost-button compact-ghost-button"
          type="button"
          variant="ghost"
          size="sm"
          disabled={crossValidationExportBusy || !selectedReport}
          onClick={onExportSelectedReport}
        >
          {crossValidationExportBusy ? pick(locale, "Exporting...", "내보내는 중...") : pick(locale, "Export selected report", "선택 리포트 내보내기")}
        </Button>
      </div>
      <div className="ops-form-grid ops-form-grid-wide">
        <Field className="inline-field" label={pick(locale, "Architecture", "아키텍처")}>
          <select value={initialForm.architecture} onChange={(event) => setInitialForm((current) => ({ ...current, architecture: event.target.value }))}>
            {TRAINING_ARCHITECTURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field className="inline-field" label={pick(locale, "Execution mode", "실행 모드")}>
          <select value={initialForm.execution_mode} onChange={(event) => setInitialForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}>
            <option value="auto">{pick(locale, "auto", "자동")}</option>
            <option value="cpu">CPU</option>
            <option value="gpu">GPU</option>
          </select>
        </Field>
        <Field className="inline-field" label={pick(locale, "Crop mode", "Crop 모드")}>
          <select value={initialForm.crop_mode} onChange={(event) => setInitialForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" | "both" }))}>
            <option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option>
            <option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option>
            <option value="both">{pick(locale, "Both ensemble", "둘 다 앙상블")}</option>
          </select>
        </Field>
        <Field className="inline-field" label={pick(locale, "Epochs", "에폭")}>
          <input type="number" min={1} value={initialForm.epochs} onChange={(event) => setInitialForm((current) => ({ ...current, epochs: Number(event.target.value) }))} />
        </Field>
        <Field className="inline-field" label={pick(locale, "Batch size", "배치 크기")}>
          <input type="number" min={1} value={initialForm.batch_size} onChange={(event) => setInitialForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} />
        </Field>
        <Field className="inline-field" label={pick(locale, "Learning rate", "학습률")}>
          <input type="number" min={0.00001} step="0.00001" value={initialForm.learning_rate} onChange={(event) => setInitialForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} />
        </Field>
        <Field className="inline-field" label={pick(locale, "Validation split", "검증 비율")}>
          <input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.val_split} onChange={(event) => setInitialForm((current) => ({ ...current, val_split: Number(event.target.value) }))} />
        </Field>
        <Field className="inline-field" label={pick(locale, "Test split", "테스트 비율")}>
          <input type="number" min={0.1} max={0.4} step="0.05" value={initialForm.test_split} onChange={(event) => setInitialForm((current) => ({ ...current, test_split: Number(event.target.value) }))} />
        </Field>
      </div>
      <div className="workspace-actions">
        <button className={`toggle-pill ${initialForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{initialForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button>
        <button className={`toggle-pill ${!initialForm.regenerate_split ? "active" : ""}`} type="button" onClick={() => setInitialForm((current) => ({ ...current, regenerate_split: !current.regenerate_split }))}>{initialForm.regenerate_split ? pick(locale, "Regenerate split", "분할 재생성") : pick(locale, "Reuse split", "기존 분할 재사용")}</button>
      </div>
      <div className="doc-footer">
        <div>
          <strong>{pick(locale, "DenseNet / ConvNeXt / EfficientNet / Swin / ViT benchmark ready", "DenseNet / ConvNeXt / EfficientNet / Swin / ViT 벤치마크 지원")}</strong>
          <p>{pick(locale, "Single-model training and multi-model benchmark both reuse the Python training pipeline.", "단일 학습과 멀티모델 벤치마크 모두 기존 Python 학습 파이프라인을 재사용합니다.")}</p>
        </div>
        <div className="workspace-actions">
          <Button className="ghost-button" type="button" variant="ghost" disabled={benchmarkBusy || !selectedSiteId} onClick={onRunBenchmark}>
            {benchmarkBusy ? pick(locale, "Benchmarking...", "벤치마크 중...") : pick(locale, "Run multi-model benchmark", "멀티모델 벤치마크 실행")}
          </Button>
          <Button className="primary-workspace-button" type="button" variant="primary" disabled={initialBusy || !selectedSiteId} onClick={onRunInitialTraining}>
            {initialBusy ? pick(locale, "Training...", "학습 중...") : pick(locale, "Run initial training", "초기 학습 실행")}
          </Button>
        </div>
      </div>
      {initialJob ? (
        <Card as="div" variant="nested" className="ops-card training-progress-card">
          <div className="panel-card-head"><strong>{pick(locale, "Training progress", "학습 진행 상태")}</strong><span>{formatTrainingStage((initialProgress as { stage?: string } | null)?.stage ?? null)}</span></div>
          <div className="training-progress-bar" aria-hidden="true"><div className="training-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
          <MetricGrid className="panel-metric-grid training-progress-grid">
            <MetricItem value={`${progressPercent}%`} label={pick(locale, "progress", "진행률")} />
            <MetricItem value={(initialProgress as { component_crop_mode?: string; crop_mode?: string } | null)?.component_crop_mode ?? (initialProgress as { crop_mode?: string } | null)?.crop_mode ?? notAvailableLabel} label={pick(locale, "mode", "모드")} />
            <MetricItem value={(initialProgress as { epoch?: number; epochs?: number } | null)?.epoch && (initialProgress as { epoch?: number; epochs?: number } | null)?.epochs ? `${(initialProgress as { epoch: number }).epoch} / ${(initialProgress as { epochs: number }).epochs}` : notAvailableLabel} label={pick(locale, "epoch", "에폭")} />
            <MetricItem value={typeof (initialProgress as { val_acc?: number } | null)?.val_acc === "number" ? (initialProgress as { val_acc: number }).val_acc.toFixed(3) : notAvailableLabel} label={pick(locale, "val acc", "검증 정확도")} />
          </MetricGrid>
          <p className="training-progress-copy">{(initialProgress as { message?: string } | null)?.message ? (initialProgress as { message: string }).message : pick(locale, "Waiting for the training worker to report progress.", "학습 작업 상태를 기다리는 중입니다.")}</p>
        </Card>
      ) : null}
      {benchmarkJob ? (
        <Card as="div" variant="nested" className="ops-card training-progress-card">
          <div className="panel-card-head"><strong>{pick(locale, "Benchmark progress", "벤치마크 진행 상태")}</strong><span>{formatTrainingStage((benchmarkProgress as { stage?: string } | null)?.stage ?? null)}</span></div>
          <div className="training-progress-bar" aria-hidden="true"><div className="training-progress-fill" style={{ width: `${benchmarkPercent}%` }} /></div>
          <MetricGrid className="panel-metric-grid training-progress-grid">
            <MetricItem value={`${benchmarkPercent}%`} label={pick(locale, "progress", "진행률")} />
            <MetricItem value={(benchmarkProgress as { architecture?: string } | null)?.architecture ?? notAvailableLabel} label={pick(locale, "architecture", "아키텍처")} />
            <MetricItem value={(benchmarkProgress as { architecture_index?: number; architecture_count?: number } | null)?.architecture_index && (benchmarkProgress as { architecture_index?: number; architecture_count?: number } | null)?.architecture_count ? `${(benchmarkProgress as { architecture_index: number }).architecture_index} / ${(benchmarkProgress as { architecture_count: number }).architecture_count}` : notAvailableLabel} label={pick(locale, "sequence", "순서")} />
            <MetricItem value={(benchmarkProgress as { component_crop_mode?: string; crop_mode?: string } | null)?.component_crop_mode ?? (benchmarkProgress as { crop_mode?: string } | null)?.crop_mode ?? notAvailableLabel} label={pick(locale, "mode", "모드")} />
          </MetricGrid>
          <p className="training-progress-copy">{(benchmarkProgress as { message?: string } | null)?.message ? (benchmarkProgress as { message: string }).message : pick(locale, "Waiting for the benchmark worker to report progress.", "벤치마크 작업 상태를 기다리는 중입니다.")}</p>
        </Card>
      ) : null}
      {benchmarkResult ? <Card as="div" variant="nested" className="ops-card"><div className="panel-card-head"><strong>{pick(locale, "Benchmark summary", "벤치마크 요약")}</strong><span>{benchmarkResult.best_architecture ?? notAvailableLabel}</span></div><div className="ops-table"><div className="ops-table-row ops-table-head"><span>{pick(locale, "architecture", "아키텍처")}</span><span>{pick(locale, "status", "상태")}</span><span>{pick(locale, "best val acc", "최고 검증 정확도")}</span><span>{pick(locale, "version", "버전")}</span></div>{benchmarkResult.results.map((entry) => <div key={entry.architecture} className="ops-table-row"><span>{entry.architecture}</span><span>{entry.status}</span><span>{formatMetric(entry.result?.best_val_acc, notAvailableLabel)}</span><span>{entry.model_version?.version_name ?? notAvailableLabel}</span></div>)}{benchmarkResult.failures.map((entry) => <div key={`failed-${entry.architecture}`} className="ops-table-row"><span>{entry.architecture}</span><span>{entry.status}</span><span>{notAvailableLabel}</span><span>{entry.error}</span></div>)}</div></Card> : null}
      {initialResult ? <MetricGrid className="panel-metric-grid"><MetricItem value={initialResult.result.n_train_patients} label={pick(locale, "train patients", "학습 환자")} /><MetricItem value={initialResult.result.n_val_patients} label={pick(locale, "val patients", "검증 환자")} /><MetricItem value={initialResult.result.n_test_patients} label={pick(locale, "test patients", "테스트 환자")} /><MetricItem value={formatMetric(initialResult.result.best_val_acc, notAvailableLabel)} label={pick(locale, "best val acc", "최고 검증 정확도")} /></MetricGrid> : null}
    </Card>
  );
}
