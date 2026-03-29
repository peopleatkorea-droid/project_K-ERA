import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  clearDesktopFileSrcCache: vi.fn(),
  convertDesktopFilePath: vi.fn(),
  hasDesktopRuntime: vi.fn(() => true),
  invokeDesktop: vi.fn(),
  throwIfAborted: vi.fn(),
}));

const desktopTransportMocks = vi.hoisted(() => ({
  clearDesktopTransportCaches: vi.fn(),
}));

const tokenPayloadMocks = vi.hoisted(() => ({
  readUserIdFromToken: vi.fn(() => "user_desktop"),
  readUserRoleFromToken: vi.fn(() => "admin"),
}));

vi.mock("./desktop-ipc", () => ({
  clearDesktopFileSrcCache: desktopIpcMocks.clearDesktopFileSrcCache,
  convertDesktopFilePath: desktopIpcMocks.convertDesktopFilePath,
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
  throwIfAborted: desktopIpcMocks.throwIfAborted,
}));

vi.mock("./desktop-transport", () => ({
  clearDesktopTransportCaches: desktopTransportMocks.clearDesktopTransportCaches,
}));

vi.mock("./token-payload", () => ({
  readUserIdFromToken: tokenPayloadMocks.readUserIdFromToken,
  readUserRoleFromToken: tokenPayloadMocks.readUserRoleFromToken,
}));

describe("desktop workspace upload transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    tokenPayloadMocks.readUserIdFromToken.mockReturnValue("user_desktop");
    tokenPayloadMocks.readUserRoleFromToken.mockReturnValue("admin");
  });

  it("sends upload bytes as a Uint8Array instead of expanding them into a number array", async () => {
    desktopIpcMocks.invokeDesktop.mockResolvedValue({
      image_id: "image_1",
      visit_id: "visit_1",
      patient_id: "16547845",
      visit_date: "Initial",
      view: "white_light",
      image_path: "C:\\\\KERA_DATA\\\\sites\\\\39100103\\\\raw\\\\16547845\\\\Initial\\\\image_1.png",
      content_url: "asset://image_1",
      preview_url: "asset://image_1_preview",
      is_representative: true,
      uploaded_at: "2026-03-29T00:00:00Z",
    });

    const mod = await import("./desktop-workspace");
    const file = {
      name: "slit-lamp.png",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
    } as unknown as File;

    await mod.uploadDesktopImage("39100103", "desktop-token", {
      patient_id: "16547845",
      visit_date: "Initial",
      view: "white_light",
      is_representative: true,
      file,
    });

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenCalledTimes(1);
    const uploadArgs = desktopIpcMocks.invokeDesktop.mock.calls[0]?.[1] as {
      payload: { bytes: Uint8Array; file_name: string };
    };
    expect(uploadArgs.payload.file_name).toBe("slit-lamp.png");
    expect(uploadArgs.payload.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.isArray(uploadArgs.payload.bytes)).toBe(false);
    expect(Array.from(uploadArgs.payload.bytes)).toEqual([1, 2, 3, 4]);
  });
});
