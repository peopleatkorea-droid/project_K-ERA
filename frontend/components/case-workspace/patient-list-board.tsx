"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { CaseSummaryRecord, MedsamArtifactListItem, MedsamArtifactStatusKey } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import {
  docSectionClass,
  docSiteBadgeClass,
  docSurfaceClass,
  emptySurfaceClass,
  listBoardSearchClass,
  listBoardStackClass,
  patientListChipClass,
  patientListRowChipsClass,
  patientListRowClass,
  patientListRowMainClass,
  patientListRowMetaClass,
  patientListThumbClass,
  patientListThumbEmptyClass,
  patientListThumbMoreClass,
  patientListThumbnailsClass,
  segmentedToggleClass,
  togglePillClass,
} from "../ui/workspace-patterns";
import type { LocalePick, PatientListRow, PatientListThumbnail, TranslateOption } from "./shared";

type PatientListBoardProps = {
  locale: Locale;
  localeTag: string;
  commonNotAvailable: string;
  selectedSiteLabel: string | null;
  selectedPatientId: string | null | undefined;
  patientListRows: PatientListRow[];
  patientListTotalCount: number;
  patientListPage: number;
  patientListTotalPages: number;
  patientListThumbsByPatient: Record<string, PatientListThumbnail[]>;
  caseSearch: string;
  showOnlyMine: boolean;
  casesLoading: boolean;
  copyPatients: string;
  copyAllRecords: string;
  copyMyPatientsOnly: string;
  copyLoadingSavedCases: string;
  pick: LocalePick;
  translateOption: TranslateOption;
  displayVisitReference: (locale: Locale, visitReference: string) => string;
  formatDateTime: (value: string | null | undefined, localeTag: string, emptyLabel: string) => string;
  onSearchChange: (value: string) => void;
  onShowOnlyMineChange: (nextValue: boolean) => void;
  onPageChange: (page: number) => void;
  onOpenSavedCase: (caseRecord: CaseSummaryRecord, nextView: "cases" | "patients") => void;
  onPrefetchCase?: (caseRecord: CaseSummaryRecord) => void;
  medsamArtifactActiveStatus: MedsamArtifactStatusKey | null;
  medsamArtifactScope: "patient" | "visit" | "image";
  medsamArtifactItems: MedsamArtifactListItem[];
  medsamArtifactItemsBusy: boolean;
  medsamArtifactPage: number;
  medsamArtifactTotalCount: number;
  medsamArtifactTotalPages: number;
  onCloseMedsamArtifactBacklog: () => void;
  onMedsamArtifactScopeChange: (scope: "patient" | "visit" | "image") => void;
  onMedsamArtifactPageChange: (page: number) => void;
};

export function PatientListBoard({
  locale,
  localeTag,
  commonNotAvailable,
  selectedSiteLabel,
  selectedPatientId,
  patientListRows,
  patientListTotalCount,
  patientListPage,
  patientListTotalPages,
  patientListThumbsByPatient,
  caseSearch,
  showOnlyMine,
  casesLoading,
  copyPatients,
  copyAllRecords,
  copyMyPatientsOnly,
  copyLoadingSavedCases,
  pick,
  translateOption,
  displayVisitReference,
  formatDateTime,
  onSearchChange,
  onShowOnlyMineChange,
  onPageChange,
  onOpenSavedCase,
  onPrefetchCase,
  medsamArtifactActiveStatus,
  medsamArtifactScope,
  medsamArtifactItems,
  medsamArtifactItemsBusy,
  medsamArtifactPage,
  medsamArtifactTotalCount,
  medsamArtifactTotalPages,
  onCloseMedsamArtifactBacklog,
  onMedsamArtifactScopeChange,
  onMedsamArtifactPageChange,
}: PatientListBoardProps) {
  const [localSearch, setLocalSearch] = useState(caseSearch);
  const deferredSearch = useDeferredValue(localSearch);

  useEffect(() => {
    setLocalSearch((current) => (current === caseSearch ? current : caseSearch));
  }, [caseSearch]);

  useEffect(() => {
    if (deferredSearch !== caseSearch) {
      onSearchChange(deferredSearch);
    }
  }, [deferredSearch, caseSearch, onSearchChange]);

  useEffect(() => {
    const scrollElement = patientListScrollRef.current;
    if (!scrollElement) {
      return;
    }
    if (typeof scrollElement.scrollTo === "function") {
      scrollElement.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    scrollElement.scrollTop = 0;
  }, [patientListPage, caseSearch, showOnlyMine, medsamArtifactActiveStatus]);

  const pageWindow = 5;
  const patientPageStart = Math.max(1, patientListPage - Math.floor(pageWindow / 2));
  const patientPageEnd = Math.min(patientListTotalPages, patientPageStart + pageWindow - 1);
  const patientVisiblePages = Array.from(
    { length: Math.max(0, patientPageEnd - patientPageStart + 1) },
    (_, index) => patientPageStart + index,
  );
  const backlogPageStart = Math.max(1, medsamArtifactPage - Math.floor(pageWindow / 2));
  const backlogPageEnd = Math.min(medsamArtifactTotalPages, backlogPageStart + pageWindow - 1);
  const backlogVisiblePages = Array.from(
    { length: Math.max(0, backlogPageEnd - backlogPageStart + 1) },
    (_, index) => backlogPageStart + index,
  );
  const activeArtifactFilter =
    medsamArtifactActiveStatus == null
      ? null
      : {
          title:
            medsamArtifactActiveStatus === "missing_lesion_box"
              ? pick(locale, "Lesion box missing", "Lesion box 누락")
              : medsamArtifactActiveStatus === "missing_roi"
                ? pick(locale, "Cornea ROI missing", "각막 ROI 누락")
                : medsamArtifactActiveStatus === "missing_lesion_crop"
                  ? pick(locale, "Lesion crop missing", "병변 crop 누락")
                  : pick(locale, "MedSAM backlog", "MedSAM 백로그"),
          description:
            medsamArtifactActiveStatus === "missing_lesion_box"
              ? pick(locale, "Review images that still need manual boxing before lesion crops can exist.", "lesion crop 전에 수동 boxing이 필요한 항목만 보여줍니다.")
              : medsamArtifactActiveStatus === "missing_roi"
                ? pick(locale, "Review cases where corneal ROI artifacts are still missing.", "각막 ROI 아티팩트가 아직 없는 항목만 보여줍니다.")
                : medsamArtifactActiveStatus === "missing_lesion_crop"
                  ? pick(locale, "Review cases where lesion artifacts are still missing.", "lesion 아티팩트가 아직 없는 항목만 보여줍니다.")
                  : pick(locale, "Review all processable ROI or lesion artifacts that can be generated in the background.", "백그라운드에서 생성 가능한 ROI / lesion 항목만 보여줍니다."),
        };
  const scopeLabel =
    medsamArtifactScope === "patient"
      ? pick(locale, "patients", "환자")
      : medsamArtifactScope === "visit"
        ? pick(locale, "visits", "방문")
        : pick(locale, "images", "이미지");
  const patientListScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldWindowPatients = !activeArtifactFilter && patientListRows.length > 8;
  const patientRowVirtualizer = useVirtualizer({
    count: activeArtifactFilter ? 0 : patientListRows.length,
    getScrollElement: () => patientListScrollRef.current,
    estimateSize: () => 156,
    overscan: 6,
  });

  function renderArtifactRow(item: MedsamArtifactListItem) {
    const caseSummary = item.case_summary ?? null;
    const canOpenCase = Boolean(caseSummary?.case_id);
    const missingParts = [
      item.missing_lesion_box_count ? `${item.missing_lesion_box_count} ${pick(locale, "box", "box")}` : null,
      item.missing_roi_count ? `${item.missing_roi_count} ROI` : null,
      item.missing_lesion_crop_count ? `${item.missing_lesion_crop_count} ${pick(locale, "lesion", "lesion")}` : null,
    ].filter(Boolean);
    if (item.scope === "image") {
      const imageMissing = [
        !item.has_lesion_box ? pick(locale, "box", "box") : null,
        !item.has_roi_crop || !item.has_medsam_mask ? "ROI" : null,
        item.has_lesion_box && (!item.has_lesion_crop || !item.has_lesion_mask) ? pick(locale, "lesion", "lesion") : null,
      ].filter(Boolean);
      return (
        <button
          key={`${item.patient_id}-${item.visit_date}-${item.image_id}`}
          type="button"
          className={patientListRowClass(false)}
          onClick={() => {
            if (caseSummary) {
              onOpenSavedCase(caseSummary, "cases");
            }
          }}
          disabled={!canOpenCase}
        >
          <div className={patientListRowMainClass}>
            <div className={patientListRowChipsClass}>
              <span className={patientListChipClass(true)}>{item.image_id ?? pick(locale, "Image", "이미지")}</span>
              <span className={patientListChipClass()}>{item.patient_id}</span>
              <span className={patientListChipClass()}>{item.visit_date ?? commonNotAvailable}</span>
              <span className={patientListChipClass()}>{translateOption(locale, "view", item.view ?? "white")}</span>
              {item.is_representative ? <span className={patientListChipClass()}>{pick(locale, "Representative", "대표")}</span> : null}
            </div>
            <div className={patientListRowMetaClass}>
              <span>{imageMissing.join(" · ") || pick(locale, "Ready", "준비됨")}</span>
              <span>{formatDateTime(item.uploaded_at, localeTag, commonNotAvailable)}</span>
            </div>
          </div>
        </button>
      );
    }
    return (
      <button
        key={`${item.scope}-${item.patient_id}-${item.visit_date ?? "latest"}`}
        type="button"
        className={patientListRowClass(false)}
        onClick={() => {
          if (caseSummary) {
            onOpenSavedCase(caseSummary, "cases");
          }
        }}
        disabled={!canOpenCase}
      >
        <div className={patientListRowMainClass}>
          <div className={patientListRowChipsClass}>
            <span className={patientListChipClass(true)}>{item.patient_id}</span>
            {item.visit_date ? <span className={patientListChipClass()}>{item.visit_date}</span> : null}
            <span className={patientListChipClass()}>{`${item.image_count ?? 0} ${pick(locale, "images", "이미지")}`}</span>
            {item.scope === "patient" ? <span className={patientListChipClass()}>{`${item.visit_count ?? 0} ${pick(locale, "visits", "방문")}`}</span> : null}
          </div>
          <div className={patientListRowMetaClass}>
            <span>{missingParts.join(" · ") || pick(locale, "No missing artifacts", "누락 아티팩트 없음")}</span>
            <span>{formatDateTime(caseSummary?.latest_image_uploaded_at ?? caseSummary?.created_at, localeTag, commonNotAvailable)}</span>
          </div>
        </div>
      </button>
    );
  }

  function renderPatientRow(row: PatientListRow) {
    return (
      <button
        key={`board-${row.patient_id}`}
        className={patientListRowClass(selectedPatientId === row.patient_id)}
        type="button"
        onPointerEnter={() => onPrefetchCase?.(row.latest_case)}
        onClick={() => onOpenSavedCase(row.latest_case, "cases")}
      >
        <div className={patientListRowMainClass}>
          <div className={patientListRowChipsClass}>
            {row.latest_case.local_case_code && row.latest_case.local_case_code !== row.patient_id ? (
              <span className={patientListChipClass(true)}>{row.latest_case.local_case_code}</span>
            ) : null}
            <span className={patientListChipClass(!row.latest_case.local_case_code || row.latest_case.local_case_code === row.patient_id)}>
              {row.patient_id}
            </span>
            <span className={patientListChipClass()}>{`${translateOption(locale, "sex", row.latest_case.sex)} · ${row.latest_case.age ?? commonNotAvailable}`}</span>
            <span className={patientListChipClass()}>{`${row.case_count} ${pick(locale, "cases", "케이스")}`}</span>
            <span className={patientListChipClass()}>{`${translateOption(locale, "cultureCategory", row.latest_case.culture_category)} · ${row.organism_summary}`}</span>
          </div>
          <div className={patientListRowMetaClass}>
            <span>{displayVisitReference(locale, row.latest_case.visit_date)}</span>
            {row.latest_case.actual_visit_date ? <span>{row.latest_case.actual_visit_date}</span> : null}
            <span>{formatDateTime(row.latest_case.latest_image_uploaded_at ?? row.latest_case.created_at, localeTag, commonNotAvailable)}</span>
          </div>
        </div>
        <div className={patientListThumbnailsClass}>
          {row.representative_thumbnails.length === 0 ? (
            <span className={patientListThumbEmptyClass}>{pick(locale, "No thumbnails", "썸네일 없음")}</span>
          ) : (
            row.representative_thumbnails.slice(0, 4).map((thumbnail) => {
              const resolvedThumbnail =
                patientListThumbsByPatient[row.patient_id]?.find((item) => item.case_id === thumbnail.case_id) ??
                thumbnail;
              const previewUrl = resolvedThumbnail.preview_url;
              return previewUrl ? (
                <img
                  key={`board-${thumbnail.case_id}`}
                  src={previewUrl}
                  alt={`${row.patient_id}-${thumbnail.case_id}`}
                  className={patientListThumbClass}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  onError={(event) => {
                    const fallbackUrl = resolvedThumbnail.fallback_url;
                    if (!fallbackUrl || event.currentTarget.dataset.fallbackApplied === "true") {
                      return;
                    }
                    event.currentTarget.dataset.fallbackApplied = "true";
                    event.currentTarget.src = fallbackUrl;
                  }}
                />
              ) : (
                <div key={`board-${thumbnail.case_id}`} className={`${patientListThumbClass} grid place-items-center`}>
                  {translateOption(locale, "view", thumbnail.view ?? "white")}
                </div>
              );
            })
          )}
          {row.representative_thumbnails.length > 4 ? (
            <span className={patientListThumbMoreClass}>+{row.representative_thumbnails.length - 4}</span>
          ) : null}
        </div>
      </button>
    );
  }

  return (
    <section className={docSurfaceClass}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
        <div className="text-[0.88rem] font-semibold tracking-[-0.02em] text-ink">
          {selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}
        </div>
        <span className={docSiteBadgeClass}>
          {activeArtifactFilter
            ? `${medsamArtifactTotalCount} ${scopeLabel}`
            : `${patientListTotalCount} ${pick(locale, "patients", "환자")}`}
        </span>
        {activeArtifactFilter ? (
          medsamArtifactItemsBusy ? <span className={docSiteBadgeClass}>{pick(locale, "Filtering…", "필터 적용 중…")}</span> : null
        ) : casesLoading ? (
          <span className={docSiteBadgeClass}>{pick(locale, "Syncing…", "동기화 중…")}</span>
        ) : null}
        <div className={segmentedToggleClass} role="group" aria-label={copyPatients}>
          <Button
            className={togglePillClass(!showOnlyMine)}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onShowOnlyMineChange(false)}
          >
            {copyAllRecords}
          </Button>
          <Button
            className={togglePillClass(showOnlyMine)}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onShowOnlyMineChange(true)}
          >
            {copyMyPatientsOnly}
          </Button>
        </div>
        {activeArtifactFilter ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:ml-auto">
            <span className={docSiteBadgeClass}>{activeArtifactFilter.title}</span>
            <div className={segmentedToggleClass} role="group" aria-label={pick(locale, "Artifact scope", "아티팩트 범위")}>
              {(["patient", "visit", "image"] as const).map((scope) => (
                <Button
                  key={scope}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={togglePillClass(medsamArtifactScope === scope)}
                  onClick={() => onMedsamArtifactScopeChange(scope)}
                >
                  {scope === "patient"
                    ? pick(locale, "Patients", "환자")
                    : scope === "visit"
                      ? pick(locale, "Visits", "방문")
                      : pick(locale, "Images", "이미지")}
                </Button>
              ))}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={onCloseMedsamArtifactBacklog}>
              {pick(locale, "Clear filter", "필터 해제")}
            </Button>
          </div>
        ) : (
          <input
            className={`${listBoardSearchClass} min-h-10 min-w-[220px] flex-1 rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.84))] px-4 text-sm text-ink shadow-[0_8px_20px_rgba(15,23,42,0.04)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] md:ml-auto md:max-w-[320px] dark:bg-white/4`}
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            placeholder={pick(locale, "Search patient or organism", "환자 / 균종 검색")}
          />
        )}
      </div>
      {activeArtifactFilter ? (
        <p className="m-0 pb-1 text-sm leading-6 text-muted">{activeArtifactFilter.description}</p>
      ) : null}
      <section className={`${docSectionClass} grid gap-3`}>
        {activeArtifactFilter ? (
          medsamArtifactItemsBusy ? (
            <div className={emptySurfaceClass}>{pick(locale, "Loading backlog filter...", "백로그 필터를 불러오는 중...")}</div>
          ) : medsamArtifactItems.length === 0 ? (
            <div className={emptySurfaceClass}>{pick(locale, "No matching backlog items were found.", "조건에 맞는 백로그 항목이 없습니다.")}</div>
          ) : (
            <div className={listBoardStackClass}>
              {medsamArtifactItems.map((item) => renderArtifactRow(item))}
            </div>
          )
        ) : (
          <>
            {casesLoading && patientListRows.length === 0 ? <div className={emptySurfaceClass}>{copyLoadingSavedCases}</div> : null}
            {!casesLoading && patientListRows.length === 0 ? (
              <div className={emptySurfaceClass}>{pick(locale, "No saved patients match this search yet.", "검색 조건에 맞는 저장된 환자가 아직 없습니다.")}</div>
            ) : null}
            {shouldWindowPatients ? (
              <div ref={patientListScrollRef} className="max-h-[min(68vh,920px)] overflow-y-auto pr-1">
                <div
                  className="relative"
                  style={{
                    height: `${patientRowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {patientRowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = patientListRows[virtualRow.index];
                    return (
                      <div
                        key={`virtual-patient-${row.patient_id}`}
                        data-index={virtualRow.index}
                        ref={patientRowVirtualizer.measureElement}
                        className="absolute left-0 top-0 w-full pb-3"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {renderPatientRow(row)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={listBoardStackClass}>
                {patientListRows.map((row) => renderPatientRow(row))}
              </div>
            )}
          </>
        )}
        {activeArtifactFilter ? (
          medsamArtifactTotalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <div className="text-sm text-muted">
                {pick(locale, `Page ${medsamArtifactPage} of ${medsamArtifactTotalPages}`, `${medsamArtifactPage} / ${medsamArtifactTotalPages} 페이지`)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={medsamArtifactPage <= 1}
                  onClick={() => onMedsamArtifactPageChange(medsamArtifactPage - 1)}
                >
                  {pick(locale, "Previous", "이전")}
                </Button>
                {backlogVisiblePages.map((page) => (
                  <Button
                    key={`medsam-filter-page-${page}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={togglePillClass(page === medsamArtifactPage, true)}
                    onClick={() => onMedsamArtifactPageChange(page)}
                  >
                    {page}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={medsamArtifactPage >= medsamArtifactTotalPages}
                  onClick={() => onMedsamArtifactPageChange(medsamArtifactPage + 1)}
                >
                  {pick(locale, "Next", "다음")}
                </Button>
              </div>
            </div>
          ) : null
        ) : patientListTotalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
            <div className="text-sm text-muted">
              {pick(locale, `Page ${patientListPage} of ${patientListTotalPages}`, `${patientListPage} / ${patientListTotalPages} 페이지`)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={patientListPage <= 1}
                onClick={() => onPageChange(patientListPage - 1)}
              >
                {pick(locale, "Previous", "이전")}
              </Button>
              {patientVisiblePages.map((page) => (
                <Button
                  key={`patient-page-${page}`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={togglePillClass(page === patientListPage, true)}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={patientListPage >= patientListTotalPages}
                onClick={() => onPageChange(patientListPage + 1)}
              >
                {pick(locale, "Next", "다음")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}
