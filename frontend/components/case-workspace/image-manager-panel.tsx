"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { pick, type Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { CanvasBlock } from "../ui/canvas-block";
import { Card } from "../ui/card";
import {
  canvasFooterBodyClass,
  canvasFooterClass,
  canvasFooterCopyClass,
  canvasFooterTitleClass,
  canvasPropertyGridClass,
  canvasSidebarItemClass,
  draftLesionSurfaceClass,
  imageGridClass,
  lesionBoxOverlayClass,
  togglePillClass,
} from "../ui/workspace-patterns";

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type NormalizedBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type LesionBoxMap = Record<string, NormalizedBox | null>;

type Props = {
  locale: Locale;
  intakeCompleted: boolean;
  resolvedVisitReferenceLabel: string;
  whiteDraftImages: DraftImage[];
  fluoresceinDraftImages: DraftImage[];
  draftLesionPromptBoxes: LesionBoxMap;
  whiteFileInputRef: RefObject<HTMLInputElement | null>;
  fluoresceinFileInputRef: RefObject<HTMLInputElement | null>;
  openFilePicker: (view: "white" | "fluorescein") => void;
  appendFiles: (files: File[], view: "white" | "fluorescein") => void;
  handleDraftLesionPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  handleDraftLesionPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  finishDraftLesionPointer: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  removeDraftImage: (draftId: string) => void;
  setRepresentativeImage: (draftId: string) => void;
  onSaveCase: () => void;
  saveBusy: boolean;
  selectedSiteId: string | null;
};

type ImageGridProps = {
  locale: Locale;
  images: DraftImage[];
  draftLesionPromptBoxes: LesionBoxMap;
  onPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onRemove: (draftId: string) => void;
  onSetRepresentative: (draftId: string) => void;
};

const compactSummaryPropertyClass =
  "flex min-w-0 items-center justify-between gap-3 rounded-[18px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.82))] px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] dark:bg-white/4";
const compactSummaryLabelClass = "shrink-0 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted";
const compactSummaryValueClass = "min-w-0 truncate text-sm font-medium leading-6 text-ink text-right";
const draftLesionStatusChipClass =
  "inline-flex min-h-10 w-full items-center justify-center rounded-[12px] border border-border/80 bg-surface px-3.5 text-center text-[0.78rem] font-semibold tracking-[0.01em] text-muted whitespace-nowrap";

function hasUsableDraftLesionBox(
  box: NormalizedBox | null | undefined,
): box is NormalizedBox {
  return Boolean(box && box.x1 - box.x0 >= 0.01 && box.y1 - box.y0 >= 0.01);
}

function SummaryProperty({ label, value }: { label: string; value: string }) {
  return (
    <div className={compactSummaryPropertyClass}>
      <span className={compactSummaryLabelClass}>{label}</span>
      <span className={compactSummaryValueClass}>{value}</span>
    </div>
  );
}

function ImageGrid({
  locale,
  images,
  draftLesionPromptBoxes,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRemove,
  onSetRepresentative,
}: ImageGridProps) {
  if (!images.length) {
    return null;
  }

  return (
    <div className={imageGridClass(images.length === 1)}>
      {images.map((image) => {
        const draftBox = draftLesionPromptBoxes[image.draft_id] ?? null;
        const hasUsableDraftBox = hasUsableDraftLesionBox(draftBox);
        const lesionCanvasLabel = pick(
          locale,
          `Lesion box canvas for ${image.file.name}`,
          `${image.file.name} 병변 박스 캔버스`,
        );
        return (
          <Card key={image.draft_id} as="article" variant="interactive" className="grid gap-2 overflow-hidden rounded-[18px] p-2.5">
            <div className="grid place-items-center rounded-[16px] border border-border/70 bg-surface-muted/55 p-2">
              <div
                aria-label={lesionCanvasLabel}
                className={`${draftLesionSurfaceClass} mx-auto w-fit max-w-full !aspect-auto rounded-[14px] border-border/60 bg-white/70`}
                onPointerDown={(event) => onPointerDown(image.draft_id, event)}
                onPointerMove={(event) => onPointerMove(image.draft_id, event)}
                onPointerUp={(event) => onPointerUp(image.draft_id, event)}
                onPointerCancel={(event) => onPointerUp(image.draft_id, event)}
              >
                <img
                  src={image.preview_url}
                  alt={image.file.name}
                  className="block max-h-[320px] w-auto max-w-full select-none rounded-[12px] object-contain"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                />
                {draftBox ? (
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
              </div>
            </div>

            <div className="grid gap-2.5 px-1 pb-1">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <button
                  className={`${togglePillClass(image.is_representative, true)} inline-flex min-w-0 items-center justify-center whitespace-nowrap px-3.5 text-center`}
                  type="button"
                  onClick={() => onSetRepresentative(image.draft_id)}
                >
                  {image.is_representative
                    ? pick(locale, "Representative", "대표 이미지")
                    : pick(locale, "Mark representative", "대표로 지정")}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  className="min-h-10 min-w-[92px] shrink-0 whitespace-nowrap px-4"
                  onClick={() => onRemove(image.draft_id)}
                >
                  {pick(locale, "Remove", "제거")}
                </Button>
              </div>
              <span className={draftLesionStatusChipClass}>
                {hasUsableDraftBox
                  ? pick(locale, "Lesion box ready", "병변 박스 준비됨")
                  : pick(locale, "Draw lesion box", "병변 박스 그리기")}
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

type ImageBucketProps = {
  locale: Locale;
  title: string;
  uploadLabel: string;
  dropTitle: string;
  dropBody: string;
  view: "white" | "fluorescein";
  images: DraftImage[];
  inputRef: RefObject<HTMLInputElement | null>;
  draftLesionPromptBoxes: LesionBoxMap;
  openFilePicker: (view: "white" | "fluorescein") => void;
  appendFiles: (files: File[], view: "white" | "fluorescein") => void;
  handleDraftLesionPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  handleDraftLesionPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  finishDraftLesionPointer: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  removeDraftImage: (draftId: string) => void;
  setRepresentativeImage: (draftId: string) => void;
};

function ImageBucket({
  locale,
  title,
  uploadLabel,
  dropTitle,
  dropBody,
  view,
  images,
  inputRef,
  draftLesionPromptBoxes,
  openFilePicker,
  appendFiles,
  handleDraftLesionPointerDown,
  handleDraftLesionPointerMove,
  finishDraftLesionPointer,
  removeDraftImage,
  setRepresentativeImage,
}: ImageBucketProps) {
  return (
    <Card as="section" variant="nested" className="grid content-start gap-2 rounded-[22px] border border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h4 className="m-0 text-[1.08rem] font-semibold tracking-[-0.03em] text-ink">{title}</h4>
          <p className="m-0 text-sm leading-6 text-muted">{`${images.length} ${pick(locale, "images", "이미지")}`}</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => openFilePicker(view)}>
          {uploadLabel}
        </Button>
      </div>

      <div
        className="group cursor-pointer rounded-[22px] border border-dashed border-brand/22 bg-brand-soft/65 p-3 transition hover:border-brand/36 hover:bg-brand-soft/82"
        onClick={() => openFilePicker(view)}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          appendFiles(Array.from(event.dataTransfer.files), view);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            appendFiles(Array.from(event.target.files ?? []), view);
            event.currentTarget.value = "";
          }}
        />
        <div className="grid gap-1.5">
          <strong className="text-base font-semibold text-ink">{dropTitle}</strong>
          <span className="text-sm leading-6 text-muted">{dropBody}</span>
        </div>
      </div>

      <ImageGrid
        locale={locale}
        images={images}
        draftLesionPromptBoxes={draftLesionPromptBoxes}
        onPointerDown={handleDraftLesionPointerDown}
        onPointerMove={handleDraftLesionPointerMove}
        onPointerUp={finishDraftLesionPointer}
        onRemove={removeDraftImage}
        onSetRepresentative={setRepresentativeImage}
      />
    </Card>
  );
}

export function ImageManagerPanel({
  locale,
  intakeCompleted,
  resolvedVisitReferenceLabel,
  whiteDraftImages,
  fluoresceinDraftImages,
  draftLesionPromptBoxes,
  whiteFileInputRef,
  fluoresceinFileInputRef,
  openFilePicker,
  appendFiles,
  handleDraftLesionPointerDown,
  handleDraftLesionPointerMove,
  finishDraftLesionPointer,
  removeDraftImage,
  setRepresentativeImage,
  onSaveCase,
  saveBusy,
  selectedSiteId,
}: Props) {
  const allDraftImages = [...whiteDraftImages, ...fluoresceinDraftImages];
  const representativeCount = allDraftImages.filter((image) => image.is_representative).length;
  const boxedImageCount = allDraftImages.filter((image) =>
    hasUsableDraftLesionBox(draftLesionPromptBoxes[image.draft_id]),
  ).length;
  const lesionBoxesComplete =
    allDraftImages.length > 0 && boxedImageCount === allDraftImages.length;
  const readyToSubmit =
    intakeCompleted &&
    Boolean(selectedSiteId) &&
    allDraftImages.length > 0 &&
    lesionBoxesComplete;
  const imageSummary = allDraftImages.length
    ? lesionBoxesComplete
      ? pick(
          locale,
          `${allDraftImages.length} draft images are lined up for ${resolvedVisitReferenceLabel}, and every image has a lesion box.`,
          `${resolvedVisitReferenceLabel}에 연결된 초안 이미지 ${allDraftImages.length}장에 병변 박스를 모두 지정했습니다.`,
        )
      : pick(
          locale,
          `${boxedImageCount} of ${allDraftImages.length} draft images already have lesion boxes. Draw directly on each image before saving.`,
          `초안 이미지 ${allDraftImages.length}장 중 ${boxedImageCount}장에 병변 박스를 지정했습니다. 저장 전 모든 이미지에 직접 그려 주세요.`,
        )
    : pick(locale, "Start by dropping one or more images into a lane below.", "아래 레인에 이미지 한 장 이상을 먼저 놓아보세요.");

  return (
    <CanvasBlock
      eyebrow={pick(locale, "Images", "이미지")}
      title={
        <span className="inline-flex items-center gap-2">
          <span>{pick(locale, "Build the image", "제출 전에 이미지")}</span>
          <span role="img" aria-label={pick(locale, "Image board", "이미지 보드")}>
            🖼️
          </span>
          <span>{pick(locale, "board before submission", "보드를 먼저 완성합니다")}</span>
        </span>
      }
      statusLabel={
        readyToSubmit
          ? pick(locale, "Ready to submit", "제출 준비됨")
          : intakeCompleted
            ? pick(locale, "Lesion boxes required", "병변 박스 필요")
            : pick(locale, "Draft only until intake completes", "intake 완료 전까지는 초안 상태")
      }
      statusTone={readyToSubmit ? "complete" : intakeCompleted ? "active" : "pending"}
    >
      <div className={canvasPropertyGridClass}>
        <SummaryProperty label={pick(locale, "Visit", "방문")} value={resolvedVisitReferenceLabel} />
        <SummaryProperty label={pick(locale, "Representative", "대표 이미지")} value={`${representativeCount} / ${Math.max(1, allDraftImages.length)}`} />
      </div>

      <div className={canvasSidebarItemClass}>{imageSummary}</div>

      <div className="grid gap-3 xl:grid-cols-2">
        <ImageBucket
          locale={locale}
          title={pick(locale, "White (Slit) lane", "White (Slit) 레인")}
          uploadLabel={pick(locale, "Add files", "파일 추가")}
          dropTitle={pick(locale, "Drop White (Slit) photos here", "White (Slit) 사진을 여기에 놓으세요")}
          dropBody={pick(locale, "Files stay local.", "이 파일들은 로컬에만 머뭅니다.")}
          view="white"
          images={whiteDraftImages}
          inputRef={whiteFileInputRef}
          draftLesionPromptBoxes={draftLesionPromptBoxes}
          openFilePicker={openFilePicker}
          appendFiles={appendFiles}
          handleDraftLesionPointerDown={handleDraftLesionPointerDown}
          handleDraftLesionPointerMove={handleDraftLesionPointerMove}
          finishDraftLesionPointer={finishDraftLesionPointer}
          removeDraftImage={removeDraftImage}
          setRepresentativeImage={setRepresentativeImage}
        />

        <ImageBucket
          locale={locale}
          title={pick(locale, "Fluorescein lane", "Fluorescein 레인")}
          uploadLabel={pick(locale, "Add files", "파일 추가")}
          dropTitle={pick(locale, "Drop Fluorescein photos here", "Fluorescein 사진을 여기에 놓으세요")}
          dropBody={pick(locale, "Files stay local.", "이 파일들은 로컬에만 머뭅니다.")}
          view="fluorescein"
          images={fluoresceinDraftImages}
          inputRef={fluoresceinFileInputRef}
          draftLesionPromptBoxes={draftLesionPromptBoxes}
          openFilePicker={openFilePicker}
          appendFiles={appendFiles}
          handleDraftLesionPointerDown={handleDraftLesionPointerDown}
          handleDraftLesionPointerMove={handleDraftLesionPointerMove}
          finishDraftLesionPointer={finishDraftLesionPointer}
          removeDraftImage={removeDraftImage}
          setRepresentativeImage={setRepresentativeImage}
        />
      </div>

      <div className={canvasFooterClass}>
        <div className={canvasFooterCopyClass}>
          <strong className={canvasFooterTitleClass}>
            {readyToSubmit ? pick(locale, "Submission is available", "제출 가능 상태입니다") : pick(locale, "Submission is still gated", "아직 제출 조건이 남아 있습니다")}
          </strong>
          <p className={canvasFooterBodyClass}>
            {!selectedSiteId
              ? pick(locale, "Select a hospital before the case can be stored.", "케이스를 저장하려면 먼저 병원을 선택하세요.")
              : !intakeCompleted
                ? pick(locale, "Complete the intake first. Image uploads can continue, but submission stays disabled until the case structure is locked.", "먼저 intake를 완료하세요. 이미지 업로드는 계속할 수 있지만, 케이스 구조를 고정하기 전까지 제출은 비활성화됩니다.")
                : allDraftImages.length === 0
                  ? pick(locale, "Add at least one image before saving this case to the hospital workspace.", "병원 워크스페이스에 저장하려면 이미지가 최소 한 장 필요합니다.")
                  : !lesionBoxesComplete
                    ? pick(
                        locale,
                        "Draw and save a lesion box on every uploaded image before saving this case.",
                        "케이스를 저장하기 전에 업로드한 모든 이미지에 병변 박스를 그리고 저장해 주세요.",
                      )
                  : pick(locale, "Patient, visit, and image records are aligned. You can save this case to the selected hospital now.", "환자, 방문, 이미지 기록이 정렬되었습니다. 이제 선택한 병원에 케이스를 저장할 수 있습니다.")}
          </p>
        </div>
        <Button type="button" variant="primary" onClick={onSaveCase} disabled={saveBusy || !readyToSubmit}>
          {saveBusy ? pick(locale, "Saving case...", "케이스 저장 중...") : pick(locale, "Save to hospital", "병원에 저장")}
        </Button>
      </div>
    </CanvasBlock>
  );
}
