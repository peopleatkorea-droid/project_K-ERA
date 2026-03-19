import { afterEach, describe, expect, it, vi } from "vitest";

describe("controlPlaneDatabaseUrl", () => {
  afterEach(() => {
    delete process.env.KERA_CONTROL_PLANE_DATABASE_URL;
    delete process.env.KERA_AUTH_DATABASE_URL;
    delete process.env.KERA_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    vi.resetModules();
  });

  it("prefers the dedicated control plane database url", async () => {
    process.env.KERA_CONTROL_PLANE_DATABASE_URL = "postgresql://control-plane";
    process.env.KERA_DATABASE_URL = "postgresql://legacy";

    const { controlPlaneDatabaseUrl } = await import("./config");

    expect(controlPlaneDatabaseUrl()).toBe("postgresql://control-plane");
  });

  it("falls back to the legacy shared database url", async () => {
    process.env.KERA_DATABASE_URL = "postgresql://legacy-shared";

    const { controlPlaneDatabaseUrl } = await import("./config");

    expect(controlPlaneDatabaseUrl()).toBe("postgresql://legacy-shared");
  });
});
