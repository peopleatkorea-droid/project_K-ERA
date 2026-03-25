"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass } from "../ui/workspace-patterns";
import type { SiteJobRecord, SslPretrainingResponse } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const SSL_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "swin", label: "Swin" },
  { value: "vit", label: "ViT" },
  { value: "dinov2", label: "DINOv2" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
];

type SslForm = {
  archive_base_dir: string;
  architecture: string;
  init_mode: "imagenet" | "random";
  method: "byol";
  execution_mode: "auto" | "cpu" | "gpu";
  image_size: number;
  batch_size: number;
  epochs: number;
  learning_rate: number;
  weight_decay: number;
  num_workers: number;
  min_patient_quality: "low" | "medium" | "high";
  include_review_rows: boolean;
  use_amp: boolean;
};

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  selectedSiteId: string | null;
  selectedSiteLabel: string | null;
  sslForm: SslForm;
  sslBusy: boolean;
  sslJob: SiteJobRecord | null;
  sslProgress: SiteJobRecord["result"] extends { progress?: infer T } ? T : unknown;
  sslPercent: number;
  sslResult: SslPretrainingResponse | null;
  setSslForm: Dispatch<SetStateAction<SslForm>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  formatTrainingStage: (stage: string | null | undefined) => string;
  onPickArchiveDirectory: () => void;
  onRunSslPretraining: () => void;
  onCancelSslPretraining: () => void;
  onRefreshSslStatus: () => void;
};

function pathDisplay(path: string | null | undefined, emptyLabel: string) {
  const normalized = String(path || "").trim();
  return normalized || emptyLabel;
}

export function SslSection({
  locale,
  notAvailableLabel,
  selectedSiteId,
  selectedSiteLabel,
  sslForm,
  sslBusy,
  sslJob,
  sslProgress,
  sslPercent,
  sslResult,
  setSslForm,
  formatDateTime,
  formatTrainingStage,
  onPickArchiveDirectory,
  onRunSslPretraining,
  onCancelSslPretraining,
  onRefreshSslStatus,
}: Props) {
  const progressState = sslProgress as
    | {
        stage?: string | null;
        message?: string | null;
        epoch?: number | null;
        epochs?: number | null;
        current_step_in_epoch?: number | null;
        steps_per_epoch?: number | null;
        last_loss?: number | null;
        records_count?: number | null;
        manifest_clean_images?: number | null;
        manifest_anomaly_images?: number | null;
        output_dir?: string | null;
        archive_base_dir?: string | null;
      }
    | null;
  const isActive = ["queued", "running", "cancelling"].includes(String(sslJob?.status || "").trim().toLowerCase());
  const manifest = sslResult?.run.manifest ?? null;
  const training = sslResult?.run.training ?? null;
  const manifestCleanImages = progressState?.manifest_clean_images ?? manifest?.clean_images ?? null;
  const manifestAnomalyImages = progressState?.manifest_anomaly_images ?? manifest?.anomaly_images ?? null;
  const trainedRecords = progressState?.records_count ?? training?.records_count ?? null;

  return (
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "SSL pretraining", "SSL 사전학습")}</div>}
        title={pick(locale, "Anterior-segment SSL archive runs", "전안부 SSL 아카이브 실행")}
        titleAs="h3"
        description={pick(
          locale,
          "Select an external image archive, auto-generate the manifest, and run BYOL pretraining on a desktop worker.",
          "외부 이미지 아카이브를 선택하면 manifest를 자동 생성한 뒤 데스크톱 worker에서 BYOL 사전학습을 실행합니다."
        )}
        aside={
          <span className={docSiteBadgeClass}>
            {selectedSiteLabel ?? selectedSiteId ?? pick(locale, "No site selected", "병원 미선택")}
          </span>
        }
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <Field as="div" label={pick(locale, "Archive folder", "원본 폴더")} unstyledControl>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-12 w-full rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/4"
              value={sslForm.archive_base_dir}
              onChange={(event) => setSslForm((current) => ({ ...current, archive_base_dir: event.target.value }))}
              placeholder="E:\\전안부 사진"
            />
            <Button type="button" variant="ghost" onClick={onPickArchiveDirectory}>
              {pick(locale, "Browse", "찾아보기")}
            </Button>
          </div>
        </Field>
        <Field label={pick(locale, "Architecture", "아키텍처")}>
          <select
            value={sslForm.architecture}
            onChange={(event) => setSslForm((current) => ({ ...current, architecture: event.target.value }))}
          >
            {SSL_ARCHITECTURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={pick(locale, "Initialization", "초기화")}>
          <select
            value={sslForm.init_mode}
            onChange={(event) => setSslForm((current) => ({ ...current, init_mode: event.target.value as "imagenet" | "random" }))}
          >
            <option value="imagenet">{pick(locale, "ImageNet", "ImageNet")}</option>
            <option value="random">{pick(locale, "Random", "랜덤")}</option>
          </select>
        </Field>
        <Field label={pick(locale, "Execution mode", "실행 모드")}>
          <select
            value={sslForm.execution_mode}
            onChange={(event) => setSslForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}
          >
            <option value="auto">{pick(locale, "auto", "자동")}</option>
            <option value="cpu">CPU</option>
            <option value="gpu">GPU</option>
          </select>
        </Field>
        <Field label={pick(locale, "Epochs", "에폭")}>
          <input
            type="number"
            min={1}
            value={sslForm.epochs}
            onChange={(event) => setSslForm((current) => ({ ...current, epochs: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Batch size", "배치 크기")}>
          <input
            type="number"
            min={1}
            value={sslForm.batch_size}
            onChange={(event) => setSslForm((current) => ({ ...current, batch_size: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Learning rate", "학습률")}>
          <input
            type="number"
            min={0.00001}
            step="0.00001"
            value={sslForm.learning_rate}
            onChange={(event) => setSslForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Workers", "워커 수")}>
          <input
            type="number"
            min={0}
            value={sslForm.num_workers}
            onChange={(event) => setSslForm((current) => ({ ...current, num_workers: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Image size", "이미지 크기")}>
          <input
            type="number"
            min={64}
            step={32}
            value={sslForm.image_size}
            onChange={(event) => setSslForm((current) => ({ ...current, image_size: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Weight decay", "가중치 감쇠")}>
          <input
            type="number"
            min={0}
            step="0.00001"
            value={sslForm.weight_decay}
            onChange={(event) => setSslForm((current) => ({ ...current, weight_decay: Number(event.target.value) }))}
          />
        </Field>
        <Field label={pick(locale, "Min patient quality", "최소 환자 폴더 품질")}>
          <select
            value={sslForm.min_patient_quality}
            onChange={(event) =>
              setSslForm((current) => ({
                ...current,
                min_patient_quality: event.target.value as "low" | "medium" | "high",
              }))
            }
          >
            <option value="high">{pick(locale, "high only", "high만")}</option>
            <option value="medium">{pick(locale, "medium+", "medium 이상")}</option>
            <option value="low">{pick(locale, "include low", "low 포함")}</option>
          </select>
        </Field>
        <Field as="div" label={pick(locale, "Dataset filters", "데이터 필터")} unstyledControl>
          <div className="grid gap-2 rounded-[18px] border border-border bg-surface px-4 py-3 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sslForm.include_review_rows}
                onChange={(event) => setSslForm((current) => ({ ...current, include_review_rows: event.target.checked }))}
              />
              <span>{pick(locale, "Include review rows", "review 행 포함")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sslForm.use_amp}
                onChange={(event) => setSslForm((current) => ({ ...current, use_amp: event.target.checked }))}
              />
              <span>{pick(locale, "Use AMP mixed precision", "AMP 혼합정밀도 사용")}</span>
            </label>
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="primary" onClick={onRunSslPretraining} disabled={!selectedSiteId || isActive || sslBusy}>
          {isActive ? pick(locale, "SSL running...", "SSL 실행 중...") : pick(locale, "Start SSL pretraining", "SSL 학습 시작")}
        </Button>
        <Button type="button" variant="ghost" onClick={onRefreshSslStatus} disabled={!selectedSiteId || sslBusy}>
          {pick(locale, "Refresh status", "상태 새로고침")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelSslPretraining} disabled={!isActive || !sslJob}>
          {pick(locale, "Cancel run", "실행 중단")}
        </Button>
      </div>

      {sslJob ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Run progress", "실행 진행 상태")}</div>}
            title={pick(locale, "Manifest and SSL training status", "manifest 및 SSL 학습 상태")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{formatTrainingStage(progressState?.stage ?? sslJob.status)}</span>}
          />
          <div className="h-3 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${sslPercent}%` }} />
          </div>
          <MetricGrid columns={4}>
            <MetricItem value={`${sslPercent}%`} label={pick(locale, "Progress", "진행률")} />
            <MetricItem value={manifestCleanImages ?? notAvailableLabel} label={pick(locale, "Clean images", "정상 이미지")} />
            <MetricItem value={manifestAnomalyImages ?? notAvailableLabel} label={pick(locale, "Anomalies", "예외 이미지")} />
            <MetricItem
              value={
                progressState?.epoch && progressState?.epochs
                  ? `${progressState.epoch} / ${progressState.epochs}`
                  : notAvailableLabel
              }
              label={pick(locale, "Epoch", "에폭")}
            />
            <MetricItem
              value={
                progressState?.current_step_in_epoch && progressState?.steps_per_epoch
                  ? `${progressState.current_step_in_epoch} / ${progressState.steps_per_epoch}`
                  : notAvailableLabel
              }
              label={pick(locale, "Step", "스텝")}
            />
            <MetricItem
              value={typeof progressState?.last_loss === "number" ? progressState.last_loss.toFixed(4) : notAvailableLabel}
              label={pick(locale, "Loss", "손실")}
            />
            <MetricItem value={trainedRecords ?? notAvailableLabel} label={pick(locale, "Training records", "학습 레코드")} />
            <MetricItem value={formatDateTime(sslJob.started_at ?? sslJob.created_at, notAvailableLabel)} label={pick(locale, "Started", "시작")} />
            <MetricItem value={formatDateTime(sslJob.updated_at ?? sslJob.created_at, notAvailableLabel)} label={pick(locale, "Updated", "업데이트")} />
            <MetricItem value={String(sslJob.status || "").trim() || notAvailableLabel} label={pick(locale, "Job status", "잡 상태")} />
          </MetricGrid>
          <div className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
            {progressState?.message
              ? progressState.message
              : pick(locale, "Waiting for the SSL worker to report progress.", "SSL worker 진행 상태를 기다리는 중입니다.")}
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
              <strong className="block text-ink">{pick(locale, "Archive", "원본 폴더")}</strong>
              <span className="break-all">{pathDisplay(progressState?.archive_base_dir ?? sslForm.archive_base_dir, notAvailableLabel)}</span>
            </div>
            <div className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
              <strong className="block text-ink">{pick(locale, "Training output", "학습 출력")}</strong>
              <span className="break-all">{pathDisplay(progressState?.output_dir ?? training?.summary_path, notAvailableLabel)}</span>
            </div>
          </div>
        </Card>
      ) : (
        <div className={emptySurfaceClass}>
          {pick(locale, "No SSL run has started for this site yet.", "이 병원에서 아직 SSL 실행을 시작하지 않았습니다.")}
        </div>
      )}

      {sslResult ? (
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Latest result", "최근 결과")}</div>}
            title={pick(locale, "Saved manifest and encoder artifacts", "저장된 manifest 및 인코더 산출물")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{sslResult.execution_device.toUpperCase()}</span>}
          />
          <MetricGrid columns={4}>
            <MetricItem value={sslResult.run.manifest.total_supported_images ?? notAvailableLabel} label={pick(locale, "Total images", "전체 이미지")} />
            <MetricItem value={sslResult.run.manifest.clean_images ?? notAvailableLabel} label={pick(locale, "Clean manifest", "clean manifest")} />
            <MetricItem value={sslResult.run.manifest.anomaly_images ?? notAvailableLabel} label={pick(locale, "Anomalies", "예외")} />
            <MetricItem value={sslResult.run.training.records_count ?? notAvailableLabel} label={pick(locale, "Trained records", "학습 레코드")} />
            <MetricItem value={sslResult.run.run_id} label={pick(locale, "Run ID", "실행 ID")} />
          </MetricGrid>
          <div className="grid gap-3">
            {[
              [pick(locale, "Archive", "원본 폴더"), sslResult.run.archive_base_dir],
              [pick(locale, "Clean manifest", "clean manifest"), sslResult.run.manifest.clean_manifest_path ?? null],
              [pick(locale, "Anomaly manifest", "anomaly manifest"), sslResult.run.manifest.anomaly_manifest_path ?? null],
              [pick(locale, "Manifest summary", "manifest summary"), sslResult.run.manifest.summary_path ?? null],
              [pick(locale, "Encoder checkpoint", "인코더 체크포인트"), sslResult.run.training.encoder_latest_path],
              [pick(locale, "Training summary", "학습 요약"), sslResult.run.training.summary_path],
            ].map(([label, value]) => (
              <div key={`${label}-${value ?? "empty"}`} className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
                <strong className="block text-ink">{label}</strong>
                <span className="break-all">{pathDisplay(value, notAvailableLabel)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </Card>
  );
}
