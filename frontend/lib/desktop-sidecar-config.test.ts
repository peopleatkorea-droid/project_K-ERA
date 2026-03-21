import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
  invokeDesktop: vi.fn(),
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
}));

describe("desktop-sidecar-config", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT;
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("defaults to sidecar transport on desktop", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);

    const mod = await import("./desktop-sidecar-config");

    expect(mod.resolveDesktopMlTransport()).toBe("sidecar");
    expect(mod.describeDesktopMlRuntime()).toEqual({
      runtime: "desktop",
      transport: "sidecar",
    });
  });

  it("returns a web runtime status outside desktop", async () => {
    const mod = await import("./desktop-sidecar-config");

    await expect(mod.fetchDesktopMlBackendStatus()).resolves.toMatchObject({
      transport: "http",
      mode: "external",
      running: false,
      healthy: false,
      launched_by_desktop: false,
    });
    expect(desktopIpcMocks.invokeDesktop).not.toHaveBeenCalled();
  });

  it("uses desktop IPC for backend ensure/status/stop", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop
      .mockResolvedValueOnce({ managed: true, healthy: false })
      .mockResolvedValueOnce({ managed: true, healthy: true })
      .mockResolvedValueOnce({ managed: true, healthy: false });

    const mod = await import("./desktop-sidecar-config");

    await mod.fetchDesktopMlBackendStatus();
    await mod.ensureDesktopMlBackendReady();
    await mod.stopDesktopMlBackend();

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "get_ml_sidecar_status", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "ensure_ml_sidecar", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(3, "stop_ml_sidecar", {}, undefined);
  });

  it("falls back to local backend commands when desktop transport is forced to http", async () => {
    process.env.NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT = "http";
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop
      .mockResolvedValueOnce({ managed: false, healthy: false })
      .mockResolvedValueOnce({ managed: false, healthy: true })
      .mockResolvedValueOnce({ managed: false, healthy: false });

    const mod = await import("./desktop-sidecar-config");

    await mod.fetchDesktopMlBackendStatus();
    await mod.ensureDesktopMlBackendReady();
    await mod.stopDesktopMlBackend();

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "get_local_backend_status", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "ensure_local_backend", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(3, "stop_local_backend", {}, undefined);
  });
});
