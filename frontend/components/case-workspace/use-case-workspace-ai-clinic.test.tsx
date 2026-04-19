import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCaseWorkspaceAiClinic } from "./use-case-workspace-ai-clinic";

const apiMocks = vi.hoisted(() => ({
  fetchImagePreviewUrl: vi.fn(),
  runCaseAiClinic: vi.fn(),
  runCaseAiClinicSimilarCases: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  fetchImagePreviewUrl: apiMocks.fetchImagePreviewUrl,
  runCaseAiClinic: apiMocks.runCaseAiClinic,
  runCaseAiClinicSimilarCases: apiMocks.runCaseAiClinicSimilarCases,
}));

describe("useCaseWorkspaceAiClinic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates similar-case previews with smaller lead and secondary preview tiers", async () => {
    vi.useFakeTimers();
    try {
      apiMocks.runCaseAiClinicSimilarCases.mockResolvedValue({
        analysis_stage: "similar_cases",
        query_case: {
          patient_id: "QUERY-1",
          visit_date: "Initial",
          case_id: "query_case",
        },
        model_version: {
          version_id: "model_dinov2",
        },
        execution_device: "cpu",
        retrieval_mode: "vector",
        top_k: 3,
        eligible_candidate_count: 21,
        text_evidence: [],
        similar_cases: [
          {
            case_id: "case_1",
            patient_id: "SIM-1",
            visit_date: "Initial",
            representative_image_id: "image_1",
            similarity: 0.98,
            culture_category: "bacterial",
            culture_species: "Pseudomonas",
            image_count: 1,
          },
          {
            case_id: "case_2",
            patient_id: "SIM-2",
            visit_date: "FU #1",
            representative_image_id: "image_2",
            similarity: 0.96,
            culture_category: "fungal",
            culture_species: "Fusarium",
            image_count: 2,
          },
          {
            case_id: "case_3",
            patient_id: "SIM-3",
            visit_date: "FU #2",
            representative_image_id: "image_3",
            similarity: 0.94,
            culture_category: "fungal",
            culture_species: "Aspergillus",
            image_count: 1,
          },
        ],
      });
      apiMocks.fetchImagePreviewUrl
        .mockResolvedValueOnce("/preview/image_1")
        .mockResolvedValueOnce("/preview/image_2")
        .mockResolvedValueOnce("/preview/image_3");

      const { result } = renderHook(() =>
        useCaseWorkspaceAiClinic({
          token: "token",
          selectedSiteId: "SITE_A",
          selectedCase: {
            patient_id: "QUERY-1",
            visit_date: "Initial",
          } as any,
          validationResult: {
            execution_device: "cpu",
            model_version: {
              version_id: "model_convnext",
            },
          } as any,
          executionModeFromDevice: () => "cpu",
          describeError: (error, fallback) =>
            error instanceof Error ? error.message : fallback,
          setToast: vi.fn(),
          setPanelOpen: vi.fn(),
          copy: {
            selectSavedCaseForValidation: "need case",
            selectValidationBeforeAiClinic: "need validation",
            aiClinicReady: (count) => `ready ${count}`,
            aiClinicExpandedReady: "expanded",
            aiClinicFailed: "failed",
            aiClinicExpandFirst: "expand first",
          },
        }),
      );

      await act(async () => {
        await result.current.handleRunAiClinic();
        await vi.runAllTimersAsync();
      });

      expect(apiMocks.fetchImagePreviewUrl).toHaveBeenNthCalledWith(
        1,
        "SITE_A",
        "image_1",
        "token",
        { maxSide: 256 },
      );
      expect(apiMocks.fetchImagePreviewUrl).toHaveBeenNthCalledWith(
        2,
        "SITE_A",
        "image_2",
        "token",
        { maxSide: 224 },
      );
      expect(apiMocks.fetchImagePreviewUrl).toHaveBeenNthCalledWith(
        3,
        "SITE_A",
        "image_3",
        "token",
        { maxSide: 224 },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
