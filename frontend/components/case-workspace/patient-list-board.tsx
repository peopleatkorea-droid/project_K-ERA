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
  selectedSiteId: string | null;
  selectedPatientId: string | null | undefined;
  patientListRows: PatientListRow[];
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
  onOpenSavedCase: (caseRecord: CaseSummaryRecord, nextView: "cases" | "patients") => void;
};

export function PatientListBoard({
  locale,
  localeTag,
  commonNotAvailable,
  selectedSiteId,
  selectedPatientId,
  patientListRows,
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
  onOpenSavedCase,
}: PatientListBoardProps) {
  return (
    <section className={docSurfaceClass}>
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
        <div className="shrink-0 text-[0.88rem] font-semibold tracking-[-0.02em] text-ink">
          {selectedSiteId ?? pick(locale, "Select a hospital", "병원 선택")}
        </div>
        <span className={`${docSiteBadgeClass} shrink-0 whitespace-nowrap`}>{`${patientListRows.length} ${pick(locale, "patients", "환자")}`}</span>
        <div className={`${segmentedToggleClass} shrink-0`} role="group" aria-label={copyPatients}>
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
          className={`${listBoardSearchClass} ml-auto min-h-10 w-[320px] shrink-0 rounded-[var(--radius-md)] border border-border bg-white/55 px-4 text-sm text-ink shadow-card outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] dark:bg-white/4`}
          value={caseSearch}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
          placeholder={pick(locale, "Search patient or organism", "환자 / 균종 검색")}
        />
      </div>
      <section className={`${docSectionClass} grid gap-3`}>
        {casesLoading ? <div className={emptySurfaceClass}>{copyLoadingSavedCases}</div> : null}
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
      </section>
    </section>
  );
}
