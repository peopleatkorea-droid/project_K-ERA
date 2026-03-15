"use client";

import type { Dispatch, SetStateAction } from "react";

import type { ModelUpdateRecord, ModelVersionRecord } from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";

type Props = {
  locale: Locale;
  notAvailableLabel: string;
  canManagePlatform: boolean;
  modelVersions: ModelVersionRecord[];
  currentModel: ModelVersionRecord | null;
  modelUpdates: ModelUpdateRecord[];
  selectedModelUpdate: ModelUpdateRecord | null;
  selectedApprovalReport: NonNullable<ModelUpdateRecord["approval_report"]> | null;
  selectedUpdatePreviewUrls: { source: string | null; roi: string | null; mask: string | null };
  modelUpdateReviewNotes: Record<string, string>;
  setSelectedModelUpdateId: Dispatch<SetStateAction<string | null>>;
  setModelUpdateReviewNotes: Dispatch<SetStateAction<Record<string, string>>>;
  formatDateTime: (value: string | null | undefined, emptyLabel?: string) => string;
  formatWeightPercent: (value: number | null | undefined) => string;
  formatMetric: (value: number | null | undefined, emptyLabel?: string) => string;
  formatQualityRecommendation: (recommendation: string | null | undefined) => string;
  translateQualityFlag: (flag: string) => string;
  onDeleteModelVersion: (version: ModelVersionRecord) => void;
  onModelUpdateReview: (decision: "approved" | "rejected") => void;
};

export function RegistrySection({
  locale,
  notAvailableLabel,
  canManagePlatform,
  modelVersions,
  currentModel,
  modelUpdates,
  selectedModelUpdate,
  selectedApprovalReport,
  selectedUpdatePreviewUrls,
  modelUpdateReviewNotes,
  setSelectedModelUpdateId,
  setModelUpdateReviewNotes,
  formatDateTime,
  formatWeightPercent,
  formatMetric,
  formatQualityRecommendation,
  translateQualityFlag,
  onDeleteModelVersion,
  onModelUpdateReview,
}: Props) {
  return (
    <section className="doc-surface">
      <div className="doc-title-row">
        <div>
          <div className="doc-eyebrow">{pick(locale, "Registry", "레지스트리")}</div>
          <h3>{pick(locale, "Model versions and update flow", "모델 버전 및 업데이트 흐름")}</h3>
        </div>
        <div className="doc-site-badge">{modelVersions.length} {pick(locale, "model(s)", "모델")}</div>
      </div>
      <div className="ops-dual-grid">
        <section className="ops-card">
          <div className="panel-card-head"><strong>{pick(locale, "Model versions", "모델 버전")}</strong><span>{currentModel?.version_name ?? notAvailableLabel}</span></div>
          {modelVersions.length === 0 ? <div className="empty-surface">{pick(locale, "No model version is registered yet.", "아직 등록된 모델 버전이 없습니다.")}</div> : <div className="ops-list">{modelVersions.slice().reverse().map((item) => <div key={item.version_id} className={`ops-item ${item.is_current ? "ops-item-active" : ""}`}><div className="panel-card-head"><strong>{item.version_name}</strong><span>{item.architecture}</span></div><div className="panel-meta"><span>{item.is_current ? pick(locale, "current", "현재") : item.stage ?? pick(locale, "stored", "보관됨")}</span><span>{formatDateTime(item.created_at, notAvailableLabel)}</span><span>{item.ready ? pick(locale, "ready", "준비됨") : pick(locale, "pending", "대기 중")}</span></div>{item.ensemble_weights ? <div className="panel-meta"><span>{pick(locale, "Ensemble", "앙상블")}</span><span>{pick(locale, "Automated", "Automated")} {formatWeightPercent(item.ensemble_weights.automated)}</span><span>{pick(locale, "Manual", "Manual")} {formatWeightPercent(item.ensemble_weights.manual)}</span></div> : null}{canManagePlatform ? <div className="workspace-actions"><button className="ghost-button compact-ghost-button" type="button" disabled={item.is_current} onClick={() => onDeleteModelVersion(item)}>{pick(locale, "Delete model", "모델 삭제")}</button></div> : null}</div>)}</div>}
        </section>
        <section className="ops-card">
          <div className="panel-card-head"><strong>{pick(locale, "Model updates", "모델 업데이트")}</strong><span>{modelUpdates.length}</span></div>
          {modelUpdates.length === 0 ? <div className="empty-surface">{pick(locale, "No model update has been recorded for the current filter.", "현재 필터에 기록된 모델 업데이트가 없습니다.")}</div> : <div className="ops-list">{modelUpdates.map((item) => <button key={item.update_id} className="ops-item ops-table-button" type="button" onClick={() => setSelectedModelUpdateId(item.update_id)}><div className="panel-card-head"><strong>{item.update_id}</strong><span>{item.status ?? pick(locale, "unknown", "알 수 없음")}</span></div><div className="panel-meta"><span>{item.site_id ?? pick(locale, "unknown hospital", "알 수 없는 병원")}</span><span>{item.architecture ?? pick(locale, "unknown architecture", "알 수 없는 아키텍처")}</span><span>{formatDateTime(item.created_at, notAvailableLabel)}</span></div></button>)}</div>}
        </section>
      </div>
      {selectedModelUpdate ? (
        <section className="ops-card">
          <div className="panel-card-head"><strong>{pick(locale, "Selected update", "선택한 업데이트")}</strong><span>{selectedModelUpdate.status ?? notAvailableLabel}</span></div>
          <div className="panel-meta"><span>{selectedModelUpdate.site_id ?? notAvailableLabel}</span><span>{selectedModelUpdate.case_reference_id ?? notAvailableLabel}</span><span>{selectedModelUpdate.architecture ?? notAvailableLabel}</span></div>
          {selectedModelUpdate.quality_summary ? (
            <section className="update-quality-card">
              <div className="panel-card-head"><strong>{pick(locale, "Automatic quality summary", "자동 품질 요약")}</strong><span>{formatQualityRecommendation(selectedModelUpdate.quality_summary.recommendation)}</span></div>
              <p className="update-quality-help">{pick(locale, "Image 25 + crop 25 + delta 25 + validation 25. Policy mismatch or invalid delta lowers the recommendation.", "이미지 25 + crop 25 + delta 25 + 검증 25점 기준입니다. 정책 불일치나 delta 이상이 있으면 권장 수준이 내려갑니다.")}</p>
              <div className="panel-metric-grid">
                <div><strong>{selectedModelUpdate.quality_summary.quality_score ?? notAvailableLabel}</strong><span>{pick(locale, "quality score", "품질 점수")}</span></div>
                <div><strong>{selectedModelUpdate.quality_summary.image_quality?.score ?? notAvailableLabel}</strong><span>{pick(locale, "image", "이미지")}</span></div>
                <div><strong>{selectedModelUpdate.quality_summary.crop_quality?.score ?? notAvailableLabel}</strong><span>{pick(locale, "crop", "crop")}</span></div>
                <div><strong>{selectedModelUpdate.quality_summary.delta_quality?.score ?? notAvailableLabel}</strong><span>{pick(locale, "delta", "delta")}</span></div>
                <div><strong>{selectedModelUpdate.quality_summary.validation_consistency?.status ?? notAvailableLabel}</strong><span>{pick(locale, "validation", "검증")}</span></div>
                <div><strong>{selectedModelUpdate.quality_summary.delta_quality?.l2_norm ?? notAvailableLabel}</strong><span>{pick(locale, "delta norm", "delta norm")}</span></div>
              </div>
              <div className="panel-meta">
                <span>{pick(locale, "Brightness", "밝기")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.mean_brightness, notAvailableLabel)}</span>
                <span>{pick(locale, "Contrast", "대비")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.contrast_stddev, notAvailableLabel)}</span>
                <span>{pick(locale, "Edge density", "경계 밀도")}: {formatMetric(selectedModelUpdate.quality_summary.image_quality?.edge_density, notAvailableLabel)}</span>
                <span>{pick(locale, "Crop ratio", "crop 비율")}: {formatMetric(selectedModelUpdate.quality_summary.crop_quality?.roi_area_ratio, notAvailableLabel)}</span>
              </div>
              {selectedModelUpdate.quality_summary.validation_consistency?.predicted_label ? (
                <div className="panel-meta">
                  <span>{pick(locale, "Predicted", "예측")}: {selectedModelUpdate.quality_summary.validation_consistency.predicted_label}</span>
                  <span>{pick(locale, "Culture", "배양")}: {selectedModelUpdate.quality_summary.validation_consistency.true_label ?? notAvailableLabel}</span>
                  <span>{pick(locale, "Confidence", "신뢰도")}: {formatMetric(selectedModelUpdate.quality_summary.validation_consistency.prediction_probability, notAvailableLabel)}</span>
                </div>
              ) : null}
              {selectedModelUpdate.quality_summary.risk_flags && selectedModelUpdate.quality_summary.risk_flags.length > 0 ? (
                <div className="review-checklist-tags">{selectedModelUpdate.quality_summary.risk_flags.map((flag) => <span key={flag} className="review-checklist-tag quality-risk-tag">{translateQualityFlag(flag)}</span>)}</div>
              ) : null}
            </section>
          ) : null}
          <div className="ops-gallery-triptych">
            <div className="panel-image-card">{selectedUpdatePreviewUrls.source ? <img src={selectedUpdatePreviewUrls.source} alt="Source thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Source unavailable", "원본 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Source", "원본")}</strong></div></div>
            <div className="panel-image-card">{selectedUpdatePreviewUrls.roi ? <img src={selectedUpdatePreviewUrls.roi} alt="Cornea crop thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Cornea crop unavailable", "각막 crop 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>{pick(locale, "Cornea crop", "각막 crop")}</strong></div></div>
            <div className="panel-image-card">{selectedUpdatePreviewUrls.mask ? <img src={selectedUpdatePreviewUrls.mask} alt="Mask thumbnail" className="panel-image-preview" /> : <div className="panel-image-fallback">{pick(locale, "Mask unavailable", "Mask 썸네일 없음")}</div>}<div className="panel-image-copy"><strong>Mask</strong></div></div>
          </div>
          <div className="panel-metric-grid">
            <div><strong>{selectedApprovalReport?.case_summary?.image_count ?? 0}</strong><span>{pick(locale, "images", "이미지 수")}</span></div>
            <div><strong>{selectedApprovalReport?.case_summary?.representative_view ?? notAvailableLabel}</strong><span>{pick(locale, "representative view", "대표 view")}</span></div>
            <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.source?.mean_brightness, notAvailableLabel)}</strong><span>{pick(locale, "source brightness", "원본 밝기")}</span></div>
            <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.source?.edge_density, notAvailableLabel)}</strong><span>{pick(locale, "source edge", "원본 edge")}</span></div>
            <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.roi_crop?.contrast_stddev, notAvailableLabel)}</strong><span>{pick(locale, "Cornea crop contrast", "각막 crop 대비")}</span></div>
            <div><strong>{formatMetric(selectedApprovalReport?.qa_metrics?.roi_area_ratio, notAvailableLabel)}</strong><span>{pick(locale, "Cornea crop area ratio", "각막 crop 면적 비율")}</span></div>
          </div>
          <div className="panel-meta">
            <span>{pick(locale, "EXIF removed", "EXIF 제거")}: {selectedApprovalReport?.privacy_controls?.upload_exif_removed ? pick(locale, "yes", "예") : pick(locale, "no", "아니오")}</span>
            <span>{pick(locale, "Filename policy", "파일명 정책")}: {selectedApprovalReport?.privacy_controls?.stored_filename_policy ?? notAvailableLabel}</span>
            <span>{pick(locale, "Media policy", "미디어 정책")}: {selectedApprovalReport?.privacy_controls?.review_media_policy ?? notAvailableLabel}</span>
          </div>
          <div className="review-checklist">
            <div className="review-checklist-block"><strong>{pick(locale, "Approval criteria", "승인 기준")}</strong><ul><li>{pick(locale, "Culture result and organism label are clear.", "배양 결과와 입력 균종이 명확합니다.")}</li><li>{pick(locale, "The lesion is clearly visible in the representative and supporting images.", "대표 이미지와 보조 이미지에서 병변이 충분히 식별됩니다.")}</li><li>{pick(locale, "Cornea or lesion crop appropriately covers the lesion and surrounding cornea.", "각막 또는 병변 crop이 병변과 주변 각막을 적절히 포함합니다.")}</li><li>{pick(locale, "The case matches the current training policy and is not a duplicate contribution.", "현재 학습 정책에 맞고 중복 기여가 아닙니다.")}</li></ul></div>
            <div className="review-checklist-block"><strong>{pick(locale, "Rejection criteria", "반려 기준")}</strong><ul><li>{pick(locale, "The culture result or organism label is uncertain.", "배양 결과 또는 균종 라벨이 불확실합니다.")}</li><li>{pick(locale, "Image quality is too poor to interpret the lesion.", "이미지 품질이 낮아 병변 해석이 어렵습니다.")}</li><li>{pick(locale, "The lesion box, mask, or crop result is inappropriate.", "병변 박스, mask, 또는 crop 결과가 부적절합니다.")}</li><li>{pick(locale, "The case conflicts with the current training policy or violates privacy rules.", "현재 학습 정책과 맞지 않거나 개인정보 정책을 위반합니다.")}</li></ul></div>
            <div className="review-checklist-block"><strong>{pick(locale, "Short rejection reasons", "짧은 반려 사유")}</strong><div className="review-checklist-tags">{[pick(locale, "Label uncertain", "라벨 불확실"), pick(locale, "Image quality issue", "이미지 품질 불량"), pick(locale, "Crop quality issue", "crop 품질 불량"), pick(locale, "Duplicate contribution", "중복 기여"), pick(locale, "Policy mismatch", "학습 정책과 불일치"), pick(locale, "Policy violation", "정책 위반")].map((reason) => <span key={reason} className="review-checklist-tag">{reason}</span>)}</div></div>
          </div>
          <label className="notes-field"><span>{pick(locale, "Reviewer note", "검토 메모")}</span><textarea rows={3} value={modelUpdateReviewNotes[selectedModelUpdate.update_id] ?? ""} onChange={(event) => setModelUpdateReviewNotes((current) => ({ ...current, [selectedModelUpdate.update_id]: event.target.value }))} /></label>
          <div className="workspace-actions"><button className="ghost-button" type="button" onClick={() => onModelUpdateReview("rejected")}>{pick(locale, "Reject update", "업데이트 반려")}</button><button className="primary-workspace-button" type="button" onClick={() => onModelUpdateReview("approved")}>{pick(locale, "Approve update", "업데이트 승인")}</button></div>
        </section>
      ) : null}
    </section>
  );
}
