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

  it("uses main control plane sync while keeping desktop local API bridges for local admin settings", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});
    mainControlPlaneMocks.requestMainControlPlane.mockResolvedValue({});

    const mod = await import("./admin");
    await mod.syncInstitutionDirectory("desktop-token", { page_size: 100 });
    await mod.fetchStorageSettings("desktop-token", "SITE_A");
    await mod.updateStorageSettings("desktop-token", { storage_root: "C:/KERA" }, "SITE_A");
    await mod.fetchSiteComparison("desktop-token");

    expect(mainControlPlaneMocks.requestMainControlPlane).toHaveBeenNthCalledWith(
      1,
      "/admin/institutions/sync?page_size=100",
      { method: "POST" },
      "desktop-token",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/storage-settings",
      "desktop-token",
      {
        query: expect.any(URLSearchParams),
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/storage-settings",
      "desktop-token",
      {
        method: "PATCH",
        query: expect.any(URLSearchParams),
        body: { storage_root: "C:/KERA" },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/site-comparison",
      "desktop-token",
    );
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop local API bridge for site storage root and metadata recovery", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson.mockResolvedValue({});

    const mod = await import("./admin");
    await mod.updateAdminSiteStorageRoot("SITE_A", "desktop-token", { storage_root: "C:/KERA/SITE_A" });
    await mod.migrateAdminSiteStorageRoot("SITE_A", "desktop-token", { storage_root: "D:/KERA/SITE_A" });
    await mod.recoverAdminSiteMetadata("SITE_A", "desktop-token", {
      source: "backup",
      force_replace: false,
      backup_path: "C:/backup/site.json",
    });

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/admin/sites/SITE_A/storage-root",
      "desktop-token",
      {
        method: "PATCH",
        body: { storage_root: "C:/KERA/SITE_A" },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/admin/sites/SITE_A/storage-root/migrate",
      "desktop-token",
      {
        method: "POST",
        body: { storage_root: "D:/KERA/SITE_A" },
      },
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/admin/sites/SITE_A/metadata/recover",
      "desktop-token",
      {
        method: "POST",
        body: {
          source: "backup",
          force_replace: false,
          backup_path: "C:/backup/site.json",
        },
      },
    );
  });
});
