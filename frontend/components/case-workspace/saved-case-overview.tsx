"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { CaseSummaryRecord, OrganismRecord } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  docSectionLabelClass,
  docSiteBadgeClass,
  emptySurfaceClass,
  patientVisitGalleryCardClass,
  patientVisitGalleryStackClass,
  savedCaseActionButtonClass,
} from "../ui/workspace-patterns";
import { MaskOverlayPreview } from "./preview-media";
import type { LesionBoxMap, LiveLesionPreviewMap, SavedImagePreview, TranslateOption } from "./shared";

type SavedCaseOverviewProps = {
  locale: Locale;
  localeTag: string;
  commonLoading: string;
  commonNotAvailable: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord;
  selectedPatientCases: CaseSummaryRecord[];
  patientVisitGalleryBusy: boolean;
  patientVisitGallery: Record<string, SavedImagePreview[]>;
  liveLesionPreviews: LiveLesionPreviewMap;
  lesionPromptDrafts: LesionBoxMap;
  lesionPromptSaved: LesionBoxMap;
  editDraftBusy: boolean;
  pick: (locale: Locale, en: string, ko: string) => string;
  translateOption: TranslateOption;
  displayVisitReference: (locale: Locale, visitReference: string) => string;
  formatDateTime: (value: string | null | undefined, localeTag: string, emptyLabel: string) => string;
  organismSummaryLabel: (
    cultureCategory: string,
    cultureSpecies: string,
    additionalOrganisms?: OrganismRecord[],
    limit?: number
  ) => string;
  organismKey: (organism: Pick<OrganismRecord, "culture_category" | "culture_species">) => string;
  onStartEditDraft: () => void | Promise<void>;
  onStartFollowUpDraft: () => void | Promise<void>;
  onToggleFavorite: (caseId: string) => void;
  onOpenSavedCase: (caseRecord: CaseSummaryRecord, nextView: "cases" | "patients") => void;
  onDeleteSavedCase: (caseRecord: CaseSummaryRecord) => void | Promise<void>;
  onLesionPointerDown: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onLesionPointerMove: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onFinishLesionPointer: (imageId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  isFavoriteCase: (caseId: string) => boolean;
  caseTitle: string;
};

function resolveVisitLabel(
  locale: Locale,
  visitReference: string,
  isInitialVisit: boolean,
  pick: SavedCaseOverviewProps["pick"],
  displayVisitReference: SavedCaseOverviewProps["displayVisitReference"]
) {
  if (isInitialVisit) {
    return pick(locale, "Initial", "초진");
  }
  return displayVisitReference(locale, visitReference);
}

export function SavedCaseOverview({
  locale,
  localeTag,
  commonLoading,
  commonNotAvailable,
  selectedSiteId,
  selectedCase,
  selectedPatientCases,
  patientVisitGalleryBusy,
  patientVisitGallery,
  liveLesionPreviews,
  lesionPromptDrafts,
  lesionPromptSaved,
  editDraftBusy,
  pick,
  translateOption,
  displayVisitReference,
  formatDateTime,
  organismSummaryLabel,
  onStartEditDraft,
  onStartFollowUpDraft,
  onToggleFavorite,
  onOpenSavedCase,
  onDeleteSavedCase,
  onLesionPointerDown,
  onLesionPointerMove,
  onFinishLesionPointer,
  isFavoriteCase,
  caseTitle,
}: SavedCaseOverviewProps) {
  const caseNumber = selectedCase.local_case_code || caseTitle || selectedCase.patient_id;
  const selectedVisitLabel = resolveVisitLabel(locale, selectedCase.visit_date, selectedCase.is_initial_visit, pick, displayVisitReference);
  const selectedOrganismLabel = `${translateOption(locale, "cultureCategory", selectedCase.culture_category)} / ${organismSummaryLabel(
    selectedCase.culture_category,
    selectedCase.culture_species,
    selectedCase.additional_organisms,
    2
  )}`;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3 lg:gap-4">
          <div className={docSectionLabelClass}>{pick(locale, "Saved case", "저장 케이스")}</div>
          <h3 className="m-0 text-[clamp(2.1rem,3.6vw,3rem)] font-semibold leading-none tracking-[-0.05em] text-ink">
            {caseTitle}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={docSiteBadgeClass}>{selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}</span>
          <span className={docSiteBadgeClass}>{selectedVisitLabel}</span>
        </div>
      </header>

      <section className="grid gap-3 border-b border-border/70 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className={docSectionLabelClass}>{pick(locale, "Case summary", "케이스 요약")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="ghost" className="px-4" onClick={() => void onStartEditDraft()} disabled={editDraftBusy}>
              {editDraftBusy ? commonLoading : pick(locale, "Edit", "수정")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="px-4" onClick={() => void onStartFollowUpDraft()}>
              {pick(locale, "Add F/U", "재진 추가")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={isFavoriteCase(selectedCase.case_id) ? savedCaseActionButtonClass(true) : "px-4"}
              onClick={() => onToggleFavorite(selectedCase.case_id)}
            >
              {pick(locale, "Favorite", "즐겨찾기")}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-border bg-surface">
          <div className="grid divide-y divide-border sm:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)_minmax(0,1.18fr)] sm:divide-x sm:divide-y-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
              <strong className="text-[clamp(1.5rem,2.1vw,2.1rem)] font-semibold tracking-[-0.04em] text-ink">{caseNumber}</strong>
              <span className="text-[clamp(1rem,1.45vw,1.35rem)] text-muted">
                {translateOption(locale, "sex", selectedCase.sex)} / {selectedCase.age ?? commonNotAvailable}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
              <strong className="text-[clamp(1.5rem,2.1vw,2.1rem)] font-semibold tracking-[-0.04em] text-ink">{selectedVisitLabel}</strong>
              <span className="text-[clamp(1rem,1.45vw,1.35rem)] text-muted">
                {translateOption(locale, "visitStatus", selectedCase.visit_status)} / {selectedVisitLabel}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
              <strong className="text-[clamp(1.35rem,1.85vw,1.9rem)] font-semibold tracking-[-0.04em] text-ink">{selectedOrganismLabel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className={docSectionLabelClass}>{pick(locale, "Patient timeline", "환자 전체 방문")}</div>
          </div>
          <span className={docSiteBadgeClass}>
            {patientVisitGalleryBusy ? commonLoading : `${selectedPatientCases.length} ${pick(locale, "visits", "방문")}`}
          </span>
        </div>

        {patientVisitGalleryBusy ? <div className={emptySurfaceClass}>{commonLoading}</div> : null}
        {!patientVisitGalleryBusy && selectedPatientCases.length === 0 ? (
          <div className={emptySurfaceClass}>{pick(locale, "No saved visits are available for this patient yet.", "이 환자에는 아직 저장 방문이 없습니다.")}</div>
        ) : null}
        {!patientVisitGalleryBusy && selectedPatientCases.length > 0 ? (
          <div className={patientVisitGalleryStackClass}>
            {selectedPatientCases.map((caseItem) => {
              const visitImages = patientVisitGallery[caseItem.case_id] ?? [];
              const isCurrentVisit = selectedCase.case_id === caseItem.case_id;
              const visitLabel = resolveVisitLabel(locale, caseItem.visit_date, caseItem.is_initial_visit, pick, displayVisitReference);
              const imageCount = visitImages.length || caseItem.image_count;
              const visitMeta = [
                formatDateTime(caseItem.latest_image_uploaded_at ?? caseItem.created_at, localeTag, commonNotAvailable),
                `${imageCount} ${pick(locale, "images", "이미지")}`,
                `${translateOption(locale, "cultureCategory", caseItem.culture_category)} / ${organismSummaryLabel(
                  caseItem.culture_category,
                  caseItem.culture_species,
                  caseItem.additional_organisms
                )}`,
              ];

              return (
                <Card
                  as="section"
                  variant="nested"
                  key={`visit-gallery-${caseItem.case_id}`}
                  className={`${patientVisitGalleryCardClass(isCurrentVisit)} grid gap-4 p-4`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="grid gap-1.5">
                      <h5 className="m-0 text-[clamp(1.35rem,1.9vw,1.7rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">{visitLabel}</h5>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.95rem] leading-5 text-muted">
                        {visitMeta.map((item) => (
                          <span key={`${caseItem.case_id}-${item}`}>{item}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={isCurrentVisit ? savedCaseActionButtonClass() : "px-3.5"}
                        onClick={() => onOpenSavedCase(caseItem, "cases")}
                      >
                        {isCurrentVisit ? pick(locale, "Current visit", "현재 방문") : pick(locale, "Open visit", "방문 열기")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="px-3.5" onClick={() => void onDeleteSavedCase(caseItem)}>
                        {pick(locale, "Delete visit", "방문 삭제")}
                      </Button>
                    </div>
                  </div>

                  {visitImages.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {visitImages.map((image) => {
                        const livePreview = liveLesionPreviews[image.image_id];
                        const draftBox = lesionPromptDrafts[image.image_id] ?? lesionPromptSaved[image.image_id] ?? null;
                        const maskReady = Boolean(isCurrentVisit && livePreview?.status === "done" && livePreview?.lesion_mask_url);

                        return (
                          <div key={`timeline-${image.image_id}`} className="grid gap-2.5">
                            {image.preview_url ? (
                              <div className="grid h-40 place-items-center rounded-[14px] border border-border/60 bg-surface p-2">
                                <div
                                  className={`relative w-fit max-w-full overflow-hidden rounded-[12px] ${isCurrentVisit ? "cursor-crosshair touch-none" : ""}`}
                                  onPointerDown={isCurrentVisit ? (event) => onLesionPointerDown(image.image_id, event) : undefined}
                                  onPointerMove={isCurrentVisit ? (event) => onLesionPointerMove(image.image_id, event) : undefined}
                                  onPointerUp={isCurrentVisit ? (event) => onFinishLesionPointer(image.image_id, event) : undefined}
                                  onPointerCancel={isCurrentVisit ? (event) => onFinishLesionPointer(image.image_id, event) : undefined}
                                >
                                  {maskReady ? (
                                    <MaskOverlayPreview
                                      sourceUrl={image.preview_url}
                                      maskUrl={livePreview?.lesion_mask_url}
                                      alt={pick(locale, "Live MedSAM mask overlay", "실시간 MedSAM mask overlay")}
                                      tint={[242, 164, 154]}
                                      className="pointer-events-none !aspect-auto block !h-36 !w-auto max-w-full object-contain select-none rounded-[12px]"
                                      fallbackClassName="pointer-events-none !aspect-auto block !h-36 !w-auto max-w-full object-contain select-none rounded-[12px]"
                                    />
                                  ) : (
                                    <img
                                      src={image.preview_url}
                                      alt={image.image_id}
                                      className="block h-36 w-auto max-w-full rounded-[12px] object-contain"
                                      draggable={false}
                                      onDragStart={(event) => event.preventDefault()}
                                    />
                                  )}
                                  {isCurrentVisit && draftBox && !maskReady ? (
                                    <div
                                      className="pointer-events-none absolute rounded-[10px] border-2 border-danger/70 bg-danger/10"
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
                            ) : (
                              <div className="grid h-48 w-full place-items-center rounded-[20px] border border-border/60 bg-surface text-sm text-muted">
                                {translateOption(locale, "view", image.view)}
                              </div>
                            )}
                          <div className="grid gap-0.5">
                            <strong className="text-base font-semibold tracking-[-0.03em] text-ink">
                              {translateOption(locale, "view", image.view)}
                            </strong>
                            <span className="text-sm leading-5 text-muted">
                              {image.is_representative ? pick(locale, "Representative image", "대표 이미지") : pick(locale, "Supporting image", "보조 이미지")}
                            </span>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={emptySurfaceClass}>{pick(locale, "No saved images for this visit yet.", "이 방문에는 아직 저장 이미지가 없습니다.")}</div>
                  )}
                </Card>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}
