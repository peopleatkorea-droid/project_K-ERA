import { NextResponse } from "next/server";

import { controlPlaneSessionCookieName, sessionCookieOptions } from "../../../../../lib/control-plane/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(controlPlaneSessionCookieName, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
