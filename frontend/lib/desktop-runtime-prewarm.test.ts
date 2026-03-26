import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
}));

const diagnosticsMocks = vi.hoisted(() => ({
  ensureDesktopLocalWorkerReady: vi.fn(),
}));

const sidecarMocks = vi.hoisted(() => ({
  ensureDesktopMlBackendReady: vi.fn(),
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
}));

vi.mock("./desktop-diagnostics", () => ({
  ensureDesktopLocalWorkerReady: diagnosticsMocks.ensureDesktopLocalWorkerReady,
}));

vi.mock("./desktop-sidecar-config", () => ({
  ensureDesktopMlBackendReady: sidecarMocks.ensureDesktopMlBackendReady,
}));

describe("desktop-runtime-prewarm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("dedupes concurrent worker prewarm calls", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    const resolveWorkerRef: { current: (() => void) | null } = { current: null };
    diagnosticsMocks.ensureDesktopLocalWorkerReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWorkerRef.current = resolve;
        }),
    );

    const mod = await import("./desktop-runtime-prewarm");
    const first = mod.prewarmDesktopWorker();
    const second = mod.prewarmDesktopWorker();

    expect(diagnosticsMocks.ensureDesktopLocalWorkerReady).toHaveBeenCalledTimes(1);
    resolveWorkerRef.current?.();
    await Promise.all([first, second]);
  });

  it("dedupes concurrent ML prewarm calls", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    const resolveMlRef: { current: (() => void) | null } = { current: null };
    sidecarMocks.ensureDesktopMlBackendReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMlRef.current = resolve;
        }),
    );

    const mod = await import("./desktop-runtime-prewarm");
    const first = mod.prewarmDesktopMlBackend();
    const second = mod.prewarmDesktopMlBackend();

    expect(sidecarMocks.ensureDesktopMlBackendReady).toHaveBeenCalledTimes(1);
    resolveMlRef.current?.();
    await Promise.all([first, second]);
  });

  it("stays idle outside desktop", async () => {
    const mod = await import("./desktop-runtime-prewarm");

    await mod.prewarmDesktopWorker();
    await mod.prewarmDesktopMlBackend();

    expect(diagnosticsMocks.ensureDesktopLocalWorkerReady).not.toHaveBeenCalled();
    expect(sidecarMocks.ensureDesktopMlBackendReady).not.toHaveBeenCalled();
  });
});
