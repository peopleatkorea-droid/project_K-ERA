import React, { type ComponentProps } from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrainingSection } from "./training-section";

function buildProps(
  overrides: Partial<ComponentProps<typeof TrainingSection>> = {}
): ComponentProps<typeof TrainingSection> {
  return {
    locale: "en",
    notAvailableLabel: "n/a",
    selectedSiteId: "HTTP_SITE",
    selectedSiteLabel: "HTTP Hospital",
    selectedReport: null,
    crossValidationExportBusy: false,
    initialForm: {
      architecture: "densenet121",
      execution_mode: "cpu",
      crop_mode: "automated",
      case_aggregation: "mean",
      epochs: 10,
      learning_rate: 0.001,
      batch_size: 8,
      val_split: 0.2,
      test_split: 0.2,
      use_pretrained: true,
      regenerate_split: false,
    },
    initialBusy: false,
    initialResult: null,
    initialJob: null,
    initialProgress: null,
    progressPercent: 0,
    benchmarkBusy: false,
    benchmarkResult: null,
    benchmarkJob: null,
    benchmarkProgress: null,
    benchmarkPercent: 0,
    setInitialForm: vi.fn(),
    formatMetric: (value) => (typeof value === "number" ? value.toFixed(3) : "n/a"),
    formatTrainingStage: (stage) => stage ?? "n/a",
    onCancelBenchmark: vi.fn(),
    onCancelInitialTraining: vi.fn(),
    onExportSelectedReport: vi.fn(),
    onRunBenchmark: vi.fn(),
    onRunInitialTraining: vi.fn(),
    onResumeBenchmark: vi.fn(),
    ...overrides,
  };
}

describe("TrainingSection", () => {
  it("updates the initial training form and triggers training actions", () => {
    const setInitialForm = vi.fn();
    const onRunBenchmark = vi.fn();
    const onRunInitialTraining = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          setInitialForm,
          onRunBenchmark,
          onRunInitialTraining,
        })}
      />
    );

    fireEvent.change(screen.getByLabelText("Epochs"), { target: { value: "12" } });
    expect(setInitialForm).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pretrained init" }));
    const updater = setInitialForm.mock.calls.at(-1)?.[0];
    expect(updater(buildProps().initialForm).use_pretrained).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Run 8-model staged initial training" }));
    expect(screen.getByRole("dialog", { name: "8-model staged training confirmation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start 8-model staged training" }));
    fireEvent.click(screen.getByRole("button", { name: "Run initial training" }));

    expect(onRunBenchmark).toHaveBeenCalledTimes(1);
    expect(onRunInitialTraining).toHaveBeenCalledTimes(1);
  });

  it("shows remaining models, ETA, and stop controls during batch training", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:05:00Z"));
    render(
      <TrainingSection
        {...buildProps({
          benchmarkJob: {
            job_id: "job-1",
            job_type: "initial_training_benchmark",
            site_id: "HTTP_SITE",
            status: "running",
            payload: {
              architectures: ["densenet121", "convnext_tiny", "vit", "swin", "efficientnet_v2_s", "dinov2", "dinov2_mil", "dual_input_concat"],
              execution_mode: "gpu",
              crop_mode: "both",
              case_aggregation: "quality_weighted_mean",
              epochs: 20,
              learning_rate: 0.0003,
              batch_size: 12,
              val_split: 0.25,
              test_split: 0.15,
              use_pretrained: false,
              regenerate_split: true,
            },
            result: {
              progress: {
                percent: 42,
                stage: "training_component",
                architecture: "vit",
                architecture_index: 2,
                architecture_count: 8,
                crop_mode: "both",
              },
            },
            created_at: "2026-03-15T00:00:00Z",
            started_at: "2026-03-15T00:00:00Z",
          },
          benchmarkProgress: {
            percent: 42,
            stage: "training_component",
            architecture: "vit",
            architecture_index: 2,
            architecture_count: 8,
            crop_mode: "both",
          },
          benchmarkPercent: 42,
        })}
      />
    );

    const settingsHeading = screen.getByText("Run settings");
    const settingsPanel = screen.getByTestId("training-progress-settings");

    expect(settingsHeading).toBeInTheDocument();
    expect(screen.getByText("Loaded from the queued job payload.")).toBeInTheDocument();
    expect(screen.getByText("Current phase: Phase 1 · Main benchmark")).toBeInTheDocument();
    expect(screen.getByText("remaining")).toBeInTheDocument();
    expect(screen.getByText(/Estimated remaining time:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop benchmark" })).toBeInTheDocument();
    expect(settingsPanel).not.toBeNull();
    expect(within(settingsPanel as HTMLElement).getByText("GPU")).toBeInTheDocument();
    expect(within(settingsPanel as HTMLElement).getByText("0.0003")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows resume when a cancelled benchmark has remaining architectures", () => {
    const onResumeBenchmark = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          onResumeBenchmark,
          benchmarkJob: {
            job_id: "job-2",
            job_type: "initial_training_benchmark",
            site_id: "HTTP_SITE",
            status: "cancelled",
            payload: {
              architectures: ["vit", "swin", "dinov2"],
            },
            result: {
              progress: {
                percent: 48,
                stage: "cancelled",
                completed_architectures: ["vit"],
              },
            },
            created_at: "2026-03-15T00:00:00Z",
          },
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume remaining (2)" }));
    expect(onResumeBenchmark).toHaveBeenCalledTimes(1);
  });

  it("locks crop mode to paired fusion and keeps the 8-model benchmark available", () => {
    const setInitialForm = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          initialForm: {
            ...buildProps().initialForm,
            architecture: "dual_input_concat",
            crop_mode: "paired",
          },
          setInitialForm,
        })}
      />
    );

    const cropSelect = screen.getByLabelText("Crop mode") as HTMLSelectElement;
    expect(cropSelect.value).toBe("paired");
    expect(cropSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run 8-model staged initial training" })).toBeEnabled();
    expect(screen.getByText(/always uses paired cornea \+ lesion crops/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Architecture"), { target: { value: "dual_input_concat" } });
    const updater = setInitialForm.mock.calls.at(-1)?.[0];
    expect(updater(buildProps().initialForm).crop_mode).toBe("paired");
  });
});
