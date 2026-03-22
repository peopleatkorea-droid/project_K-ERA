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
      .mockResolvedValueOnce({ healthy: false });

    const mod = await import("./desktop-diagnostics");

    await mod.ensureDesktopLocalWorkerReady();
    await mod.stopDesktopLocalWorker();
    await mod.ensureDesktopLocalRuntimeReady();
    await mod.stopDesktopLocalRuntime();

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(1, "ensure_local_worker", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(2, "stop_local_worker", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(3, "ensure_local_runtime", {}, undefined);
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(4, "stop_local_runtime", {}, undefined);
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
    });
    expect(desktopIpcMocks.invokeDesktop).not.toHaveBeenCalled();
  });
});
