"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

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

function renderImageGrid(
  locale: Locale,
  images: DraftImage[],
  viewLabel: string,
  storageLabel: string,
  draftLesionPromptBoxes: LesionBoxMap,
  onPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void,
  onPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void,
  onPointerUp: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void,
  onRemove: (draftId: string) => void,
  onSetRepresentative: (draftId: string) => void,
) {
  if (!images.length) {
    return null;
  }
  return (
    <div className={`image-grid ${images.length === 1 ? "single" : ""}`}>
      {images.map((image) => (
        <article key={image.draft_id} className="image-card">
          <div
            className="image-preview-frame lesion-editor-surface draft-lesion-surface"
            onPointerDown={(event) => onPointerDown(image.draft_id, event)}
            onPointerMove={(event) => onPointerMove(image.draft_id, event)}
            onPointerUp={(event) => onPointerUp(image.draft_id, event)}
            onPointerCancel={(event) => onPointerUp(image.draft_id, event)}
          >
            <img
              src={image.preview_url}
              alt={image.file.name}
              className="image-preview lesion-editor-image"
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
            />
            {draftLesionPromptBoxes[image.draft_id] ? (
              <div
                className="lesion-box-overlay"
                style={{
                  left: `${(draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0) * 100}%`,
                  top: `${(draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0) * 100}%`,
                  width: `${((draftLesionPromptBoxes[image.draft_id]?.x1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.x0 ?? 0)) * 100}%`,
                  height: `${((draftLesionPromptBoxes[image.draft_id]?.y1 ?? 0) - (draftLesionPromptBoxes[image.draft_id]?.y0 ?? 0)) * 100}%`,
                }}
              />
            ) : null}
          </div>
          <div className="image-card-body">
            <div className="image-card-head">
              <strong className="image-card-name" title={image.file.name}>
                {image.file.name}
              </strong>
              <button className="text-button" type="button" onClick={() => onRemove(image.draft_id)}>
                {pick(locale, "Remove", "제거")}
              </button>
            </div>
            <div className="image-card-controls">
              <span className="image-card-storage-label">{storageLabel}</span>
              <button className={`toggle-pill ${image.is_representative ? "active" : ""}`} type="button" onClick={() => onSetRepresentative(image.draft_id)}>
                {image.is_representative ? pick(locale, "Representative", "대표 이미지") : pick(locale, "Mark representative", "대표 이미지로 지정")}
              </button>
            </div>
            <div className="panel-meta draft-lesion-meta">
              <span>
                {draftLesionPromptBoxes[image.draft_id]
                  ? pick(locale, "Local lesion box ready", "로컬 병변 박스 준비됨")
                  : pick(locale, "Draw lesion box", "병변 박스 그리기")}
              </span>
              <span>{viewLabel}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
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
      <section className="doc-section">
        <div className="doc-section-head">
          <div className="visit-context-headline">
            <div className="doc-section-label">{pick(locale, "Image board", "이미지 보드")}</div>
            <h4 className="visit-context-hint">{pick(locale, "Place White (Slit) and Fluorescein images into separate slots", "White (Slit) 뷰와 Fluorescein 뷰를 나눠서 넣기")}</h4>
          </div>
        </div>
        <div className="ops-stack">
          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "White (Slit) view", "White (Slit) 뷰")}</strong>
              <button className="ghost-button" type="button" onClick={() => openFilePicker("white")}>
                {pick(locale, "Add files", "파일 추가")}
              </button>
            </div>
            <div
              className="drop-surface"
              onClick={() => openFilePicker("white")}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                appendFiles(Array.from(event.dataTransfer.files), "white");
              }}
            >
              <input
                ref={whiteFileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  appendFiles(Array.from(event.target.files ?? []), "white");
                  event.currentTarget.value = "";
                }}
              />
              <div className="drop-copy">
                <strong>{pick(locale, "Drop White (Slit) photos here", "White (Slit) 사진을 여기로 넣으세요")}</strong>
                <span>{pick(locale, "These files will be stored as the White view.", "White 뷰로 저장됩니다.")}</span>
              </div>
            </div>
            {renderImageGrid(
              locale,
              whiteDraftImages,
              pick(locale, "White", "White"),
              pick(locale, "Stored as White view", "White 뷰로 저장"),
              draftLesionPromptBoxes,
              handleDraftLesionPointerDown,
              handleDraftLesionPointerMove,
              finishDraftLesionPointer,
              removeDraftImage,
              setRepresentativeImage
            )}
          </section>

          <section className="ops-card">
            <div className="panel-card-head">
              <strong>{pick(locale, "Fluorescein view", "Fluorescein 뷰")}</strong>
              <button className="ghost-button" type="button" onClick={() => openFilePicker("fluorescein")}>
                {pick(locale, "Add files", "파일 추가")}
              </button>
            </div>
            <div
              className="drop-surface"
              onClick={() => openFilePicker("fluorescein")}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                appendFiles(Array.from(event.dataTransfer.files), "fluorescein");
              }}
            >
              <input
                ref={fluoresceinFileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  appendFiles(Array.from(event.target.files ?? []), "fluorescein");
                  event.currentTarget.value = "";
                }}
              />
              <div className="drop-copy">
                <strong>{pick(locale, "Drop Fluorescein photos here", "Fluorescein 사진을 여기로 넣으세요")}</strong>
                <span>{pick(locale, "These files will be stored as the Fluorescein view.", "Fluorescein 뷰로 저장됩니다.")}</span>
              </div>
            </div>
            {renderImageGrid(
              locale,
              fluoresceinDraftImages,
              pick(locale, "Fluorescein", "Fluorescein"),
              pick(locale, "Stored as Fluorescein view", "Fluorescein 뷰로 저장"),
              draftLesionPromptBoxes,
              handleDraftLesionPointerDown,
              handleDraftLesionPointerMove,
              finishDraftLesionPointer,
              removeDraftImage,
              setRepresentativeImage
            )}
          </section>
        </div>
      </section>

      <div className="doc-footer">
        <div>
          <strong>{pick(locale, "Ready to save", "저장 준비 완료")}</strong>
          <p>
            {pick(locale, "Patient, visit, and image records will be stored in the selected hospital workspace using the current dataset model.", "환자, 방문, 이미지 레코드는 현재 데이터셋 구조를 유지한 채 선택한 병원 워크스페이스에 저장됩니다.")}
          </p>
        </div>
        <button className="primary-workspace-button" type="button" onClick={onSaveCase} disabled={saveBusy || !selectedSiteId}>
          {saveBusy ? pick(locale, "Saving case...", "케이스 저장 중...") : pick(locale, "Save case to hospital", "병원에 케이스 저장")}
        </button>
      </div>
    </>
  );
}
