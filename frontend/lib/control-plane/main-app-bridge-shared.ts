import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { NextRequest } from "next/server";
import type { Row } from "postgres";

import { normalizeEffectiveApprovalStatus, normalizeSiteIds } from "../auth-access-state";
import type { AuthResponse, AuthState, AuthUser } from "../types";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import { mainAppAuthCookieName } from "./main-app-auth-cookie";
import {
  localApiJwtAudience,
  localApiJwtIssuer,
  localApiJwtKeyId,
  localApiJwtPrivateKey,
  localApiJwtPublicKey,
  localApiJwtSharedSecret,
} from "./local-api-jwt";
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
  return trimmed || makeControlPlaneId("site").slice(0, "site_".length + 10);
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
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    if (token) {
      return token;
    }
  }
  const token = request.cookies.get(mainAppAuthCookieName)?.value?.trim() || "";
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return token;
}

export async function readMainAppTokenClaims(request: NextRequest): Promise<MainAppTokenClaims> {
  const token = readBearerToken(request);
  const publicKey = localApiJwtPublicKey();
  if (publicKey) {
    try {
      const verified = await jwtVerify(token, publicKey, {
        algorithms: ["RS256"],
        audience: localApiJwtAudience(),
        issuer: localApiJwtIssuer(),
      });
      const role = typeof verified.payload.role === "string" ? verified.payload.role : null;
      const siteIds = normalizeStringArray(verified.payload.site_ids);
      return {
        sub: typeof verified.payload.sub === "string" ? verified.payload.sub : null,
        username: typeof verified.payload.username === "string" ? verified.payload.username : null,
        full_name: typeof verified.payload.full_name === "string" ? verified.payload.full_name : null,
        public_alias: typeof verified.payload.public_alias === "string" ? verified.payload.public_alias : null,
        role,
        site_ids: siteIds,
        approval_status:
          typeof verified.payload.approval_status === "string"
            ? normalizeEffectiveApprovalStatus({
                role,
                site_ids: siteIds,
                approval_status: verified.payload.approval_status,
              })
            : null,
        registry_consents: normalizeRegistryConsents(verified.payload.registry_consents),
      };
    } catch {
      // Fall through to legacy shared-secret verification when configured.
    }
  }
  const sharedSecret = localApiJwtSharedSecret();
  if (sharedSecret) {
    try {
      const verified = await jwtVerify(token, new TextEncoder().encode(sharedSecret), {
        algorithms: ["HS256"],
      });
      const role = typeof verified.payload.role === "string" ? verified.payload.role : null;
      const siteIds = normalizeStringArray(verified.payload.site_ids);
      return {
        sub: typeof verified.payload.sub === "string" ? verified.payload.sub : null,
        username: typeof verified.payload.username === "string" ? verified.payload.username : null,
        full_name: typeof verified.payload.full_name === "string" ? verified.payload.full_name : null,
        public_alias: typeof verified.payload.public_alias === "string" ? verified.payload.public_alias : null,
        role,
        site_ids: siteIds,
        approval_status:
          typeof verified.payload.approval_status === "string"
            ? normalizeEffectiveApprovalStatus({
                role,
                site_ids: siteIds,
                approval_status: verified.payload.approval_status,
              })
            : null,
        registry_consents: normalizeRegistryConsents(verified.payload.registry_consents),
      };
    } catch {
      throw new Error("Authentication required.");
    }
  }
  if (publicKey) {
    throw new Error("Authentication required.");
  }
  throw new Error("KERA_LOCAL_API_JWT_PUBLIC_KEY_B64 is not available to verify control-plane access tokens.");
}

export async function buildLocalAuthResponse(user: AuthUser): Promise<AuthResponse> {
  const normalizedSiteIds = normalizeSiteIds(user.site_ids);
  const normalizedRole =
    user.role === "viewer" &&
    user.approval_status === "approved" &&
    normalizedSiteIds.length > 0
      ? "researcher"
      : user.role;
  const normalizedUser: AuthUser = {
    ...user,
    role: normalizedRole,
    site_ids: normalizedSiteIds,
    approval_status: normalizeEffectiveApprovalStatus({
      role: normalizedRole,
      site_ids: normalizedSiteIds,
      approval_status: user.approval_status,
    }),
  };
  const privateKey = localApiJwtPrivateKey();
  if (privateKey) {
    const protectedHeader: { alg: "RS256"; kid?: string } = { alg: "RS256" };
    const keyId = localApiJwtKeyId();
    if (keyId) {
      protectedHeader.kid = keyId;
    }
    const token = await new SignJWT({
      sub: normalizedUser.user_id,
      username: normalizedUser.username,
      full_name: normalizedUser.full_name,
      public_alias: normalizedUser.public_alias ?? null,
      role: normalizedUser.role,
      site_ids: normalizedUser.site_ids ?? [],
      approval_status: normalizedUser.approval_status,
      registry_consents: normalizeRegistryConsents(normalizedUser.registry_consents),
    })
      .setProtectedHeader(protectedHeader)
      .setIssuer(localApiJwtIssuer())
      .setAudience(localApiJwtAudience())
      .setIssuedAt()
      .setExpirationTime(`${LOCAL_TOKEN_TTL_HOURS}h`)
      .sign(privateKey);
    return {
      auth_state: normalizedUser.approval_status,
      access_token: token,
      token_type: "bearer",
      user: normalizedUser,
    };
  }

  const sharedSecret = localApiJwtSharedSecret();
  if (!sharedSecret) {
    throw new Error("KERA_LOCAL_API_JWT_PRIVATE_KEY_B64 is not available to mint control-plane access tokens.");
  }
  const token = await new SignJWT({
    sub: normalizedUser.user_id,
    username: normalizedUser.username,
    full_name: normalizedUser.full_name,
    public_alias: normalizedUser.public_alias ?? null,
    role: normalizedUser.role,
    site_ids: normalizedUser.site_ids ?? [],
    approval_status: normalizedUser.approval_status,
    registry_consents: normalizeRegistryConsents(normalizedUser.registry_consents),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_TOKEN_TTL_HOURS}h`)
    .sign(new TextEncoder().encode(sharedSecret));
  return {
    auth_state: normalizedUser.approval_status,
    access_token: token,
    token_type: "bearer",
    user: normalizedUser,
  };
}
