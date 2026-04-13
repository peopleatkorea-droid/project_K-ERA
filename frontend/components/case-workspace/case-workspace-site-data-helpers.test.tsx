import { describe, expect, it } from "vitest";

import type { CaseSummaryRecord } from "../../lib/api";

import {
  buildCaseHistoryCacheKey,
  buildPatientCaseTimelineCacheKey,
  buildPatientImageCacheKey,
  buildVisitImageCacheKey,
  hasSettledCaseImageCache,
  mergeCaseTimelineRecords,
  normalizeVisitMatchKey,
  sortCaseTimelineRecords,
} from "./case-workspace-site-data-helpers";
import type { SavedImagePreview } from "./shared";

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
    is_representative: overrides.is_representative ?? true,
    content_url: overrides.content_url ?? `/content/${overrides.image_id}`,
    uploaded_at: overrides.uploaded_at ?? "2026-04-01T00:00:00Z",
    preview_url: overrides.preview_url ?? `/preview/${overrides.image_id}`,
    lesion_prompt_box: overrides.lesion_prompt_box ?? null,
    quality_scores: overrides.quality_scores ?? null,
  };
}

describe("case workspace site data helpers", () => {
  it("normalizes initial and follow-up visit labels to stable cache keys", () => {
    expect(normalizeVisitMatchKey("Initial")).toBe("initial");
    expect(normalizeVisitMatchKey("초진")).toBe("initial");
    expect(normalizeVisitMatchKey("FU #01")).toBe("fu:1");
    expect(normalizeVisitMatchKey("u-12")).toBe("fu:12");
    expect(normalizeVisitMatchKey(" Visit  A ")).toBe("visit a");
  });

  it("sorts and merges patient timeline records by latest image timestamp", () => {
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
    const refreshedFollowUpCase = createCase({
      case_id: "case_fu1",
      patient_id: "P-001",
      visit_date: "FU #1",
      latest_image_uploaded_at: "2026-04-04T00:00:00Z",
      image_count: 3,
      is_initial_visit: false,
    });

    expect(
      sortCaseTimelineRecords([initialCase, followUpCase]).map(
        (item) => item.case_id,
      ),
    ).toEqual(["case_fu1", "case_initial"]);

    expect(
      mergeCaseTimelineRecords(
        [initialCase],
        [followUpCase],
        [refreshedFollowUpCase],
      ).map((item) => [item.case_id, item.image_count]),
    ).toEqual([
      ["case_fu1", 3],
      ["case_initial", 1],
    ]);
  });

  it("builds stable cache keys for visit, patient, and history lookups", () => {
    expect(buildCaseHistoryCacheKey("P-001", "Initial")).toBe("P-001::Initial");
    expect(buildVisitImageCacheKey("P-001", "FU #02")).toBe("P-001::fu:2");
    expect(buildPatientImageCacheKey(" SITE_A ", " P-001 ")).toBe(
      "SITE_A::P-001",
    );
    expect(
      buildPatientCaseTimelineCacheKey(" SITE_A ", true, " P-001 "),
    ).toBe("SITE_A::mine::P-001");
  });

  it("treats cached empty images as settled only for zero-image cases", () => {
    const zeroImageCase = createCase({
      case_id: "case_zero",
      patient_id: "P-001",
      visit_date: "Initial",
      image_count: 0,
    });
    const imageCase = createCase({
      case_id: "case_one",
      patient_id: "P-001",
      visit_date: "FU #1",
      image_count: 1,
      is_initial_visit: false,
    });
    const cachedImages = [
      createSavedImagePreview({
        image_id: "image_1",
        patient_id: "P-001",
        visit_date: "FU #1",
      }),
    ];

    expect(hasSettledCaseImageCache(zeroImageCase, [])).toBe(true);
    expect(hasSettledCaseImageCache(imageCase, [])).toBe(false);
    expect(hasSettledCaseImageCache(imageCase, cachedImages)).toBe(true);
    expect(hasSettledCaseImageCache(imageCase, undefined)).toBe(false);
  });
});
