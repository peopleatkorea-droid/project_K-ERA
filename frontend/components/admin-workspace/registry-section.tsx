"use client";

import type { Dispatch, SetStateAction } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Field } from "../ui/field";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, docSiteBadgeClass, emptySurfaceClass, panelImageFallbackClass } from "../ui/workspace-patterns";
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

function PreviewCard({
  title,
  src,
  empty,
}: {
  title: string;
  src: string | null;
  empty: string;
}) {
  return (
    <Card as="div" variant="nested" className="grid gap-3 p-4">
      <div className="text-sm font-medium text-muted">{title}</div>
      {src ? (
        <img src={src} alt={title} className="aspect-[4/3] w-full rounded-[18px] object-cover" />
      ) : (
        <div className={panelImageFallbackClass}>{empty}</div>
      )}
    </Card>
  );
}

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
    <Card as="section" variant="surface" className="grid gap-5 p-6">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Registry", "레지스트리")}</div>}
        title={pick(locale, "Model versions and update flow", "모델 버전과 업데이트 흐름")}
        titleAs="h3"
        description={pick(
          locale,
          "Review stored model versions, inspect contributed updates, and decide whether each update should move into the global registry.",
          "저장된 모델 버전을 검토하고 기여 업데이트를 확인한 뒤, 각 업데이트를 글로벌 레지스트리로 올릴지 결정합니다."
        )}
        aside={<span className={docSiteBadgeClass}>{`${modelVersions.length} ${pick(locale, "model(s)", "모델")}`}</span>}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Model versions", "모델 버전")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{currentModel?.version_name ?? notAvailableLabel}</span>}
          />
          {modelVersions.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No model version is registered yet.", "아직 등록된 모델 버전이 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {modelVersions
                .slice()
                .reverse()
                .map((item) => (
                  <Card
                    key={item.version_id}
                    as="article"
                    variant="nested"
                    className={`grid gap-3 border p-4 ${item.is_current ? "border-brand/25 bg-brand-soft/60" : "border-border/80"}`}
                  >
                    <SectionHeader
                      title={item.version_name}
                      titleAs="h4"
                      description={item.notes || item.notes_en || item.notes_ko || item.architecture}
                      aside={<span className={docSiteBadgeClass}>{item.architecture}</span>}
                    />
                    <MetricGrid columns={4}>
                      <MetricItem value={item.is_current ? pick(locale, "Current", "현재") : item.stage ?? pick(locale, "Stored", "보관됨")} label={pick(locale, "Stage", "단계")} />
                      <MetricItem value={formatDateTime(item.created_at, notAvailableLabel)} label={pick(locale, "Created", "생성 시각")} />
                      <MetricItem value={item.ready ? pick(locale, "Ready", "준비됨") : pick(locale, "Pending", "대기 중")} label={pick(locale, "Status", "상태")} />
                      <MetricItem value={item.crop_mode ?? notAvailableLabel} label={pick(locale, "Crop mode", "Crop 모드")} />
                    </MetricGrid>
                    {item.ensemble_weights ? (
                      <div className="flex flex-wrap gap-2">
                        <span className={docSiteBadgeClass}>{`${pick(locale, "Automated", "Automated")} ${formatWeightPercent(item.ensemble_weights.automated)}`}</span>
                        <span className={docSiteBadgeClass}>{`${pick(locale, "Manual", "Manual")} ${formatWeightPercent(item.ensemble_weights.manual)}`}</span>
                      </div>
                    ) : null}
                    {canManagePlatform ? (
                      <div className="flex justify-end">
                        <Button type="button" variant="danger" size="sm" disabled={item.is_current} onClick={() => onDeleteModelVersion(item)}>
                          {pick(locale, "Delete model", "모델 삭제")}
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                ))}
            </div>
          )}
        </Card>

        <Card as="section" variant="nested" className="grid gap-4 p-5">
          <SectionHeader
            title={pick(locale, "Model updates", "모델 업데이트")}
            titleAs="h4"
            aside={<span className={docSiteBadgeClass}>{modelUpdates.length}</span>}
          />
          {modelUpdates.length === 0 ? (
            <div className={emptySurfaceClass}>
              {pick(locale, "No model update has been recorded for the current filter.", "현재 필터에 기록된 모델 업데이트가 없습니다.")}
            </div>
          ) : (
            <div className="grid gap-3">
              {modelUpdates.map((item) => (
                <button
                  key={item.update_id}
                  type="button"
                  onClick={() => setSelectedModelUpdateId(item.update_id)}
                  className={`grid gap-3 rounded-[20px] border p-4 text-left transition duration-150 ease-out hover:-translate-y-0.5 ${
                    selectedModelUpdate?.update_id === item.update_id
                      ? "border-brand/25 bg-brand-soft/60"
                      : "border-border bg-surface-muted/80"
                  }`}
                >
                  <SectionHeader
                    title={item.update_id}
                    titleAs="h4"
                    description={item.site_id ?? pick(locale, "Unknown hospital", "알 수 없는 병원")}
                    aside={<span className={docSiteBadgeClass}>{item.status ?? pick(locale, "Unknown", "알 수 없음")}</span>}
                  />
                  <MetricGrid columns={3}>
                    <MetricItem value={item.architecture ?? notAvailableLabel} label={pick(locale, "Architecture", "아키텍처")} />
                    <MetricItem value={String(item.n_cases ?? 0)} label={pick(locale, "Cases", "케이스")} />
                    <MetricItem value={formatDateTime(item.created_at, notAvailableLabel)} label={pick(locale, "Created", "생성 시각")} />
                  </MetricGrid>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedModelUpdate ? (
        <Card as="section" variant="nested" className="grid gap-5 p-5">
          <SectionHeader
            title={pick(locale, "Selected update", "선택한 업데이트")}
            titleAs="h4"
            description={`${selectedModelUpdate.site_id ?? notAvailableLabel} / ${selectedModelUpdate.case_reference_id ?? notAvailableLabel}`}
            aside={<span className={docSiteBadgeClass}>{selectedModelUpdate.status ?? notAvailableLabel}</span>}
          />

          <MetricGrid columns={4}>
            <MetricItem value={selectedModelUpdate.architecture ?? notAvailableLabel} label={pick(locale, "Architecture", "아키텍처")} />
            <MetricItem value={selectedModelUpdate.upload_type ?? notAvailableLabel} label={pick(locale, "Upload type", "업로드 유형")} />
            <MetricItem value={selectedModelUpdate.execution_device ?? notAvailableLabel} label={pick(locale, "Execution device", "실행 장치")} />
            <MetricItem value={formatDateTime(selectedModelUpdate.created_at, notAvailableLabel)} label={pick(locale, "Created", "생성 시각")} />
          </MetricGrid>

          {selectedModelUpdate.quality_summary ? (
            <Card as="section" variant="nested" className="grid gap-4 border border-border/80 p-4">
              <SectionHeader
                title={pick(locale, "Automatic quality summary", "자동 품질 요약")}
                titleAs="h4"
                aside={<span className={docSiteBadgeClass}>{formatQualityRecommendation(selectedModelUpdate.quality_summary.recommendation)}</span>}
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <MetricItem value={selectedModelUpdate.quality_summary.quality_score ?? notAvailableLabel} label={pick(locale, "Quality score", "품질 점수")} />
                <MetricItem value={selectedModelUpdate.quality_summary.image_quality?.score ?? notAvailableLabel} label={pick(locale, "Image", "이미지")} />
                <MetricItem value={selectedModelUpdate.quality_summary.crop_quality?.score ?? notAvailableLabel} label={pick(locale, "Crop", "Crop")} />
                <MetricItem value={selectedModelUpdate.quality_summary.delta_quality?.score ?? notAvailableLabel} label={pick(locale, "Delta", "Delta")} />
                <MetricItem value={selectedModelUpdate.quality_summary.validation_consistency?.status ?? notAvailableLabel} label={pick(locale, "Validation", "검증")} />
                <MetricItem value={selectedModelUpdate.quality_summary.delta_quality?.l2_norm ?? notAvailableLabel} label={pick(locale, "Delta norm", "Delta norm")} />
              </div>
              <MetricGrid columns={4}>
                <MetricItem value={formatMetric(selectedModelUpdate.quality_summary.image_quality?.mean_brightness, notAvailableLabel)} label={pick(locale, "Brightness", "밝기")} />
                <MetricItem value={formatMetric(selectedModelUpdate.quality_summary.image_quality?.contrast_stddev, notAvailableLabel)} label={pick(locale, "Contrast", "대비")} />
                <MetricItem value={formatMetric(selectedModelUpdate.quality_summary.image_quality?.edge_density, notAvailableLabel)} label={pick(locale, "Edge density", "경계 밀도")} />
                <MetricItem value={formatMetric(selectedModelUpdate.quality_summary.crop_quality?.roi_area_ratio, notAvailableLabel)} label={pick(locale, "Crop ratio", "Crop 비율")} />
              </MetricGrid>
              {selectedModelUpdate.quality_summary.validation_consistency?.predicted_label ? (
                <MetricGrid columns={3}>
                  <MetricItem value={selectedModelUpdate.quality_summary.validation_consistency.predicted_label ?? notAvailableLabel} label={pick(locale, "Predicted", "예측")} />
                  <MetricItem value={selectedModelUpdate.quality_summary.validation_consistency.true_label ?? notAvailableLabel} label={pick(locale, "Culture", "배양")} />
                  <MetricItem
                    value={formatMetric(selectedModelUpdate.quality_summary.validation_consistency.prediction_probability, notAvailableLabel)}
                    label={pick(locale, "Confidence", "신뢰도")}
                  />
                </MetricGrid>
              ) : null}
              {selectedModelUpdate.quality_summary.risk_flags?.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedModelUpdate.quality_summary.risk_flags.map((flag) => (
                    <span key={flag} className={docSiteBadgeClass}>
                      {translateQualityFlag(flag)}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <PreviewCard
              title={pick(locale, "Source", "원본")}
              src={selectedUpdatePreviewUrls.source}
              empty={pick(locale, "Source unavailable", "원본 미리보기를 표시할 수 없습니다.")}
            />
            <PreviewCard
              title={pick(locale, "Cornea crop", "각막 crop")}
              src={selectedUpdatePreviewUrls.roi}
              empty={pick(locale, "Cornea crop unavailable", "각막 crop 미리보기를 표시할 수 없습니다.")}
            />
            <PreviewCard
              title="Mask"
              src={selectedUpdatePreviewUrls.mask}
              empty={pick(locale, "Mask unavailable", "Mask 미리보기를 표시할 수 없습니다.")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricItem value={selectedApprovalReport?.case_summary?.image_count ?? 0} label={pick(locale, "Images", "이미지")} />
            <MetricItem value={selectedApprovalReport?.case_summary?.representative_view ?? notAvailableLabel} label={pick(locale, "Representative view", "대표 뷰")} />
            <MetricItem value={formatMetric(selectedApprovalReport?.qa_metrics?.source?.mean_brightness, notAvailableLabel)} label={pick(locale, "Source brightness", "원본 밝기")} />
            <MetricItem value={formatMetric(selectedApprovalReport?.qa_metrics?.source?.edge_density, notAvailableLabel)} label={pick(locale, "Source edge", "원본 edge")} />
            <MetricItem value={formatMetric(selectedApprovalReport?.qa_metrics?.roi_crop?.contrast_stddev, notAvailableLabel)} label={pick(locale, "Cornea crop contrast", "각막 crop 대비")} />
            <MetricItem value={formatMetric(selectedApprovalReport?.qa_metrics?.roi_area_ratio, notAvailableLabel)} label={pick(locale, "Cornea crop area ratio", "각막 crop 면적 비율")} />
          </div>

          <div className="grid gap-3 rounded-[20px] border border-border bg-surface px-4 py-4 text-sm leading-6 text-muted">
            <div>{`${pick(locale, "EXIF removed", "EXIF 제거")}: ${
              selectedApprovalReport?.privacy_controls?.upload_exif_removed ? pick(locale, "yes", "예") : pick(locale, "no", "아니오")
            }`}</div>
            <div>{`${pick(locale, "Filename policy", "파일명 정책")}: ${
              selectedApprovalReport?.privacy_controls?.stored_filename_policy ?? notAvailableLabel
            }`}</div>
            <div>{`${pick(locale, "Media policy", "미디어 정책")}: ${
              selectedApprovalReport?.privacy_controls?.review_media_policy ?? notAvailableLabel
            }`}</div>
          </div>

          <Card as="section" variant="nested" className="grid gap-4 border border-border/80 p-4">
            <SectionHeader title={pick(locale, "Review checklist", "검토 체크리스트")} titleAs="h4" />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="grid gap-2 text-sm leading-6 text-muted">
                <strong className="text-ink">{pick(locale, "Approval criteria", "승인 기준")}</strong>
                <ul className="m-0 grid gap-2 pl-5">
                  <li>{pick(locale, "Culture result and organism label are clear.", "배양 결과와 원인균 라벨이 명확합니다.")}</li>
                  <li>{pick(locale, "Representative and supporting images show the lesion clearly.", "대표 이미지와 보조 이미지에서 병변이 충분히 보입니다.")}</li>
                  <li>{pick(locale, "The crop appropriately covers the lesion and surrounding cornea.", "crop가 병변과 주변 각막을 적절히 포함합니다.")}</li>
                </ul>
              </div>
              <div className="grid gap-2 text-sm leading-6 text-muted">
                <strong className="text-ink">{pick(locale, "Rejection criteria", "반려 기준")}</strong>
                <ul className="m-0 grid gap-2 pl-5">
                  <li>{pick(locale, "The organism label is uncertain.", "원인균 라벨이 불확실합니다.")}</li>
                  <li>{pick(locale, "Image quality is too poor to interpret the lesion.", "이미지 품질이 낮아 병변 해석이 어렵습니다.")}</li>
                  <li>{pick(locale, "The crop or mask result is inappropriate.", "crop 또는 mask 결과가 부적절합니다.")}</li>
                </ul>
              </div>
              <div className="grid gap-2 text-sm leading-6 text-muted">
                <strong className="text-ink">{pick(locale, "Quick reasons", "빠른 사유")}</strong>
                <div className="flex flex-wrap gap-2">
                  {[
                    pick(locale, "Label uncertain", "라벨 불확실"),
                    pick(locale, "Image quality issue", "이미지 품질 이슈"),
                    pick(locale, "Crop quality issue", "Crop 품질 이슈"),
                    pick(locale, "Duplicate contribution", "중복 기여"),
                    pick(locale, "Policy mismatch", "정책 불일치"),
                  ].map((reason) => (
                    <span key={reason} className={docSiteBadgeClass}>
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Field label={pick(locale, "Reviewer note", "검토 메모")}>
            <textarea
              rows={3}
              value={modelUpdateReviewNotes[selectedModelUpdate.update_id] ?? ""}
              onChange={(event) =>
                setModelUpdateReviewNotes((current) => ({
                  ...current,
                  [selectedModelUpdate.update_id]: event.target.value,
                }))
              }
            />
          </Field>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="danger" onClick={() => onModelUpdateReview("rejected")}>
              {pick(locale, "Reject update", "업데이트 반려")}
            </Button>
            <Button type="button" variant="primary" onClick={() => onModelUpdateReview("approved")}>
              {pick(locale, "Approve update", "업데이트 승인")}
            </Button>
          </div>
        </Card>
      ) : null}
    </Card>
  );
}
