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
    onExportSelectedReport: vi.fn(),
    onRunBenchmark: vi.fn(),
    onRunInitialTraining: vi.fn(),
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

    fireEvent.click(screen.getByRole("button", { name: "Run 5-model initial training" }));
    expect(screen.getByRole("dialog", { name: "Five-model training confirmation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start 5-model training" }));
    fireEvent.click(screen.getByRole("button", { name: "Run initial training" }));

    expect(onRunBenchmark).toHaveBeenCalledTimes(1);
    expect(onRunInitialTraining).toHaveBeenCalledTimes(1);
  });

  it("shows remaining models and payload-based settings during batch training", () => {
    render(
      <TrainingSection
        {...buildProps({
          benchmarkJob: {
            job_id: "job-1",
            job_type: "initial_training_benchmark",
            site_id: "HTTP_SITE",
            status: "running",
            payload: {
              architectures: ["densenet121", "convnext_tiny", "vit", "swin", "efficientnet_v2_s"],
              execution_mode: "gpu",
              crop_mode: "both",
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
                architecture_count: 5,
                crop_mode: "both",
              },
            },
            created_at: "2026-03-15T00:00:00Z",
          },
          benchmarkProgress: {
            percent: 42,
            stage: "training_component",
            architecture: "vit",
            architecture_index: 2,
            architecture_count: 5,
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
    expect(screen.getByText("remaining")).toBeInTheDocument();
    expect(settingsPanel).not.toBeNull();
    expect(within(settingsPanel as HTMLElement).getByText("GPU")).toBeInTheDocument();
    expect(within(settingsPanel as HTMLElement).getByText("0.0003")).toBeInTheDocument();
  });
});
