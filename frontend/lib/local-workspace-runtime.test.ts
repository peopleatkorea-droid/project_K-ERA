import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

const desktopTransportMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
  clearDesktopTransportCaches: vi.fn(),
  fetchDesktopPatientListPage: vi.fn(),
  fetchDesktopVisitImages: vi.fn(),
  prewarmDesktopPatientListPage: vi.fn(),
}));

const desktopWorkspaceMocks = vi.hoisted(() => ({
  canUseDesktopWorkspaceTransport: vi.fn(() => false),
  createDesktopPatient: vi.fn(),
  fetchDesktopCases: vi.fn(),
  fetchDesktopCaseHistory: vi.fn(),
  fetchDesktopSiteActivity: vi.fn(),
}));

vi.mock("./api-core", () => ({
  request: apiCoreMocks.request,
}));

vi.mock("./desktop-transport", () => desktopTransportMocks);

vi.mock("./desktop-workspace", () => ({
  ...desktopWorkspaceMocks,
}));

vi.mock("./artifacts", () => ({
  buildImageContentUrl: vi.fn(() => "/content"),
  buildImagePreviewUrl: vi.fn(() => "/preview"),
}));

describe("local-workspace-runtime desktop routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(false);
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(false);
  });

  it("uses the desktop patient mutation when the desktop workspace transport is available", async () => {
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(true);
    desktopWorkspaceMocks.createDesktopPatient.mockResolvedValue({
      patient_id: "17452298",
      created_by_user_id: "user_admin",
      sex: "female",
      age: 87,
      chart_alias: "",
      local_case_code: "",
      created_at: "2026-03-21T00:00:00Z",
    });

    const mod = await import("./local-workspace-runtime");

    await mod.createWorkspacePatient("39100103", "desktop-token", {
      patient_id: "17452298",
      sex: "female",
      age: 87,
    });

    expect(desktopWorkspaceMocks.createDesktopPatient).toHaveBeenCalledWith("39100103", "desktop-token", {
      patient_id: "17452298",
      sex: "female",
      age: 87,
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop case-history reader when the desktop workspace transport is available", async () => {
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(true);
    desktopWorkspaceMocks.fetchDesktopCaseHistory.mockResolvedValue({
      validations: [],
      contributions: [],
    });

    const mod = await import("./local-workspace-runtime");

    await mod.fetchWorkspaceCaseHistory("39100103", "17452298", "Initial", "desktop-token");

    expect(desktopWorkspaceMocks.fetchDesktopCaseHistory).toHaveBeenCalledWith("39100103", "17452298", "Initial", {
      signal: undefined,
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop case summaries reader when the desktop workspace transport is available", async () => {
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(true);
    desktopWorkspaceMocks.fetchDesktopCases.mockResolvedValue([]);

    const mod = await import("./local-workspace-runtime");

    await mod.fetchWorkspaceCases("39100103", "desktop-token", { mine: true });

    expect(desktopWorkspaceMocks.fetchDesktopCases).toHaveBeenCalledWith("39100103", "desktop-token", {
      mine: true,
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });

  it("uses the desktop site activity reader when the desktop workspace transport is available", async () => {
    desktopWorkspaceMocks.canUseDesktopWorkspaceTransport.mockReturnValue(true);
    desktopWorkspaceMocks.fetchDesktopSiteActivity.mockResolvedValue({
      pending_updates: 0,
      recent_validations: [],
      recent_contributions: [],
      contribution_leaderboard: null,
    });

    const mod = await import("./local-workspace-runtime");

    await mod.fetchWorkspaceSiteActivity("39100103", "desktop-token");

    expect(desktopWorkspaceMocks.fetchDesktopSiteActivity).toHaveBeenCalledWith("39100103", "desktop-token", {
      signal: undefined,
    });
    expect(apiCoreMocks.request).not.toHaveBeenCalled();
  });
});
