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
  canvasPropertyCardClass,
  canvasPropertyGridClass,
  canvasPropertyLabelClass,
  canvasPropertyValueClass,
  canvasSidebarItemClass,
  draftLesionSurfaceClass,
  imageGridClass,
  imagePreviewCoverClass,
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
  viewLabel: string;
  storageLabel: string;
  draftLesionPromptBoxes: LesionBoxMap;
  onPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onRemove: (draftId: string) => void;
  onSetRepresentative: (draftId: string) => void;
};

function SummaryProperty({ label, value }: { label: string; value: string }) {
  return (
    <div className={canvasPropertyCardClass}>
      <span className={canvasPropertyLabelClass}>{label}</span>
      <span className={canvasPropertyValueClass}>{value}</span>
    </div>
  );
}

function ImageGrid({
  locale,
  images,
  viewLabel,
  storageLabel,
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
        const lesionBox = draftLesionPromptBoxes[image.draft_id];
        return (
          <Card key={image.draft_id} as="article" variant="interactive" className="grid gap-4 overflow-hidden rounded-[20px] p-4">
            <div
              className={draftLesionSurfaceClass}
              onPointerDown={(event) => onPointerDown(image.draft_id, event)}
              onPointerMove={(event) => onPointerMove(image.draft_id, event)}
              onPointerUp={(event) => onPointerUp(image.draft_id, event)}
              onPointerCancel={(event) => onPointerUp(image.draft_id, event)}
            >
              <img
                src={image.preview_url}
                alt={image.file.name}
                className={imagePreviewCoverClass}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
              />
              {lesionBox ? (
                <div
                  className={lesionBoxOverlayClass}
                  style={{
                    left: `${lesionBox.x0 * 100}%`,
                    top: `${lesionBox.y0 * 100}%`,
                    width: `${(lesionBox.x1 - lesionBox.x0) * 100}%`,
                    height: `${(lesionBox.y1 - lesionBox.y0) * 100}%`,
                  }}
                />
              ) : null}
            </div>

            <div className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]" title={image.file.name}>
                    {image.file.name}
                  </strong>
                  <span className="mt-1 block text-xs text-muted">{storageLabel}</span>
                </div>
                <Button size="sm" variant="ghost" type="button" onClick={() => onRemove(image.draft_id)}>
                  {pick(locale, "Remove", "제거")}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={togglePillClass(image.is_representative)}
                  type="button"
                  onClick={() => onSetRepresentative(image.draft_id)}
                >
                  {image.is_representative
                    ? pick(locale, "Representative", "대표 이미지")
                    : pick(locale, "Mark representative", "대표로 지정")}
                </button>
                <span className="inline-flex min-h-8 items-center rounded-full border border-border/70 bg-white/55 px-3 text-[0.76rem] font-medium text-muted dark:bg-white/4">
                  {viewLabel}
                </span>
              </div>

              <div className={canvasSidebarItemClass}>
                {lesionBox
                  ? pick(locale, "Lesion box ready on this image.", "이 이미지의 lesion box가 준비되었습니다.")
                  : pick(locale, "Draw a lesion box directly on the image when ready.", "준비되면 이미지 위에 바로 lesion box를 그리세요.")}
              </div>
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
  viewLabel: string;
  storageLabel: string;
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
  viewLabel,
  storageLabel,
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
    <Card as="section" variant="nested" className="grid gap-4 rounded-[22px] border border-border/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 className="m-0 text-[1.08rem] font-semibold tracking-[-0.03em] text-ink">{title}</h4>
          <p className="m-0 text-sm leading-6 text-muted">{`${images.length} ${pick(locale, "images", "이미지")}`}</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => openFilePicker(view)}>
          {uploadLabel}
        </Button>
      </div>

      <div
        className="group cursor-pointer rounded-[24px] border border-dashed border-brand/22 bg-brand-soft/65 p-5 transition hover:border-brand/36 hover:bg-brand-soft/82"
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
        viewLabel={viewLabel}
        storageLabel={storageLabel}
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
  const lesionBoxCount = allDraftImages.filter((image) => Boolean(draftLesionPromptBoxes[image.draft_id])).length;
  const missingLesionBoxes = Math.max(0, allDraftImages.length - lesionBoxCount);
  const readyToSubmit = intakeCompleted && Boolean(selectedSiteId) && allDraftImages.length > 0;
  const imageSummary = allDraftImages.length
    ? pick(locale, `${allDraftImages.length} draft images are lined up for ${resolvedVisitReferenceLabel}.`, `${resolvedVisitReferenceLabel}에 연결된 초안 이미지 ${allDraftImages.length}장을 정리해 두었습니다.`)
    : pick(locale, "Start by dropping one or more images into a lane below.", "아래 레인에 이미지 한 장 이상을 먼저 놓아보세요.");

  return (
    <CanvasBlock
      eyebrow={pick(locale, "Images", "이미지")}
      title={pick(locale, "Build the image board before submission", "제출 전에 이미지 보드를 먼저 완성합니다")}
      summary={pick(
        locale,
        "Upload at any time. Intake completion now stabilizes submission, not image entry, so the board stays fluid while you work.",
        "이미지는 언제든 올릴 수 있습니다. 이제 intake 완료는 업로드를 막지 않고 제출만 안정화하므로 흐름이 더 자연스럽게 유지됩니다."
      )}
      statusLabel={
        readyToSubmit
          ? pick(locale, "Ready to submit", "제출 준비됨")
          : intakeCompleted
            ? pick(locale, "Draft images", "초안 이미지")
            : pick(locale, "Draft only until intake completes", "intake 완료 전까지는 초안 상태")
      }
      statusTone={readyToSubmit ? "complete" : intakeCompleted ? "active" : "pending"}
    >
      <div className={canvasPropertyGridClass}>
        <SummaryProperty label={pick(locale, "Visit", "방문")} value={resolvedVisitReferenceLabel} />
        <SummaryProperty label={pick(locale, "Representative", "대표 이미지")} value={`${representativeCount} / ${Math.max(1, allDraftImages.length)}`} />
        <SummaryProperty label={pick(locale, "Lesion boxes", "Lesion box")} value={`${lesionBoxCount} / ${allDraftImages.length}`} />
      </div>

      <div className={canvasSidebarItemClass}>{imageSummary}</div>

      <div className="grid gap-4">
        <ImageBucket
          locale={locale}
          title={pick(locale, "White (Slit) lane", "White (Slit) 레인")}
          uploadLabel={pick(locale, "Add files", "파일 추가")}
          dropTitle={pick(locale, "Drop White (Slit) photos here", "White (Slit) 사진을 여기에 놓으세요")}
          dropBody={pick(locale, "Files stay local until this case is saved.", "이 파일들은 케이스를 저장하기 전까지 로컬에만 머뭅니다.")}
          viewLabel={pick(locale, "White", "White")}
          storageLabel={pick(locale, "Draft lane: White", "초안 레인: White")}
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
          dropBody={pick(locale, "Files stay local until this case is saved.", "이 파일들은 케이스를 저장하기 전까지 로컬에만 머뭅니다.")}
          viewLabel={pick(locale, "Fluorescein", "Fluorescein")}
          storageLabel={pick(locale, "Draft lane: Fluorescein", "초안 레인: Fluorescein")}
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
                  : missingLesionBoxes > 0
                    ? pick(locale, `${missingLesionBoxes} image(s) still have no lesion box. You can still save, but the board reads better when the key images are annotated.`, `아직 lesion box가 없는 이미지가 ${missingLesionBoxes}장 있습니다. 저장은 가능하지만, 중요한 이미지는 표시를 마치는 편이 더 좋습니다.`)
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
