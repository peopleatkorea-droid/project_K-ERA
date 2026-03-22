"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { SemanticPromptInputMode, SemanticPromptReviewResponse } from "../../lib/api";
import { searchAnalysisImagesByText, type ImageTextSearchResult } from "../../lib/analysis-runtime";
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
const LOW_VIEW_SCORE_THRESHOLD = 60;
const savedImageSupportChipClass =
  "inline-flex min-h-7 items-center rounded-full border border-border/80 bg-surface px-2.5 py-1 text-[0.72rem] font-medium tracking-[0.01em] text-muted";
const savedImageWarningChipClass =
  "inline-flex min-h-7 items-center rounded-full border border-amber-300/70 bg-amber-50/80 px-2.5 py-1 text-[0.72rem] font-medium tracking-[0.01em] text-[rgb(120,74,31)] dark:border-amber-200/20 dark:bg-[rgba(120,74,31,0.16)] dark:text-[rgba(255,232,204,0.92)]";

type SavedCaseImageBoardProps = {
  locale: Locale;
  commonLoading: string;
  commonNotAvailable: string;
  siteId: string;
  token: string;
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
  savedImageRoiCropUrls: Record<string, string | null>;
  savedImageRoiCropBusy: boolean;
  savedImageLesionCropUrls: Record<string, string | null>;
  savedImageLesionCropBusy: boolean;
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
        <div className={emptySurfaceClass}>
          {pick(
            locale,
            "Run BiomedCLIP analysis once to inspect the top-ranked matches.",
            "상위 결과를 보려면 BiomedCLIP 분석을 한 번 실행해 주세요.",
          )}
        </div>
      )}
    </Card>
  );
}

export function SavedCaseImageBoard({
  locale,
  commonLoading,
  commonNotAvailable,
  siteId,
  token,
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
  savedImageRoiCropUrls,
  savedImageRoiCropBusy,
  savedImageLesionCropUrls,
  savedImageLesionCropBusy,
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
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [textSearchBusy, setTextSearchBusy] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<ImageTextSearchResult[] | null>(null);
  const [textSearchError, setTextSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  async function handleTextSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = textSearchQuery.trim();
    if (!query) return;
    setTextSearchBusy(true);
    setTextSearchError(null);
    setTextSearchResults(null);
    try {
      const response = await searchAnalysisImagesByText(siteId, query, token);
      setTextSearchResults(response.results);
    } catch {
      setTextSearchError(pick(locale, "Search failed. Please try again.", "검색 실패. 다시 시도해 주세요."));
    } finally {
      setTextSearchBusy(false);
    }
  }

  function handleClearSearch() {
    setTextSearchQuery("");
    setTextSearchResults(null);
    setTextSearchError(null);
    searchInputRef.current?.focus();
  }

  const loadingCardCount = Math.max(1, Math.min(selectedCaseImageCountHint || selectedCaseImages.length || 1, 3));
  const sourceModeActive = semanticPromptInputMode === "source";
  const roiCropModeActive = semanticPromptInputMode === "roi_crop";
  const lesionCropModeActive = semanticPromptInputMode === "lesion_crop";
  const boardHelpCopy = sourceModeActive
    ? pick(
        locale,
        "Drag a lesion box on the source image. When you release, K-ERA saves the box and starts a live MedSAM mask preview.",
        "원본 이미지에서 병변 박스를 드래그한 뒤 손을 떼면, K-ERA가 박스를 저장하고 live MedSAM 마스크 미리보기를 시작합니다.",
      )
    : roiCropModeActive
      ? pick(
          locale,
          "Cornea crop mode shows saved cornea crops when available. MedSAM overlays stay hidden in crop modes.",
          "각막 crop 모드에서는 저장된 각막 crop을 보여주고, crop 모드에서는 MedSAM 오버레이를 숨깁니다.",
        )
      : pick(
          locale,
          "Lesion crop mode shows saved lesion crops when available. Return to the source image to draw or edit lesion boxes.",
          "병변 crop 모드에서는 저장된 병변 crop을 보여주며, 병변 박스 편집은 원본 이미지 모드에서만 할 수 있습니다.",
        );

  return (
    <section className={docSectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={docSectionLabelClass}>{pick(locale, "Saved images", "저장 이미지")}</div>
          <button
            type="button"
            className={`${togglePillClass(liveLesionMaskEnabled, true)} order-2`}
            aria-pressed={liveLesionMaskEnabled}
            onClick={onToggleLiveLesionMask}
          >
            {liveLesionMaskEnabled
              ? pick(locale, "MedSAM mask on", "MedSAM mask 켜짐")
              : pick(locale, "MedSAM mask off", "MedSAM mask 꺼짐")}
          </button>
          <select
            aria-label={pick(locale, "Saved image mode", "저장 이미지 모드")}
            className="order-1 min-h-8 rounded-[10px] border border-border bg-white/60 px-3 text-[0.82rem] text-ink outline-none transition duration-150 ease-out focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4"
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
        <span className={docSiteBadgeClass}>
          {panelBusy ? commonLoading : `${selectedCaseImages.length} ${pick(locale, "images", "이미지")}`}
        </span>
      </div>
      <p className="m-0 text-sm leading-6 text-muted">{boardHelpCopy}</p>

      <form onSubmit={(e) => void handleTextSearch(e)} className="flex gap-2">
        <input
          ref={searchInputRef}
          type="text"
          value={textSearchQuery}
          onChange={(e) => setTextSearchQuery(e.target.value)}
          placeholder={pick(locale, "Search images by description (e.g. hypopyon, feathery border)…", "이미지 설명으로 검색 (예: hypopyon, 각막 혼탁)…")}
          className="min-h-9 flex-1 rounded-[10px] border border-border bg-white/60 px-3 text-[0.85rem] text-ink outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4"
          disabled={textSearchBusy}
        />
        <Button type="submit" size="sm" variant="ghost" disabled={textSearchBusy || !textSearchQuery.trim()}>
          {textSearchBusy ? commonLoading : pick(locale, "Search", "검색")}
        </Button>
        {textSearchResults !== null ? (
          <Button type="button" size="sm" variant="ghost" onClick={handleClearSearch}>
            {pick(locale, "Clear", "초기화")}
          </Button>
        ) : null}
      </form>

      {textSearchError ? (
        <div className={emptySurfaceClass}>{textSearchError}</div>
      ) : textSearchResults !== null ? (
        <Card as="div" variant="nested" className="grid gap-3 p-4">
          <div className="text-[0.82rem] font-semibold text-muted">
            {pick(locale, `${textSearchResults.length} results for`, `"${textSearchQuery}" 검색 결과`)} &ldquo;{textSearchQuery}&rdquo;
          </div>
          {textSearchResults.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {textSearchResults.map((result) => (
                <Card key={result.image_id} as="div" variant="panel" className="grid gap-2 p-3">
                  <div className="flex items-center justify-between gap-2 text-[0.82rem]">
                    <span className="font-semibold text-ink">{result.patient_id}</span>
                    <span className={docSiteBadgeClass}>{result.visit_date}</span>
                  </div>
                  {result.preview_url ? (
                    <img
                      src={result.preview_url}
                      alt={result.image_id}
                      className="block max-h-[200px] w-auto max-w-full rounded-[10px] border border-border/60 object-contain"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-2 text-[0.78rem] text-muted">
                    <span>{result.view}</span>
                    <span className={savedImageSupportChipClass}>score {result.score.toFixed(2)}</span>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-[0.85rem] text-muted">
              {pick(locale, "No matching images found.", "일치하는 이미지가 없습니다.")}
            </div>
          )}
        </Card>
      ) : null}

      {selectedCaseImages.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {selectedCaseImages.map((image, index) => {
            const promptReviewOpen = semanticPromptOpenImageIds.includes(image.image_id);
            const livePreview = liveLesionPreviews[image.image_id];
            const draftBox = lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id] ?? null;
            const roiCropKnown = Object.prototype.hasOwnProperty.call(savedImageRoiCropUrls, image.image_id);
            const lesionCropKnown = Object.prototype.hasOwnProperty.call(savedImageLesionCropUrls, image.image_id);
            const roiCropUrl = savedImageRoiCropUrls[image.image_id] ?? null;
            const lesionCropUrl = livePreview?.lesion_crop_url ?? savedImageLesionCropUrls[image.image_id] ?? null;
            const roiCropLoading =
              roiCropModeActive && savedImageRoiCropBusy && Boolean(image.has_roi_crop) && !roiCropKnown;
            const lesionCropLoading =
              lesionCropModeActive &&
              ((livePreview?.status === "running" && !livePreview?.lesion_crop_url) ||
                (savedImageLesionCropBusy &&
                  Boolean(image.has_lesion_crop) &&
                  !lesionCropKnown &&
                  !livePreview?.lesion_crop_url));
            const displayUrl = roiCropModeActive ? roiCropUrl : lesionCropModeActive ? lesionCropUrl : image.preview_url;
            const maskReady = Boolean(
              sourceModeActive && liveLesionMaskEnabled && livePreview?.status === "done" && livePreview?.lesion_mask_url
            );
            const prioritizeImage = index < 2;
            const statusCopy =
              lesionBoxBusyImageId === image.image_id
                ? pick(locale, "Saving...", "저장 중...")
                : roiCropModeActive
                  ? roiCropLoading
                    ? pick(locale, "Preparing cornea crop", "각막 crop 준비 중")
                    : roiCropUrl
                      ? pick(locale, "Cornea crop ready", "각막 crop 준비됨")
                      : pick(locale, "Cornea crop unavailable", "각막 crop 없음")
                  : lesionCropModeActive
                    ? lesionCropLoading
                      ? pick(locale, "Preparing lesion crop", "병변 crop 준비 중")
                      : lesionCropUrl
                        ? pick(locale, "Lesion crop ready", "병변 crop 준비됨")
                        : draftBox
                          ? pick(locale, "Box ready", "Box 준비됨")
                          : pick(locale, "Lesion crop unavailable", "병변 crop 없음")
                    : livePreview?.status === "running"
                      ? pick(locale, "MedSAM running", "MedSAM 실행 중")
                      : maskReady
                        ? pick(locale, "Mask ready", "Mask 준비됨")
                        : draftBox
                          ? pick(locale, "Box ready", "Box 준비됨")
                          : pick(locale, "Draw box for MedSAM", "MedSAM용 박스 그리기");
            const unavailableCopy = roiCropModeActive
              ? pick(locale, "Cornea crop unavailable", "각막 crop이 없습니다")
              : lesionCropModeActive
                ? pick(locale, "Lesion crop unavailable", "병변 crop이 없습니다")
                : pick(locale, "Preview unavailable", "미리보기를 표시할 수 없습니다");

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
                      <span className="shrink-0">· {pick(locale, "Supporting image", "보조 이미지")}</span>
                    )}
                  </div>
                  <span className={docSiteBadgeClass}>{statusCopy}</span>
                </div>

                {displayUrl ? (
                  <div className="grid place-items-center rounded-[14px] border border-border bg-surface-muted/45 p-2">
                    <div
                      className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-[12px] border border-border/60 bg-surface-elevated ${
                        sourceModeActive ? "cursor-crosshair touch-none" : "cursor-default"
                      }`}
                      onPointerDown={sourceModeActive ? (event) => onLesionPointerDown(image.image_id, event) : undefined}
                      onPointerMove={sourceModeActive ? (event) => onLesionPointerMove(image.image_id, event) : undefined}
                      onPointerUp={sourceModeActive ? (event) => onFinishLesionPointer(image.image_id, event) : undefined}
                      onPointerCancel={sourceModeActive ? (event) => onFinishLesionPointer(image.image_id, event) : undefined}
                    >
                      {maskReady ? (
                        <MaskOverlayPreview
                          sourceUrl={image.preview_url}
                          maskUrl={livePreview?.lesion_mask_url}
                          alt={pick(locale, "Live MedSAM mask overlay", "실시간 MedSAM 마스크 오버레이")}
                          tint={LIVE_LESION_MASK_TINT}
                          className="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[12px]"
                          fallbackClassName="pointer-events-none !aspect-auto block !max-h-[320px] !w-auto max-w-full object-contain select-none rounded-[12px]"
                        />
                      ) : (
                        <img
                          src={displayUrl}
                          alt={image.image_id}
                          className="block max-h-[320px] w-auto max-w-full select-none rounded-[12px]"
                          decoding="async"
                          loading={prioritizeImage ? "eager" : "lazy"}
                          fetchPriority={prioritizeImage ? "high" : "low"}
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                        />
                      )}

                      {sourceModeActive && draftBox && !maskReady ? (
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

                      {sourceModeActive && livePreview?.status === "running" ? (
                        <div className="pointer-events-none absolute right-3 top-3 rounded-[8px] bg-ink/78 px-3 py-1 text-[0.72rem] font-semibold text-white">
                          {pick(locale, "MedSAM running", "MedSAM 실행 중")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : panelBusy || roiCropLoading || lesionCropLoading ? (
                  <div className="grid place-items-center rounded-[14px] border border-border bg-surface-muted/45 p-2">
                    <div className="grid h-[220px] w-full max-w-[320px] place-items-center rounded-[12px] border border-border/60 bg-white/75 text-sm text-muted dark:bg-white/4">
                      {roiCropModeActive
                        ? pick(locale, "Preparing cornea crop...", "각막 crop 준비 중...")
                        : lesionCropModeActive
                          ? pick(locale, "Preparing lesion crop...", "병변 crop 준비 중...")
                          : pick(locale, "Loading preview...", "미리보기를 불러오는 중...")}
                    </div>
                  </div>
                ) : (
                  <div className={panelImageFallbackClass}>{unavailableCopy}</div>
                )}

                <div className="flex flex-wrap gap-2 text-[0.78rem] text-muted">
                  <SavedImageSupportChip label="Q" value={image.quality_scores?.quality_score} />
                  {image.quality_scores?.view_score != null && image.quality_scores.view_score < LOW_VIEW_SCORE_THRESHOLD ? (
                    <span className={savedImageWarningChipClass}>
                      {pick(locale, "Check view", "뷰 확인 필요")}
                    </span>
                  ) : null}
                  {livePreview?.status === "failed" && livePreview.error ? (
                    <span className="rounded-[8px] border border-danger/30 bg-danger/8 px-3 py-1.5 text-danger">
                      {livePreview.error}
                    </span>
                  ) : null}
                </div>

                <div className={savedImageActionBarClass}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void onReviewSemanticPrompts(image.image_id)}
                    disabled={semanticPromptBusyImageId === image.image_id}
                  >
                    {semanticPromptBusyImageId === image.image_id
                      ? commonLoading
                      : promptReviewOpen
                        ? pick(locale, "Hide BiomedCLIP analysis", "BiomedCLIP 분석 숨기기")
                        : pick(locale, "Run BiomedCLIP analysis", "BiomedCLIP 분석")}
                  </Button>
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
                        ? pick(locale, "Representative", "대표")
                        : pick(locale, "Set representative", "대표로 지정")}
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
        <div className={emptySurfaceClass}>
          {pick(locale, "No saved images are attached to this case yet.", "이 케이스에는 아직 저장된 이미지가 없습니다.")}
        </div>
      ) : null}
    </section>
  );
}
