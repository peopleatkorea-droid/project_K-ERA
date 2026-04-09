import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(() => false),
  invokeDesktop: vi.fn(),
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
}));

describe("desktop-app-config", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  it("returns the web fallback outside desktop", async () => {
    const mod = await import("./desktop-app-config");

    await expect(mod.fetchDesktopAppConfig()).resolves.toMatchObject({
      runtime: "web",
      setup_ready: false,
      runtime_contract: {
        disk_notice: null,
      },
    });
    expect(desktopIpcMocks.invokeDesktop).not.toHaveBeenCalled();
  });

  it("uses desktop IPC for directory picking", async () => {
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.invokeDesktop.mockResolvedValue("C:\\KERA_DATA");

    const mod = await import("./desktop-app-config");
    const result = await mod.pickDesktopDirectory({
      title: "Choose storage root",
      defaultPath: "C:\\Users\\USER\\AppData\\Local\\KERA\\KERA_DATA",
    });

    expect(result).toBe("C:\\KERA_DATA");
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledWith(
      "pick_desktop_directory",
      {
        payload: {
          title: "Choose storage root",
          default_path: "C:\\Users\\USER\\AppData\\Local\\KERA\\KERA_DATA",
        },
      },
      undefined,
    );
  });
});
