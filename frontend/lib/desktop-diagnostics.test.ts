import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
  invokeDesktop: vi.fn(),
}));

const sidecarMocks = vi.hoisted(() => ({
  ensureDesktopMlBackendReady: vi.fn(),
  fetchDesktopMlBackendStatus: vi.fn(),
  stopDesktopMlBackend: vi.fn(),
}));

const localApiMocks = vi.hoisted(() => ({
  requestDesktopLocalApiJson: vi.fn(),
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
}));

vi.mock("./desktop-sidecar-config", () => ({
  ensureDesktopMlBackendReady: sidecarMocks.ensureDesktopMlBackendReady,
  fetchDesktopMlBackendStatus: sidecarMocks.fetchDesktopMlBackendStatus,
  stopDesktopMlBackend: sidecarMocks.stopDesktopMlBackend,
}));

vi.mock("./desktop-local-api", () => ({
  requestDesktopLocalApiJson: localApiMocks.requestDesktopLocalApiJson,
}));

describe("desktop-diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("uses desktop IPC for worker and full runtime commands", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop
      .mockResolvedValueOnce({ running: true })
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce({ healthy: true })
      .mockResolvedValueOnce({ healthy: false })
      .mockResolvedValueOnce({ healthy: true })
      .mockResolvedValueOnce({ healthy: false });

    const mod = await import("./desktop-diagnostics");

    await mod.ensureDesktopLocalWorkerReady();
    await mod.stopDesktopLocalWorker();
    await mod.ensureDesktopLocalBackendReady();
    await mod.stopDesktopLocalBackend();
    await mod.ensureDesktopLocalRuntimeReady();
    await mod.stopDesktopLocalRuntime();

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "ensure_local_worker", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "stop_local_worker", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(3, "ensure_local_backend", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(4, "stop_local_backend", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(5, "ensure_local_runtime", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(6, "stop_local_runtime", {}, undefined);
  });

  it("includes backend capability routes in the diagnostics snapshot", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    sidecarMocks.fetchDesktopMlBackendStatus.mockResolvedValue({ healthy: true });
    desktopIpcMocks.invokeDesktop
      .mockResolvedValueOnce({ healthy: true })
      .mockResolvedValueOnce({ running: true });
    localApiMocks.requestDesktopLocalApiJson
      .mockResolvedValueOnce({ control_plane: { configured: true } })
      .mockResolvedValueOnce({
        paths: {
          "/api/auth/desktop/start": {},
          "/api/auth/desktop/exchange": {},
          "/api/desktop/self-check": {},
        },
      });

    const mod = await import("./desktop-diagnostics");

    await expect(mod.fetchDesktopDiagnosticsSnapshot()).resolves.toMatchObject({
      runtime: "desktop",
      backendCapabilities: {
        desktopAuthRoutes: true,
        selfCheckRoute: true,
      },
      backendCapabilitiesError: null,
    });
  });

  it("can force a refreshed control-plane node-status probe", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    localApiMocks.requestDesktopLocalApiJson.mockResolvedValue({ control_plane: { configured: true } });

    const mod = await import("./desktop-diagnostics");

    await mod.fetchDesktopNodeStatus({ forceRefresh: true });

    expect(localApiMocks.requestDesktopLocalApiJson).toHaveBeenCalledWith(
      "/api/control-plane/node/status?refresh=true",
      "",
      {
        signal: undefined,
      },
    );
  });

  it("returns a web snapshot outside desktop", async () => {
    const mod = await import("./desktop-diagnostics");

    await expect(mod.fetchDesktopDiagnosticsSnapshot()).resolves.toEqual({
      runtime: "web",
      localBackend: null,
      localWorker: null,
      mlBackend: null,
      nodeStatus: null,
      nodeStatusError: null,
      backendCapabilities: null,
      backendCapabilitiesError: null,
    });
    expect(desktopIpcMocks.invokeDesktop).not.toHaveBeenCalled();
  });
});
