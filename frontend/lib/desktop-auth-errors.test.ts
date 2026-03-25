import { describe, expect, it } from "vitest";

import { describeDesktopGoogleLoginError } from "./desktop-auth-errors";

describe("desktop-auth-errors", () => {
  it("maps desktop Google auth misconfiguration to a user-facing unavailable message", () => {
    expect(
      describeDesktopGoogleLoginError(
        "en",
        new Error("Desktop Google OAuth is not configured. Set KERA_GOOGLE_DESKTOP_CLIENT_ID."),
        "Login failed.",
      ),
    ).toBe(
      "Google sign-in is currently unavailable. Confirm the desktop Google sign-in setup in the control plane.",
    );
  });

  it("translates generic Google login errors when they are not desktop capability issues", () => {
    expect(
      describeDesktopGoogleLoginError("ko", new Error("Google token verification failed."), "로그인에 실패했습니다."),
    ).toBe("Google 토큰 검증에 실패했습니다.");
  });
});
