import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

const analysisRuntimeMocks = vi.hoisted(() => ({
  fetchAnalysisCaseLesionPreview: vi.fn(),
  fetchAnalysisCaseRoiPreview: vi.fn(),
  fetchAnalysisLiveLesionPreviewJob: vi.fn(),
  fetchAnalysisSemanticPromptScores: vi.fn(),
  fetchAnalysisStoredCaseLesionPreview: vi.fn(),
  runAnalysisCaseContribution: vi.fn(),
  startAnalysisLiveLesionPreview: vi.fn(),
}));

const localWorkspaceRuntimeMocks = vi.hoisted(() => ({
  createWorkspacePatient: vi.fn(),
  createWorkspaceVisit: vi.fn(),
  deleteWorkspaceVisit: vi.fn(),
  deleteWorkspaceVisitImages: vi.fn(),
  fetchWorkspaceCaseHistory: vi.fn(),
  fetchWorkspaceCases: vi.fn(),
  fetchWorkspaceImages: vi.fn(),
  fetchWorkspacePatientIdLookup: vi.fn(),
  fetchWorkspacePatientListPage: vi.fn(),
  fetchWorkspacePatients: vi.fn(),
  fetchWorkspaceSiteActivity: vi.fn(),
  fetchWorkspaceVisitImagesWithPreviews: vi.fn(),
  fetchWorkspaceVisits: vi.fn(),
  invalidateWorkspaceDesktopCaches: vi.fn(),
  prewarmWorkspacePatientListPage: vi.fn(),
  setWorkspaceRepresentativeImage: vi.fn(),
  updateWorkspacePatient: vi.fn(),
  updateWorkspaceVisit: vi.fn(),
  uploadWorkspaceImage: vi.fn(),
}));

const desktopLocalApiMocks = vi.hoisted(() => ({
  canUseDesktopLocalApiTransport: vi.fn(() => false),
  requestDesktopLocalApiJson: vi.fn(),
  requestDesktopLocalApiMultipart: vi.fn(),
}));

const mainControlPlaneMocks = vi.hoisted(() => ({
  persistMainAppToken: vi.fn(),
  requestMainControlPlane: vi.fn(),
}));

vi.mock("./api-core", () => ({
  request: apiCoreMocks.request,
}));

vi.mock("./analysis-runtime", () => analysisRuntimeMocks);

vi.mock("./local-workspace-runtime", () => localWorkspaceRuntimeMocks);

vi.mock("./desktop-local-api", () => desktopLocalApiMocks);

vi.mock("./main-control-plane-client", () => mainControlPlaneMocks);

describe("cases desktop wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(false);
  });

  it("uses the desktop local API JSON bridge for staged site summary and lesion box writes", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});

    const mod = await import("./cases");
    await mod.fetchSiteSummaryCounts("SITE_A", "desktop-token");
    await mod.fetchSiteSummary("SITE_A", "desktop-token");
    await mod.updateImageLesionBox("SITE_A", "image_1", "desktop-token", {
      x0: 0.1,
      y0: 0.2,
      x1: 0.8,
      y1: 0.9,
    });
    await mod.clearImageLesionBox("SITE_A", "image_1", "desktop-token");

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/sites/SITE_A/summary/counts",
      "desktop-token",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/sites/SITE_A/summary",
      "desktop-token",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/sites/SITE_A/images/image_1/lesion-box",
      "desktop-token",
      {
        method: "PATCH",
        body: {
          x0: 0.1,
          y0: 0.2,
          x1: 0.8,
          y1: 0.9,
        },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      4,
      "/api/sites/SITE_A/images/image_1/lesion-box",
      "desktop-token",
      {
        method: "DELETE",
      },
    );
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("merges staged summary counts without dropping same-site details", async () => {
    const mod = await import("./cases");

    expect(
      mod.mergeSiteSummaryCounts(
        {
          site_id: "SITE_A",
          n_patients: 1,
          n_visits: 2,
          n_images: 3,
          n_active_visits: 1,
          n_fungal_visits: 1,
          n_bacterial_visits: 1,
          n_validation_runs: 4,
          latest_validation: { validation_id: "val_1" },
          research_registry: {
            site_enabled: true,
            user_enrolled: true,
            included_cases: 7,
            excluded_cases: 1,
          },
        },
        {
          site_id: "SITE_A",
          n_patients: 50,
          n_visits: 133,
          n_images: 408,
          n_active_visits: 19,
          n_fungal_visits: 21,
          n_bacterial_visits: 112,
        },
      ),
    ).toMatchObject({
      site_id: "SITE_A",
      n_patients: 50,
      n_visits: 133,
      n_images: 408,
      n_active_visits: 19,
      n_fungal_visits: 21,
      n_bacterial_visits: 112,
      n_validation_runs: 4,
      latest_validation: { validation_id: "val_1" },
      research_registry: {
        site_enabled: true,
        user_enrolled: true,
        included_cases: 7,
        excluded_cases: 1,
      },
    });
  });

  it("uses the desktop local API bridges for medsam and bulk import flows", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});
    desktopLocalApiMocks.requestDesktopLocalApiMultipart.mockResolvedValue({ imported_cases: 1 });

    const mod = await import("./cases");
    await mod.fetchMedsamArtifactStatus("SITE_A", "desktop-token", {
      mine: true,
      refresh: true,
    });
    await mod.fetchMedsamArtifactItems("SITE_A", "desktop-token", {
      scope: "visit",
      status_key: "medsam_backfill_ready",
      mine: true,
      page: 2,
      page_size: 10,
    });
    await mod.backfillMedsamArtifacts("SITE_A", "desktop-token", {
      mine: true,
      refresh_cache: false,
    });
    await mod.runBulkImport("SITE_A", "desktop-token", {
      csvFile: new File(["patient_id\n1"], "import.csv", { type: "text/csv" }),
      files: [new File(["img"], "image.jpg", { type: "image/jpeg" })],
    });

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/sites/SITE_A/medsam-artifacts/status",
      "desktop-token",
      {
        query: expect.any(URLSearchParams),
        signal: undefined,
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/sites/SITE_A/medsam-artifacts/items",
      "desktop-token",
      {
        query: expect.any(URLSearchParams),
        signal: undefined,
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/sites/SITE_A/medsam-artifacts/backfill",
      "desktop-token",
      {
        method: "POST",
        query: expect.any(URLSearchParams),
        body: {
          refresh_cache: false,
        },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiMultipart).toHaveBeenCalledWith(
      "/api/sites/SITE_A/import/bulk",
      "desktop-token",
      {
        files: [
          expect.objectContaining({
            fieldName: "csv_file",
            fileName: "import.csv",
            contentType: "text/csv",
          }),
          expect.objectContaining({
            fieldName: "files",
            fileName: "image.jpg",
            contentType: "image/jpeg",
          }),
        ],
      },
    );
  });
});
