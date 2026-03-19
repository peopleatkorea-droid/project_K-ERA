import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { jwtVerify, SignJWT } from "jose";
import { NextRequest } from "next/server";
import type { Row } from "postgres";

import type { AuthResponse, AuthState, AuthUser } from "../types";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import type { ControlPlaneSiteRole } from "./types";

export const DEFAULT_PROJECT_ID = "project_default";
export const DEFAULT_PROJECT_NAME = "K-ERA Default Project";
export const HIRA_SITE_ID_PATTERN = /^\d{8}$/;

const LOCAL_TOKEN_TTL_HOURS = 2;
const LOCAL_OWNER_PREFERENCE_HEADER = "x-kera-control-plane-owner";
const LOCAL_OWNER_PREFERENCE_VALUE = "local";

type LocalMainAppUser = AuthUser;

export type MainAppTokenClaims = {
  sub?: string | null;
  username?: string | null;
  full_name?: string | null;
  public_alias?: string | null;
  role?: string | null;
  site_ids?: string[] | null;
  approval_status?: AuthState | null;
  registry_consents?: Record<string, { enrolled_at: string; version?: string }> | null;
};

export function rowValue<T>(row: Row, key: string): T {
  return row[key] as T;
}

export function trimText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeSiteIdPreservingCase(value: string): string {
  const trimmed = value.trim();
  return trimmed || makeControlPlaneId("site");
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => trimText(entry))
        .filter(Boolean),
    ),
  );
}

export function normalizeRegistryConsents(value: unknown): Record<string, { enrolled_at: string; version?: string }> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const next: Record<string, { enrolled_at: string; version?: string }> = {};
  for (const [siteId, rawConsent] of Object.entries(value as Record<string, unknown>)) {
    if (!rawConsent || typeof rawConsent !== "object") {
      continue;
    }
    const consent = rawConsent as Record<string, unknown>;
    const enrolledAt = trimText(consent.enrolled_at);
    if (!enrolledAt) {
      continue;
    }
    const version = trimText(consent.version);
    next[trimText(siteId)] = version ? { enrolled_at: enrolledAt, version } : { enrolled_at: enrolledAt };
  }
  return next;
}

export function legacyEmailForLocalUser(user: LocalMainAppUser): string {
  const username = trimText(user.username).toLowerCase();
  if (username.includes("@")) {
    return normalizeEmail(username);
  }
  return normalizeEmail(`${username || user.user_id}@local.invalid`);
}

export function mapLegacyRoleToMembershipRole(role: string): ControlPlaneSiteRole {
  const normalized = trimText(role).toLowerCase();
  if (normalized === "site_admin" || normalized === "admin") {
    return "site_admin";
  }
  if (normalized === "viewer") {
    return "viewer";
  }
  return "member";
}

export function mapMembershipRoleToLegacyRole(role: ControlPlaneSiteRole): AuthUser["role"] {
  if (role === "site_admin") {
    return "site_admin";
  }
  if (role === "viewer") {
    return "viewer";
  }
  return "researcher";
}

function nextJsonErrorDetail(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function resolveLocalNodeApiBaseUrl(request: NextRequest): string {
  const configured =
    process.env.KERA_LOCAL_NODE_API_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  const host = request.nextUrl.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://${host}:8000`;
  }
  return "http://127.0.0.1:8000";
}

export async function fetchLocalNodeApi<T>(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${resolveLocalNodeApiBaseUrl(request)}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try {
      detail = nextJsonErrorDetail(await response.json(), detail);
    } catch {
      detail = (await response.text()) || detail;
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function fetchLegacyLocalNodeApi<T>(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(LOCAL_OWNER_PREFERENCE_HEADER, LOCAL_OWNER_PREFERENCE_VALUE);
  return fetchLocalNodeApi<T>(request, path, { ...init, headers }, token);
}

export function readBearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing bearer token.");
  }
  const token = authorization.slice("bearer ".length).trim();
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return token;
}

function localApiSecretKey(): Uint8Array {
  const secret = loadLocalApiSecret();
  if (!secret) {
    throw new Error("KERA_API_SECRET is not available to verify local access tokens.");
  }
  return new TextEncoder().encode(secret);
}

export async function readMainAppTokenClaims(request: NextRequest): Promise<MainAppTokenClaims> {
  const token = readBearerToken(request);
  try {
    const verified = await jwtVerify(token, localApiSecretKey());
    return {
      sub: typeof verified.payload.sub === "string" ? verified.payload.sub : null,
      username: typeof verified.payload.username === "string" ? verified.payload.username : null,
      full_name: typeof verified.payload.full_name === "string" ? verified.payload.full_name : null,
      public_alias: typeof verified.payload.public_alias === "string" ? verified.payload.public_alias : null,
      role: typeof verified.payload.role === "string" ? verified.payload.role : null,
      site_ids: normalizeStringArray(verified.payload.site_ids),
      approval_status:
        typeof verified.payload.approval_status === "string"
          ? (verified.payload.approval_status as AuthState)
          : null,
      registry_consents: normalizeRegistryConsents(verified.payload.registry_consents),
    };
  } catch {
    throw new Error("Authentication required.");
  }
}

let cachedLocalApiSecret: string | null | undefined;

function loadLocalApiSecret(): string {
  if (cachedLocalApiSecret !== undefined) {
    return cachedLocalApiSecret || "";
  }
  const envSecret = trimText(process.env.KERA_API_SECRET);
  if (envSecret) {
    cachedLocalApiSecret = envSecret;
    return envSecret;
  }
  const cwd = process.cwd();
  const candidates = [
    resolvePath(cwd, "..", "KERA_DATA", "kera_secret.key"),
    resolvePath(cwd, "KERA_DATA", "kera_secret.key"),
    resolvePath(cwd, "..", "..", "KERA_DATA", "kera_secret.key"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const value = readFileSync(candidate, "utf-8").trim();
    if (value) {
      cachedLocalApiSecret = value;
      return value;
    }
  }
  cachedLocalApiSecret = "";
  return "";
}

export async function buildLocalAuthResponse(user: AuthUser): Promise<AuthResponse> {
  const secret = loadLocalApiSecret();
  if (!secret) {
    throw new Error("KERA_API_SECRET is not available to mint local access tokens.");
  }
  const token = await new SignJWT({
    sub: user.user_id,
    username: user.username,
    full_name: user.full_name,
    public_alias: user.public_alias ?? null,
    role: user.role,
    site_ids: user.site_ids ?? [],
    approval_status: user.approval_status,
    registry_consents: normalizeRegistryConsents(user.registry_consents),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_TOKEN_TTL_HOURS}h`)
    .sign(new TextEncoder().encode(secret));
  return {
    auth_state: user.approval_status,
    access_token: token,
    token_type: "bearer",
    user,
  };
}
