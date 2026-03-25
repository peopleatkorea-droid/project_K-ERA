import { beforeEach, describe, expect, it, vi } from "vitest";

const mainControlPlaneMocks = vi.hoisted(() => ({
  requestMainControlPlane: vi.fn(),
  persistMainAppToken: vi.fn(),
}));

const desktopLocalApiMocks = vi.hoisted(() => ({
  canUseDesktopLocalApiTransport: vi.fn(() => false),
  requestDesktopLocalApiJson: vi.fn(),
}));

const siteLabelMocks = vi.hoisted(() => ({
  filterVisibleSites: vi.fn((sites: unknown) => sites),
}));

vi.mock("./main-control-plane-client", () => mainControlPlaneMocks);

vi.mock("./desktop-local-api", () => desktopLocalApiMocks);

vi.mock("./site-labels", () => siteLabelMocks);

describe("auth desktop wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(false);
    siteLabelMocks.filterVisibleSites.mockImplementation((sites: unknown) => sites);
  });

  it("uses the desktop local API bridge for public catalog requests", async () => {
    desktopLocalApiMocks.canUseDesktopLocalApiTransport.mockReturnValue(true);
    desktopLocalApiMocks.requestDesktopLocalApiJson
      .mockResolvedValueOnce([{ site_id: "SITE_A" }])
      .mockResolvedValueOnce([{ institution_id: "39100103", name: "제주대학교병원" }])
      .mockResolvedValueOnce({ site_count: 1, total_cases: 2, total_images: 3, current_model_version: null, last_updated: "2026-03-25T00:00:00Z" });

    const mod = await import("./auth");
    await mod.fetchPublicSites();
    await mod.searchPublicInstitutions("제주대", { limit: 8 });
    await mod.fetchPublicStatistics();

    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      1,
      "/api/public/sites",
      "",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      2,
      "/api/public/institutions/search?q=%EC%A0%9C%EC%A3%BC%EB%8C%80&limit=8",
      "",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).toHaveBeenNthCalledWith(
      3,
      "/api/public/statistics",
      "",
    );
    expect(mainControlPlaneMocks.requestMainControlPlane).not.toHaveBeenCalled();
  });

  it("falls back to the main control plane in web mode", async () => {
    mainControlPlaneMocks.requestMainControlPlane.mockResolvedValue([{ institution_id: "39100103" }]);

    const mod = await import("./auth");
    await mod.searchPublicInstitutions("제주대", { limit: 8 });

    expect(mainControlPlaneMocks.requestMainControlPlane).toHaveBeenCalledWith(
      "/public/institutions/search?q=%EC%A0%9C%EC%A3%BC%EB%8C%80&limit=8",
    );
    expect(desktopLocalApiMocks.requestDesktopLocalApiJson).not.toHaveBeenCalled();
  });
});
