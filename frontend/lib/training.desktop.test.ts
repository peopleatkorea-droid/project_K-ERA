import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

const analysisRuntimeMocks = vi.hoisted(() => ({
  fetchAnalysisSiteJob: vi.fn(),
  runAnalysisCaseAiClinic: vi.fn(),
  runAnalysisCaseAiClinicSimilarCases: vi.fn(),
  runAnalysisCaseValidation: vi.fn(),
  runAnalysisCaseValidationCompare: vi.fn(),
}));

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
  invokeDesktop: vi.fn(),
}));

const desktopDiagnosticsMocks = vi.hoisted(() => ({
  ensureDesktopLocalWorkerReady: vi.fn(),
}));

vi.mock("./api-core", () => ({
  request: apiCoreMocks.request,
}));

vi.mock("./analysis-runtime", () => ({
  fetchAnalysisSiteJob: analysisRuntimeMocks.fetchAnalysisSiteJob,
  runAnalysisCaseAiClinic: analysisRuntimeMocks.runAnalysisCaseAiClinic,
  runAnalysisCaseAiClinicSimilarCases: analysisRuntimeMocks.runAnalysisCaseAiClinicSimilarCases,
  runAnalysisCaseValidation: analysisRuntimeMocks.runAnalysisCaseValidation,
  runAnalysisCaseValidationCompare: analysisRuntimeMocks.runAnalysisCaseValidationCompare,
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
}));

vi.mock("./desktop-diagnostics", () => ({
  ensureDesktopLocalWorkerReady: desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady,
}));

describe("training desktop routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
    desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady.mockResolvedValue({ running: true });
  });

  it("uses the desktop site validations reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue([]);

    const mod = await import("./training");
    await mod.fetchSiteValidations("SITE_A", "desktop-token", { limit: 12 });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("fetch_site_validations", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        limit: 12,
      },
    }, undefined);
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop site model versions reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue([]);

    const mod = await import("./training");
    await mod.fetchSiteModelVersions("SITE_A", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("fetch_site_model_versions", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
      },
    }, undefined);
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop site validation runner when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ job: { job_id: "job_1" } });

    const mod = await import("./training");
    await mod.runSiteValidation("SITE_A", "desktop-token", { model_version_id: "model_1" });

    expect(desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady).toHaveBeenCalledTimes(1);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("run_site_validation", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        model_version_id: "model_1",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop initial training runner when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ job: { job_id: "job_1" } });

    const mod = await import("./training");
    await mod.runInitialTraining("SITE_A", "desktop-token", { architecture: "convnext_tiny" });

    expect(desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady).toHaveBeenCalledTimes(1);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("run_initial_training", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        architecture: "convnext_tiny",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop job cancel command when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ job_id: "job_1", status: "cancelling" });

    const mod = await import("./training");
    await mod.cancelSiteJob("SITE_A", "job_1", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("cancel_site_job", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        job_id: "job_1",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop embedding status and backfill commands when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValueOnce({ pending_case_count: 0 }).mockResolvedValueOnce({ job: { job_id: "job_2" } });

    const mod = await import("./training");
    await mod.fetchAiClinicEmbeddingStatus("SITE_A", "desktop-token", { model_version_id: "model_1" });
    await mod.backfillAiClinicEmbeddings("SITE_A", "desktop-token", { model_version_id: "model_1", force_refresh: true });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "fetch_ai_clinic_embedding_status", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        model_version_id: "model_1",
      },
    });
    expect(desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady).toHaveBeenCalledTimes(1);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "backfill_ai_clinic_embeddings", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        model_version_id: "model_1",
        force_refresh: true,
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop SSL runner when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ job: { job_id: "job_ssl_1" } });

    const mod = await import("./training");
    await mod.runSslPretraining("SITE_A", "desktop-token", {
      archive_base_dir: "E:\\전안부 사진",
      architecture: "convnext_tiny",
      execution_mode: "gpu",
    });

    expect(desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady).toHaveBeenCalledTimes(1);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("run_ssl_pretraining", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        archive_base_dir: "E:\\전안부 사진",
        architecture: "convnext_tiny",
        execution_mode: "gpu",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop site jobs reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue([]);

    const mod = await import("./training");
    await mod.fetchSiteJobs("SITE_A", "desktop-token", {
      job_type: "initial_training_benchmark",
      limit: 1,
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("list_site_jobs", {
      payload: {
        site_id: "SITE_A",
        token: "desktop-token",
        job_type: "initial_training_benchmark",
        status: undefined,
        limit: 1,
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("surfaces a contextual error when the desktop worker is unavailable", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopDiagnosticsMocks.ensureDesktopLocalWorkerReady.mockRejectedValue(new Error("Desktop-managed local worker exited."));

    const mod = await import("./training");

    await expect(mod.runCrossValidation("SITE_A", "desktop-token")).rejects.toThrow(
      "Cross-validation is unavailable: Desktop-managed local worker exited.",
    );
    expect(desktopIpcMocks.invokeDesktop).not.toHaveBeenCalled();
  });

  it("uses the desktop AI Clinic similar-cases runner when the desktop runtime is available", async () => {
    analysisRuntimeMocks.runAnalysisCaseAiClinicSimilarCases.mockResolvedValue({
      analysis_stage: "similar_cases",
      similar_cases: [],
    });

    const mod = await import("./training");
    await mod.runCaseAiClinicSimilarCases("SITE_A", "desktop-token", {
      patient_id: "P-001",
      visit_date: "Initial",
      model_version_id: "model_1",
      retrieval_backend: "classifier",
    });

    expect(analysisRuntimeMocks.runAnalysisCaseAiClinicSimilarCases).toHaveBeenCalledWith("SITE_A", "desktop-token", {
      patient_id: "P-001",
      visit_date: "Initial",
      model_version_id: "model_1",
      retrieval_backend: "classifier",
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });
});
