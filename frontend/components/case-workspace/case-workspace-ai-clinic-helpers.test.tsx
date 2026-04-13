import { describe, expect, it } from "vitest";

import {
  aiClinicSimilarCaseKey,
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
            preview_url: "/preview/image_1",
          },
        ],
      },
    );

    expect(result.similar_cases[0]?.preview_url).toBe("/preview/image_1");
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
      },
      null,
    );

    expect(result.similar_cases[0]?.preview_url).toBe("/preview/image_2");
  });
});
