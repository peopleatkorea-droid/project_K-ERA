import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiClinicResult } from "./ai-clinic-result";

describe("AiClinicResult", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("stages retrieved similar-case cards so the first card appears before the rest", () => {
    vi.useFakeTimers();
    try {
      render(
        <AiClinicResult
          locale="en"
          validationResult={null}
          modelCompareResult={null}
          result={
            {
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
              eligible_candidate_count: 18,
              text_evidence: [],
              similar_cases: [
                {
                  case_id: "case_1",
                  patient_id: "SIM-1",
                  visit_date: "Initial",
                  representative_image_id: "image_1",
                  preview_url: "/preview/image_1",
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
                  preview_url: "/preview/image_2",
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
                  preview_url: "/preview/image_3",
                  similarity: 0.94,
                  culture_category: "fungal",
                  culture_species: "Aspergillus",
                  image_count: 1,
                },
              ],
            } as any
          }
          activeView="retrieval"
          aiClinicPreviewBusy={false}
          aiClinicExpandedBusy={false}
          canExpandAiClinic={false}
          onExpandAiClinic={vi.fn()}
          notAvailableLabel="n/a"
          aiClinicTextUnavailableLabel="n/a"
          displayVisitReference={(value) => value}
          formatSemanticScore={(value) =>
            typeof value === "number" ? value.toFixed(3) : "n/a"
          }
          formatImageQualityScore={(value) =>
            typeof value === "number" ? value.toFixed(1) : "n/a"
          }
          formatProbability={(value) =>
            typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a"
          }
          formatMetadataField={(value) => value}
          token="token"
          siteId="SITE_A"
        />,
      );

      expect(screen.getByText("SIM-1")).toBeInTheDocument();
      expect(screen.queryByText("SIM-2")).not.toBeInTheDocument();
      expect(screen.queryByText("SIM-3")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("SIM-2")).toBeInTheDocument();
      expect(screen.getByText("SIM-3")).toBeInTheDocument();

      const renderedImages = screen.getAllByRole("img");
      expect(renderedImages[0]?.getAttribute("loading")).toBe("eager");
      expect(renderedImages[1]?.getAttribute("loading")).toBe("lazy");
      expect(renderedImages[2]?.getAttribute("loading")).toBe("lazy");
    } finally {
      vi.useRealTimers();
    }
  });
});
