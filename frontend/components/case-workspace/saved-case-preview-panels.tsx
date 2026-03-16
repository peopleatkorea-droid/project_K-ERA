"use client";

import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  docSectionClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  panelImageCardClass,
  panelImageCopyClass,
  panelImageFallbackClass,
  panelImagePreviewClass,
  panelImageStackClass,
  panelPreviewGridClass,
  previewItemMetricGridClass,
  previewRunButtonClass,
  previewSectionActionsClass,
  previewSectionHeadClass,
} from "../ui/workspace-patterns";
import { MaskOverlayPreview } from "./preview-media";
import type { LesionPreviewCard, LocalePick, RoiPreviewCard, TranslateOption } from "./shared";

type SavedCasePreviewPanelsProps = {
  locale: Locale;
  commonLoading: string;
  canRunRoiPreview: boolean;
  selectedCaseImageCount: number;
  hasAnySavedLesionBox: boolean;
  roiPreviewBusy: boolean;
  lesionPreviewBusy: boolean;
  roiPreviewItems: RoiPreviewCard[];
  lesionPreviewItems: LesionPreviewCard[];
  pick: LocalePick;
  translateOption: TranslateOption;
  onRunRoiPreview: () => void | Promise<void>;
  onRunLesionPreview: () => void | Promise<void>;
};

export function SavedCasePreviewPanels({
  locale,
  commonLoading,
  canRunRoiPreview,
  selectedCaseImageCount,
  hasAnySavedLesionBox,
  roiPreviewBusy,
  lesionPreviewBusy,
  roiPreviewItems,
  lesionPreviewItems,
  pick,
  translateOption,
  onRunRoiPreview,
  onRunLesionPreview,
}: SavedCasePreviewPanelsProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className={docSectionClass}>
        <SectionHeader
          className={previewSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Cornea preview", "각막 crop 미리보기")}</div>}
          title={pick(locale, "Source, cornea mask, and crop", "원본, 각막 mask, crop 비교")}
          titleAs="h4"
          description={pick(
            locale,
            "Generate ROI previews to compare the original image with the cornea segmentation and crop.",
            "원본 이미지와 각막 segmentation, crop 결과를 한 번에 비교하도록 ROI 미리보기를 생성합니다."
          )}
          aside={
            <div className={previewSectionActionsClass}>
              <span className={docSiteBadgeClass}>{roiPreviewBusy ? commonLoading : `${roiPreviewItems.length} ${pick(locale, "results", "결과")}`}</span>
              <Button
                className={previewRunButtonClass}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRunRoiPreview()}
                disabled={roiPreviewBusy || !canRunRoiPreview}
              >
                {roiPreviewBusy ? pick(locale, "Preparing...", "준비 중...") : pick(locale, "Preview cornea crop", "각막 crop 미리보기 실행")}
              </Button>
            </div>
          }
        />
        {!canRunRoiPreview ? <p>{pick(locale, "Viewer accounts can inspect images, but cornea preview remains disabled.", "뷰어 계정은 이미지를 볼 수 있지만 각막 preview는 실행할 수 없습니다.")}</p> : null}
        {canRunRoiPreview && roiPreviewItems.length === 0 ? (
          <p>{pick(locale, "Generate a preview to compare the saved source images with their cornea crops.", "저장된 원본 이미지와 각막 crop을 비교하려면 미리보기를 생성해 주세요.")}</p>
        ) : null}
        {roiPreviewItems.length > 0 ? (
          <div className={panelImageStackClass}>
            {roiPreviewItems.map((item) => (
              <Card as="article" variant="nested" key={`${item.image_id ?? item.source_image_path}:roi`} className={panelImageCardClass}>
                <MetricGrid columns={3} className={previewItemMetricGridClass}>
                  <MetricItem value={translateOption(locale, "view", item.view)} label={pick(locale, "View", "뷰")} />
                  <MetricItem
                    value={item.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}
                    label={pick(locale, "Role", "역할")}
                  />
                  <MetricItem value={item.backend} label={pick(locale, "Backend", "Backend")} />
                </MetricGrid>
                <div className={panelPreviewGridClass}>
                  <div>
                    {item.source_preview_url ? (
                      <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Source preview unavailable", "원본 미리보기를 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Source", "원본")}</strong>
                    </div>
                  </div>
                  <div>
                    {item.medsam_mask_url ? (
                      <MaskOverlayPreview
                        sourceUrl={item.source_preview_url}
                        maskUrl={item.medsam_mask_url}
                        alt={`${item.view} cornea mask overlay`}
                        tint={[231, 211, 111]}
                      />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Cornea mask unavailable", "각막 mask를 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Cornea mask", "각막 mask")}</strong>
                    </div>
                  </div>
                  <div>
                    {item.roi_crop_url ? (
                      <img src={item.roi_crop_url} alt={`${item.view} cornea crop`} className={panelImagePreviewClass} />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Cornea crop unavailable", "각막 crop을 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Cornea crop", "각막 crop")}</strong>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </section>

      <section className={docSectionClass}>
        <SectionHeader
          className={previewSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Lesion preview", "병변 crop 미리보기")}</div>}
          title={pick(locale, "Source, lesion mask, and crop", "원본, 병변 mask, crop 비교")}
          titleAs="h4"
          description={pick(
            locale,
            "Generate lesion previews to compare boxed images with their lesion-centered mask and crop.",
            "박스를 지정한 이미지와 병변 중심 mask, crop 결과를 한 번에 비교하도록 미리보기를 생성합니다."
          )}
          aside={
            <div className={previewSectionActionsClass}>
              <span className={docSiteBadgeClass}>{lesionPreviewBusy ? commonLoading : `${lesionPreviewItems.length} ${pick(locale, "results", "결과")}`}</span>
              <Button
                className={previewRunButtonClass}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRunLesionPreview()}
                disabled={lesionPreviewBusy || selectedCaseImageCount === 0}
              >
                {lesionPreviewBusy ? pick(locale, "Preparing...", "준비 중...") : pick(locale, "Preview lesion crop", "병변 crop 미리보기 실행")}
              </Button>
            </div>
          }
        />
        {!selectedCaseImageCount ? <p>{pick(locale, "Select a saved case with uploaded images before running lesion preview.", "병변 crop 미리보기를 실행하려면 업로드 이미지가 있는 저장 케이스를 선택해 주세요.")}</p> : null}
        {selectedCaseImageCount > 0 && lesionPreviewItems.length === 0 ? (
          <p>
            {hasAnySavedLesionBox
              ? pick(locale, "Generate a preview to compare each boxed image with its lesion-centered crop.", "박스가 저장된 각 이미지와 병변 중심 crop을 비교하려면 미리보기를 생성해 주세요.")
              : pick(locale, "Save at least one lesion box in the saved images section, then run preview.", "저장 이미지 섹션에서 lesion box를 하나 이상 저장한 뒤 미리보기를 실행해 주세요.")}
          </p>
        ) : null}
        {lesionPreviewItems.length > 0 ? (
          <div className={panelImageStackClass}>
            {lesionPreviewItems.map((item) => (
              <Card as="article" variant="nested" key={`${item.image_id ?? item.source_image_path}:lesion`} className={panelImageCardClass}>
                <MetricGrid columns={3} className={previewItemMetricGridClass}>
                  <MetricItem value={translateOption(locale, "view", item.view)} label={pick(locale, "View", "뷰")} />
                  <MetricItem
                    value={item.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}
                    label={pick(locale, "Role", "역할")}
                  />
                  <MetricItem value={item.backend} label={pick(locale, "Backend", "Backend")} />
                </MetricGrid>
                <div className={panelPreviewGridClass}>
                  <div>
                    {item.source_preview_url ? (
                      <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Source preview unavailable", "원본 미리보기를 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Source", "원본")}</strong>
                    </div>
                  </div>
                  <div>
                    {item.lesion_mask_url ? (
                      <MaskOverlayPreview
                        sourceUrl={item.source_preview_url}
                        maskUrl={item.lesion_mask_url}
                        alt={`${item.view} lesion mask overlay`}
                        tint={[242, 164, 154]}
                      />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Lesion mask unavailable", "병변 mask를 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Lesion mask", "병변 mask")}</strong>
                    </div>
                  </div>
                  <div>
                    {item.lesion_crop_url ? (
                      <img src={item.lesion_crop_url} alt={`${item.view} lesion crop`} className={panelImagePreviewClass} />
                    ) : (
                      <div className={panelImageFallbackClass}>{pick(locale, "Lesion crop unavailable", "병변 crop을 표시할 수 없습니다")}</div>
                    )}
                    <div className={panelImageCopyClass}>
                      <strong>{pick(locale, "Lesion crop", "병변 crop")}</strong>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
