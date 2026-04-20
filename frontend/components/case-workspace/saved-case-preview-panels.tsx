"use client";

import { memo, useMemo } from "react";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import { SectionHeader } from "../ui/section-header";
import {
  docSectionClass,
  docSectionHeadClass,
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
} from "../ui/workspace-patterns";
import { MaskOverlayPreview } from "./preview-media";
import type { LesionPreviewCard, LocalePick, RoiPreviewCard, TranslateOption } from "./shared";
import { useStagedRevealCount } from "./use-staged-reveal-count";

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

function SavedCasePreviewPanelsInner({
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
  const roiPreviewSignature = useMemo(
    () =>
      roiPreviewItems
        .map((item) => `${item.image_id ?? item.source_image_path}:roi`)
        .join("|"),
    [roiPreviewItems],
  );
  const lesionPreviewSignature = useMemo(
    () =>
      lesionPreviewItems
        .map((item) => `${item.image_id ?? item.source_image_path}:lesion`)
        .join("|"),
    [lesionPreviewItems],
  );
  const visibleRoiPreviewCount = useStagedRevealCount({
    totalCount: roiPreviewItems.length,
    initialCount: 1,
    resetKey: roiPreviewSignature,
  });
  const visibleLesionPreviewCount = useStagedRevealCount({
    totalCount: lesionPreviewItems.length,
    initialCount: 1,
    resetKey: lesionPreviewSignature,
  });
  const visibleRoiPreviewItems = useMemo(
    () => roiPreviewItems.slice(0, visibleRoiPreviewCount),
    [roiPreviewItems, visibleRoiPreviewCount],
  );
  const visibleLesionPreviewItems = useMemo(
    () => lesionPreviewItems.slice(0, visibleLesionPreviewCount),
    [lesionPreviewItems, visibleLesionPreviewCount],
  );

  return (
    <section
      className={docSectionClass}
      style={{ contentVisibility: "auto", containIntrinsicSize: "960px" }}
    >
      <SectionHeader
        className={docSectionHeadClass}
        eyebrow={
          <div className={docSectionLabelClass}>
            {pick(locale, "Optional previews", "보조 미리보기")}
          </div>
        }
        title={pick(locale, "Mask and crop previews", "mask / crop 미리보기")}
        titleAs="h4"
        description={pick(
          locale,
          "Use these only when you need a quick source-to-mask-to-crop comparison.",
          "원본, mask, crop을 빠르게 비교할 때만 사용합니다.",
        )}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card as="section" variant="nested" className="grid content-start gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <div className={docSectionLabelClass}>
                {pick(locale, "Cornea", "각막")}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Compare the source image, cornea mask, and cornea crop.",
                  "원본, 각막 mask, 각막 crop을 비교합니다.",
                )}
              </p>
            </div>
            <div className={previewSectionActionsClass}>
              <span className={docSiteBadgeClass}>
                {roiPreviewBusy
                  ? commonLoading
                  : `${roiPreviewItems.length} ${pick(locale, "results", "결과")}`}
              </span>
              <Button
                className={previewRunButtonClass}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRunRoiPreview()}
                disabled={roiPreviewBusy || !canRunRoiPreview}
              >
                {roiPreviewBusy
                  ? pick(locale, "Preparing...", "준비 중...")
                  : pick(locale, "Run cornea preview", "각막 미리보기 실행")}
              </Button>
            </div>
          </div>
          {!canRunRoiPreview ? (
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Viewer accounts can inspect images, but cornea preview is disabled.",
                "뷰어 계정은 이미지를 볼 수 있지만 각막 미리보기는 실행할 수 없습니다.",
              )}
            </p>
          ) : null}
          {canRunRoiPreview && roiPreviewItems.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Run this only if you need to compare saved cornea crops.",
                "저장된 각막 crop 비교가 필요할 때만 실행하세요.",
              )}
            </p>
          ) : null}
          {roiPreviewItems.length > 0 ? (
            <div className={panelImageStackClass}>
              {visibleRoiPreviewItems.map((item) => (
                <Card
                  as="article"
                  variant="nested"
                  key={`${item.image_id ?? item.source_image_path}:roi`}
                  className={panelImageCardClass}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
                >
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
                        <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} loading="lazy" decoding="async" />
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
                        <img src={item.roi_crop_url} alt={`${item.view} cornea crop`} className={panelImagePreviewClass} loading="lazy" decoding="async" />
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
        </Card>

        <Card as="section" variant="nested" className="grid content-start gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <div className={docSectionLabelClass}>
                {pick(locale, "Lesion", "병변")}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Compare the source image, lesion mask, and lesion crop.",
                  "원본, 병변 mask, 병변 crop을 비교합니다.",
                )}
              </p>
            </div>
            <div className={previewSectionActionsClass}>
              <span className={docSiteBadgeClass}>
                {lesionPreviewBusy
                  ? commonLoading
                  : `${lesionPreviewItems.length} ${pick(locale, "results", "결과")}`}
              </span>
              <Button
                className={previewRunButtonClass}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRunLesionPreview()}
                disabled={lesionPreviewBusy || selectedCaseImageCount === 0}
              >
                {lesionPreviewBusy
                  ? pick(locale, "Preparing...", "준비 중...")
                  : pick(locale, "Run lesion preview", "병변 미리보기 실행")}
              </Button>
            </div>
          </div>
          {!selectedCaseImageCount ? (
            <p className="m-0 text-sm leading-6 text-muted">
              {pick(
                locale,
                "Open a saved case with uploaded images before running lesion preview.",
                "병변 미리보기를 실행하려면 업로드 이미지가 있는 저장 케이스를 선택해 주세요.",
              )}
            </p>
          ) : null}
          {selectedCaseImageCount > 0 && lesionPreviewItems.length === 0 ? (
            <p className="m-0 text-sm leading-6 text-muted">
              {hasAnySavedLesionBox
                ? pick(
                    locale,
                    "Run this only if you need to compare saved lesion crops.",
                    "저장된 병변 crop 비교가 필요할 때만 실행하세요.",
                  )
                : pick(
                    locale,
                    "Save at least one lesion box first, then run the preview.",
                    "먼저 lesion box를 하나 이상 저장한 뒤 실행하세요.",
                  )}
            </p>
          ) : null}
          {lesionPreviewItems.length > 0 ? (
            <div className={panelImageStackClass}>
              {visibleLesionPreviewItems.map((item) => (
                <Card
                  as="article"
                  variant="nested"
                  key={`${item.image_id ?? item.source_image_path}:lesion`}
                  className={panelImageCardClass}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
                >
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
                        <img src={item.source_preview_url} alt={`${item.view} source`} className={panelImagePreviewClass} loading="lazy" decoding="async" />
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
                        <img src={item.lesion_crop_url} alt={`${item.view} lesion crop`} className={panelImagePreviewClass} loading="lazy" decoding="async" />
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
        </Card>
      </div>
    </section>
  );
}

export const SavedCasePreviewPanels = memo(SavedCasePreviewPanelsInner);
