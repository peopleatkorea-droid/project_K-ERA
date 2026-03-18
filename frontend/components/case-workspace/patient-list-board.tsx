"use client";

import type { ChangeEvent } from "react";

import type { CaseSummaryRecord } from "../../lib/api";
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
}: PatientListBoardProps) {
  const pageWindow = 5;
  const pageStart = Math.max(1, patientListPage - Math.floor(pageWindow / 2));
  const pageEnd = Math.min(patientListTotalPages, pageStart + pageWindow - 1);
  const visiblePages = Array.from(
    { length: Math.max(0, pageEnd - pageStart + 1) },
    (_, index) => pageStart + index,
  );

  return (
    <section className={docSurfaceClass}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
        <div className="text-[0.88rem] font-semibold tracking-[-0.02em] text-ink">
          {selectedSiteLabel ?? pick(locale, "Select a hospital", "병원 선택")}
        </div>
        <span className={docSiteBadgeClass}>{`${patientListTotalCount} ${pick(locale, "patients", "환자")}`}</span>
        {casesLoading ? (
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
        <input
          className={`${listBoardSearchClass} min-h-10 min-w-[220px] flex-1 rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.84))] px-4 text-sm text-ink shadow-[0_8px_20px_rgba(15,23,42,0.04)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] md:ml-auto md:max-w-[320px] dark:bg-white/4`}
          value={caseSearch}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
          placeholder={pick(locale, "Search patient or organism", "환자 / 균종 검색")}
        />
      </div>
      <section className={`${docSectionClass} grid gap-3`}>
        {casesLoading && patientListRows.length === 0 ? <div className={emptySurfaceClass}>{copyLoadingSavedCases}</div> : null}
        {!casesLoading && patientListRows.length === 0 ? (
          <div className={emptySurfaceClass}>{pick(locale, "No saved patients match this search yet.", "검색 조건에 맞는 저장된 환자가 아직 없습니다.")}</div>
        ) : null}
        <div className={listBoardStackClass}>
          {patientListRows.map((row) => (
            <button
              key={`board-${row.patient_id}`}
              className={patientListRowClass(selectedPatientId === row.patient_id)}
              type="button"
              onClick={() => onOpenSavedCase(row.latest_case, "cases")}
            >
              <div className={patientListRowMainClass}>
                <div className={patientListRowChipsClass}>
                  <span className={patientListChipClass(true)}>{row.latest_case.local_case_code || row.patient_id}</span>
                  <span className={patientListChipClass()}>{row.patient_id}</span>
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
                    const previewUrl =
                      patientListThumbsByPatient[row.patient_id]?.find((item) => item.case_id === thumbnail.case_id)?.preview_url ??
                      thumbnail.preview_url;
                    return previewUrl ? (
                      <img
                        key={`board-${thumbnail.case_id}`}
                        src={previewUrl}
                        alt={`${row.patient_id}-${thumbnail.case_id}`}
                        className={patientListThumbClass}
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
          ))}
        </div>
        {patientListTotalPages > 1 ? (
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
              {visiblePages.map((page) => (
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
