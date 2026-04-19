import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiClinicResult } from "./ai-clinic-result";

describe("AiClinicResult", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:cluster-view"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders separate local and cross-site sections while staging cards within each section", () => {
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
                  case_id: "remote_case_4",
                  patient_id: "REMOTE-4",
                  visit_date: "cross-site",
                  representative_image_id: null,
                  preview_url: "/preview/remote_case_4",
                  similarity: 0.92,
                  culture_category: "amoeba",
                  culture_species: "Acanthamoeba",
                  image_count: 1,
                  source_site_display_name: "Partner Hospital",
                },
              ],
              local_similar_cases: [
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
              ],
              cross_site_similar_cases: [
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
                {
                  case_id: "remote_case_4",
                  patient_id: "REMOTE-4",
                  visit_date: "cross-site",
                  representative_image_id: null,
                  preview_url: "/preview/remote_case_4",
                  similarity: 0.92,
                  culture_category: "amoeba",
                  culture_species: "Acanthamoeba",
                  image_count: 1,
                  source_site_display_name: "Partner Hospital",
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

      expect(screen.getByText("Local similar cases")).toBeInTheDocument();
      expect(screen.getByText("Cross-site similar cases")).toBeInTheDocument();
      expect(screen.getByText("SIM-1")).toBeInTheDocument();
      expect(screen.queryByText("SIM-2")).not.toBeInTheDocument();
      expect(screen.getByText("SIM-3")).toBeInTheDocument();
      expect(screen.queryByText("REMOTE-4")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("SIM-2")).toBeInTheDocument();
      expect(screen.getByText("SIM-3")).toBeInTheDocument();
      expect(screen.getByText("REMOTE-4")).toBeInTheDocument();

      const renderedImages = screen.getAllByRole("img");
      expect(renderedImages[0]?.getAttribute("loading")).toBe("eager");
      expect(renderedImages[1]?.getAttribute("loading")).toBe("lazy");
      expect(renderedImages[2]?.getAttribute("loading")).toBe("eager");
      expect(renderedImages[3]?.getAttribute("loading")).toBe("lazy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders cross-site references inside the cluster view without replacing the same-site map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          html: "<html><body>plotly</body></html>",
          neighbors: [
            {
              patient_id: "LOCAL-1",
              visit_date: "FU #1",
              category: "fungal",
              species: "Fusarium",
              age: "64",
              sex: "female",
              distance: 0.11,
            },
          ],
          cluster_message:
            "Lesion crops were unavailable for part of this visit, so the 3D position is using source frames for those images.",
          cross_site_neighbors: [
            {
              case_id: "remote_case_001",
              patient_id: "REMOTE-1",
              visit_date: "cross-site",
              preview_url: "/preview/remote_1",
              similarity: 0.93,
              culture_category: "fungal",
              culture_species: "Fusarium",
              representative_view: "white",
              visit_status: "active",
              source_site_display_name: "Partner Site",
            },
          ],
          cross_site_status: "ready",
          cross_site_message: "Remote cluster references are ready.",
          cross_site_cache_used: true,
          cross_site_cache_saved_at: "2026-04-19T10:00:00+00:00",
          cross_site_corpus_status: {
            profile_label: "DINOv2 cornea-ROI retrieval",
            eligible_case_count: 12,
            latest_sync: {
              prepared_entry_count: 7,
            },
          },
          cross_site_opportunistic_sync: {
            queued: true,
          },
          cross_site_retrieval_profile: "dinov2_lesion_crop",
          cross_site_requested_retrieval_profile: "dinov2_lesion_crop",
          cross_site_requested_retrieval_label: "DINOv2 lesion-crop retrieval",
          cross_site_effective_retrieval_profile: "dinov2_cornea_roi",
          cross_site_effective_retrieval_label: "DINOv2 cornea-ROI retrieval",
          cross_site_status_retrieval_profile: "dinov2_cornea_roi",
          cross_site_status_retrieval_label: "DINOv2 cornea-ROI retrieval",
        }),
      })) as any,
    );

    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-CLUSTER-1",
              visit_date: "Initial",
              case_id: "query_cluster_case",
            },
            ai_clinic_profile: {
              profile_id: "dinov2_lesion_crop",
              label: "DINOv2 lesion-crop retrieval",
              description: "desc",
            },
            model_version: {
              version_id: "model_dinov2",
            },
            execution_device: "cpu",
            retrieval_mode: "vector",
            top_k: 3,
            eligible_candidate_count: 8,
            text_evidence: [],
            similar_cases: [],
          } as any
        }
        activeView="cluster"
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

    await waitFor(() => {
      expect(
        screen.getByText("Cross-site nearest references"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Partner Site")).toBeInTheDocument();
    expect(
      screen.getByText(
        "These reference cases come from the central retrieval corpus and are not projected into the same-site 3D map.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lesion crops were unavailable for part of this visit, so the 3D position is using source frames for those images.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cross-site references used DINOv2 cornea-ROI retrieval because DINOv2 lesion-crop retrieval was unavailable.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Central retrieval corpus for DINOv2 cornea-ROI retrieval is behind this site (7/12 cases synced).",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces cross-site fallback and sync status messages in the retrieval overview", () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-STATUS-1",
              visit_date: "Initial",
              case_id: "query_status_case",
            },
            ai_clinic_profile: {
              profile_id: "dinov2_lesion_crop",
              label: "DINOv2 lesion-crop retrieval",
              description: "desc",
            },
            technical_details: {
              cross_site_retrieval: {
                status: "cache_fallback",
                cache_used: true,
                cache_saved_at: "2026-04-19T10:00:00+00:00",
                requested_profile_label: "DINOv2 lesion-crop retrieval",
                effective_profile_label: "DINOv2 cornea-ROI retrieval",
                opportunistic_sync: {
                  queued: true,
                },
                corpus_status: {
                  profile_label: "DINOv2 cornea-ROI retrieval",
                  eligible_case_count: 12,
                  latest_sync: {
                    prepared_entry_count: 7,
                  },
                },
              },
            },
            model_version: {
              version_id: "model_dinov2",
            },
            execution_device: "cpu",
            retrieval_mode: "vector",
            top_k: 3,
            eligible_candidate_count: 18,
            text_evidence: [],
            similar_cases: [],
            local_similar_cases: [],
            cross_site_similar_cases: [],
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

    expect(
      screen.getByText(
        "Cross-site search used DINOv2 cornea-ROI retrieval because DINOv2 lesion-crop retrieval was unavailable.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A background retrieval corpus sync has been queued for this site.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Central retrieval corpus for DINOv2 cornea-ROI retrieval is behind this site (7/12 cases synced).",
      ),
    ).toBeInTheDocument();
  });

  it("explains when cross-site sync is disabled or already running", () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-STATUS-2",
              visit_date: "Initial",
              case_id: "query_status_case_2",
            },
            technical_details: {
              cross_site_retrieval: {
                status: "disabled",
                warning: "Cross-site retrieval corpus sync is not configured.",
                attempted: false,
                corpus_status: {
                  remote_node_sync_enabled: false,
                  active_job: {
                    job_id: "job_123",
                  },
                },
              },
            },
            model_version: {
              version_id: "model_dinov2",
            },
            execution_device: "cpu",
            retrieval_mode: "vector",
            top_k: 3,
            eligible_candidate_count: 18,
            text_evidence: [],
            similar_cases: [],
            local_similar_cases: [],
            cross_site_similar_cases: [],
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

    expect(
      screen.getByText("Cross-site retrieval corpus sync is not configured."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A retrieval corpus sync is already running for this site."),
    ).toBeInTheDocument();
  });
});
