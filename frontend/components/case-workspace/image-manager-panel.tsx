"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import {
  docFooterClass,
  docSectionClass,
  docSectionHeadClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  draftLesionSurfaceClass,
  imageGridClass,
  imagePreviewCoverClass,
  lesionBoxOverlayClass,
  togglePillClass,
} from "../ui/workspace-patterns";
import { pick, type Locale } from "../../lib/i18n";

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
          <Card key={image.draft_id} as="article" variant="interactive" className="grid gap-4 p-4">
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
                  <strong className="block truncate text-sm font-semibold text-ink" title={image.file.name}>
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
                <span className={docSiteBadgeClass}>{viewLabel}</span>
              </div>

              <div className="rounded-[16px] border border-border bg-surface-muted/80 px-3 py-2 text-xs text-muted">
                {lesionBox
                  ? pick(locale, "Local lesion box ready", "로컬 병변 박스 준비됨")
                  : pick(locale, "Draw lesion box", "병변 박스 그리기")}
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
    <Card as="section" variant="nested" className="grid gap-4 p-5">
      <SectionHeader
        title={title}
        titleAs="h4"
        aside={
          <Button type="button" variant="ghost" onClick={() => openFilePicker(view)}>
            {uploadLabel}
          </Button>
        }
      />

      <div
        className="group cursor-pointer rounded-[22px] border border-dashed border-brand/25 bg-brand-soft/70 p-5 transition hover:border-brand/40 hover:bg-brand-soft"
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
  return (
    <>
      <section className={docSectionClass}>
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Image board", "이미지 보드")}</div>}
          title={pick(locale, "Organize White and Fluorescein captures", "White와 Fluorescein 이미지를 분리 정리")}
          titleAs="h4"
          description={pick(
            locale,
            "Drop each image into its own view lane, mark a representative image, and draw a local lesion box before saving.",
            "각 뷰에 이미지를 배치하고 대표 이미지를 지정한 뒤, 저장 전에 로컬 병변 박스를 그립니다."
          )}
        />

        <div className="mt-4 grid gap-4">
          <ImageBucket
            locale={locale}
            title={pick(locale, "White (Slit) view", "White (Slit) 뷰")}
            uploadLabel={pick(locale, "Add files", "파일 추가")}
            dropTitle={pick(locale, "Drop White (Slit) photos here", "White (Slit) 사진을 여기에 놓으세요")}
            dropBody={pick(locale, "These files will be stored as the White view.", "이 파일들은 White 뷰로 저장됩니다.")}
            viewLabel={pick(locale, "White", "White")}
            storageLabel={pick(locale, "Stored as White view", "White 뷰로 저장됨")}
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
            title={pick(locale, "Fluorescein view", "Fluorescein 뷰")}
            uploadLabel={pick(locale, "Add files", "파일 추가")}
            dropTitle={pick(locale, "Drop Fluorescein photos here", "Fluorescein 사진을 여기에 놓으세요")}
            dropBody={pick(
              locale,
              "These files will be stored as the Fluorescein view.",
              "이 파일들은 Fluorescein 뷰로 저장됩니다."
            )}
            viewLabel={pick(locale, "Fluorescein", "Fluorescein")}
            storageLabel={pick(locale, "Stored as Fluorescein view", "Fluorescein 뷰로 저장됨")}
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
      </section>

      <div className={docFooterClass}>
        <div className="grid gap-1.5">
          <strong>{pick(locale, "Ready to save", "저장 준비 완료")}</strong>
          <p className="m-0 text-sm leading-6 text-muted">
            {pick(
              locale,
              "Patient, visit, and image records will be stored in the selected hospital workspace using the current dataset model.",
              "환자, 방문, 이미지 기록은 현재 데이터셋 모델을 유지한 채 선택한 병원 워크스페이스에 저장됩니다."
            )}
          </p>
        </div>
        <Button type="button" variant="primary" onClick={onSaveCase} disabled={saveBusy || !selectedSiteId}>
          {saveBusy ? pick(locale, "Saving case...", "케이스 저장 중...") : pick(locale, "Save case to hospital", "병원에 케이스 저장")}
        </Button>
      </div>
    </>
  );
}
