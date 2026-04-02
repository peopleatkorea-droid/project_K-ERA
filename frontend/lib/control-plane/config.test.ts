import { afterEach, describe, expect, it, vi } from "vitest";

describe("controlPlaneDatabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefers the dedicated control plane database url", async () => {
    vi.stubEnv("KERA_CONTROL_PLANE_DATABASE_URL", "postgresql://control-plane");
    vi.stubEnv("KERA_DATABASE_URL", "postgresql://legacy");

    const { controlPlaneDatabaseUrl } = await import("./config");

    expect(controlPlaneDatabaseUrl()).toBe("postgresql://control-plane");
  });

  it("prefers the local control plane cache when configured", async () => {
    vi.stubEnv("KERA_LOCAL_CONTROL_PLANE_DATABASE_URL", "sqlite:///control-plane-cache.db");
    vi.stubEnv("KERA_CONTROL_PLANE_DATABASE_URL", "postgresql://control-plane");

    const { controlPlaneDatabaseUrl } = await import("./config");

    expect(controlPlaneDatabaseUrl()).toBe("sqlite:///control-plane-cache.db");
  });

  it("falls back to the legacy shared database url", async () => {
    vi.stubEnv("KERA_DATABASE_URL", "postgresql://legacy-shared");

    const { controlPlaneDatabaseUrl } = await import("./config");

    expect(controlPlaneDatabaseUrl()).toBe("postgresql://legacy-shared");
  });

  it("disables the legacy control-plane sandbox by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { controlPlaneSandboxEnabled } = await import("./config");

    expect(controlPlaneSandboxEnabled()).toBe(false);
  });

  it("keeps the legacy control-plane sandbox enabled by default in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { controlPlaneSandboxEnabled } = await import("./config");

    expect(controlPlaneSandboxEnabled()).toBe(true);
  });

  it("allows an explicit sandbox override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KERA_CONTROL_PLANE_SANDBOX", "true");

    const { controlPlaneSandboxEnabled } = await import("./config");

    expect(controlPlaneSandboxEnabled()).toBe(true);
  });
});
