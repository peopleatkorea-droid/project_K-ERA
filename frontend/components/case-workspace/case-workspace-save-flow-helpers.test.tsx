import { describe, expect, it } from "vitest";

import type { CaseSummaryRecord, OrganismRecord } from "../../lib/api";

import {
  buildOptimisticPatientRow,
  buildOptimisticSavedCase,
  buildRepresentativeThumbnail,
  pickRepresentativeSavedImage,
} from "./case-workspace-save-flow-helpers";
import type { PatientListRow, SavedImagePreview } from "./shared";

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

function createSavedImagePreview(
  overrides: Partial<SavedImagePreview> & {
    image_id: string;
    patient_id: string;
    visit_date: string;
  },
): SavedImagePreview {
  return {
    image_id: overrides.image_id,
    visit_id: overrides.visit_id ?? `visit:${overrides.image_id}`,
    patient_id: overrides.patient_id,
    visit_date: overrides.visit_date,
    view: overrides.view ?? "white",
    image_path: overrides.image_path ?? `C:\\KERA\\${overrides.image_id}.png`,
    is_representative: overrides.is_representative ?? false,
    content_url: overrides.content_url ?? `/content/${overrides.image_id}`,
    uploaded_at: overrides.uploaded_at ?? "2026-04-01T00:00:00Z",
    preview_url: overrides.preview_url ?? `/preview/${overrides.image_id}`,
    lesion_prompt_box: overrides.lesion_prompt_box ?? null,
    quality_scores: overrides.quality_scores ?? null,
  };
}

describe("case workspace save-flow helpers", () => {
  it("prefers the explicit representative image when present", () => {
    const firstImage = createSavedImagePreview({
      image_id: "image_1",
      patient_id: "P-001",
      visit_date: "Initial",
    });
    const representativeImage = createSavedImagePreview({
      image_id: "image_2",
      patient_id: "P-001",
      visit_date: "Initial",
      is_representative: true,
    });

    expect(
      pickRepresentativeSavedImage([firstImage, representativeImage])?.image_id,
    ).toBe("image_2");
    expect(
      buildRepresentativeThumbnail("case_1", [firstImage, representativeImage]),
    ).toMatchObject({
      case_id: "case_1",
      image_id: "image_2",
    });
  });

  it("builds an optimistic saved case using visit metadata fallbacks", () => {
    const additionalOrganisms: OrganismRecord[] = [
      {
        culture_category: "bacterial",
        culture_species: "Staphylococcus aureus",
      },
    ];
    const uploadedImages = [
      createSavedImagePreview({
        image_id: "image_1",
        patient_id: "P-001",
        visit_date: "Initial",
        is_representative: true,
        uploaded_at: "2026-04-05T08:00:00Z",
      }),
      createSavedImagePreview({
        image_id: "image_2",
        patient_id: "P-001",
        visit_date: "Initial",
        uploaded_at: "2026-04-05T08:01:00Z",
      }),
    ];

    expect(
      buildOptimisticSavedCase({
        patientId: "P-001",
        visitReference: "Initial",
        draft: {
          actual_visit_date: "2026-04-05",
          sex: "female",
          age: "61",
          culture_status: "positive",
          culture_category: "bacterial",
          culture_species: "Pseudomonas aeruginosa",
          contact_lens_use: "none",
          predisposing_factor: ["trauma"],
          other_history: " prior keratitis ",
          visit_status: "active",
        },
        patientPayload: {
          chart_alias: "ALIAS-1",
          local_case_code: "CASE-1",
        },
        draftNeedsPrimaryOrganism: true,
        additionalOrganisms,
        uploadedImages,
        visitRecord: {
          visit_id: "visit_1",
          smear_result: "positive",
        },
        editingSourceCase: {
          created_at: "2026-04-01T00:00:00Z",
          created_by_user_id: "user_edit",
        },
        userId: "user_save",
      }),
    ).toMatchObject({
      case_id: "P-001::Initial",
      visit_id: "visit_1",
      patient_id: "P-001",
      created_by_user_id: "user_edit",
      actual_visit_date: "2026-04-05",
      chart_alias: "ALIAS-1",
      local_case_code: "CASE-1",
      age: 61,
      culture_category: "bacterial",
      culture_species: "Pseudomonas aeruginosa",
      additional_organisms: additionalOrganisms,
      smear_result: "positive",
      polymicrobial: true,
      image_count: 2,
      representative_image_id: "image_1",
      representative_view: "white",
      created_at: "2026-04-01T00:00:00Z",
      latest_image_uploaded_at: "2026-04-05T08:01:00Z",
    });
  });

  it("builds an optimistic patient row that keeps the new representative thumbnail first", () => {
    const optimisticCase = createCase({
      case_id: "case_new",
      patient_id: "P-001",
      visit_date: "FU #1",
      latest_image_uploaded_at: "2026-04-05T08:01:00Z",
      image_count: 2,
      is_initial_visit: false,
      culture_species: "Candida albicans",
    });
    const currentPatientRow: PatientListRow = {
      patient_id: "P-001",
      latest_case: createCase({
        case_id: "case_old",
        patient_id: "P-001",
        visit_date: "Initial",
        latest_image_uploaded_at: "2026-04-01T00:00:00Z",
      }),
      case_count: 3,
      organism_summary: "Old summary",
      representative_thumbnail_count: 4,
      representative_thumbnails: [
        {
          case_id: "case_old",
          image_id: "image_old",
          view: "white",
          preview_url: "/preview/image_old",
          fallback_url: "/content/image_old",
        },
        {
          case_id: "case_other",
          image_id: "image_other",
          view: "white",
          preview_url: "/preview/image_other",
          fallback_url: "/content/image_other",
        },
        {
          case_id: "case_extra",
          image_id: "image_extra",
          view: "white",
          preview_url: "/preview/image_extra",
          fallback_url: "/content/image_extra",
        },
      ],
    };

    expect(
      buildOptimisticPatientRow({
        optimisticCase,
        uploadedImages: [
          createSavedImagePreview({
            image_id: "image_new",
            patient_id: "P-001",
            visit_date: "FU #1",
            is_representative: true,
            preview_url: "/preview/image_new",
          }),
        ],
        currentPatientRow,
        currentPatientCaseCount: 2,
        organismSummaryLabel: (cultureCategory, cultureSpecies) =>
          `${cultureCategory}:${cultureSpecies}`,
      }),
    ).toMatchObject({
      patient_id: "P-001",
      latest_case: optimisticCase,
      case_count: 2,
      representative_thumbnail_count: 4,
      organism_summary: "bacterial:Candida albicans",
    });

    expect(
      buildOptimisticPatientRow({
        optimisticCase,
        uploadedImages: [
          createSavedImagePreview({
            image_id: "image_new",
            patient_id: "P-001",
            visit_date: "FU #1",
            is_representative: true,
            preview_url: "/preview/image_new",
          }),
        ],
        currentPatientRow,
        currentPatientCaseCount: 2,
        organismSummaryLabel: (cultureCategory, cultureSpecies) =>
          `${cultureCategory}:${cultureSpecies}`,
      }).representative_thumbnails.map((item) => item.image_id),
    ).toEqual(["image_new", "image_old", "image_other"]);
  });
});
