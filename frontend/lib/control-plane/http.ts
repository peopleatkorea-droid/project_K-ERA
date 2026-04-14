import { NextRequest, NextResponse } from "next/server";

import { mainAppAuthCookieName, mainAppAuthCookieOptions } from "./main-app-auth-cookie";
import { controlPlaneSandboxEnabled } from "./config";
import { createSessionToken, readSessionUserId, sessionCookieOptions } from "./session";
import { authenticateNode, getControlPlaneUser } from "./store";
import type { ControlPlaneNode, ControlPlaneUser } from "./types";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ detail: message }, { status });
}

export function clearMainAppAuthCookie<T extends NextResponse>(response: T): T {
  response.cookies.set(mainAppAuthCookieName, "", {
    ...mainAppAuthCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export function authJsonResponse(payload: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(payload, { status });
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (token) {
    response.cookies.set(mainAppAuthCookieName, token, mainAppAuthCookieOptions());
  }
  return response;
}

function assertControlPlaneSandboxEnabled(): void {
  if (!controlPlaneSandboxEnabled()) {
    throw new Error("Legacy control-plane sandbox is disabled.");
  }
}

export async function sessionResponse(userId: string, payload: Record<string, unknown>) {
  assertControlPlaneSandboxEnabled();
  const token = await createSessionToken(userId);
  const response = NextResponse.json(
    {
      access_token: token,
      token_type: "bearer",
      ...payload,
    },
    { status: 200 },
  );
  response.cookies.set("kera_cp_session", token, sessionCookieOptions());
  return response;
}

export async function requireControlPlaneUser(request: NextRequest): Promise<ControlPlaneUser> {
  assertControlPlaneSandboxEnabled();
  const userId = await readSessionUserId(request);
  if (!userId) {
    throw new Error("Authentication required.");
  }
  const user = await getControlPlaneUser(userId);
  if (!user) {
    throw new Error("Authenticated user no longer exists.");
  }
  if (user.status !== "active") {
    throw new Error("This account is disabled.");
  }
  return user;
}

export async function requireControlPlaneNode(request: NextRequest): Promise<ControlPlaneNode> {
  assertControlPlaneSandboxEnabled();
  const nodeId = request.headers.get("x-kera-node-id")?.trim() || "";
  const nodeToken = request.headers.get("x-kera-node-token")?.trim() || "";
  if (!nodeId || !nodeToken) {
    throw new Error("Node credentials are required.");
  }
  const node = await authenticateNode(nodeId, nodeToken);
  if (!node) {
    throw new Error("Invalid node credentials.");
  }
  return node;
}
