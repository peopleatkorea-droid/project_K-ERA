"use client";

import type { Dispatch, SetStateAction } from "react";

import type { CrossValidationFoldRecord, CrossValidationReport, SiteJobRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

const TRAINING_ARCHITECTURE_OPTIONS = [
  { value: "densenet121", label: "DenseNet121" },
  { value: "convnext_tiny", label: "ConvNeXt-Tiny" },
  { value: "vit", label: "ViT" },
  { value: "swin", label: "Swin" },
  { value: "efficientnet_v2_s", label: "EfficientNetV2-S" },
];

type CrossValidationForm = {
  architecture: string;
  execution_mode: "auto" | "cpu" | "gpu";
  crop_mode: "automated" | "manual";
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
  return (
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Cross-validation", "교차 검증")}</div>
          <h3>{pick(locale, "Patient-level fold review", "환자 단위 fold 검토")}</h3>
        </div>
        <div className="doc-site-badge">{crossValidationReports.length} {pick(locale, "report(s)", "리포트")}</div>
      </div>
      <div className="ops-form-grid ops-form-grid-wide">
        <label className="inline-field"><span>{pick(locale, "Architecture", "아키텍처")}</span><select value={crossValidationForm.architecture} onChange={(event) => setCrossValidationForm((current) => ({ ...current, architecture: event.target.value }))}>{TRAINING_ARCHITECTURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="inline-field"><span>{pick(locale, "Execution mode", "실행 모드")}</span><select value={crossValidationForm.execution_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, execution_mode: event.target.value as "auto" | "cpu" | "gpu" }))}><option value="auto">{pick(locale, "auto", "자동")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
        <label className="inline-field"><span>{pick(locale, "Crop mode", "Crop 모드")}</span><select value={crossValidationForm.crop_mode} onChange={(event) => setCrossValidationForm((current) => ({ ...current, crop_mode: event.target.value as "automated" | "manual" }))}><option value="automated">{pick(locale, "Automated cornea crop", "Automated 각막 crop")}</option><option value="manual">{pick(locale, "Manual lesion crop", "Manual 병변 crop")}</option></select></label>
        <label className="inline-field"><span>{pick(locale, "Folds", "폴드 수")}</span><input type="number" min={3} max={5} value={crossValidationForm.num_folds} onChange={(event) => setCrossValidationForm((current) => ({ ...current, num_folds: Number(event.target.value) }))} /></label>
        <label className="inline-field"><span>{pick(locale, "Epochs", "에폭")}</span><input type="number" min={1} value={crossValidationForm.epochs} onChange={(event) => setCrossValidationForm((current) => ({ ...current, epochs: Number(event.target.value) }))} /></label>
        <label className="inline-field"><span>{pick(locale, "Batch size", "배치 크기")}</span><input type="number" min={1} value={crossValidationForm.batch_size} onChange={(event) => setCrossValidationForm((current) => ({ ...current, batch_size: Number(event.target.value) }))} /></label>
        <label className="inline-field"><span>{pick(locale, "Learning rate", "학습률")}</span><input type="number" min={0.00001} step="0.00001" value={crossValidationForm.learning_rate} onChange={(event) => setCrossValidationForm((current) => ({ ...current, learning_rate: Number(event.target.value) }))} /></label>
        <label className="inline-field"><span>{pick(locale, "Validation split", "검증 비율")}</span><input type="number" min={0.1} max={0.4} step="0.05" value={crossValidationForm.val_split} onChange={(event) => setCrossValidationForm((current) => ({ ...current, val_split: Number(event.target.value) }))} /></label>
      </div>
      <div className="workspace-actions"><button className={`toggle-pill ${crossValidationForm.use_pretrained ? "active" : ""}`} type="button" onClick={() => setCrossValidationForm((current) => ({ ...current, use_pretrained: !current.use_pretrained }))}>{crossValidationForm.use_pretrained ? pick(locale, "Pretrained init", "사전학습 초기화") : pick(locale, "Scratch init", "처음부터 학습")}</button></div>
      <div className="doc-footer"><div><strong>{pick(locale, "Saved reports stay selectable", "저장된 리포트 선택 가능")}</strong><p>{pick(locale, "Cross-validation JSON reports are read back from the existing validation workspace.", "교차 검증 JSON 리포트는 기존 검증 워크스페이스에서 다시 읽어옵니다.")}</p></div><button className="primary-workspace-button" type="button" disabled={crossValidationBusy || !selectedSiteId} onClick={onRunCrossValidation}>{crossValidationBusy ? pick(locale, "Running...", "실행 중...") : pick(locale, "Run cross-validation", "교차 검증 실행")}</button></div>
      {crossValidationJob ? (
        <div className="ops-card training-progress-card">
          <div className="panel-card-head"><strong>{pick(locale, "Cross-validation progress", "교차 검증 진행 상태")}</strong><span>{formatTrainingStage((crossValidationProgress as { stage?: string } | null)?.stage ?? null)}</span></div>
          <div className="training-progress-bar" aria-hidden="true"><div className="training-progress-fill" style={{ width: `${crossValidationPercent}%` }} /></div>
          <div className="panel-metric-grid training-progress-grid">
            <div><strong>{crossValidationPercent}%</strong><span>{pick(locale, "progress", "진행률")}</span></div>
            <div><strong>{(crossValidationProgress as { fold_index?: number; num_folds?: number } | null)?.fold_index && (crossValidationProgress as { fold_index?: number; num_folds?: number } | null)?.num_folds ? `${(crossValidationProgress as { fold_index: number }).fold_index} / ${(crossValidationProgress as { num_folds: number }).num_folds}` : notAvailableLabel}</strong><span>{pick(locale, "fold", "fold")}</span></div>
            <div><strong>{(crossValidationProgress as { epoch?: number; epochs?: number } | null)?.epoch && (crossValidationProgress as { epoch?: number; epochs?: number } | null)?.epochs ? `${(crossValidationProgress as { epoch: number }).epoch} / ${(crossValidationProgress as { epochs: number }).epochs}` : notAvailableLabel}</strong><span>{pick(locale, "epoch", "에폭")}</span></div>
            <div><strong>{typeof (crossValidationProgress as { val_acc?: number } | null)?.val_acc === "number" ? (crossValidationProgress as { val_acc: number }).val_acc.toFixed(3) : notAvailableLabel}</strong><span>{pick(locale, "val acc", "검증 정확도")}</span></div>
          </div>
          <p className="training-progress-copy">{(crossValidationProgress as { message?: string } | null)?.message ? (crossValidationProgress as { message: string }).message : pick(locale, "Waiting for the cross-validation worker to report progress.", "교차 검증 작업 상태를 기다리는 중입니다.")}</p>
        </div>
      ) : null}
      {crossValidationReports.length > 0 ? (
        <div className="ops-stack">
          <label className="inline-field"><span>{pick(locale, "Saved report", "저장된 리포트")}</span><select value={selectedReportId ?? ""} onChange={(event) => setSelectedReportId(event.target.value)}>{crossValidationReports.map((report) => <option key={report.cross_validation_id} value={report.cross_validation_id}>{report.cross_validation_id} · {report.architecture} · {formatDateTime(report.created_at, notAvailableLabel)}</option>)}</select></label>
          {selectedReport ? <div className="panel-metric-grid">{["AUROC", "accuracy", "sensitivity", "specificity", "F1"].map((metricName) => <div key={metricName}><strong>{formatMetric(selectedReport.aggregate_metrics[metricName]?.mean, notAvailableLabel)}</strong><span>{metricName === "accuracy" ? pick(locale, "accuracy", "정확도") : metricName === "sensitivity" ? pick(locale, "sensitivity", "민감도") : metricName === "specificity" ? pick(locale, "specificity", "특이도") : metricName}</span></div>)}</div> : null}
          {selectedReport && selectedReportConfusion ? (
            <div className="ops-dual-grid">
              <section className="ops-card">
                <div className="panel-card-head"><strong>{pick(locale, "Confusion matrix", "Confusion matrix")}</strong><span>{pick(locale, "Aggregated across folds", "전체 fold 합산")}</span></div>
                <div className="ops-table">
                  <div className="ops-table-row ops-table-head"><span>{pick(locale, "actual / predicted", "실제 / 예측")}</span><span>{pick(locale, "bacterial", "세균")}</span><span>{pick(locale, "fungal", "진균")}</span></div>
                  <div className="ops-table-row"><span>{pick(locale, "bacterial", "세균")}</span><span>{selectedReportConfusion[0][0]}</span><span>{selectedReportConfusion[0][1]}</span></div>
                  <div className="ops-table-row"><span>{pick(locale, "fungal", "진균")}</span><span>{selectedReportConfusion[1][0]}</span><span>{selectedReportConfusion[1][1]}</span></div>
                </div>
              </section>
              <section className="ops-card">
                <div className="panel-card-head"><strong>{pick(locale, "Fold-by-fold matrix", "fold별 matrix")}</strong><span>{selectedReport.fold_results.length} {pick(locale, "folds", "fold")}</span></div>
                <div className="ops-table">
                  <div className="ops-table-row ops-table-head"><span>{pick(locale, "fold", "fold")}</span><span>{pick(locale, "TN / FP", "TN / FP")}</span><span>{pick(locale, "FN / TP", "FN / TP")}</span></div>
                  {selectedReport.fold_results.map((fold) => {
                    const matrix = getFoldConfusionMatrix(fold);
                    return <div key={fold.fold_index} className="ops-table-row"><span>{fold.fold_index}</span><span>{matrix ? `${matrix[0][0]} / ${matrix[0][1]}` : notAvailableLabel}</span><span>{matrix ? `${matrix[1][0]} / ${matrix[1][1]}` : notAvailableLabel}</span></div>;
                  })}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      ) : <div className="empty-surface">{pick(locale, "No cross-validation report has been saved for this hospital yet.", "이 병원에는 아직 저장된 교차 검증 리포트가 없습니다.")}</div>}
    </section>
  );
}
