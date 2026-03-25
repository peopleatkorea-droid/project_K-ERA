import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

const mainControlPlaneMocks = vi.hoisted(() => ({
  requestMainControlPlane: vi.fn(),
}));

const desktopLocalApiMocks = vi.hoisted(() => ({
  canUseDesktopLocalApiTransport: vi.fn(() => false),
  requestDesktopLocalApiJson: vi.fn(),
}));

const siteLabelMocks = vi.hoisted(() => ({
  filterVisibleSites: vi.fn((sites: unknown) => sites),
}));

vi.mock("./api-core", () => ({
  request: apiCoreMocks.request,
}));

vi.mock("./main-control-plane-client", () => mainControlPlaneMocks);

vi.mock("./desktop-local-api", () => desktopLocalApiMocks);

vi.mock("./site-labels", () => siteLabelMocks);

describe("admin desktop wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(false);
  });

  it("uses the desktop local API bridge for institution sync and local admin settings", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});

    const mod = await import("./admin");
    await mod.syncInstitutionDirectory("desktop-token", { page_size: 100 });
    await mod.fetchStorageSettings("desktop-token", "SITE_A");
    await mod.updateStorageSettings("desktop-token", { storage_root: "C:/KERA" }, "SITE_A");
    await mod.fetchSiteComparison("desktop-token");

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/institutions/sync?page_size=100",
      "desktop-token",
      {
        method: "POST",
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/storage-settings",
      "desktop-token",
      {
        query: expect.any(URLSearchParams),
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/storage-settings",
      "desktop-token",
      {
        method: "PATCH",
        query: expect.any(URLSearchParams),
        body: { storage_root: "C:/KERA" },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      4,
      "/api/admin/site-comparison",
      "desktop-token",
    );
    expect(mainControlPlaneMocks.requestMainControlPlane).not.toHaveBeenCalled();
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop local API bridge for initial admin workspace bootstrap and registry helpers", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson
      .mockResolvedValueOnce({ current_model_version: "local-efficientnet" })
      .mockResolvedValueOnce([{ project_id: "project_default" }])
      .mockResolvedValueOnce([{ site_id: "SITE_A" }])
      .mockResolvedValueOnce({ current_model_version: "local-efficientnet" })
      .mockResolvedValueOnce([{ version_id: "local_model" }])
      .mockResolvedValueOnce([{ update_id: "local_update" }])
      .mockResolvedValueOnce([{ aggregation_id: "local_agg" }]);

    const mod = await import("./admin");
    const bootstrap = await mod.fetchAdminWorkspaceBootstrap("desktop-token", { scope: "initial", site_id: "SITE_A" });
    await mod.fetchAdminOverview("desktop-token");
    await mod.fetchModelVersions("desktop-token");
    await mod.fetchModelUpdates("desktop-token", { site_id: "SITE_A", status_filter: "pending" });
    await mod.fetchAggregations("desktop-token");

    expect(mainControlPlaneMocks.requestMainControlPlane).not.toHaveBeenCalled();
    expect(bootstrap).toMatchObject({
      overview: { current_model_version: "local-efficientnet" },
      projects: [{ project_id: "project_default" }],
      managed_sites: [{ site_id: "SITE_A" }],
      pending_requests: [],
      approved_requests: [],
      model_versions: [],
      model_updates: [],
      aggregations: [],
      managed_users: [],
      institution_sync_status: {
        source: "hira",
        institutions_synced: 0,
        total_count: 0,
        synced_at: null,
      },
    });
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/overview",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/projects",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/sites",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      4,
      "/api/admin/overview",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      5,
      "/api/admin/model-versions",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      6,
      "/api/admin/model-updates",
      "desktop-token",
      {
        query: expect.any(URLSearchParams),
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      7,
      "/api/admin/aggregations",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
  });

  it("uses the desktop local API bridge for access request review and site/user management", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});

    const mod = await import("./admin");
    await mod.fetchAccessRequests("desktop-token", "pending");
    await mod.fetchInstitutionDirectoryStatus("desktop-token");
    await mod.fetchProjects("desktop-token");
    await mod.createProject("desktop-token", { name: "Default", description: "desc" });
    await mod.fetchAdminSites("desktop-token");
    await mod.createAdminSite("desktop-token", {
      project_id: "project_default",
      site_code: "SITE_A",
      display_name: "SITE_A",
      hospital_name: "Hospital A",
      research_registry_enabled: true,
    });
    await mod.updateAdminSite("SITE_A", "desktop-token", {
      display_name: "SITE_A",
      hospital_name: "Hospital A",
      research_registry_enabled: true,
    });
    await mod.fetchUsers("desktop-token");
    await mod.upsertManagedUser("desktop-token", {
      username: "admin",
      role: "admin",
      full_name: "Admin",
      password: "secret",
      site_ids: [],
    });
    await mod.reviewAccessRequest("REQ_A", "desktop-token", {
      decision: "approved",
      assigned_site_id: "SITE_A",
    });

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/access-requests?status_filter=pending",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/institutions/status",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/projects",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      4,
      "/api/admin/projects",
      "desktop-token",
      {
        method: "POST",
        body: {
          name: "Default",
          description: "desc",
        },
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      5,
      "/api/admin/sites",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      6,
      "/api/admin/sites",
      "desktop-token",
      {
        method: "POST",
        body: {
          project_id: "project_default",
          site_code: "SITE_A",
          display_name: "SITE_A",
          hospital_name: "Hospital A",
          research_registry_enabled: true,
        },
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      7,
      "/api/admin/sites/SITE_A",
      "desktop-token",
      {
        method: "PATCH",
        body: {
          display_name: "SITE_A",
          hospital_name: "Hospital A",
          research_registry_enabled: true,
        },
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      8,
      "/api/admin/users",
      "desktop-token",
      {
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      9,
      "/api/admin/users",
      "desktop-token",
      {
        method: "POST",
        body: {
          username: "admin",
          role: "admin",
          full_name: "Admin",
          password: "secret",
          site_ids: [],
        },
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      10,
      "/api/admin/access-requests/REQ_A/review",
      "desktop-token",
      {
        method: "POST",
        body: {
          decision: "approved",
          assigned_site_id: "SITE_A",
        },
        controlPlaneOwner: "local",
      },
    );
    expect(mainControlPlaneMocks.requestMainControlPlane).not.toHaveBeenCalled();
  });

  it("uses the desktop local API bridge for local model version actions", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});

    const mod = await import("./admin");
    await mod.activateLocalModelVersion("MODEL_A", "desktop-token");
    await mod.deleteModelVersion("MODEL_A", "desktop-token");
    await mod.publishModelVersion("MODEL_A", "desktop-token", {
      download_url: "https://example.com/model.pt",
      set_current: true,
    });
    await mod.autoPublishModelVersion("MODEL_A", "desktop-token", {
      set_current: true,
    });

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/model-versions/MODEL_A/activate-local",
      "desktop-token",
      {
        method: "POST",
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/model-versions/MODEL_A",
      "desktop-token",
      {
        method: "DELETE",
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/model-versions/MODEL_A/publish",
      "desktop-token",
      {
        method: "POST",
        body: {
          download_url: "https://example.com/model.pt",
          set_current: true,
        },
        controlPlaneOwner: "local",
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      4,
      "/api/admin/model-versions/MODEL_A/auto-publish",
      "desktop-token",
      {
        method: "POST",
        body: {
          set_current: true,
        },
        controlPlaneOwner: "local",
      },
    );
    expect(mainControlPlaneMocks.requestMainControlPlane).not.toHaveBeenCalled();
  });
});
