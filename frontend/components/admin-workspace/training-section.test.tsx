import React, { type ComponentProps } from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrainingSection } from "./training-section";

function buildProps(
  overrides: Record<string, unknown> = {}
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
    onRefreshBenchmarkStatus: vi.fn(),
    onRunBenchmark: vi.fn(),
    onRunLesionGuidedBenchmark: vi.fn(),
    onRunInitialTraining: vi.fn(),
    onResumeBenchmark: vi.fn(),
    ...overrides,
  } as ComponentProps<typeof TrainingSection>;
}

describe("TrainingSection", () => {
  it("updates the initial training form and triggers training actions", () => {
    const setInitialForm = vi.fn();
    const onRunBenchmark = vi.fn();
    const onRunLesionGuidedBenchmark = vi.fn();
    const onRunInitialTraining = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          setInitialForm,
          onRunBenchmark,
          onRunLesionGuidedBenchmark,
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
    fireEvent.click(screen.getByRole("button", { name: "Run LGF + SSL 6-model training" }));
    expect(screen.getByRole("dialog", { name: "LGF + SSL 6-model training confirmation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start LGF + SSL 6-model training" }));
    fireEvent.click(screen.getByRole("button", { name: "Run initial training" }));

    expect(onRunBenchmark).toHaveBeenCalledTimes(1);
    expect(onRunLesionGuidedBenchmark).toHaveBeenCalledTimes(1);
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
    expect(screen.getAllByRole("button", { name: "Refresh status" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Stop benchmark" })).toBeInTheDocument();
    expect(settingsPanel).not.toBeNull();
    expect(within(settingsPanel as HTMLElement).getByText("GPU")).toBeInTheDocument();
    expect(within(settingsPanel as HTMLElement).getByText("0.0003")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("refreshes benchmark status and renders benchmark test metrics in the summary table", () => {
    const onRefreshBenchmarkStatus = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          onRefreshBenchmarkStatus,
          benchmarkJob: {
            job_id: "job-3",
            job_type: "initial_training_benchmark",
            site_id: "HTTP_SITE",
            status: "completed",
            payload: {
              architectures: ["efficientnet_v2_s", "dual_input_concat"],
            },
            result: {
              response: {
                best_architecture: "dual_input_concat",
                results: [],
                failures: [],
              },
            },
            created_at: "2026-03-15T00:00:00Z",
          },
          benchmarkResult: {
            best_architecture: "dual_input_concat",
            results: [
              {
                architecture: "dual_input_concat",
                status: "completed",
                result: {
                  best_val_acc: 0.7732,
                  test_metrics: {
                    accuracy: 0.6,
                    AUROC: 0.6896,
                    balanced_accuracy: 0.5651,
                  },
                },
                model_version: {
                  version_name: "dual-input-v1",
                },
              },
              {
                architecture: "efficientnet_v2_s",
                status: "completed",
                result: {
                  best_val_acc: 0.6186,
                  test_metrics: {
                    accuracy: 0.7384,
                    AUROC: 0.8093,
                    balanced_accuracy: 0.7303,
                  },
                },
                model_version: {
                  version_name: "effnet-v1",
                },
              },
            ],
            failures: [],
          },
        })}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Refresh status" })[0]);
    expect(onRefreshBenchmarkStatus).toHaveBeenCalledTimes(1);

    expect(screen.getByText("Benchmark training summary")).toBeInTheDocument();
    expect(screen.getByText("balanced acc")).toBeInTheDocument();
    expect(screen.getAllByText("best test").length).toBeGreaterThan(0);
    expect(screen.getByText("effnet-v1")).toBeInTheDocument();
    expect(screen.getByText("dual-input-v1")).toBeInTheDocument();
    expect(screen.getByText("0.809")).toBeInTheDocument();
  });

  it("opens the paper-ready benchmark figures panel from the benchmark summary", () => {
    render(
      <TrainingSection
        {...buildProps({
          benchmarkResult: {
            best_architecture: "dual_input_concat",
            results: [
              {
                architecture: "efficientnet_v2_s",
                status: "completed",
                result: {
                  best_val_acc: 0.6186,
                  test_predictions: [
                    {
                      sample_key: "image::P-001::Initial::raw/a.jpg",
                      sample_kind: "image",
                      patient_id: "P-001",
                      visit_date: "Initial",
                      true_label: "bacterial",
                      true_label_index: 0,
                      predicted_label: "bacterial",
                      predicted_label_index: 0,
                      positive_probability: 0.21,
                      is_correct: true,
                    },
                    {
                      sample_key: "image::P-002::FU #1::raw/b.jpg",
                      sample_kind: "image",
                      patient_id: "P-002",
                      visit_date: "FU #1",
                      true_label: "fungal",
                      true_label_index: 1,
                      predicted_label: "fungal",
                      predicted_label_index: 1,
                      positive_probability: 0.89,
                      is_correct: true,
                    },
                  ],
                  test_metrics: {
                    accuracy: 0.7384,
                    AUROC: 0.8093,
                    balanced_accuracy: 0.7303,
                    F1: 0.7411,
                    roc_curve: { fpr: [0, 0.1, 1], tpr: [0, 0.82, 1], thresholds: [1, 0.6, 0] },
                    confusion_matrix: { labels: ["Bacterial", "Fungal"], matrix: [[9, 2], [3, 12]] },
                  },
                },
                model_version: {
                  version_name: "effnet-v1",
                },
              },
              {
                architecture: "convnext_tiny",
                status: "completed",
                result: {
                  best_val_acc: 0.5771,
                  test_predictions: [
                    {
                      sample_key: "image::P-001::Initial::raw/a.jpg",
                      sample_kind: "image",
                      patient_id: "P-001",
                      visit_date: "Initial",
                      true_label: "bacterial",
                      true_label_index: 0,
                      predicted_label: "bacterial",
                      predicted_label_index: 0,
                      positive_probability: 0.34,
                      is_correct: true,
                    },
                    {
                      sample_key: "image::P-002::FU #1::raw/b.jpg",
                      sample_kind: "image",
                      patient_id: "P-002",
                      visit_date: "FU #1",
                      true_label: "fungal",
                      true_label_index: 1,
                      predicted_label: "fungal",
                      predicted_label_index: 1,
                      positive_probability: 0.77,
                      is_correct: true,
                    },
                  ],
                  test_metrics: {
                    accuracy: 0.6621,
                    AUROC: 0.8031,
                    balanced_accuracy: 0.6412,
                    F1: 0.6499,
                    roc_curve: { fpr: [0, 0.16, 1], tpr: [0, 0.75, 1], thresholds: [1, 0.55, 0] },
                    confusion_matrix: { labels: ["Bacterial", "Fungal"], matrix: [[8, 3], [5, 10]] },
                  },
                },
                model_version: {
                  version_name: "convnext-v1",
                },
              },
            ],
            failures: [],
          },
        })}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Paper figures" })[0]);
    expect(screen.getByRole("dialog", { name: "Paper-ready benchmark figures" })).toBeInTheDocument();
    expect(screen.getByText("Figure 1 · ROC curve")).toBeInTheDocument();
    expect(screen.getByText("Figure export")).toBeInTheDocument();
    expect(screen.getByText("Ensemble confusion matrix")).toBeInTheDocument();
    expect(screen.getByText("Benchmark summary table")).toBeInTheDocument();
  });

  it("shows the paper figures launcher in the top action bar when the latest benchmark only exists on benchmarkJob.response", () => {
    render(
      <TrainingSection
        {...buildProps({
          benchmarkJob: {
            job_id: "job-4",
            job_type: "initial_training_benchmark",
            site_id: "HTTP_SITE",
            status: "completed",
            payload: {
              architectures: ["efficientnet_v2_s"],
            },
            result: {
              response: {
                best_architecture: "efficientnet_v2_s",
                results: [
                  {
                    architecture: "efficientnet_v2_s",
                    status: "completed",
                    result: {
                      best_val_acc: 0.6186,
                      test_metrics: {
                        accuracy: 0.7384,
                        AUROC: 0.8093,
                        balanced_accuracy: 0.7303,
                        roc_curve: { fpr: [0, 0.1, 1], tpr: [0, 0.82, 1], thresholds: [1, 0.6, 0] },
                        confusion_matrix: { labels: ["Bacterial", "Fungal"], matrix: [[9, 2], [3, 12]] },
                      },
                    },
                    model_version: {
                      version_name: "effnet-v1",
                    },
                  },
                ],
                failures: [],
              },
            },
            created_at: "2026-03-15T00:00:00Z",
          },
        })}
      />
    );

    expect(screen.getByText("The latest benchmark summary is available. Open the paper-figure panel here.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Paper figures" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Benchmark training summary")).toBeInTheDocument();
  });

  it("shows refresh status in the benchmark summary even without an active benchmark job", () => {
    const onRefreshBenchmarkStatus = vi.fn();

    render(
      <TrainingSection
        {...buildProps({
          onRefreshBenchmarkStatus,
          benchmarkResult: {
            best_architecture: "efficientnet_v2_s",
            results: [
              {
                architecture: "efficientnet_v2_s",
                status: "completed",
                result: {
                  best_val_acc: 0.6186,
                  test_metrics: {
                    accuracy: 0.7384,
                    AUROC: 0.8093,
                    balanced_accuracy: 0.7303,
                  },
                },
                model_version: {
                  version_name: "effnet-v1",
                },
              },
            ],
            failures: [],
          },
        })}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Refresh status" })[0]);
    expect(onRefreshBenchmarkStatus).toHaveBeenCalledTimes(1);
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

  it("locks crop mode to paired fusion and keeps the benchmark suites available", () => {
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
    expect(screen.getByRole("button", { name: "Run LGF + SSL 6-model training" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Architecture"), { target: { value: "dual_input_concat" } });
    const updater = setInitialForm.mock.calls.at(-1)?.[0];
    expect(updater(buildProps().initialForm).crop_mode).toBe("paired");
  });
});
