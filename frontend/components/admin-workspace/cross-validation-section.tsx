"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { CrossValidationFoldRecord, CrossValidationReport, SiteJobRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

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
];
const ATTENTION_MIL_ARCHITECTURES = new Set(["dinov2_mil", "swin_mil"]);
const CASE_AGGREGATION_OPTIONS = [
  { value: "mean", label: "Mean" },
  { value: "logit_mean", label: "Logit mean" },
  { value: "quality_weighted_mean", label: "Quality-weighted mean" },
  { value: "attention_mil", label: "Attention MIL" },
];

type CrossValidationForm = {
  architecture: string;
  execution_mode: "auto" | "cpu" | "gpu";
  crop_mode: "automated" | "manual" | "paired";
  case_aggregation: "mean" | "logit_mean" | "quality_weighted_mean" | "attention_mil";
  num_folds: number;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  val_split: number;
  use_pretrained: boolean;
};

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  selectedSiteId: string | null;
  crossValidationReports: CrossValidationReport[];
  selectedReportId: string | null;
  selectedReport: CrossValidationReport | null;
  selectedReportConfusion: number[][] | null;
  crossValidationForm: CrossValidationForm;
  crossValidationBusy: boolean;
  crossValidationJob: SiteJobRecord | null;
  crossValidationProgress: SiteJobRecord["result"] extends { progress?: infer T } ? T : unknown;
  crossValidationPercent: number;
  setCrossValidationForm: Dispatch<SetStateAction<CrossValidationForm>>;
  setSelectedReportId: Dispatch<SetStateAction<string | null>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
  formatTrainingStage: (stage: string | null | undefined) => string;
  getFoldConfusionMatrix: (fold: CrossValidationFoldRecord | null | undefined) => number[][] | null;
  onRunCrossValidation: () => void;
};

function MatrixCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: Array<[string, string, string]>;
}) {
  return (
    <Card as="section" variant="nested" className="grid gap-4 p-5">
      <SectionHeader title={title} titleAs="h4" description={subtitle} />
      <div className="grid gap-2">
        {rows.map(([col1, col2, col3], index) => (
          <div
            key={`${title}-${index}`}
            className={`grid gap-3 rounded-[18px] border border-border px-4 py-3 text-sm md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))] ${
              index === 0 ? "bg-surface text-muted font-medium" : "bg-surface-muted/80 text-ink"
            }`}
          >
            <span>{col1}</span>
            <span>{col2}</span>
            <span>{col3}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CrossValidationSection({
  locale,
  notAvailableLabel,
  selectedSiteId,
  crossValidationReports,
  selectedReportId,
  selectedReport,
  selectedReportConfusion,
  crossValidationForm,
  crossValidationBusy,
  crossValidationJob,
  crossValidationProgress,
  crossValidationPercent,
  setCrossValidationForm,
  setSelectedReportId,
  formatDateTime,
  formatMetric,
  formatTrainingStage,
  getFoldConfusionMatrix,
  onRunCrossValidation,
}: Props) {
  const isDualInputArchitecture = crossValidationForm.architecture === "dual_input_concat";
  const effectiveCropMode = isDualInputArchitecture ? "paired" : crossValidationForm.crop_mode;
  const effectiveCaseAggregation = ATTENTION_MIL_ARCHITECTURES.has(crossValidationForm.architecture)
    ? "attention_mil"
    : crossValidationForm.case_aggregation;
  const progressState = crossValidationProgress as
    | {
        stage?: string;
        fold_index?: number;
        num_folds?: number;
        epoch?: number;
        epochs?: number;
        val_acc?: number;
        message?: string;
      }
    | null;

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Cross-validation", "교차 검증")}</div>}
        title={pick(locale, "Patient-level fold review", "환자 단위 fold 검토")}
        titleAs="h3"
        description={pick(
          locale,
          "Configure patient-level folds, run cross-validation on the selected hospital, and review saved reports by matrix and aggregate metrics.",
          "선택한 병원의 환자 단위 fold를 구성하고 교차 검증을 실행한 뒤, 저장된 리포트를 confusion matrix와 aggregate metric 기준으로 검토합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{`${crossValidationReports.length} ${pick(locale, "report(s)", "리포트")}`}</span>}
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <Field label={pick(locale, "Architecture", "아키텍처")}>
          <select
            value={crossValidationForm.architecture}
            onChange={(event) =>
              setCrossValidationForm((current) => ({
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
            value={crossValidationForm.execution_mode}
            onChange={(event) =>
              setCrossValidationForm((current) => ({
                ...current,
                execution_mode: event.target.value as "auto" | "cpu" | "gpu",
              }))
            }
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
              setCrossValidationForm((current) => ({
                ...current,
                crop_mode: event.target.value as "automated" | "manual" | "paired",
              }))
            }
          >
            <option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option>
            <option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option>
            {isDualInputArchitecture ? <option value="paired">{pick(locale, "Paired cornea + lesion", "각막 + 병변 paired")}</option> : null}
          </select>
        </Field>
        <Field label={pick(locale, "Visit aggregation", "Visit 집계 방식")}>
          <select
            value={effectiveCaseAggregation}
            disabled={ATTENTION_MIL_ARCHITECTURES.has(crossValidationForm.architecture)}
            onChange={(event) =>
              setCrossValidationForm((current) => ({
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
        <Field label={pick(locale, "Folds", "폴드 수")}>
          <input
            type="number"
            min={3}
            max={5}
            value={crossValidationForm.num_folds}
            onChange={(event) => setCrossValidationForm((current) => ({ ...current, num_folds: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Epochs", "에폭")}>
          <input
            type="number"
            min={1}
            value={crossValidationForm.epochs}
            onChange={(event) => setCrossValidationForm((current) => ({ ...current, epochs: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Batch size", "배치 크기")}>
          <input
            type="number"
            min={1}
            value={crossValidationForm.batch_size}
            onChange={(event) => setCrossValidationForm((current) => ({ ...current, batch_size: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Learning rate", "학습률")}>
          <input
            type="number"
            min={0.00001}
            step="0.00001"
            value={crossValidationForm.learning_rate}
            onChange={(event) => setCrossValidationForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Validation split", "검증 비율")}>
          <input
            type="number"
            min={0.1}
            max={0.4}
            step="0.05"
            value={crossValidationForm.val_split}
            onChange={(event) => setCrossValidationForm((current) => ({ ...current, val_split: Number(event.target.value) }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-surface-muted/70 p-4">
        <button
          type="button"
          className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition ${
            crossValidationForm.use_pretrained
              ? "border-brand/20 bg-brand-soft text-brand"
              : "border-border bg-surface text-muted"
          }`}
          onClick={() => setCrossValidationForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}
        >
          {crossValidationForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}
        </button>
        <Button type="button" variant="primary" disabled={crossValidationBusy || !selectedSiteId} onClick={onRunCrossValidation}>
          {crossValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run cross-validation", "교차 검증 실행")}
        </Button>
      </div>

      {crossValidationJob ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Cross-validation progress", "교차 검증 진행 상태")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{formatTrainingStage(progressState?.stage ?? null)}</span>}
          />
          <div className="h-2.5 overflow-hidden rounded-full bg-brand/10" aria-hidden="true">
            <div className="h-full rounded-full bg-brand" style={{ width: `${crossValidationPercent}%` }} />
          </div>
          <MetricGrid columns={4}>
            <MetricItem value={`${crossValidationPercent}%`} label={pick(locale, "Progress", "진행률")} />
            <MetricItem
              value={
                progressState?.fold_index && progressState?.num_folds
                  ? `${progressState.fold_index} / ${progressState.num_folds}`
                  : notAvailableLabel
              }
              label={pick(locale, "Fold", "폴드")}
            />
            <MetricItem
              value={
                progressState?.epoch && progressState?.epochs
                  ? `${progressState.epoch} / ${progressState.epochs}`
                  : notAvailableLabel
              }
              label={pick(locale, "Epoch", "에폭")}
            />
            <MetricItem
              value={typeof progressState?.val_acc === "number" ? progressState.val_acc.toFixed(3) : notAvailableLabel}
              label={pick(locale, "Val acc", "검증 정확도")}
            />
          </MetricGrid>
          <p className="m-0 text-sm leading-6 text-muted">
            {progressState?.message
              ? progressState.message
              : pick(locale, "Waiting for the cross-validation worker to report progress.", "교차 검증 작업 상태를 기다리는 중입니다.")}
          </p>
        </Card>
      ) : null}

      {crossValidationReports.length > 0 ? (
        <div className="grid gap-4">
          <Field label={pick(locale, "Saved report", "저장된 리포트")}>
            <select value={selectedReportId ?? ""} onChange={(event) => setSelectedReportId(event.target.value)}>
              {crossValidationReports.map((report) => (
                <option key={report.cross_validation_id} value={report.cross_validation_id}>
                  {`${report.cross_validation_id} · ${report.architecture} · ${formatDateTime(report.created_at, notAvailableLabel)}`}
                </option>
              ))}
            </select>
          </Field>

          {selectedReport ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {["AUROC", "accuracy", "sensitivity", "specificity", "F1"].map((metricName) => (
                <MetricItem
                  key={metricName}
                  value={formatMetric(selectedReport.aggregate_metrics[metricName]?.mean, notAvailableLabel)}
                  label={
                    metricName === "accuracy"
                      ? pick(locale, "Accuracy", "정확도")
                      : metricName === "sensitivity"
                        ? pick(locale, "Sensitivity", "민감도")
                        : metricName === "specificity"
                          ? pick(locale, "Specificity", "특이도")
                          : metricName
                  }
                />
              ))}
            </div>
          ) : null}

          {selectedReport && selectedReportConfusion ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <MatrixCard
                title={pick(locale, "Confusion matrix", "Confusion matrix")}
                subtitle={pick(locale, "Aggregated across folds", "전체 fold 합산")}
                rows={[
                  [
                    pick(locale, "Actual / predicted", "실제 / 예측"),
                    pick(locale, "Bacterial", "세균"),
                    pick(locale, "Fungal", "진균"),
                  ],
                  [pick(locale, "Bacterial", "세균"), String(selectedReportConfusion[0][0]), String(selectedReportConfusion[0][1])],
                  [pick(locale, "Fungal", "진균"), String(selectedReportConfusion[1][0]), String(selectedReportConfusion[1][1])],
                ]}
              />

              <MatrixCard
                title={pick(locale, "Fold-by-fold matrix", "fold별 matrix")}
                subtitle={`${selectedReport.fold_results.length} ${pick(locale, "folds", "fold")}`}
                rows={[
                  [pick(locale, "Fold", "fold"), pick(locale, "TN / FP", "TN / FP"), pick(locale, "FN / TP", "FN / TP")],
                  ...selectedReport.fold_results.map((fold) => {
                    const matrix = getFoldConfusionMatrix(fold);
                    return [
                      String(fold.fold_index),
                      matrix ? `${matrix[0][0]} / ${matrix[0][1]}` : notAvailableLabel,
                      matrix ? `${matrix[1][0]} / ${matrix[1][1]}` : notAvailableLabel,
                    ] as [string, string, string];
                  }),
                ]}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className={emptySurfaceClass}>
          {pick(locale, "No cross-validation report has been saved for this hospital yet.", "이 병원에는 아직 저장된 교차 검증 리포트가 없습니다.")}
        </div>
      )}
    </Card>
  );
}
