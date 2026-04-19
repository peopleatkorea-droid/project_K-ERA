import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  buildApiUrl: vi.fn((path: string) => path),
  request: vi.fn(),
  requestBlob: vi.fn(),
}));

const analysisRuntimeMocks = vi.hoisted(() => ({
  fetchAnalysisValidationArtifactBlob: vi.fn(),
  fetchAnalysisValidationArtifactUrl: vi.fn(),
  fetchAnalysisCaseRoiPreviewArtifactBlob: vi.fn(),
  fetchAnalysisCaseRoiPreviewArtifactUrl: vi.fn(),
  fetchAnalysisCaseLesionPreviewArtifactBlob: vi.fn(),
  fetchAnalysisCaseLesionPreviewArtifactUrl: vi.fn(),
}));

const desktopWorkspaceMocks = vi.hoisted(() => ({
  canUseDesktopWorkspaceTransport: vi.fn(() => false),
  readDesktopImageBlob: vi.fn(),
}));

const desktopTransportMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
  ensureDesktopImagePreviews: vi.fn(),
}));

const desktopLocalApiMocks = vi.hoisted(() => ({
  canUseDesktopLocalApiTransport: vi.fn(() => false),
  requestDesktopLocalApiBinary: vi.fn(),
}));

vi.mock("./api-core", () => ({
  buildApiUrl: apiCoreMocks.buildApiUrl,
  request: apiCoreMocks.request,
  requestBlob: apiCoreMocks.requestBlob,
}));

vi.mock("./analysis-runtime", () => ({
  fetchAnalysisValidationArtifactBlob: analysisRuntimeMocks.fetchAnalysisValidationArtifactBlob,
  fetchAnalysisValidationArtifactUrl: analysisRuntimeMocks.fetchAnalysisValidationArtifactUrl,
  fetchAnalysisCaseRoiPreviewArtifactBlob: analysisRuntimeMocks.fetchAnalysisCaseRoiPreviewArtifactBlob,
  fetchAnalysisCaseRoiPreviewArtifactUrl: analysisRuntimeMocks.fetchAnalysisCaseRoiPreviewArtifactUrl,
  fetchAnalysisCaseLesionPreviewArtifactBlob: analysisRuntimeMocks.fetchAnalysisCaseLesionPreviewArtifactBlob,
  fetchAnalysisCaseLesionPreviewArtifactUrl: analysisRuntimeMocks.fetchAnalysisCaseLesionPreviewArtifactUrl,
}));

vi.mock("./desktop-workspace", () => ({
  canUseDesktopWorkspaceTransport: desktopWorkspaceMocks.canUseDesktopWorkspaceTransport,
  readDesktopImageBlob: desktopWorkspaceMocks.readDesktopImageBlob,
}));

vi.mock("./desktop-transport", () => ({
  canUseDesktopTransport: desktopTransportMocks.canUseDesktopTransport,
  ensureDesktopImagePreviews: desktopTransportMocks.ensureDesktopImagePreviews,
}));

vi.mock("./desktop-local-api", () => ({
  canUseDesktopLocalApiTransport: desktopLocalApiMocks.canUseDesktopLocalApiTransport,
  requestDesktopLocalApiBinary: desktopLocalApiMocks.requestDesktopLocalApiBinary,
}));

describe("artifacts desktop routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(false);
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(false);
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(false);
  });

  it("uses the desktop blob reader for image content when the desktop transport is available", async () => {
    const desktopBlob = new Blob(["kera"], { type: "image/png" });
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(true);
    desktopWorkspaceMocks.readDesktopImageBlob.mockResolvedValue(desktopBlob);

    const mod = await import("./artifacts");
    const result = await mod.fetchImageBlob("39100103", "image_1", "desktop-token");

    expect(desktopWorkspaceMocks.readDesktopImageBlob).toHaveBeenCalledWith("39100103", "image_1", {
      signal: undefined,
    });
    expect(apiCoreMocks.requestBlob).not.toHaveBeenCalled();
    expect(result).toBe(desktopBlob);
  });

  it("uses the desktop preview cache for image preview URLs when available", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    desktopTransportMocks.ensureDesktopImagePreviews.mockResolvedValue(new Map([["image_1", "asset://preview"]]));

    const mod = await import("./artifacts");
    const result = await mod.fetchImagePreviewUrl("39100103", "image_1", "desktop-token", { maxSide: 512 });

    expect(desktopTransportMocks.ensureDesktopImagePreviews).toHaveBeenCalledWith("39100103", ["image_1"], {
      maxSide: 512,
      signal: undefined,
    });
    expect(result).toBe("asset://preview");
  });

  it("uses the desktop local API binary bridge for manifest and template downloads", async () => {
    const desktopBlob = new Blob(["site_id"], { type: "text/csv" });
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiBinary.mockResolvedValue(desktopBlob);

    const mod = await import("./artifacts");
    await mod.downloadManifest("39100103", "desktop-token");
    await mod.downloadImportTemplate("39100103", "desktop-token");

    expect(desktopLocalApiMocks.requestDesktopLocalApiBinary).toHaveBeenNthCalledWith(
      1,
      "/api/sites/39100103/manifest.csv",
      "desktop-token",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiBinary).toHaveBeenNthCalledWith(
      2,
      "/api/sites/39100103/import/template.csv",
      "desktop-token",
    );
  });

  it("uses the desktop local API binary bridge for model update artifacts", async () => {
    const desktopBlob = new Blob(["kera"], { type: "image/png" });
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiBinary.mockResolvedValue(desktopBlob);

    const mod = await import("./artifacts");
    const result = await mod.fetchModelUpdateArtifactBlob("update_1", "mask_thumbnail", "desktop-token");

    expect(desktopLocalApiMocks.requestDesktopLocalApiBinary).toHaveBeenCalledWith(
      "/api/admin/model-updates/update_1/artifacts/mask_thumbnail",
      "desktop-token",
    );
    expect(result).toBe(desktopBlob);
  });

  it("forwards a custom preview size for validation artifact URLs", async () => {
    analysisRuntimeMocks.fetchAnalysisValidationArtifactUrl.mockResolvedValue(
      "asset://validation-preview",
    );

    const mod = await import("./artifacts");
    const result = await mod.fetchValidationArtifactUrl(
      "39100103",
      "validation_1",
      "17452298",
      "Initial",
      "roi_crop",
      "desktop-token",
      { previewMaxSide: 448 },
    );

    expect(
      analysisRuntimeMocks.fetchAnalysisValidationArtifactUrl,
    ).toHaveBeenCalledWith(
      "39100103",
      "validation_1",
      "17452298",
      "Initial",
      "roi_crop",
      "desktop-token",
      { previewMaxSide: 448 },
    );
    expect(result).toBe("asset://validation-preview");
  });

  it("forwards a custom preview size for ROI and lesion artifact URLs", async () => {
    analysisRuntimeMocks.fetchAnalysisCaseRoiPreviewArtifactUrl.mockResolvedValue(
      "asset://roi-preview",
    );
    analysisRuntimeMocks.fetchAnalysisCaseLesionPreviewArtifactUrl.mockResolvedValue(
      "asset://lesion-preview",
    );

    const mod = await import("./artifacts");
    const roiResult = await mod.fetchCaseRoiPreviewArtifactUrl(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "roi_crop",
      "desktop-token",
      { previewMaxSide: 512 },
    );
    const lesionResult = await mod.fetchCaseLesionPreviewArtifactUrl(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "lesion_crop",
      "desktop-token",
      { previewMaxSide: 512 },
    );

    expect(
      analysisRuntimeMocks.fetchAnalysisCaseRoiPreviewArtifactUrl,
    ).toHaveBeenCalledWith(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "roi_crop",
      "desktop-token",
      { previewMaxSide: 512 },
    );
    expect(
      analysisRuntimeMocks.fetchAnalysisCaseLesionPreviewArtifactUrl,
    ).toHaveBeenCalledWith(
      "39100103",
      "17452298",
      "Initial",
      "image_1",
      "lesion_crop",
      "desktop-token",
      { previewMaxSide: 512 },
    );
    expect(roiResult).toBe("asset://roi-preview");
    expect(lesionResult).toBe("asset://lesion-preview");
  });
});
