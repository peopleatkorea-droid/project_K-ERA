import "server-only";

export const mainAppAuthCookieName = "kera_web_token";

const MAIN_APP_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 2;

export function mainAppAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAIN_APP_AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}
