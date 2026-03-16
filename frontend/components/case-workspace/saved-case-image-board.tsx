"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { SemanticPromptInputMode, SemanticPromptReviewResponse } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  docSectionClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  emptySurfaceClass,
  lesionBoxOverlayClass,
  panelImageFallbackClass,
  savedCaseActionButtonClass,
  savedImageActionBarClass,
  semanticPromptCopyClass,
  semanticPromptGridClass,
  semanticPromptLayerClass,
  semanticPromptLayerHeadClass,
  semanticPromptMatchClass,
  semanticPromptMatchListClass,
  semanticPromptRankClass,
  semanticPromptReviewClass,
  semanticPromptReviewHeadClass,
  semanticPromptScoreClass,
  togglePillClass,
} from "../ui/workspace-patterns";
import { MaskOverlayPreview } from "./preview-media";
import type {
  LesionBoxMap,
  LiveLesionPreviewMap,
  LocalePick,
  SavedImagePreview,
  SemanticPromptErrorMap,
  SemanticPromptInputOption,
  SemanticPromptReviewMap,
  TranslateOption,
} from "./shared";

type SavedCaseImageBoardProps = {
  locale: Locale;
  commonLoading: string;
  commonNotAvailable: string;
  panelBusy: boolean;
  selectedCaseImages: SavedImagePreview[];
  semanticPromptInputMode: SemanticPromptInputMode;
  semanticPromptInputOptions: SemanticPromptInputOption[];
  semanticPromptBusyImageId: string | null;
  semanticPromptReviews: SemanticPromptReviewMap;
  semanticPromptErrors: SemanticPromptErrorMap;
  semanticPromptOpenImageIds: string[];
  liveLesionPreviews: LiveLesionPreviewMap;
  lesionPromptDrafts: LesionBoxMap;
  lesionPromptSaved: LesionBoxMap;
  lesionBoxBusyImageId: string | null;
  representativeBusyImageId: string | null;
  pick: LocalePick;
  translateOption: TranslateOption;
  formatSemanticScore: (value: number | null | undefined, emptyLabel: string) => string;
  onSemanticPromptInputModeChange: (mode: SemanticPromptInputMode) => void;
  onSetSavedRepresentative: (imageId: string) => void | Promise<void>;
  onReviewSemanticPrompts: (imageId: string) => void | Promise<void>;
  onLesionPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onLesionPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onFinishLesionPointer: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
};

function SemanticPromptReviewPanel({
  locale,
  commonNotAvailable,
  imageId,
  review,
  error,
  pick,
  formatSemanticScore,
}: {
  locale: Locale;
  commonNotAvailable: string;
  imageId: string;
  review: SemanticPromptReviewResponse | undefined;
  error: string | undefined;
  pick: LocalePick;
  formatSemanticScore: (value: number | null | undefined, emptyLabel: string) => string;
}) {
  return (
    <Card as="div" variant="nested" className={semanticPromptReviewClass}>
      {error ? (
        <div className={emptySurfaceClass}>{error}</div>
      ) : review ? (
        <>
          <div className={semanticPromptReviewHeadClass}>
            <strong>{pick(locale, "BiomedCLIP prompt ranking", "BiomedCLIP prompt ranking")}</strong>
            <span>
              {review.dictionary_name} · {review.model_name}
            </span>
          </div>
          <Card as="div" variant="nested" className={semanticPromptLayerClass}>
            <div className={semanticPromptLayerHeadClass}>
              <strong>{pick(locale, "Overall top 3", "Overall top 3")}</strong>
            </div>
            <div className={semanticPromptMatchListClass}>
              {review.overall_top_matches.map((match, index) => (
                <div key={`${imageId}-overall-${match.prompt_id}`} className={semanticPromptMatchClass}>
                  <div className={semanticPromptRankClass}>{index + 1}</div>
                  <div className={semanticPromptCopyClass}>
                    <strong>{match.label}</strong>
                    <span>{match.prompt}</span>
                  </div>
                  <div className={semanticPromptScoreClass}>{formatSemanticScore(match.score, commonNotAvailable)}</div>
                </div>
              ))}
            </div>
          </Card>
          <div className={semanticPromptGridClass}>
            {review.layers.map((layer) => (
              <Card as="div" variant="nested" key={`${imageId}-${layer.layer_id}`} className={semanticPromptLayerClass}>
                <div className={semanticPromptLayerHeadClass}>
                  <strong>{layer.layer_label}</strong>
                </div>
                <div className={semanticPromptMatchListClass}>
                  {layer.matches.map((match, index) => (
                    <div key={`${imageId}-${layer.layer_id}-${match.prompt_id}`} className={semanticPromptMatchClass}>
                      <div className={semanticPromptRankClass}>{index + 1}</div>
                      <div className={semanticPromptCopyClass}>
                        <strong>{match.label}</strong>
                        <span>{match.prompt}</span>
                      </div>
                      <div className={semanticPromptScoreClass}>{formatSemanticScore(match.score, commonNotAvailable)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <div className={emptySurfaceClass}>{pick(locale, "Run the review once to inspect the top-ranked prompt matches.", "Top-ranked prompt score를 보려면 review를 실행해 주세요.")}</div>
      )}
    </Card>
  );
}

export function SavedCaseImageBoard({
  locale,
  commonLoading,
  commonNotAvailable,
  panelBusy,
  selectedCaseImages,
  semanticPromptInputMode,
  semanticPromptInputOptions,
  semanticPromptBusyImageId,
  semanticPromptReviews,
  semanticPromptErrors,
  semanticPromptOpenImageIds,
  liveLesionPreviews,
  lesionPromptDrafts,
  lesionPromptSaved,
  lesionBoxBusyImageId,
  representativeBusyImageId,
  pick,
  translateOption,
  formatSemanticScore,
  onSemanticPromptInputModeChange,
  onSetSavedRepresentative,
  onReviewSemanticPrompts,
  onLesionPointerDown,
  onLesionPointerMove,
  onFinishLesionPointer,
}: SavedCaseImageBoardProps) {
  return (
    <section className={docSectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={docSectionLabelClass}>{pick(locale, "Saved images", "저장 이미지")}</div>
          <select
            aria-label={pick(locale, "Prompt input", "Prompt 입력")}
            className="min-h-9 rounded-full border border-border bg-white/60 px-3.5 text-sm text-ink outline-none transition duration-150 ease-out focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4"
            value={semanticPromptInputMode}
            onChange={(event) => onSemanticPromptInputModeChange(event.target.value as SemanticPromptInputMode)}
          >
            {semanticPromptInputOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <span className={docSiteBadgeClass}>{panelBusy ? commonLoading : `${selectedCaseImages.length} ${pick(locale, "images", "이미지")}`}</span>
      </div>

      {selectedCaseImages.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedCaseImages.map((image) => {
            const promptReviewOpen = semanticPromptOpenImageIds.includes(image.image_id);
            const livePreview = liveLesionPreviews[image.image_id];
            const draftBox = lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id] ?? null;
            const maskReady = Boolean(livePreview?.status === "done" && livePreview?.lesion_mask_url);
            const statusCopy =
              lesionBoxBusyImageId === image.image_id
                ? pick(locale, "Saving...", "저장 중...")
                : livePreview?.status === "running"
                  ? pick(locale, "MedSAM running", "MedSAM 실행 중")
                  : maskReady
                    ? pick(locale, "Mask ready", "Mask 준비됨")
                    : draftBox
                      ? pick(locale, "Box ready", "Box 준비됨")
                      : pick(locale, "Drag to segment", "드래그해서 분할");

            return (
              <Card as="section" variant="panel" key={`doc-${image.image_id}`} className="grid content-start gap-3 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <strong className="text-[1.12rem] font-semibold tracking-[-0.03em] text-ink">
                      {translateOption(locale, "view", image.view)}
                    </strong>
                    <span className="text-sm leading-6 text-muted">
                      {image.is_representative ? pick(locale, "Representative image", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}
                    </span>
                  </div>
                  <span className={docSiteBadgeClass}>{statusCopy}</span>
                </div>

                {image.preview_url ? (
                  <div className="grid min-h-[280px] place-items-center rounded-[20px] border border-border bg-surface-muted/45 p-2.5">
                    <div
                      className="relative mx-auto w-fit max-w-full cursor-crosshair overflow-hidden rounded-[18px] border border-border/60 bg-surface-elevated touch-none"
                      onPointerDown={(event) => onLesionPointerDown(image.image_id, event)}
                      onPointerMove={(event) => onLesionPointerMove(image.image_id, event)}
                      onPointerUp={(event) => onFinishLesionPointer(image.image_id, event)}
                      onPointerCancel={(event) => onFinishLesionPointer(image.image_id, event)}
                    >
                      {maskReady ? (
                        <MaskOverlayPreview
                          sourceUrl={image.preview_url}
                          maskUrl={livePreview?.lesion_mask_url}
                          alt={pick(locale, "Live MedSAM mask overlay", "실시간 MedSAM mask overlay")}
                          tint={[242, 164, 154]}
                          className="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[18px]"
                          fallbackClassName="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[18px]"
                        />
                      ) : (
                        <img
                          src={image.preview_url}
                          alt={image.image_id}
                          className="block max-h-[320px] w-auto max-w-full select-none rounded-[18px]"
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                        />
                      )}

                      {draftBox && !maskReady ? (
                        <div
                          className={lesionBoxOverlayClass}
                          style={{
                            left: `${draftBox.x0 * 100}%`,
                            top: `${draftBox.y0 * 100}%`,
                            width: `${(draftBox.x1 - draftBox.x0) * 100}%`,
                            height: `${(draftBox.y1 - draftBox.y0) * 100}%`,
                          }}
                        />
                      ) : null}

                      {livePreview?.status === "running" ? (
                        <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink/78 px-3 py-1 text-[0.72rem] font-semibold text-white">
                          {pick(locale, "MedSAM running", "MedSAM 실행 중")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className={panelImageFallbackClass}>{pick(locale, "Preview unavailable", "미리보기를 표시할 수 없습니다")}</div>
                )}

                <div className="flex flex-wrap gap-2 text-sm text-muted">
                  {image.quality_scores?.quality_score != null ? (
                    <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                      Q {Number(image.quality_scores.quality_score).toFixed(2)}
                    </span>
                  ) : null}
                  {image.quality_scores?.view_score != null ? (
                    <span className="rounded-full border border-border bg-surface px-3 py-1.5">
                      View {Number(image.quality_scores.view_score).toFixed(2)}
                    </span>
                  ) : null}
                  {livePreview?.status === "failed" && livePreview.error ? (
                    <span className="rounded-full border border-danger/30 bg-danger/8 px-3 py-1.5 text-danger">
                      {livePreview.error}
                    </span>
                  ) : null}
                </div>

                <div className={savedImageActionBarClass}>
                  <Button
                    className={image.is_representative ? savedCaseActionButtonClass(true) : "px-4"}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void onSetSavedRepresentative(image.image_id)}
                    disabled={representativeBusyImageId === image.image_id || image.is_representative}
                  >
                    {representativeBusyImageId === image.image_id
                      ? commonLoading
                      : image.is_representative
                        ? pick(locale, "Representative", "대표 이미지")
                        : pick(locale, "Set representative", "대표 이미지로 지정")}
                  </Button>
                  <Button
                    className={togglePillClass(promptReviewOpen, true)}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void onReviewSemanticPrompts(image.image_id)}
                    disabled={semanticPromptBusyImageId === image.image_id}
                  >
                    {semanticPromptBusyImageId === image.image_id
                      ? commonLoading
                      : promptReviewOpen
                        ? pick(locale, "Hide prompt review", "Prompt review 닫기")
                        : pick(locale, "Review prompts", "Prompt review")}
                  </Button>
                </div>

                {promptReviewOpen ? (
                  <SemanticPromptReviewPanel
                    locale={locale}
                    commonNotAvailable={commonNotAvailable}
                    imageId={image.image_id}
                    review={semanticPromptReviews[image.image_id]}
                    error={semanticPromptErrors[image.image_id]}
                    pick={pick}
                    formatSemanticScore={formatSemanticScore}
                  />
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}

      {!selectedCaseImages.length && !panelBusy ? (
        <div className={emptySurfaceClass}>{pick(locale, "No saved images are attached to this case yet.", "이 케이스에는 아직 저장 이미지가 없습니다.")}</div>
      ) : null}
    </section>
  );
}
