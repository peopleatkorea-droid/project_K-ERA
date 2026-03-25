import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
}));

const diagnosticsMocks = vi.hoisted(() => ({
  fetchDesktopNodeStatus: vi.fn(),
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
}));

vi.mock("./desktop-diagnostics", () => ({
  fetchDesktopNodeStatus: diagnosticsMocks.fetchDesktopNodeStatus,
}));

describe("desktop-control-plane-status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("derives a ready state from configured bootstrap data", async () => {
    const mod = await import("./desktop-control-plane-status");

    expect(
      mod.deriveDesktopControlPlaneProbe({
        control_plane: {
          configured: true,
          node_sync_enabled: true,
          base_url: "https://example.org/control-plane/api",
          node_id: "node_1",
        },
        bootstrap: { site: { site_id: "SITE_A" } },
      }),
    ).toMatchObject({
      state: "ready",
      configured: true,
      nodeSyncEnabled: true,
      bootstrapReady: true,
      baseUrl: "https://example.org/control-plane/api",
      nodeId: "node_1",
    });
  });

  it("marks an unconfigured node separately", async () => {
    const mod = await import("./desktop-control-plane-status");

    expect(
      mod.deriveDesktopControlPlaneProbe({
        control_plane: {
          configured: false,
          node_sync_enabled: false,
        },
        bootstrap: null,
      }),
    ).toMatchObject({
      state: "not_configured",
      configured: false,
      nodeSyncEnabled: false,
      bootstrapReady: false,
    });
  });

  it("forces a refreshed node-status probe on desktop", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    diagnosticsMocks.fetchDesktopNodeStatus.mockResolvedValue({
      control_plane: {
        configured: true,
        node_sync_enabled: true,
      },
      bootstrap: { ok: true },
    });

    const mod = await import("./desktop-control-plane-status");

    await expect(mod.probeDesktopControlPlaneStatus()).resolves.toMatchObject({
      state: "ready",
    });
    expect(diagnosticsMocks.fetchDesktopNodeStatus).toHaveBeenCalledWith({
      signal: undefined,
      forceRefresh: true,
    });
  });
});
