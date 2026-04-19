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

function sameStringList(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  const leftItems = left ?? [];
  const rightItems = right ?? [];
  if (leftItems.length !== rightItems.length) {
    return false;
  }
  for (let index = 0; index < leftItems.length; index += 1) {
    if (leftItems[index] !== rightItems[index]) {
      return false;
    }
  }
  return true;
}

function sameOrganismList(
  left: CaseSummaryRecord["additional_organisms"],
  right: CaseSummaryRecord["additional_organisms"],
): boolean {
  const leftItems = left ?? [];
  const rightItems = right ?? [];
  if (leftItems.length !== rightItems.length) {
    return false;
  }
  for (let index = 0; index < leftItems.length; index += 1) {
    if (
      leftItems[index]?.culture_category !== rightItems[index]?.culture_category ||
      leftItems[index]?.culture_species !== rightItems[index]?.culture_species
    ) {
      return false;
    }
  }
  return true;
}

export function sameCaseSummaryRecord(
  left: CaseSummaryRecord | null | undefined,
  right: CaseSummaryRecord | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.case_id === right.case_id &&
    left.visit_id === right.visit_id &&
    left.patient_id === right.patient_id &&
    left.created_by_user_id === right.created_by_user_id &&
    left.visit_date === right.visit_date &&
    left.actual_visit_date === right.actual_visit_date &&
    left.chart_alias === right.chart_alias &&
    left.local_case_code === right.local_case_code &&
    left.sex === right.sex &&
    left.age === right.age &&
    left.culture_status === right.culture_status &&
    left.culture_confirmed === right.culture_confirmed &&
    left.culture_category === right.culture_category &&
    left.culture_species === right.culture_species &&
    sameOrganismList(left.additional_organisms, right.additional_organisms) &&
    left.contact_lens_use === right.contact_lens_use &&
    sameStringList(left.predisposing_factor, right.predisposing_factor) &&
    left.other_history === right.other_history &&
    left.visit_status === right.visit_status &&
    left.active_stage === right.active_stage &&
    left.is_initial_visit === right.is_initial_visit &&
    left.smear_result === right.smear_result &&
    left.polymicrobial === right.polymicrobial &&
    left.research_registry_status === right.research_registry_status &&
    left.research_registry_updated_at === right.research_registry_updated_at &&
    left.research_registry_updated_by === right.research_registry_updated_by &&
    left.research_registry_source === right.research_registry_source &&
    left.image_count === right.image_count &&
    left.representative_image_id === right.representative_image_id &&
    left.representative_view === right.representative_view &&
    left.created_at === right.created_at &&
    left.latest_image_uploaded_at === right.latest_image_uploaded_at
  );
}

export function sameCaseSummaryRecordList(
  left: CaseSummaryRecord[],
  right: CaseSummaryRecord[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameCaseSummaryRecord(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function samePatientListThumbnails(
  left: PatientListThumbnail[],
  right: PatientListThumbnail[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]?.case_id !== right[index]?.case_id ||
      left[index]?.image_id !== right[index]?.image_id ||
      left[index]?.view !== right[index]?.view ||
      left[index]?.preview_url !== right[index]?.preview_url ||
      left[index]?.fallback_url !== right[index]?.fallback_url
    ) {
      return false;
    }
  }
  return true;
}

export function samePatientListRows(
  left: PatientListRow[],
  right: PatientListRow[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftRow = left[index];
    const rightRow = right[index];
    if (
      leftRow.patient_id !== rightRow.patient_id ||
      leftRow.case_count !== rightRow.case_count ||
      leftRow.organism_summary !== rightRow.organism_summary ||
      leftRow.representative_thumbnail_count !==
        rightRow.representative_thumbnail_count ||
      !sameCaseSummaryRecord(leftRow.latest_case, rightRow.latest_case) ||
      !samePatientListThumbnails(
        leftRow.representative_thumbnails,
        rightRow.representative_thumbnails,
      )
    ) {
      return false;
    }
  }
  return true;
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
