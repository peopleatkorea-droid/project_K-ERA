import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHasDesktopRuntime = vi.fn(() => true);
const mockGetVersion = vi.fn(async () => "1.0.0");
const mockCheck = vi.fn();
const mockRelaunch = vi.fn();

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: mockHasDesktopRuntime,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

describe("checkDesktopForUpdates", () => {
  beforeEach(() => {
    mockHasDesktopRuntime.mockReturnValue(true);
    mockGetVersion.mockResolvedValue("1.0.0");
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Tauri updater when a native update handle is available", async () => {
    mockCheck.mockResolvedValue({
      version: "1.1.0",
      currentVersion: "1.0.0",
      date: "2026-03-22T00:00:00.000Z",
      body: "Desktop fixes",
      downloadAndInstall: vi.fn(),
    });

    const { checkDesktopForUpdates } = await import("./desktop-updater");
    const result = await checkDesktopForUpdates();

    expect(result).toMatchObject({
      available: true,
      availableVersion: "1.1.0",
      currentVersion: "1.0.0",
      installable: true,
      source: "plugin",
    });
  });

  it("falls back to the latest GitHub release when the native updater is unavailable", async () => {
    mockCheck.mockRejectedValue(new Error("Updater endpoint returned 404."));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tag_name: "v1.2.0",
            body: "Release notes",
            html_url: "https://github.com/peopleatkorea-droid/project_K-ERA/releases/tag/v1.2.0",
            published_at: "2026-03-22T00:00:00.000Z",
            assets: [
              {
                name: "K-ERA-Desktop-1.2.0-x64.msi",
                browser_download_url: "https://github.com/peopleatkorea-droid/project_K-ERA/releases/download/v1.2.0/K-ERA-Desktop-1.2.0-x64.msi",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { checkDesktopForUpdates } = await import("./desktop-updater");
    const result = await checkDesktopForUpdates();

    expect(result).toMatchObject({
      available: true,
      availableVersion: "1.2.0",
      currentVersion: "1.0.0",
      installable: false,
      source: "github",
      downloadUrl:
        "https://github.com/peopleatkorea-droid/project_K-ERA/releases/download/v1.2.0/K-ERA-Desktop-1.2.0-x64.msi",
      error: "Updater endpoint returned 404.",
    });
  });

  it("relaunches the desktop app after installing a native update", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);

    const { installDesktopUpdate } = await import("./desktop-updater");
    const result = await installDesktopUpdate({
      version: "1.1.0",
      currentVersion: "1.0.0",
      date: "2026-03-22T00:00:00.000Z",
      body: "Desktop fixes",
      downloadAndInstall,
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
    expect(result).toBe("relaunched");
  });
});
