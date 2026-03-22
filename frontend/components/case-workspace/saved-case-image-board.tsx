"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

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
  representativeImageTagClass,
  savedCaseActionButtonClass,
  savedImageActionBarClass,
  semanticPromptCopyClass,
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

const LIVE_LESION_MASK_TINT = [242, 164, 154] as const;
const savedImageSupportChipClass =
  "inline-flex min-h-7 items-center rounded-full border border-border/80 bg-surface px-2.5 py-1 text-[0.72rem] font-medium tracking-[0.01em] text-muted";

type SavedCaseImageBoardProps = {
  locale: Locale;
  commonLoading: string;
  commonNotAvailable: string;
  panelBusy: boolean;
  selectedCaseImageCountHint: number;
  selectedCaseImages: SavedImagePreview[];
  liveLesionMaskEnabled: boolean;
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
  onToggleLiveLesionMask: () => void;
  onSemanticPromptInputModeChange: (mode: SemanticPromptInputMode) => void;
  onSetSavedRepresentative: (imageId: string) => void | Promise<void>;
  onReviewSemanticPrompts: (imageId: string) => void | Promise<void>;
  onLesionPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onLesionPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onFinishLesionPointer: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
};

function ScoreBar({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const pct = Math.min(100, Math.max(0, score * 100));
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border/60">
      <div className="h-full rounded-full bg-brand/50 transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function SavedImageSupportChip({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  if (value == null) {
    return null;
  }
  return (
    <span className={savedImageSupportChipClass}>
      {label} {Number(value).toFixed(1)}
    </span>
  );
}

function MatchList({
  imageId,
  layerId,
  matches,
  commonNotAvailable,
  formatSemanticScore,
}: {
  imageId: string;
  layerId: string;
  matches: SemanticPromptReviewResponse["overall_top_matches"];
  commonNotAvailable: string;
  formatSemanticScore: (value: number | null | undefined, emptyLabel: string) => string;
}) {
  return (
    <div className={semanticPromptMatchListClass}>
      {matches.map((match, index) => (
        <div key={`${imageId}-${layerId}-${match.prompt_id}`} className={semanticPromptMatchClass}>
          <div className={semanticPromptRankClass}>{index + 1}</div>
          <div className={semanticPromptCopyClass}>
            <strong>{match.label}</strong>
            <span className="text-[0.78rem] leading-4 text-muted">{match.prompt}</span>
            <ScoreBar score={match.score} />
          </div>
          <div className={semanticPromptScoreClass}>{formatSemanticScore(match.score, commonNotAvailable)}</div>
        </div>
      ))}
    </div>
  );
}

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
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);

  return (
    <Card as="div" variant="nested" className={semanticPromptReviewClass}>
      {error ? (
        <div className={emptySurfaceClass}>{error}</div>
      ) : review ? (
        <>
          <div className={semanticPromptReviewHeadClass}>
            <strong>{pick(locale, "BiomedCLIP analysis", "BiomedCLIP 분석")}</strong>
            <span>
              {review.dictionary_name} · {review.model_name}
            </span>
          </div>
          <Card as="div" variant="nested" className={semanticPromptLayerClass}>
            <div className={semanticPromptLayerHeadClass}>
              <strong>{pick(locale, "Overall top 3", "Overall top 3")}</strong>
            </div>
            <MatchList
              imageId={imageId}
              layerId="overall"
              matches={review.overall_top_matches}
              commonNotAvailable={commonNotAvailable}
              formatSemanticScore={formatSemanticScore}
            />
          </Card>
          {review.layers.length > 0 ? (
            <Card as="div" variant="nested" className={semanticPromptLayerClass}>
              <div className="flex flex-wrap gap-1.5">
                {review.layers.map((layer, index) => (
                  <button
                    key={layer.layer_id}
                    type="button"
                    onClick={() => setActiveLayerIndex(index)}
                    className={`min-h-7 rounded-[8px] border px-3 text-[0.82rem] font-semibold transition duration-150 ease-out ${
                      activeLayerIndex === index
                        ? "border-brand/30 bg-brand/10 text-brand"
                        : "border-border bg-surface text-muted hover:border-brand/20 hover:text-ink"
                    }`}
                  >
                    {layer.layer_label}
                  </button>
                ))}
              </div>
              {review.layers[activeLayerIndex] ? (
                <MatchList
                  imageId={imageId}
                  layerId={review.layers[activeLayerIndex].layer_id}
                  matches={review.layers[activeLayerIndex].matches}
                  commonNotAvailable={commonNotAvailable}
                  formatSemanticScore={formatSemanticScore}
                />
              ) : null}
            </Card>
          ) : null}
        </>
      ) : (
        <div className={emptySurfaceClass}>{pick(locale, "Run BiomedCLIP analysis once to inspect the top-ranked matches.", "Top-ranked 결과를 보려면 BiomedCLIP 분석을 실행해 주세요.")}</div>
      )}
    </Card>
  );
}

export function SavedCaseImageBoard({
  locale,
  commonLoading,
  commonNotAvailable,
  panelBusy,
  selectedCaseImageCountHint,
  selectedCaseImages,
  liveLesionMaskEnabled,
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
  onToggleLiveLesionMask,
  onSemanticPromptInputModeChange,
  onSetSavedRepresentative,
  onReviewSemanticPrompts,
  onLesionPointerDown,
  onLesionPointerMove,
  onFinishLesionPointer,
}: SavedCaseImageBoardProps) {
  const loadingCardCount = Math.max(1, Math.min(selectedCaseImageCountHint || selectedCaseImages.length || 1, 3));

  return (
    <section className={docSectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={docSectionLabelClass}>{pick(locale, "Saved images", "저장 이미지")}</div>
          <button
            type="button"
            className={togglePillClass(liveLesionMaskEnabled, true)}
            aria-pressed={liveLesionMaskEnabled}
            onClick={onToggleLiveLesionMask}
          >
            {liveLesionMaskEnabled
              ? pick(locale, "MedSAM mask on", "MedSAM mask 켜짐")
              : pick(locale, "MedSAM mask off", "MedSAM mask 꺼짐")}
          </button>
          <select
            aria-label={pick(locale, "BiomedCLIP input", "BiomedCLIP 입력")}
            className="min-h-8 rounded-[10px] border border-border bg-white/60 px-3 text-[0.82rem] text-ink outline-none transition duration-150 ease-out focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4"
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
      <p className="m-0 text-sm leading-6 text-muted">
        {pick(
          locale,
          "Drag a lesion box on the image. When you release, K-ERA saves the box and starts a live MedSAM mask preview.",
          "이미지에서 병변 박스를 드래그한 뒤 손을 떼면, K-ERA가 박스를 저장하고 live MedSAM 마스크 미리보기를 시작합니다.",
        )}
      </p>

      {selectedCaseImages.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedCaseImages.map((image, index) => {
            const promptReviewOpen = semanticPromptOpenImageIds.includes(image.image_id);
            const livePreview = liveLesionPreviews[image.image_id];
            const draftBox = lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id] ?? null;
            const maskReady = Boolean(
              liveLesionMaskEnabled && livePreview?.status === "done" && livePreview?.lesion_mask_url
            );
            const prioritizeImage = index < 2;
            const statusCopy =
              lesionBoxBusyImageId === image.image_id
                ? pick(locale, "Saving...", "저장 중...")
                : livePreview?.status === "running"
                  ? pick(locale, "MedSAM running", "MedSAM 실행 중")
                  : maskReady
                    ? pick(locale, "Mask ready", "Mask 준비됨")
                    : draftBox
                      ? pick(locale, "Box ready", "Box 준비됨")
                      : pick(locale, "Draw box for MedSAM", "MedSAM용 박스 그리기");

            return (
              <Card as="section" variant="panel" key={`doc-${image.image_id}`} className="grid content-start gap-2.5 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5 text-[0.88rem] leading-5 text-muted">
                    <strong className="min-w-0 truncate font-semibold tracking-[-0.02em] text-ink">
                      {translateOption(locale, "view", image.view)}
                    </strong>
                    {image.is_representative ? (
                      <span className={`${representativeImageTagClass} shrink-0`}>
                        {pick(locale, "Representative image", "대표 이미지")}
                      </span>
                    ) : (
                      <span className="shrink-0">
                        · {pick(locale, "Supporting image", "보조 이미지")}
                      </span>
                    )}
                  </div>
                  <span className={docSiteBadgeClass}>{statusCopy}</span>
                </div>

                {image.preview_url ? (
                  <div className="grid place-items-center rounded-[14px] border border-border bg-surface-muted/45 p-2">
                    <div
                      className="relative mx-auto w-fit max-w-full cursor-crosshair overflow-hidden rounded-[12px] border border-border/60 bg-surface-elevated touch-none"
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
                          tint={LIVE_LESION_MASK_TINT}
                          className="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[12px]"
                          fallbackClassName="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[12px]"
                        />
                      ) : (
                        <img
                          src={image.preview_url}
                          alt={image.image_id}
                          className="block max-h-[320px] w-auto max-w-full select-none rounded-[12px]"
                          decoding="async"
                          loading={prioritizeImage ? "eager" : "lazy"}
                          fetchPriority={prioritizeImage ? "high" : "low"}
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
                        <div className="pointer-events-none absolute right-3 top-3 rounded-[8px] bg-ink/78 px-3 py-1 text-[0.72rem] font-semibold text-white">
                          {pick(locale, "MedSAM running", "MedSAM 실행 중")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : panelBusy ? (
                  <div className="grid place-items-center rounded-[14px] border border-border bg-surface-muted/45 p-2">
                    <div className="grid h-[220px] w-full max-w-[320px] place-items-center rounded-[12px] border border-border/60 bg-white/75 text-sm text-muted dark:bg-white/4">
                      {pick(locale, "Loading preview...", "미리보기를 불러오는 중...")}
                    </div>
                  </div>
                ) : (
                  <div className={panelImageFallbackClass}>{pick(locale, "Preview unavailable", "미리보기를 표시할 수 없습니다")}</div>
                )}

                <div className="flex flex-wrap gap-2 text-[0.78rem] text-muted">
                  <SavedImageSupportChip label="Q" value={image.quality_scores?.quality_score} />
                  <SavedImageSupportChip label="View" value={image.quality_scores?.view_score} />
                  {livePreview?.status === "failed" && livePreview.error ? (
                    <span className="rounded-[8px] border border-danger/30 bg-danger/8 px-3 py-1.5 text-danger">
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
                        ? pick(locale, "Hide BiomedCLIP analysis", "BiomedCLIP 분석 닫기")
                        : pick(locale, "Run BiomedCLIP analysis", "BiomedCLIP 분석")}
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
      ) : panelBusy ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: loadingCardCount }, (_, index) => (
            <Card as="section" variant="panel" key={`loading-card-${index}`} className="grid content-start gap-2.5 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="h-5 w-32 animate-pulse rounded-full bg-border/80" />
                <div className="h-5 w-24 animate-pulse rounded-full bg-border/70" />
              </div>
              <div className="grid place-items-center rounded-[14px] border border-border bg-surface-muted/45 p-2">
                <div className="h-[220px] w-full max-w-[320px] animate-pulse rounded-[12px] border border-border/60 bg-white/75 dark:bg-white/4" />
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="h-8 w-16 animate-pulse rounded-[8px] bg-border/70" />
                <div className="h-8 w-20 animate-pulse rounded-[8px] bg-border/70" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!selectedCaseImages.length && !panelBusy ? (
        <div className={emptySurfaceClass}>{pick(locale, "No saved images are attached to this case yet.", "이 케이스에는 아직 저장 이미지가 없습니다.")}</div>
      ) : null}
    </section>
  );
}
