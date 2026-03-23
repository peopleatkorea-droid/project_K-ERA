import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canUseDesktopGoogleAuth,
  parseDesktopGoogleBrowserRedirectUrl,
  parseDesktopGoogleRedirectUrl,
} from "./desktop-google-auth";

describe("desktop google auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__;
  });

  it("uses desktop auth whenever the Tauri runtime is available", () => {
    expect(canUseDesktopGoogleAuth()).toBe(false);
    (window as typeof window & { __TAURI__?: unknown }).__TAURI__ = {};
    expect(canUseDesktopGoogleAuth()).toBe(true);
  });

  it("parses a valid Google redirect URL", () => {
    expect(parseDesktopGoogleRedirectUrl("http://127.0.0.1:44556/?code=test-code&state=state-token", 44556, "state-token")).toEqual({
      code: "test-code",
      state: "state-token",
    });
  });

  it("rejects redirect URLs with the wrong state", () => {
    expect(() =>
      parseDesktopGoogleRedirectUrl("http://127.0.0.1:44556/?code=test-code&state=wrong-state", 44556, "state-token"),
    ).toThrow("Google OAuth state mismatch.");
  });

  it("parses a valid browser bridge redirect URL", () => {
    expect(
      parseDesktopGoogleBrowserRedirectUrl(
        "http://127.0.0.1:44556/desktop-google-login?credential=test-id-token&state=bridge-state",
        44556,
        "bridge-state",
      ),
    ).toEqual({
      idToken: "test-id-token",
      state: "bridge-state",
    });
  });
});
