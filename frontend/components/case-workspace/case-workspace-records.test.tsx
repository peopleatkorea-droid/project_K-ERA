import { describe, expect, it } from "vitest";

import type { CaseSummaryRecord, VisitRecord } from "../../lib/api";

import {
  buildKnownPatientTimeline,
  buildPatientListThumbMap,
  caseTimestamp,
  patientMatchesListSearch,
  upsertCaseSummaryRecord,
  upsertPatientListRow,
  visitTimestamp,
} from "./case-workspace-records";

function createCase(
  overrides: Partial<CaseSummaryRecord> & {
    case_id: string;
    patient_id: string;
    visit_date: string;
  },
): CaseSummaryRecord {
  return {
    case_id: overrides.case_id,
    visit_id: overrides.visit_id ?? `visit:${overrides.case_id}`,
    patient_id: overrides.patient_id,
    created_by_user_id: overrides.created_by_user_id ?? "user_1",
    visit_date: overrides.visit_date,
    actual_visit_date: overrides.actual_visit_date ?? null,
    chart_alias: overrides.chart_alias ?? "",
    local_case_code: overrides.local_case_code ?? "",
    sex: overrides.sex ?? "female",
    age: overrides.age ?? 50,
    culture_status: overrides.culture_status ?? "positive",
    culture_confirmed: overrides.culture_confirmed ?? true,
    culture_category: overrides.culture_category ?? "bacterial",
    culture_species: overrides.culture_species ?? "Pseudomonas",
    additional_organisms: overrides.additional_organisms ?? [],
    contact_lens_use: overrides.contact_lens_use ?? "none",
    predisposing_factor: overrides.predisposing_factor ?? [],
    other_history: overrides.other_history ?? "",
    visit_status: overrides.visit_status ?? "active",
    active_stage: overrides.active_stage ?? true,
    is_initial_visit:
      overrides.is_initial_visit ?? /^initial$/i.test(overrides.visit_date),
    smear_result: overrides.smear_result ?? "not done",
    polymicrobial: overrides.polymicrobial ?? false,
    research_registry_status: overrides.research_registry_status,
    research_registry_updated_at: overrides.research_registry_updated_at,
    research_registry_updated_by: overrides.research_registry_updated_by,
    research_registry_source: overrides.research_registry_source,
    image_count: overrides.image_count ?? 1,
    representative_image_id: overrides.representative_image_id ?? "image_1",
    representative_view: overrides.representative_view ?? "white",
    created_at: overrides.created_at ?? "2026-04-01T00:00:00Z",
    latest_image_uploaded_at:
      overrides.latest_image_uploaded_at ??
      overrides.created_at ??
      "2026-04-01T00:00:00Z",
  };
}

describe("case workspace record helpers", () => {
  it("builds a patient timeline sorted by latest image timestamp", () => {
    const initialCase = createCase({
      case_id: "case_initial",
      patient_id: "P-001",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-01T00:00:00Z",
    });
    const followUpCase = createCase({
      case_id: "case_fu1",
      patient_id: "P-001",
      visit_date: "FU #1",
      latest_image_uploaded_at: "2026-04-03T00:00:00Z",
      is_initial_visit: false,
    });
    const otherPatientCase = createCase({
      case_id: "case_other",
      patient_id: "P-002",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-05T00:00:00Z",
    });

    expect(
      buildKnownPatientTimeline(
        [initialCase, followUpCase, otherPatientCase],
        "P-001",
      ).map((item) => item.case_id),
    ).toEqual(["case_fu1", "case_initial"]);
  });

  it("keeps the fallback case in the timeline even when it was not in the loaded list", () => {
    const initialCase = createCase({
      case_id: "case_initial",
      patient_id: "P-001",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-01T00:00:00Z",
    });
    const followUpCase = createCase({
      case_id: "case_fu1",
      patient_id: "P-001",
      visit_date: "FU #1",
      latest_image_uploaded_at: "2026-04-03T00:00:00Z",
      is_initial_visit: false,
    });

    expect(
      buildKnownPatientTimeline([followUpCase], "P-001", initialCase).map(
        (item) => item.case_id,
      ),
    ).toEqual(["case_fu1", "case_initial"]);
  });

  it("upserts an edited case by patient and visit when the case id changes", () => {
    const currentCase = createCase({
      case_id: "case_old",
      patient_id: "P-001",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-01T00:00:00Z",
    });
    const newerUnrelatedCase = createCase({
      case_id: "case_other",
      patient_id: "P-002",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-02T00:00:00Z",
    });
    const editedCase = createCase({
      case_id: "case_new",
      patient_id: "P-001",
      visit_date: "Initial",
      latest_image_uploaded_at: "2026-04-04T00:00:00Z",
    });

    const result = upsertCaseSummaryRecord(
      [currentCase, newerUnrelatedCase],
      editedCase,
      {
        replaceCase: {
          case_id: currentCase.case_id,
          patient_id: currentCase.patient_id,
          visit_date: currentCase.visit_date,
        },
      },
    );

    expect(result.map((item) => item.case_id)).toEqual([
      "case_new",
      "case_other",
    ]);
  });

  it("upserts patient list rows and keeps the newest patient first", () => {
    const olderRow = {
      patient_id: "P-001",
      latest_case: createCase({
        case_id: "case_1",
        patient_id: "P-001",
        visit_date: "Initial",
        latest_image_uploaded_at: "2026-04-01T00:00:00Z",
      }),
      case_count: 1,
      organism_summary: "Pseudomonas",
      representative_thumbnails: [],
    };
    const newerRow = {
      patient_id: "P-002",
      latest_case: createCase({
        case_id: "case_2",
        patient_id: "P-002",
        visit_date: "Initial",
        latest_image_uploaded_at: "2026-04-03T00:00:00Z",
      }),
      case_count: 1,
      organism_summary: "Candida",
      representative_thumbnails: [],
    };

    expect(
      upsertPatientListRow([olderRow], newerRow).map((row) => row.patient_id),
    ).toEqual(["P-002", "P-001"]);
  });

  it("matches patient list search against id, visit, and organism fields", () => {
    const caseRecord = createCase({
      case_id: "case_1",
      patient_id: "KERA-2026-001",
      visit_date: "FU #2",
      culture_species: "Candida albicans",
      actual_visit_date: "2026-04-03",
    });

    expect(patientMatchesListSearch("", caseRecord)).toBe(true);
    expect(patientMatchesListSearch("2026-001", caseRecord)).toBe(true);
    expect(patientMatchesListSearch("fu #2", caseRecord)).toBe(true);
    expect(patientMatchesListSearch("candida", caseRecord)).toBe(true);
    expect(patientMatchesListSearch("aspergillus", caseRecord)).toBe(false);
  });

  it("builds a patient thumbnail map keyed by patient id", () => {
    const rows = [
      {
        patient_id: "P-001",
        latest_case: createCase({
          case_id: "case_1",
          patient_id: "P-001",
          visit_date: "Initial",
        }),
        case_count: 1,
        organism_summary: "Pseudomonas",
        representative_thumbnails: [
          {
            case_id: "case_1",
            image_id: "image_1",
            view: "white",
            preview_url: "/preview/image_1",
            fallback_url: "/content/image_1",
          },
        ],
      },
    ];

    expect(buildPatientListThumbMap(rows)).toEqual({
      "P-001": rows[0].representative_thumbnails,
    });
  });

  it("returns zero timestamps for invalid dates", () => {
    const invalidCase = createCase({
      case_id: "case_invalid",
      patient_id: "P-001",
      visit_date: "Initial",
      created_at: "not-a-date",
      latest_image_uploaded_at: null,
    });
    const invalidVisit: VisitRecord = {
      visit_id: "visit_1",
      patient_id: "P-001",
      visit_date: "Initial",
      culture_status: "positive",
      culture_confirmed: true,
      culture_category: "bacterial",
      culture_species: "Pseudomonas",
      additional_organisms: [],
      contact_lens_use: "none",
      predisposing_factor: [],
      other_history: "",
      visit_status: "active",
      active_stage: true,
      is_initial_visit: true,
      smear_result: "not done",
      polymicrobial: false,
      created_at: "not-a-date",
    };

    expect(caseTimestamp(invalidCase)).toBe(0);
    expect(visitTimestamp(invalidVisit)).toBe(0);
  });
});
