// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "../types";

vi.mock("server-only", () => ({}));

describe("main-app-bridge-shared local auth secret", () => {
  beforeEach(() => {
    delete process.env.KERA_LOCAL_API_JWT_PRIVATE_KEY_B64;
    delete process.env.KERA_LOCAL_API_JWT_PUBLIC_KEY_B64;
    delete process.env.KERA_LOCAL_API_JWT_SECRET;
    delete process.env.KERA_API_SECRET;
    delete process.env.KERA_LOCAL_API_JWT_AUDIENCE;
    delete process.env.KERA_LOCAL_API_JWT_ISSUER;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.KERA_LOCAL_API_JWT_PRIVATE_KEY_B64;
    delete process.env.KERA_LOCAL_API_JWT_PUBLIC_KEY_B64;
    delete process.env.KERA_LOCAL_API_JWT_SECRET;
    delete process.env.KERA_API_SECRET;
    delete process.env.KERA_LOCAL_API_JWT_AUDIENCE;
    delete process.env.KERA_LOCAL_API_JWT_ISSUER;
    vi.resetModules();
  });

  it("uses RS256 key material to mint and verify control-plane access tokens", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.KERA_LOCAL_API_JWT_PRIVATE_KEY_B64 = Buffer.from(privateKey, "utf8").toString("base64");
    process.env.KERA_LOCAL_API_JWT_PUBLIC_KEY_B64 = Buffer.from(publicKey, "utf8").toString("base64");

    const { buildLocalAuthResponse, readMainAppTokenClaims } = await import("./main-app-bridge-shared");

    const auth = await buildLocalAuthResponse({
      user_id: "user_rs256",
      username: "rs256",
      full_name: "RS256 User",
      role: "researcher",
      site_ids: ["SITE_RSA"],
      approval_status: "approved",
      public_alias: null,
      registry_consents: {},
    });
    const claims = await readMainAppTokenClaims({
      headers: new Headers({
        authorization: `Bearer ${auth.access_token}`,
      }),
    } as never);

    expect(claims.sub).toBe("user_rs256");
    expect(claims.username).toBe("rs256");
    expect(claims.site_ids).toEqual(["SITE_RSA"]);
    expect(claims.approval_status).toBe("approved");
  });

  it("falls back to HS256 when RSA key material is not configured", async () => {
    process.env.KERA_LOCAL_API_JWT_SECRET = "desktop-shared-secret";

    const { buildLocalAuthResponse, readMainAppTokenClaims } = await import("./main-app-bridge-shared");

    const user: AuthUser = {
      user_id: "user_missing_key",
      username: "desktop",
      full_name: "Desktop User",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
      public_alias: null,
      registry_consents: {},
    };

    const auth = await buildLocalAuthResponse(user);
    const claims = await readMainAppTokenClaims({
      headers: new Headers({
        authorization: `Bearer ${auth.access_token}`,
      }),
    } as never);

    expect(claims.sub).toBe("user_missing_key");
    expect(claims.username).toBe("desktop");
  });

  it("throws when neither RSA key material nor shared secret is configured", async () => {
    const { buildLocalAuthResponse } = await import("./main-app-bridge-shared");

    await expect(
      buildLocalAuthResponse({
        user_id: "user_missing_key",
        username: "desktop",
        full_name: "Desktop User",
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
        public_alias: null,
        registry_consents: {},
      }),
    ).rejects.toThrow("KERA_LOCAL_API_JWT_PRIVATE_KEY_B64 is not available to mint control-plane access tokens.");
  });
});
