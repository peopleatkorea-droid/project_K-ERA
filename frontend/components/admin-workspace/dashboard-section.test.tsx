import React, { type ComponentProps } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSection } from "./dashboard-section";

function buildProps(
  overrides: Partial<ComponentProps<typeof DashboardSection>> = {}
): ComponentProps<typeof DashboardSection> {
  return {
    locale: "en",
    loadingLabel: "Loading...",
    notAvailableLabel: "n/a",
    selectedSiteId: "HTTP_SITE",
    selectedSiteLabel: "HTTP Hospital",
    selectedValidationRun: null,
    validationExportBusy: false,
    siteValidationBusy: false,
    siteComparison: [],
    embeddingStatus: {
      site_id: "HTTP_SITE",
      total_images: 12,
      total_cases: 4,
      missing_image_count: 3,
      missing_case_count: 1,
      needs_backfill: true,
      model_version: {
        version_id: "model_http_seed",
        version_name: "global-http-seed",
        architecture: "densenet121",
      },
      vector_index: {
        classifier_available: true,
        dinov2_embedding_available: false,
        dinov2_index_available: false,
      },
      active_job: {
        job_id: "job-embed-1",
        status: "running",
        result: {
          progress: {
            percent: 45,
            message: "Embedding in progress",
          },
        },
      },
    } as any,
    embeddingStatusBusy: false,
    embeddingBackfillBusy: false,
    currentModelVersionName: "global-http-seed",
    modelComparisonRows: [],
    rocEligibleRuns: [],
    rocValidationIds: [],
    selectedRocRuns: [],
    rocSeries: [],
    rocSelectionLimitReached: false,
    rocHasCohortMismatch: false,
    siteValidationRuns: [],
    baselineValidationId: null,
    compareValidationId: null,
    baselineValidationRun: null,
    compareValidationRun: null,
    selectedValidationId: null,
    misclassifiedCases: [],
    dashboardBusy: false,
    formatDateTime: (value) => value ?? "n/a",
    formatMetric: (value) => (typeof value === "number" ? value.toFixed(3) : "n/a"),
    formatDelta: (nextValue, baselineValue) =>
      typeof nextValue === "number" && typeof baselineValue === "number"
        ? `${(nextValue - baselineValue).toFixed(3)}`
        : "n/a",
    formatEmbeddingStage: (stage) => stage ?? "n/a",
    setBaselineValidationId: vi.fn(),
    setCompareValidationId: vi.fn(),
    setSelectedValidationId: vi.fn(),
    toggleRocValidationSelection: vi.fn(),
    onExportValidationReport: vi.fn(),
    onRunSiteValidation: vi.fn(),
    onRefreshEmbeddingStatus: vi.fn(),
    onEmbeddingBackfill: vi.fn(),
    ...overrides,
  };
}

describe("DashboardSection", () => {
  it("shows embedding status and triggers refresh and backfill actions", () => {
    const onRefreshEmbeddingStatus = vi.fn();
    const onEmbeddingBackfill = vi.fn();

    render(
      <DashboardSection
        {...buildProps({
          onRefreshEmbeddingStatus,
          onEmbeddingBackfill,
        })}
      />
    );

    expect(screen.getByText("AI Clinic embedding status")).toBeInTheDocument();
    expect(screen.getByText("Action needed")).toBeInTheDocument();
    expect(screen.getByText("job-embed-1")).toBeInTheDocument();
    expect(screen.getByText("Embedding in progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    fireEvent.click(screen.getByRole("button", { name: "Backfill missing embeddings" }));

    expect(onRefreshEmbeddingStatus).toHaveBeenCalledTimes(1);
    expect(onEmbeddingBackfill).toHaveBeenCalledTimes(1);
  });

  it("disables backfill when no missing embeddings remain", () => {
    render(
      <DashboardSection
        {...buildProps({
          embeddingStatus: {
            site_id: "HTTP_SITE",
            total_images: 12,
            total_cases: 4,
            missing_image_count: 0,
            missing_case_count: 0,
            needs_backfill: false,
            model_version: {
              version_id: "model_http_seed",
              version_name: "global-http-seed",
              architecture: "densenet121",
            },
            vector_index: {
              classifier_available: true,
              dinov2_embedding_available: true,
              dinov2_index_available: true,
            },
            active_job: null,
          } as any,
        })}
      />
    );

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backfill missing embeddings" })).toBeDisabled();
  });
});
