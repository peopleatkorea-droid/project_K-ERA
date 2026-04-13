import type { CaseSummaryRecord, VisitRecord } from "../../lib/api";

import type { PatientListRow, PatientListThumbnail } from "./shared";

export type ReplaceCaseReference =
  | {
      case_id?: string | null;
      patient_id: string;
      visit_date: string;
    }
  | null
  | undefined;

export function caseTimestamp(caseRecord: CaseSummaryRecord): number {
  const rawValue =
    caseRecord.latest_image_uploaded_at ?? caseRecord.created_at ?? "";
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

export function buildKnownPatientTimeline(
  caseRecords: CaseSummaryRecord[],
  patientId: string,
  fallbackCase: CaseSummaryRecord | null = null,
): CaseSummaryRecord[] {
  const normalizedPatientId = String(patientId ?? "").trim();
  if (!normalizedPatientId) {
    return fallbackCase ? [fallbackCase] : [];
  }
  const byCaseId = new Map<string, CaseSummaryRecord>();
  for (const item of caseRecords) {
    if (String(item.patient_id ?? "").trim() !== normalizedPatientId) {
      continue;
    }
    const caseId = String(item.case_id ?? "").trim();
    if (!caseId) {
      continue;
    }
    byCaseId.set(caseId, item);
  }
  if (fallbackCase) {
    byCaseId.set(fallbackCase.case_id, fallbackCase);
  }
  return Array.from(byCaseId.values()).sort(
    (left, right) => caseTimestamp(right) - caseTimestamp(left),
  );
}

export function buildPatientListThumbMap(
  rows: PatientListRow[],
): Record<string, PatientListThumbnail[]> {
  return Object.fromEntries(
    rows.map((row) => [row.patient_id, row.representative_thumbnails]),
  );
}

export function upsertCaseSummaryRecord(
  caseRecords: CaseSummaryRecord[],
  nextCase: CaseSummaryRecord,
  options: {
    replaceCase?: ReplaceCaseReference;
  } = {},
): CaseSummaryRecord[] {
  const replaceCase = options.replaceCase;
  const filtered = caseRecords.filter((item) => {
    if (
      replaceCase &&
      (item.case_id === replaceCase.case_id ||
        (item.patient_id === replaceCase.patient_id &&
          item.visit_date === replaceCase.visit_date))
    ) {
      return false;
    }
    return item.case_id !== nextCase.case_id;
  });
  return [nextCase, ...filtered].sort(
    (left, right) => caseTimestamp(right) - caseTimestamp(left),
  );
}

export function upsertPatientListRow(
  rows: PatientListRow[],
  nextRow: PatientListRow,
): PatientListRow[] {
  return [
    nextRow,
    ...rows.filter((row) => row.patient_id !== nextRow.patient_id),
  ].sort(
    (left, right) =>
      caseTimestamp(right.latest_case) - caseTimestamp(left.latest_case),
  );
}

export function patientMatchesListSearch(
  normalizedSearch: string,
  caseRecord: CaseSummaryRecord,
): boolean {
  const search = normalizedSearch.trim().toLowerCase();
  if (!search) {
    return true;
  }
  const searchableValues = [
    caseRecord.patient_id,
    caseRecord.chart_alias,
    caseRecord.local_case_code,
    caseRecord.culture_category,
    caseRecord.culture_species,
    caseRecord.visit_date,
    caseRecord.actual_visit_date ?? "",
  ];
  return searchableValues.some((value) =>
    String(value ?? "").toLowerCase().includes(search),
  );
}

export function visitTimestamp(visitRecord: VisitRecord): number {
  const parsed = new Date(visitRecord.created_at ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}
