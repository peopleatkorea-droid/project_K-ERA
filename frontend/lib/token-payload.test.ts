import { afterEach, describe, expect, it, vi } from "vitest";

function toBase64Url(value: string): string {
  return window
    .btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("token payload helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads both user id and role from a JWT payload", async () => {
    const header = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = toBase64Url(JSON.stringify({ sub: "user_admin", role: "admin" }));
    const token = `${header}.${payload}.`;

    const mod = await import("./token-payload");

    expect(mod.readUserIdFromToken(token)).toBe("user_admin");
    expect(mod.readUserRoleFromToken(token)).toBe("admin");
  });
});
