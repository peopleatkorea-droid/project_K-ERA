import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestBlob: vi.fn(),
}));

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
  invokeDesktop: vi.fn(),
  convertDesktopFilePath: vi.fn(async (path: string) => path),
}));

const desktopSidecarMocks = vi.hoisted(() => ({
  warnDesktopMlFallback: vi.fn(),
}));

vi.mock("./api-core", () => ({
  request: apiCoreMocks.request,
  requestBlob: apiCoreMocks.requestBlob,
}));

vi.mock("./desktop-ipc", () => ({
  convertDesktopFilePath: desktopIpcMocks.convertDesktopFilePath,
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
}));

vi.mock("./desktop-sidecar-config", () => ({
  warnDesktopMlFallback: desktopSidecarMocks.warnDesktopMlFallback,
}));

describe("analysis-runtime desktop routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("uses the desktop validation artifact reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      bytes: [107, 101, 114, 97],
      media_type: "image/png",
    });

    const mod = await import("./analysis-runtime");
    const blob = await mod.fetchAnalysisValidationArtifactBlob(
      "39100103",
      "validation_1",
      "17452298",
      "Initial",
      "roi_crop",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("read_validation_artifact", {
      payload: {
        site_id: "39100103",
        validation_id: "validation_1",
        patient_id: "17452298",
        visit_date: "Initial",
        artifact_kind: "roi_crop",
      },
    });
    expect(apiCoreMocks.requestBlob).not.toHaveBeenCalled();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });

  it("uses the desktop validation artifact path resolver when a preview URL is requested", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      path: "C:/artifacts/roi_crop.png",
    });

    const mod = await import("./analysis-runtime");
    const url = await mod.fetchAnalysisValidationArtifactUrl(
      "39100103",
      "validation_1",
      "17452298",
      "Initial",
      "roi_crop",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("resolve_validation_artifact_path", {
      payload: {
        site_id: "39100103",
        validation_id: "validation_1",
        patient_id: "17452298",
        visit_date: "Initial",
        artifact_kind: "roi_crop",
      },
    });
    expect(desktopIpcMocks.convertDesktopFilePath).toHaveBeenCalledWith("C:/artifacts/roi_crop.png");
    expect(url).toBe("C:/artifacts/roi_crop.png");
  });

  it("uses the desktop ROI artifact reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      bytes: [1, 2, 3],
      media_type: "image/png",
    });

    const mod = await import("./analysis-runtime");
    await mod.fetchAnalysisCaseRoiPreviewArtifactBlob(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "medsam_mask",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("read_case_roi_preview_artifact", {
      payload: {
        site_id: "39100103",
        patient_id: "17452298",
        visit_date: "Initial",
        image_id: "image_1",
        artifact_kind: "medsam_mask",
      },
    });
    expect(apiCoreMocks.requestBlob).not.toHaveBeenCalled();
  });

  it("uses the desktop ROI artifact path resolver when a preview URL is requested", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      path: "C:/artifacts/medsam_mask.png",
    });

    const mod = await import("./analysis-runtime");
    const url = await mod.fetchAnalysisCaseRoiPreviewArtifactUrl(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "medsam_mask",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("resolve_case_roi_preview_artifact_path", {
      payload: {
        site_id: "39100103",
        patient_id: "17452298",
        visit_date: "Initial",
        image_id: "image_1",
        artifact_kind: "medsam_mask",
      },
    });
    expect(url).toBe("C:/artifacts/medsam_mask.png");
  });

  it("uses the desktop lesion artifact reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      bytes: [1, 2, 3],
      media_type: "image/png",
    });

    const mod = await import("./analysis-runtime");
    await mod.fetchAnalysisCaseLesionPreviewArtifactBlob(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "lesion_mask",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("read_case_lesion_preview_artifact", {
      payload: {
        site_id: "39100103",
        patient_id: "17452298",
        visit_date: "Initial",
        image_id: "image_1",
        artifact_kind: "lesion_mask",
      },
    });
    expect(apiCoreMocks.requestBlob).not.toHaveBeenCalled();
  });

  it("uses the desktop lesion artifact reader when a preview URL is requested", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      bytes: [107, 101, 114, 97],
      media_type: "image/png",
    });
    const originalCreateObjectURL = (URL as typeof URL & { createObjectURL?: (obj: Blob | MediaSource) => string }).createObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:lesion-preview"),
    });

    const mod = await import("./analysis-runtime");
    const url = await mod.fetchAnalysisCaseLesionPreviewArtifactUrl(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "lesion_mask",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("read_case_lesion_preview_artifact", {
      payload: {
        site_id: "39100103",
        patient_id: "17452298",
        visit_date: "Initial",
        image_id: "image_1",
        artifact_kind: "lesion_mask",
      },
    });
    expect(url).toBe("blob:lesion-preview");
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
  });

  it("uses the desktop stored lesion preview reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue([
      {
        patient_id: "17452298",
        visit_date: "Initial",
        image_id: "image_1",
        view: "white",
        is_representative: true,
        source_image_path: "C:/image.jpg",
        has_lesion_crop: true,
        has_lesion_mask: true,
        backend: "local",
        lesion_prompt_box: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 },
      },
    ]);

    const mod = await import("./analysis-runtime");
    const previews = await mod.fetchAnalysisStoredCaseLesionPreview(
      "39100103",
      "17452298",
      "Initial",
      "desktop-token",
    );

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("list_stored_case_lesion_previews", {
      payload: {
        site_id: "39100103",
        patient_id: "17452298",
        visit_date: "Initial",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
    expect(previews).toHaveLength(1);
  });

  it("uses the desktop validation runner when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ summary: { validation_id: "validation_1" } });

    const mod = await import("./analysis-runtime");
    await mod.runAnalysisCaseValidation("39100103", "desktop-token", {
      patient_id: "17452298",
      visit_date: "Initial",
      model_version_id: "model_1",
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("run_case_validation", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
        model_version_id: "model_1",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("passes review selection profiles through the desktop validation commands", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ summary: { validation_id: "validation_1" } });

    const mod = await import("./analysis-runtime");
    await mod.runAnalysisCaseValidation("39100103", "desktop-token", {
      patient_id: "17452298",
      visit_date: "Initial",
      selection_profile: "single_case_review",
    });
    await mod.runAnalysisCaseValidationCompare("39100103", "desktop-token", {
      patient_id: "17452298",
      visit_date: "Initial",
      model_version_ids: [],
      selection_profile: "visit_level_review",
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "run_case_validation", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
        selection_profile: "single_case_review",
      },
    });
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "run_case_validation_compare", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
        selection_profile: "visit_level_review",
      },
    });
  });

  it("uses DINOv2 defaults for desktop AI Clinic commands when callers omit retrieval settings", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      analysis_stage: "similar_cases",
      similar_cases: [],
    });

    const mod = await import("./analysis-runtime");
    await mod.runAnalysisCaseAiClinic("39100103", "desktop-token", {
      patient_id: "17452298",
      visit_date: "Initial",
      model_version_id: "model_1",
    });
    await mod.runAnalysisCaseAiClinicSimilarCases("39100103", "desktop-token", {
      patient_id: "17452298",
      visit_date: "Initial",
      model_version_id: "model_1",
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "run_case_ai_clinic", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
        model_version_id: "model_1",
        retrieval_backend: "dinov2",
        retrieval_profile: "dinov2_lesion_crop",
      },
    });
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "run_case_ai_clinic_similar_cases", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
        model_version_id: "model_1",
        retrieval_backend: "dinov2",
        retrieval_profile: "dinov2_lesion_crop",
      },
    });
  });

  it("uses the desktop site-job reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ job_id: "job_1", status: "running" });

    const mod = await import("./analysis-runtime");
    await mod.fetchAnalysisSiteJob("39100103", "job_1", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("fetch_site_job", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        job_id: "job_1",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop ROI preview reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue([]);

    const mod = await import("./analysis-runtime");
    await mod.fetchAnalysisCaseRoiPreview("39100103", "17452298", "Initial", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("fetch_case_roi_preview", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        patient_id: "17452298",
        visit_date: "Initial",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop live lesion preview commands when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValueOnce({ job_id: "job_1" }).mockResolvedValueOnce({ job_id: "job_1", status: "done" });

    const mod = await import("./analysis-runtime");
    await mod.startAnalysisLiveLesionPreview("39100103", "image_1", "desktop-token");
    await mod.fetchAnalysisLiveLesionPreviewJob("39100103", "image_1", "job_1", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "start_live_lesion_preview", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        image_id: "image_1",
      },
    });
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "fetch_live_lesion_preview_job", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        image_id: "image_1",
        job_id: "job_1",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop semantic prompt reader when the desktop runtime is available", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue({ image_id: "image_1", layers: [] });

    const mod = await import("./analysis-runtime");
    await mod.fetchAnalysisSemanticPromptScores("39100103", "image_1", "desktop-token", {
      top_k: 5,
      input_mode: "lesion_crop",
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith("fetch_image_semantic_prompt_scores", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        image_id: "image_1",
        top_k: 5,
        input_mode: "lesion_crop",
      },
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });
});
