"use client";

import type { CaseSummaryRecord, OrganismRecord } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  emptySurfaceClass,
  patientVisitGalleryCardClass,
  patientVisitGalleryStackClass,
  representativeImageTagClass,
  savedCaseActionButtonClass,
} from "../ui/workspace-patterns";
import { MaskOverlayPreview } from "./preview-media";
import type { LiveLesionPreviewMap, SavedImagePreview, TranslateOption } from "./shared";

const savedCaseMintLabelClass =
  "inline-flex min-h-9 items-center rounded-[10px] border border-brand/18 bg-brand-soft/80 px-4 text-[0.76rem] font-semibold tracking-[-0.01em] text-brand dark:border-brand/20 dark:bg-brand-soft/75 dark:text-brand";
const savedCaseHeaderBadgeClass =
  "inline-flex min-h-8 items-center rounded-[10px] border border-border bg-surface px-3.5 text-[0.76rem] font-medium text-muted";
const savedCaseGhostActionClass =
  "min-h-9 rounded-[10px] border border-border bg-surface px-4 text-[0.86rem] font-semibold text-ink hover:border-border/80 hover:bg-surface-muted";
const savedCaseFollowUpActionClass =
  "min-h-10 rounded-[11px] border border-brand-strong/35 bg-brand px-4 text-[0.86rem] font-semibold text-[var(--accent-contrast)] shadow-[0_12px_24px_rgba(48,88,255,0.24)] ring-1 ring-brand/15 transition duration-150 ease-out hover:-translate-y-[1px] hover:border-brand-strong hover:bg-brand-strong hover:shadow-[0_16px_28px_rgba(48,88,255,0.28)] dark:border-brand/40 dark:bg-brand dark:text-[var(--accent-contrast)] dark:ring-brand/20";
const savedCaseCurrentVisitActionClass =
  "min-h-9 rounded-[10px] border border-brand/22 bg-brand-soft/85 px-4 text-[0.86rem] font-semibold text-brand hover:border-brand/30 hover:bg-brand-soft dark:border-brand/24 dark:bg-brand-soft/80 dark:text-brand dark:hover:border-brand/34 dark:hover:bg-brand-soft";
const savedCaseSummaryBarClass =
  "overflow-hidden rounded-[14px] border border-border bg-surface-muted/70 dark:border-white/8 dark:bg-surface-muted/70";

type SavedCaseOverviewProps = {
  locale: Locale;
  localeTag: string;
  commonLoading: string;
  commonNotAvailable: string;
  selectedCase: CaseSummaryRecord;
  selectedPatientCases: CaseSummaryRecord[];
  panelBusy: boolean;
  patientVisitGalleryBusy: boolean;
  patientVisitGallery: Record<string, SavedImagePreview[]>;
  liveLesionPreviews: LiveLesionPreviewMap;
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
  onStartEditDraft: () => void | Promise<void>;
  onStartFollowUpDraft: () => void | Promise<void>;
  onToggleFavorite: (caseId: string) => void;
  onOpenSavedCase: (caseRecord: CaseSummaryRecord, nextView: "cases" | "patients") => void;
  onDeleteSavedCase: (caseRecord: CaseSummaryRecord) => void | Promise<void>;
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
  selectedCase,
  selectedPatientCases,
  panelBusy,
  patientVisitGalleryBusy,
  patientVisitGallery,
  liveLesionPreviews,
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
  isFavoriteCase,
  caseTitle,
}: SavedCaseOverviewProps) {
  const caseNumber = selectedCase.local_case_code || caseTitle || selectedCase.patient_id;
  const selectedVisitLabel = resolveVisitLabel(locale, selectedCase.visit_date, selectedCase.is_initial_visit, pick, displayVisitReference);
  const selectedOrganismLabel = `${translateOption(locale, "cultureCategory", selectedCase.culture_category)} · ${organismSummaryLabel(
    selectedCase.culture_category,
    selectedCase.culture_species,
    selectedCase.additional_organisms,
    2
  )}`;

  return (
    <>
      <section className="grid gap-3.5 border-b border-border/70 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={savedCaseMintLabelClass}>{pick(locale, "Case summary", "케이스 요약")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="ghost" className={savedCaseGhostActionClass} onClick={() => void onStartEditDraft()} disabled={editDraftBusy}>
              {editDraftBusy ? commonLoading : pick(locale, "Edit", "수정")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className={savedCaseFollowUpActionClass} onClick={() => void onStartFollowUpDraft()}>
              {pick(locale, "Add F/U", "재진 추가")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={isFavoriteCase(selectedCase.case_id) ? savedCaseActionButtonClass(true) : savedCaseGhostActionClass}
              onClick={() => onToggleFavorite(selectedCase.case_id)}
            >
              {pick(locale, "Favorite", "즐겨찾기")}
            </Button>
          </div>
        </div>

        <div className={savedCaseSummaryBarClass}>
          <div className="grid divide-y divide-border sm:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)_minmax(0,1.18fr)] sm:divide-x sm:divide-y-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3.5">
              <strong className="text-[clamp(0.96rem,1.02vw,1.14rem)] font-semibold tracking-[-0.02em] text-ink">{caseNumber}</strong>
              <span className="text-[0.82rem] text-muted">
                {translateOption(locale, "sex", selectedCase.sex)} · {selectedCase.age ?? commonNotAvailable}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3.5">
              <strong className="text-[clamp(0.96rem,1.02vw,1.14rem)] font-semibold tracking-[-0.02em] text-ink">{selectedVisitLabel}</strong>
              <span className="text-[0.82rem] text-muted">
                {translateOption(locale, "visitStatus", selectedCase.visit_status)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3.5">
              <strong className="text-[clamp(0.96rem,1.08vw,1.12rem)] font-semibold tracking-[-0.02em] text-ink">{selectedOrganismLabel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className={savedCaseMintLabelClass}>{pick(locale, "Patient timeline", "환자 전체 방문")}</div>
          </div>
          <span className={savedCaseHeaderBadgeClass}>
            {patientVisitGalleryBusy ? commonLoading : `${selectedPatientCases.length} ${pick(locale, "visits", "방문")}`}
          </span>
        </div>

        {patientVisitGalleryBusy ? <div className={emptySurfaceClass}>{commonLoading}</div> : null}
        {!patientVisitGalleryBusy && selectedPatientCases.length === 0 ? (
          <div className={emptySurfaceClass}>{pick(locale, "No saved visits are available for this patient yet.", "이 환자에는 아직 저장 방문이 없습니다.")}</div>
        ) : null}
        {selectedPatientCases.length > 0 ? (
          <div className={patientVisitGalleryStackClass}>
            {selectedPatientCases.map((caseItem) => {
              const visitImages = patientVisitGallery[caseItem.case_id];
              const hasLoadedVisitImages = Array.isArray(visitImages);
              const visibleVisitImages = visitImages ?? [];
              const isCurrentVisit = selectedCase.case_id === caseItem.case_id;
              const visitLabel = resolveVisitLabel(locale, caseItem.visit_date, caseItem.is_initial_visit, pick, displayVisitReference);
              const imageCount = visibleVisitImages.length || caseItem.image_count;
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
                  className={`${patientVisitGalleryCardClass(isCurrentVisit)} grid gap-3 p-3.5`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2.5 md:flex-nowrap">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[0.78rem] leading-5 text-muted md:flex-nowrap">
                      <h5 className="m-0 shrink-0 text-[clamp(0.96rem,1vw,1.08rem)] font-semibold leading-none tracking-[-0.01em] text-ink">{visitLabel}</h5>
                      {visitMeta.map((item) => (
                        <span key={`${caseItem.case_id}-${item}`} className="whitespace-nowrap">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={isCurrentVisit ? savedCaseCurrentVisitActionClass : savedCaseGhostActionClass}
                        onClick={() => onOpenSavedCase(caseItem, "cases")}
                      >
                        {isCurrentVisit ? pick(locale, "Current visit", "현재 방문") : pick(locale, "Open visit", "방문 열기")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className={savedCaseGhostActionClass} onClick={() => void onDeleteSavedCase(caseItem)}>
                        {pick(locale, "Delete visit", "방문 삭제")}
                      </Button>
                    </div>
                  </div>

                  {visibleVisitImages.length > 0 ? (
                    <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                      {visibleVisitImages.map((image) => {
                        const livePreview = liveLesionPreviews[image.image_id];
                        const maskReady = Boolean(livePreview?.status === "done" && livePreview?.lesion_mask_url);

                        return (
                          <div key={`timeline-${image.image_id}`} className="grid gap-2.5">
                            {image.preview_url ? (
                              <div className="relative aspect-square overflow-hidden rounded-[18px] bg-surface-muted/55">
                                {maskReady ? (
                                  <MaskOverlayPreview
                                    sourceUrl={image.preview_url}
                                    maskUrl={livePreview?.lesion_mask_url}
                                    alt={pick(locale, "Live MedSAM mask overlay", "실시간 MedSAM mask overlay")}
                                    tint={[242, 164, 154]}
                                    className="pointer-events-none !aspect-square block !h-full !w-full object-cover select-none"
                                    fallbackClassName="pointer-events-none !aspect-square block !h-full !w-full object-cover select-none"
                                  />
                                ) : (
                                  <img
                                    src={image.preview_url}
                                    alt={image.image_id}
                                    className="block h-full w-full object-cover"
                                    draggable={false}
                                    onDragStart={(event) => event.preventDefault()}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="grid aspect-square w-full place-items-center rounded-[18px] bg-surface-muted/55 text-sm text-muted">
                                {translateOption(locale, "view", image.view)}
                              </div>
                            )}
                          <div className="flex min-w-0 items-center gap-1.5 text-[0.84rem] leading-5 text-muted">
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
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={emptySurfaceClass}>
                      {(isCurrentVisit && panelBusy) || (patientVisitGalleryBusy && !hasLoadedVisitImages)
                        ? commonLoading
                        : pick(locale, "No saved images for this visit yet.", "이 방문에는 아직 저장 이미지가 없습니다.")}
                    </div>
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
