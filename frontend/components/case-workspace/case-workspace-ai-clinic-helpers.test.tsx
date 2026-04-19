import { describe, expect, it } from "vitest";

import {
  aiClinicSimilarCaseKey,
  collectAiClinicSimilarCases,
  countDisplayedAiClinicSimilarCases,
  withAiClinicSimilarCasePreviewPatch,
  withAiClinicSimilarCasePreviews,
} from "./case-workspace-ai-clinic-helpers";

describe("case-workspace ai clinic helpers", () => {
  it("builds a stable similar-case key from patient and visit", () => {
    expect(
      aiClinicSimilarCaseKey({
        patient_id: "KERA-2026-001",
        visit_date: "FU #1",
      }),
    ).toBe("KERA-2026-001::FU #1");
  });

  it("hydrates similar cases with previews carried from the previous result", () => {
    const result = withAiClinicSimilarCasePreviews(
      {
        analysis_stage: "similar_cases",
        query_case: {
          patient_id: "KERA-2026-010",
          visit_date: "Initial",
          case_id: "case_query",
        },
        model_version: {
          version_id: "model_a",
        },
        execution_device: "cpu",
        retrieval_mode: "vector",
        top_k: 3,
        eligible_candidate_count: 12,
        text_evidence: [],
        similar_cases: [
          {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            representative_image_id: "image_1",
            similarity: 0.91,
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            image_count: 1,
          },
        ],
        local_similar_cases: [
          {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            representative_image_id: "image_1",
            similarity: 0.91,
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            image_count: 1,
          },
        ],
      },
      {
        analysis_stage: "similar_cases",
        query_case: {
          patient_id: "KERA-2026-010",
          visit_date: "Initial",
          case_id: "case_query",
        },
        model_version: {
          version_id: "model_a",
        },
        execution_device: "cpu",
        retrieval_mode: "vector",
        top_k: 3,
        eligible_candidate_count: 12,
        text_evidence: [],
        similar_cases: [
          {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            representative_image_id: "image_1",
            similarity: 0.91,
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            image_count: 1,
          },
        ],
        local_similar_cases: [
          {
            case_id: "case_1",
            patient_id: "KERA-2026-001",
            visit_date: "Initial",
            representative_image_id: "image_1",
            similarity: 0.91,
            culture_category: "bacterial",
            culture_species: "Staphylococcus aureus",
            image_count: 1,
            preview_url: "/preview/image_1",
          },
        ],
      },
    );

    expect(result.similar_cases[0]?.preview_url).toBe("/preview/image_1");
    expect(result.local_similar_cases?.[0]?.preview_url).toBe("/preview/image_1");
  });

  it("keeps a fresh preview when there is no previous cached preview", () => {
    const result = withAiClinicSimilarCasePreviews(
      {
        analysis_stage: "expanded",
        query_case: {
          patient_id: "KERA-2026-020",
          visit_date: "Initial",
          case_id: "case_query",
        },
        model_version: {
          version_id: "model_b",
        },
        execution_device: "gpu",
        retrieval_mode: "vector",
        top_k: 3,
        eligible_candidate_count: 24,
        text_evidence: [],
        similar_cases: [
          {
            case_id: "case_2",
            patient_id: "KERA-2026-002",
            visit_date: "FU #2",
            representative_image_id: "image_2",
            similarity: 0.84,
            preview_url: "/preview/image_2",
            culture_category: "fungal",
            culture_species: "Fusarium",
            image_count: 3,
          },
        ],
        cross_site_similar_cases: [
          {
            case_id: "remote_case_2",
            patient_id: "REMOTE-2026-002",
            visit_date: "cross-site",
            representative_image_id: null,
            similarity: 0.8,
            preview_url: "/preview/remote_case_2",
            culture_category: "fungal",
            culture_species: "Fusarium",
            image_count: 3,
            source_site_display_name: "Partner Hospital",
          },
        ],
      },
      null,
    );

    expect(result.similar_cases[0]?.preview_url).toBe("/preview/image_2");
    expect(result.cross_site_similar_cases?.[0]?.preview_url).toBe(
      "/preview/remote_case_2",
    );
  });

  it("applies preview patches across local and cross-site sections", () => {
    const result = withAiClinicSimilarCasePreviewPatch(
      {
        analysis_stage: "similar_cases",
        query_case: {
          patient_id: "KERA-2026-020",
          visit_date: "Initial",
          case_id: "case_query",
        },
        model_version: {
          version_id: "model_b",
        },
        execution_device: "gpu",
        retrieval_mode: "vector",
        top_k: 3,
        eligible_candidate_count: 24,
        text_evidence: [],
        similar_cases: [
          {
            case_id: "case_2",
            patient_id: "KERA-2026-002",
            visit_date: "FU #2",
            representative_image_id: "image_2",
            similarity: 0.84,
            preview_url: null,
            culture_category: "fungal",
            culture_species: "Fusarium",
            image_count: 3,
          },
          {
            case_id: "case_3",
            patient_id: "KERA-2026-003",
            visit_date: "Initial",
            representative_image_id: "image_3",
            similarity: 0.81,
            preview_url: null,
            culture_category: "bacterial",
            culture_species: "Pseudomonas",
            image_count: 2,
          },
        ],
        local_similar_cases: [
          {
            case_id: "case_2",
            patient_id: "KERA-2026-002",
            visit_date: "FU #2",
            representative_image_id: "image_2",
            similarity: 0.84,
            preview_url: null,
            culture_category: "fungal",
            culture_species: "Fusarium",
            image_count: 3,
          },
        ],
        cross_site_similar_cases: [
          {
            case_id: "remote_case_4",
            patient_id: "REMOTE-2026-004",
            visit_date: "cross-site",
            representative_image_id: null,
            similarity: 0.79,
            preview_url: null,
            culture_category: "bacterial",
            culture_species: "Pseudomonas",
            image_count: 2,
            source_site_display_name: "Partner Hospital",
          },
        ],
      },
      new Map([
        ["KERA-2026-002::FU #2", "/preview/image_2"],
        ["REMOTE-2026-004::cross-site", "/preview/remote_case_4"],
      ]),
    );

    expect(result.similar_cases[0]?.preview_url).toBe("/preview/image_2");
    expect(result.similar_cases[1]?.preview_url).toBeNull();
    expect(result.local_similar_cases?.[0]?.preview_url).toBe(
      "/preview/image_2",
    );
    expect(result.cross_site_similar_cases?.[0]?.preview_url).toBe(
      "/preview/remote_case_4",
    );
  });

  it("counts and collects displayed cases from split sections without duplicates", () => {
    const result = {
      similar_cases: [
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          preview_url: null,
        },
        {
          patient_id: "REMOTE-2026-002",
          visit_date: "cross-site",
          preview_url: null,
        },
      ],
      local_similar_cases: [
        {
          patient_id: "KERA-2026-001",
          visit_date: "Initial",
          preview_url: null,
        },
      ],
      cross_site_similar_cases: [
        {
          patient_id: "REMOTE-2026-002",
          visit_date: "cross-site",
          preview_url: null,
        },
      ],
    };

    expect(countDisplayedAiClinicSimilarCases(result)).toBe(2);
    expect(collectAiClinicSimilarCases(result)).toHaveLength(2);
  });
});
