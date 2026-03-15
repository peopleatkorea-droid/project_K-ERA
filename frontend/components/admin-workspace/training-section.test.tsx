import React, { type ComponentProps } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrainingSection } from "./training-section";

function buildProps(
  overrides: Partial<ComponentProps<typeof TrainingSection>> = {}
): ComponentProps<typeof TrainingSection> {
  return {
    locale: "en",
    notAvailableLabel: "n/a",
    selectedSiteId: "HTTP_SITE",
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

    fireEvent.click(screen.getByRole("button", { name: "Run multi-model benchmark" }));
    fireEvent.click(screen.getByRole("button", { name: "Run initial training" }));

    expect(onRunBenchmark).toHaveBeenCalledTimes(1);
    expect(onRunInitialTraining).toHaveBeenCalledTimes(1);
  });
});
