"use client";

import type { ReactNode } from "react";

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
  return (
    <>
      <section className="panel-card">
        <div className="panel-card-head validation-panel-head">
          <strong className="validation-panel-title">{pick(locale, "Validation insight", "검증 인사이트")}</strong>
          <div className="validation-panel-actions">
            <span className="validation-panel-id">
              {validationResult ? validationResult.summary.validation_id : pick(locale, "Not run yet", "아직 실행되지 않음")}
            </span>
            <button type="button" className="ghost-button compact-ghost-button validation-run-button" onClick={onRunValidation} disabled={validationBusy || !hasSelectedCase || !canRunValidation}>
              {validationBusy ? pick(locale, "Validating...", "검증 중...") : pick(locale, "Run AI validation", "AI 검증 실행")}
            </button>
          </div>
        </div>
        {validationResult ? (
          <div className="panel-stack">
            <div className="validation-summary-card">
              <div className="validation-badge-row">
                <span className={`validation-badge ${validationResult.summary.is_correct ? "tone-match" : "tone-mismatch"}`}>
                  {validationResult.summary.is_correct ? pick(locale, "Match", "일치") : pick(locale, "Mismatch", "불일치")}
                </span>
                <span className={`validation-badge tone-${validationConfidenceTone}`}>
                  {validationConfidence}% {pick(locale, "confidence", "신뢰도")}
                </span>
                <span className="validation-badge tone-neutral">{validationResult.execution_device}</span>
              </div>
              <div className="validation-pair-grid">
                <div>
                  <span>{pick(locale, "Predicted", "예측")}</span>
                  <strong>{validationResult.summary.predicted_label}</strong>
                </div>
                <div>
                  <span>{pick(locale, "Culture label", "배양 라벨")}</span>
                  <strong>{validationResult.summary.true_label}</strong>
                </div>
              </div>
              <div className="validation-gauge-meta">
                <span>{pick(locale, "Model confidence", "모델 신뢰도")}</span>
                <strong>{formatProbability(validationPredictedConfidence, common.notAvailable)}</strong>
              </div>
              <div className="validation-gauge" aria-hidden="true">
                <div className={`validation-gauge-fill tone-${validationConfidenceTone}`} style={{ width: `${validationConfidence}%` }} />
              </div>
            </div>
            <div className="panel-metric-grid">
              <div>
                <strong>{validationResult.summary.predicted_label}</strong>
                <span>{pick(locale, "predicted", "예측값")}</span>
              </div>
              <div>
                <strong>{validationResult.summary.true_label}</strong>
                <span>{pick(locale, "culture label", "배양 라벨")}</span>
              </div>
              <div>
                <strong>{formatProbability(validationPredictedConfidence, common.notAvailable)}</strong>
                <span>{pick(locale, "confidence", "신뢰도")}</span>
              </div>
              <div>
                <strong>{validationResult.execution_device}</strong>
                <span>{pick(locale, "device", "디바이스")}</span>
              </div>
            </div>
            <p>
              {pick(locale, "Model", "모델")} {validationResult.model_version.version_name} ({validationResult.model_version.architecture})
              {" · "}
              {validationResult.model_version.crop_mode ? pick(locale, `mode ${validationResult.model_version.crop_mode}`, `모드 ${validationResult.model_version.crop_mode}`) : null}
              {validationResult.model_version.crop_mode ? " · " : ""}
              {validationResult.summary.is_correct
                ? pick(locale, "prediction matched culture", "예측이 배양 결과와 일치합니다")
                : pick(locale, "prediction diverged from culture", "예측이 배양 결과와 다릅니다")}
            </p>
            {artifactContent}
          </div>
        ) : (
          <p>{pick(locale, "Run validation from this panel to generate crop artifacts, Grad-CAM, and a saved case-level prediction.", "이 패널에서 검증을 실행하면 crop 아티팩트, Grad-CAM, 케이스 단위 예측을 생성할 수 있습니다.")}</p>
        )}
      </section>

      <section className="panel-card">
        <div className="panel-card-head">
          <strong>{pick(locale, "Model compare", "Model compare")}</strong>
          <button className="ghost-button" type="button" onClick={onRunModelCompare} disabled={modelCompareBusy || !hasSelectedCase || selectedCompareModelVersionIds.length === 0}>
            {modelCompareBusy ? pick(locale, "Comparing...", "비교 중...") : pick(locale, "Compare selected models", "선택 모델 비교")}
          </button>
        </div>
        <p>
          {pick(locale, "Run the same case through the latest ViT, Swin, ConvNeXt-Tiny, and DenseNet121 versions to inspect prediction differences.", "같은 케이스를 최신 ViT, Swin, ConvNeXt-Tiny, DenseNet121 버전으로 동시에 돌려 예측 차이를 확인합니다.")}
        </p>
        <div className="panel-meta">
          {compareModelCandidates.map((modelVersion) => (
            <label key={modelVersion.version_id} className="toggle-pill">
              <input type="checkbox" checked={selectedCompareModelVersionIds.includes(modelVersion.version_id)} onChange={(event) => onToggleModelVersion(modelVersion.version_id, event.target.checked)} />
              <span>{modelVersion.architecture}</span>
            </label>
          ))}
        </div>
        {modelCompareResult ? (
          <div className="ops-list">
            {modelCompareResult.comparisons.map((item, index) => (
              <article key={item.model_version?.version_id ?? item.model_version_id ?? `compare-${index}`} className="ops-item">
                <div className="panel-card-head">
                  <strong>{item.model_version?.version_name ?? item.model_version?.architecture ?? item.model_version_id ?? common.notAvailable}</strong>
                  <span>{item.model_version?.architecture ?? common.notAvailable}</span>
                </div>
                {item.error ? (
                  <div className="panel-image-fallback">{item.error}</div>
                ) : (
                  <>
                    <div className="panel-meta">
                      <span>{pick(locale, "Predicted", "예측")} {item.summary?.predicted_label ?? common.notAvailable}</span>
                      <span>{pick(locale, "Culture", "배양")} {item.summary?.true_label ?? common.notAvailable}</span>
                      <span>{pick(locale, "Confidence", "신뢰도")} {formatProbability(item.summary?.prediction_probability, common.notAvailable)}</span>
                      <span>{pick(locale, "Validation", "검증")} {item.summary?.is_correct ? pick(locale, "match", "일치") : pick(locale, "mismatch", "불일치")}</span>
                    </div>
                    <div className="panel-meta">
                      <span>{pick(locale, "Crop", "Crop")} {item.model_version?.crop_mode ?? common.notAvailable}</span>
                      <span>{pick(locale, "Artifacts", "Artifacts")} {item.artifact_availability?.gradcam ? "Grad-CAM" : pick(locale, "compare-only", "비교 전용")}</span>
                      <span>{pick(locale, "Validation ID", "Validation ID")} {item.summary?.validation_id ?? common.notAvailable}</span>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
