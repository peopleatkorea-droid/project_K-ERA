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

  it("renders the all-hospital 3D UMAP without same-site fallback copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          html: "<html><body>plotly global map</body></html>",
          neighbors: [
            {
              patient_id: "remote_case_001",
              visit_date: "Partner Site",
              category: "fungal",
              species: "Fusarium",
              age: "",
              sex: "",
              distance: 0.08,
              source_site_display_name: "Partner Site",
              representative_view: "white",
              visit_status: "active",
            },
          ],
          cluster_message: "Showing this visit on the all-hospital 3D map.",
          cluster_scope: "global",
          cluster_scope_label: "all_hospitals",
          cluster_entry_count: 24,
          cluster_site_count: 3,
          cross_site_neighbors: [],
          cross_site_status: "ready",
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
              patient_id: "QUERY-GLOBAL-1",
              visit_date: "Initial",
              case_id: "query_global_case",
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
        screen.getByText("This visit is placed on the 3D UMAP built from all hospitals."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Nearby cases on this map")).toBeInTheDocument();
    expect(screen.getByText("Showing this visit on the all-hospital 3D map.")).toBeInTheDocument();
    expect(screen.getByText("Partner Site")).toBeInTheDocument();
    expect(screen.queryByText("Cross-site nearest references")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "These reference cases come from the central retrieval corpus and are not projected into the same-site 3D map.",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders clinician-friendly global 3D map labels and scope badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          html: "<html><body>plotly global map</body></html>",
          neighbors: [
            {
              patient_id: "remote_case_001",
              visit_date: "Partner Site",
              category: "fungal",
              species: "Fusarium",
              age: "",
              sex: "",
              distance: 0.08,
              source_site_display_name: "Partner Site",
              representative_view: "white",
              visit_status: "active",
            },
          ],
          cluster_message: "Showing this visit on the all-hospital 3D map.",
          cluster_scope: "global",
          cluster_scope_label: "all_hospitals",
          cluster_entry_count: 24,
          cluster_site_count: 3,
          cross_site_neighbors: [],
          cross_site_status: "ready",
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
              patient_id: "QUERY-GLOBAL-2",
              visit_date: "Initial",
              case_id: "query_global_case_2",
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
        clinicalMode
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
        screen.getByText("This visit is shown on the 3D map built from all hospitals."),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("This map compares this visit against 24 cases from 3 hospitals."),
    ).toBeInTheDocument();
    expect(screen.getByText("All hospitals")).toBeInTheDocument();
    expect(screen.getByText("3 hospitals")).toBeInTheDocument();
    expect(screen.getByText("24 cases")).toBeInTheDocument();
    expect(screen.getByText("Similarity")).toBeInTheDocument();
  });

  it("passes locale to the 3D map request so iframe copy can be localized", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        html: "<html><body>plotly global map</body></html>",
        neighbors: [],
        cluster_message: "Showing this visit on the all-hospital 3D map.",
        cluster_scope: "global",
        cluster_scope_label: "all_hospitals",
        cluster_entry_count: 24,
        cluster_site_count: 3,
        cross_site_neighbors: [],
        cross_site_status: "ready",
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy as any);

    render(
      <AiClinicResult
        locale="ko"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-GLOBAL-KO-1",
              visit_date: "Initial",
              case_id: "query_global_case_ko",
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
        clinicalMode
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
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toContain("locale=ko");
  });

  it("reloads the 3D map when locale changes", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        html: "<html><body>plotly global map</body></html>",
        neighbors: [],
        cluster_message: "Showing this visit on the all-hospital 3D map.",
        cluster_scope: "global",
        cluster_scope_label: "all_hospitals",
        cluster_entry_count: 24,
        cluster_site_count: 3,
        cross_site_neighbors: [],
        cross_site_status: "ready",
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy as any);

    const props = {
      validationResult: null,
      modelCompareResult: null,
      result: {
        analysis_stage: "similar_cases",
        query_case: {
          patient_id: "QUERY-GLOBAL-LOCALE-1",
          visit_date: "Initial",
          case_id: "query_global_locale_case",
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
      } as any,
      clinicalMode: true,
      activeView: "cluster" as const,
      aiClinicPreviewBusy: false,
      aiClinicExpandedBusy: false,
      canExpandAiClinic: false,
      onExpandAiClinic: vi.fn(),
      notAvailableLabel: "n/a",
      aiClinicTextUnavailableLabel: "n/a",
      displayVisitReference: (value: string) => value,
      formatSemanticScore: (value: unknown) =>
        typeof value === "number" ? value.toFixed(3) : "n/a",
      formatImageQualityScore: (value: unknown) =>
        typeof value === "number" ? value.toFixed(1) : "n/a",
      formatProbability: (value: unknown) =>
        typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a",
      formatMetadataField: (value: string) => value,
      token: "token",
      siteId: "SITE_A",
    };

    const { rerender } = render(<AiClinicResult locale="en" {...props} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toContain("locale=en");

    rerender(<AiClinicResult locale="ko" {...props} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    expect(String(fetchSpy.mock.calls[1]?.[0] ?? "")).toContain("locale=ko");
  });

  it("shows representative similar cases together with the 3D map in clinical mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          html: "<html><body>plotly global map</body></html>",
          neighbors: [],
          cluster_message: "Showing this visit on the all-hospital 3D map.",
          cluster_scope: "global",
          cluster_scope_label: "all_hospitals",
          cluster_entry_count: 24,
          cluster_site_count: 3,
          cross_site_neighbors: [],
          cross_site_status: "ready",
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
              patient_id: "QUERY-CLINICAL-CLUSTER-1",
              visit_date: "Initial",
              case_id: "query_clinical_cluster_case",
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
            similar_cases: [
              {
                case_id: "case_1",
                patient_id: "SIM-CLINICAL-1",
                visit_date: "Initial",
                representative_image_id: "image_1",
                preview_url: "/preview/image_1",
                similarity: 0.98,
                culture_category: "bacterial",
                culture_species: "Pseudomonas",
                representative_view: "white",
                visit_status: "active",
                image_count: 1,
              },
              {
                case_id: "case_2",
                patient_id: "SIM-CLINICAL-2",
                visit_date: "Partner Site",
                representative_image_id: "image_2",
                preview_url: "/preview/image_2",
                similarity: 0.95,
                culture_category: "fungal",
                culture_species: "Fusarium",
                representative_view: "slit",
                visit_status: "active",
                source_site_display_name: "Partner Site",
                image_count: 1,
              },
            ],
          } as any
        }
        clinicalMode
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
      expect(screen.getByText("Representative similar cases")).toBeInTheDocument();
    });
    expect(screen.getByText("SIM-CLINICAL-1")).toBeInTheDocument();
    expect(screen.getByText("SIM-CLINICAL-2")).toBeInTheDocument();
  });

  it("renders clinician-friendly retrieval section labels", () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-CLINICAL-RETRIEVAL-1",
              visit_date: "Initial",
              case_id: "query_clinical_retrieval_case",
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
            local_similar_cases: [],
            cross_site_similar_cases: [],
          } as any
        }
        clinicalMode
        activeView="retrieval"
        aiClinicPreviewBusy={false}
        aiClinicExpandedBusy={false}
        canExpandAiClinic
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

    expect(screen.getByText("Similar cases overview")).toBeInTheDocument();
    expect(screen.getByText("Similar cases")).toBeInTheDocument();
    expect(screen.queryByText("Similar cases in this hospital")).not.toBeInTheDocument();
    expect(screen.queryByText("Reference cases from other hospitals")).not.toBeInTheDocument();
    expect(screen.getByText("More explanation if needed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more explanation" })).toBeInTheDocument();
  });

  it("merges local and external similar cases into one section in clinician mode", () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-CLINICAL-MERGED-1",
              visit_date: "Initial",
              case_id: "query_clinical_merged_case",
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
            local_similar_cases: [
              {
                case_id: "local_1",
                patient_id: "LOCAL-1",
                visit_date: "Initial",
                preview_url: "/preview/local_1",
                similarity: 0.97,
                culture_category: "bacterial",
                culture_species: "Pseudomonas",
                representative_view: "white",
                visit_status: "active",
              },
            ],
            cross_site_similar_cases: [
              {
                case_id: "remote_1",
                patient_id: "REMOTE-1",
                visit_date: "Partner Site",
                preview_url: "/preview/remote_1",
                similarity: 0.95,
                culture_category: "fungal",
                culture_species: "Fusarium",
                representative_view: "slit",
                visit_status: "active",
                source_site_display_name: "Partner Site",
              },
            ],
          } as any
        }
        clinicalMode
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

    expect(screen.getByText("2 cases")).toBeInTheDocument();
    expect(screen.getByText("Current hospital")).toBeInTheDocument();
    expect(screen.getAllByText("Partner Site").length).toBeGreaterThan(0);
  });

  it("hides technical retrieval sync status messages in clinician mode", () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "similar_cases",
            query_case: {
              patient_id: "QUERY-STATUS-CLINICAL-1",
              visit_date: "Initial",
              case_id: "query_status_clinical_case",
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
        clinicalMode
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
      screen.queryByText(
        "A background retrieval corpus sync has been queued for this site.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Central retrieval corpus for DINOv2 cornea-ROI retrieval is behind this site (7/12 cases synced).",
      ),
    ).not.toBeInTheDocument();
  });

  it("simplifies differential cards in clinician mode", async () => {
    render(
      <AiClinicResult
        locale="en"
        validationResult={null}
        modelCompareResult={null}
        result={
          {
            analysis_stage: "expanded",
            query_case: {
              patient_id: "QUERY-DIFF-1",
              visit_date: "Initial",
              case_id: "query_diff_case",
            },
            model_version: {
              version_id: "model_dinov2",
            },
            execution_device: "cpu",
            retrieval_mode: "vector",
            top_k: 3,
            eligible_candidate_count: 18,
            text_evidence: [
              {
                patient_id: "NOTE-1",
                visit_date: "Initial",
                similarity: 0.92,
                text: "Clinical note",
              },
            ],
            similar_cases: [],
            local_similar_cases: [],
            cross_site_similar_cases: [],
            differential: {
              engine: "clinical",
              differential: [
                {
                  label: "fungal",
                  confidence_band: "high",
                  score: 0.84,
                  component_scores: {
                    classifier: 0.81,
                    retrieval: 0.83,
                    text: 0.79,
                  },
                  supporting_evidence: ["feathery margin"],
                  conflicting_evidence: ["none"],
                },
              ],
            },
          } as any
        }
        clinicalMode
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

    await waitFor(() => {
      expect(screen.getByText("Possible diagnoses")).toBeInTheDocument();
    });
    expect(screen.getByText("Likelihood")).toBeInTheDocument();
    expect(screen.getByText("Why it fits: feathery margin · Why less likely: none")).toBeInTheDocument();
    expect(screen.getByText("Note 1")).toBeInTheDocument();
    expect(screen.queryByText("Classifier")).not.toBeInTheDocument();
    expect(screen.queryByText("Retrieval")).not.toBeInTheDocument();
    expect(screen.queryByText("Text")).not.toBeInTheDocument();
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
