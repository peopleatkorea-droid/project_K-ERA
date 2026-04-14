import { NextResponse } from "next/server";

import { clearMainAppAuthCookie } from "../../../../../lib/control-plane/http";
import { controlPlaneSessionCookieName, sessionCookieOptions } from "../../../../../lib/control-plane/session";

export async function POST() {
  const response = clearMainAppAuthCookie(NextResponse.json({ ok: true }));
  response.cookies.set(controlPlaneSessionCookieName, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
