"use client";

import { useEffect, useRef } from "react";

import type { CaseSummaryRecord, OrganismRecord } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { MetricGrid, MetricItem } from "../ui/metric-grid";
import {
  emptySurfaceClass,
  patientVisitGalleryCardClass,
  patientVisitGalleryStackClass,
  representativeImageTagClass,
  savedCaseActionButtonClass,
} from "../ui/workspace-patterns";
import type { SavedImagePreview, TranslateOption } from "./shared";

const savedCaseMintLabelClass =
  "inline-flex min-h-9 items-center rounded-[10px] border border-brand/18 bg-brand-soft/80 px-4 text-[0.76rem] font-semibold tracking-[-0.01em] text-brand dark:border-brand/20 dark:bg-brand-soft/75 dark:text-brand";
const savedCaseHeaderBadgeClass =
  "inline-flex min-h-8 items-center rounded-[10px] border border-border bg-surface px-3.5 text-[0.76rem] font-medium text-muted";
const savedCaseGhostActionClass =
  "min-h-9 rounded-[10px] border border-border bg-surface px-4 text-[0.86rem] font-semibold text-ink hover:border-border/80 hover:bg-surface-muted";
const savedCaseFollowUpActionClass =
  "min-h-10 rounded-[11px] border border-brand-strong/35 bg-brand px-4 text-[0.86rem] font-semibold text-[var(--accent-contrast)] shadow-[0_12px_24px_rgba(48,88,255,0.24)] ring-1 ring-brand/15 transition duration-150 ease-out hover:-translate-y-[1px] hover:border-brand-strong hover:bg-brand-strong hover:shadow-[0_16px_28px_rgba(48,88,255,0.28)] dark:border-brand/40 dark:bg-brand dark:text-[var(--accent-contrast)] dark:ring-brand/20";
const savedCaseCurrentVisitActionClass =
  "min-h-9 rounded-[10px] border border-brand-strong/45 bg-brand px-4 text-[0.86rem] font-semibold text-[var(--accent-contrast)] shadow-[0_10px_22px_rgba(48,88,255,0.22)] ring-1 ring-brand/20 transition duration-150 ease-out hover:border-brand-strong hover:bg-brand-strong hover:shadow-[0_14px_28px_rgba(48,88,255,0.26)] dark:border-brand/50 dark:bg-brand dark:text-[var(--accent-contrast)] dark:ring-brand/24";
const savedCaseSummaryBarClass =
  "overflow-hidden rounded-[14px] border border-border bg-surface-muted/70 dark:border-white/8 dark:bg-surface-muted/70";
const savedCaseOverviewMainClass = "grid gap-5 min-w-0";
const savedCaseSidebarClass = "grid content-start gap-4 xl:sticky xl:top-6 xl:self-start";
const savedCaseSidebarCardClass = "grid gap-4 rounded-[18px] border border-border bg-surface-elevated p-4";
const savedCaseSidebarHeadingClass = "text-[0.8rem] font-semibold uppercase tracking-[0.12em] text-muted";
const savedCaseSidebarTitleClass = "text-[1.02rem] font-semibold tracking-[-0.02em] text-ink";
const savedCaseReadinessValueClass = "inline-flex min-h-8 items-center rounded-full border px-3 text-[0.76rem] font-semibold tracking-[-0.01em]";
const savedCaseReadinessPositiveClass = `${savedCaseReadinessValueClass} border-brand/18 bg-brand-soft/80 text-brand`;
const savedCaseReadinessNeutralClass = `${savedCaseReadinessValueClass} border-border bg-surface text-muted`;

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
  patientVisitGalleryLoadingCaseIds: Record<string, boolean>;
  patientVisitGalleryErrorCaseIds: Record<string, boolean>;
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
  editDraftBusy: boolean;
  onStartEditDraft: () => void | Promise<void>;
  onStartFollowUpDraft: () => void | Promise<void>;
  onToggleFavorite: (caseId: string) => void;
  onOpenSavedCase: (caseRecord: CaseSummaryRecord, nextView: "cases" | "patients") => void;
  onEnsureVisitImages: (caseRecord: CaseSummaryRecord) => void | Promise<unknown>;
  onDeleteSavedCase: (caseRecord: CaseSummaryRecord) => void | Promise<void>;
  isFavoriteCase: (caseId: string) => boolean;
  caseTitle: string;
};

export type SavedCaseSidebarProps = {
  locale: Locale;
  pick: (locale: Locale, en: string, ko: string) => string;
  selectedCaseImageCount: number;
  hasRepresentativeImage: boolean;
  hasAnySavedLesionBox: boolean;
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
  patientVisitGalleryLoadingCaseIds,
  patientVisitGalleryErrorCaseIds,
  pick,
  translateOption,
  displayVisitReference,
  formatDateTime,
  organismSummaryLabel,
  editDraftBusy,
  onStartEditDraft,
  onStartFollowUpDraft,
  onToggleFavorite,
  onOpenSavedCase,
  onEnsureVisitImages,
  onDeleteSavedCase,
  isFavoriteCase,
  caseTitle,
}: SavedCaseOverviewProps) {
  const autoRequestedVisitImagesRef = useRef<Set<string>>(new Set());
  const caseNumber = selectedCase.local_case_code || caseTitle || selectedCase.patient_id;
  const selectedVisitLabel = resolveVisitLabel(locale, selectedCase.visit_date, selectedCase.is_initial_visit, pick, displayVisitReference);
  const selectedOrganismLabel = `${translateOption(locale, "cultureCategory", selectedCase.culture_category)} · ${organismSummaryLabel(
    selectedCase.culture_category,
    selectedCase.culture_species,
    selectedCase.additional_organisms,
    2
  )}`;

  useEffect(() => {
    autoRequestedVisitImagesRef.current.clear();
  }, [selectedCase.case_id]);

  useEffect(() => {
    // Protected UX: opening a saved case must hydrate visit thumbnails without requiring extra per-visit clicks.
    for (const caseItem of selectedPatientCases) {
      const hasLoadedVisitImages = Array.isArray(patientVisitGallery[caseItem.case_id]);
      const visitImagesPending = !hasLoadedVisitImages && Number(caseItem.image_count ?? 0) > 0;
      if (!visitImagesPending) {
        autoRequestedVisitImagesRef.current.delete(caseItem.case_id);
        continue;
      }
      if (patientVisitGalleryLoadingCaseIds[caseItem.case_id] || patientVisitGalleryErrorCaseIds[caseItem.case_id]) {
        continue;
      }
      if (autoRequestedVisitImagesRef.current.has(caseItem.case_id)) {
        continue;
      }
      autoRequestedVisitImagesRef.current.add(caseItem.case_id);
      void onEnsureVisitImages(caseItem);
    }
  }, [
    onEnsureVisitImages,
    patientVisitGallery,
    patientVisitGalleryErrorCaseIds,
    patientVisitGalleryLoadingCaseIds,
    selectedPatientCases,
  ]);

  return (
    <div className={savedCaseOverviewMainClass}>
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
              const visitImagesLoading = Boolean(patientVisitGalleryLoadingCaseIds[caseItem.case_id]);
              const visitImagesFailed = Boolean(patientVisitGalleryErrorCaseIds[caseItem.case_id]);
              const visitImagesPending = !hasLoadedVisitImages && Number(caseItem.image_count ?? 0) > 0;
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
                        return (
                          <div key={`timeline-${image.image_id}`} className="grid gap-2.5">
                            {image.preview_url ? (
                              <div className="relative aspect-square overflow-hidden rounded-[18px] bg-surface-muted/55">
                                <img
                                  src={image.preview_url}
                                  alt={image.image_id}
                                  className="block h-full w-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  draggable={false}
                                  onDragStart={(event) => event.preventDefault()}
                                />
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
                      {(isCurrentVisit && panelBusy) || visitImagesLoading || (patientVisitGalleryBusy && !hasLoadedVisitImages)
                        ? commonLoading
                        : visitImagesFailed
                          ? pick(locale, "Unable to load saved images for this visit.", "이 방문의 저장 이미지를 불러오지 못했습니다.")
                          : visitImagesPending
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
    </div>
  );
}

export function SavedCaseSidebar({
  locale,
  pick,
  selectedCaseImageCount,
  hasRepresentativeImage,
  hasAnySavedLesionBox,
}: SavedCaseSidebarProps) {
  const readinessItems = [
    {
      label: pick(locale, "Intake", "Intake"),
      value: <span className={savedCaseReadinessPositiveClass}>{pick(locale, "Complete", "완료")}</span>,
    },
    {
      label: pick(locale, "Images", "이미지"),
      value: String(selectedCaseImageCount),
    },
    {
      label: pick(locale, "Representative", "대표 이미지"),
      value: (
        <span className={hasRepresentativeImage ? savedCaseReadinessPositiveClass : savedCaseReadinessNeutralClass}>
          {pick(locale, hasRepresentativeImage ? "Assigned" : "Missing", hasRepresentativeImage ? "지정됨" : "없음")}
        </span>
      ),
    },
    {
      label: pick(locale, "Lesion box", "Lesion box"),
      value: (
        <span className={hasAnySavedLesionBox ? savedCaseReadinessPositiveClass : savedCaseReadinessNeutralClass}>
          {pick(locale, hasAnySavedLesionBox ? "Saved" : "Missing", hasAnySavedLesionBox ? "저장됨" : "없음")}
        </span>
      ),
    },
  ];

  return (
    <aside className={savedCaseSidebarClass}>
      <Card as="section" variant="panel" className={savedCaseSidebarCardClass}>
        <div className="grid gap-1.5">
          <div className={savedCaseSidebarHeadingClass}>{pick(locale, "Case readiness", "Case Readiness")}</div>
          <div className={savedCaseSidebarTitleClass}>{pick(locale, "Submission state", "현재 준비 상태")}</div>
        </div>
        <MetricGrid columns={2}>
          {readinessItems.map((item) => (
            <MetricItem key={String(item.label)} value={item.value} label={item.label} />
          ))}
        </MetricGrid>
      </Card>
    </aside>
  );
}
