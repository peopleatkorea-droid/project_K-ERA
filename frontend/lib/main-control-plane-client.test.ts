import { afterEach, describe, expect, it, vi } from "vitest";

const apiCoreMocks = vi.hoisted(() => ({
  requestSameOrigin: vi.fn(),
}));

vi.mock("./api-core", () => ({
  requestSameOrigin: apiCoreMocks.requestSameOrigin,
}));

describe("mainControlPlanePath", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL;
    vi.resetModules();
  });

  it("defaults to the same-origin control-plane path when no absolute base is configured", async () => {
    const { mainControlPlanePath } = await import("./main-control-plane-client");

    expect(mainControlPlanePath("/admin/overview")).toBe("/control-plane/api/main/admin/overview");
  });

  it("uses the configured absolute control-plane base in desktop builds", async () => {
    process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL = "https://k-era.org/control-plane/api";

    const { mainControlPlanePath } = await import("./main-control-plane-client");

    expect(mainControlPlanePath("/admin/overview")).toBe(
      "https://k-era.org/control-plane/api/main/admin/overview",
    );
  });

  it("uses a control-plane specific unavailable message", async () => {
    apiCoreMocks.requestSameOrigin.mockResolvedValue({});

    const { requestMainControlPlane } = await import("./main-control-plane-client");

    await requestMainControlPlane("/admin/overview", {}, "token-1");

    expect(apiCoreMocks.requestSameOrigin).toHaveBeenCalledWith(
      "/control-plane/api/main/admin/overview",
      {},
      "token-1",
      "Control-plane server is unavailable.",
    );
  });
});
