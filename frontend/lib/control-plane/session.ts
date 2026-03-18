import { jwtVerify, SignJWT } from "jose";
import { NextRequest } from "next/server";

import { controlPlaneSessionSecret } from "./config";

const SESSION_COOKIE = "kera_cp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(controlPlaneSessionSecret());
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionUserId(request: NextRequest): Promise<string | null> {
  const bearer = request.headers.get("authorization");
  const candidate =
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : "") ||
    request.cookies.get(SESSION_COOKIE)?.value ||
    "";
  if (!candidate) {
    return null;
  }
  try {
    const verified = await jwtVerify(candidate, secretKey());
    return verified.payload.sub || null;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export const controlPlaneSessionCookieName = SESSION_COOKIE;
