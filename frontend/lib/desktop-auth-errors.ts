"use client";

import { pick, translateApiError, type Locale } from "./i18n";

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return String((error as { message: string }).message);
  }
  return "";
}

function looksLikeGoogleDesktopAuthMisconfiguration(message: string) {
  return [
    "Google authentication is not configured on the server.",
    "Desktop Google OAuth is not configured.",
    "Desktop Google OAuth configuration changed.",
    "Local API request failed (404).",
  ].some((needle) => message.includes(needle));
}

export function describeDesktopGoogleLoginError(locale: Locale, error: unknown, fallback: string) {
  const message = extractErrorMessage(error).trim();
  if (message && looksLikeGoogleDesktopAuthMisconfiguration(message)) {
    return pick(
      locale,
      "Google sign-in is currently unavailable. Confirm the desktop Google sign-in setup in the control plane.",
      "Google 로그인은 현재 사용할 수 없습니다. 운영 허브에서 desktop Google 로그인 설정을 확인하세요.",
    );
  }
  if (message) {
    return translateApiError(locale, message);
  }
  return fallback;
}
