import type { AuthState, AuthUser, SiteRecord } from "../lib/api";

export const TOKEN_KEY = "kera_web_token";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const CLIENT_BOOTSTRAP_TIMING_LOGS = process.env.NEXT_PUBLIC_KERA_BOOTSTRAP_TIMING_LOGS === "1";

export type OperationsSection = "dashboard" | "training" | "cross_validation";
export type WorkspaceMode = "canvas" | "operations";

export type LaunchTarget = { mode: WorkspaceMode; section: OperationsSection };

export type RequestFormState = {
  requested_site_id: string;
  requested_site_label: string;
  requested_role: string;
  message: string;
};

type MainAppTokenPayload = {
  sub?: unknown;
  username?: unknown;
  full_name?: unknown;
  public_alias?: unknown;
  role?: unknown;
  site_ids?: unknown;
  approval_status?: unknown;
  registry_consents?: unknown;
  exp?: unknown;
};

export function parseOperationsLaunchFromSearch(): LaunchTarget | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("workspace") !== "operations") {
    return null;
  }
  const section = params.get("section");
  if (section === "training" || section === "cross_validation" || section === "dashboard") {
    return { mode: "operations", section };
  }
  return { mode: "operations", section: "dashboard" };
}

function readJwtPayload(token: string): MainAppTokenPayload | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(window.atob(padded)) as MainAppTokenPayload;
  } catch {
    return null;
  }
}

function readJwtExpiration(token: string): number | null {
  const payload = readJwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp : null;
}

export function readOptimisticUserFromToken(token: string): AuthUser | null {
  const payload = readJwtPayload(token);
  if (!payload) {
    return null;
  }
  const userId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const fullName = typeof payload.full_name === "string" ? payload.full_name.trim() : "";
  const role = typeof payload.role === "string" ? payload.role.trim() : "";
  const approvalStatus = typeof payload.approval_status === "string" ? payload.approval_status.trim() : "";
  if (!userId || !username || !role) {
    return null;
  }
  if (!["approved", "pending", "rejected", "application_required"].includes(approvalStatus)) {
    return null;
  }
  const siteIds =
    Array.isArray(payload.site_ids)
      ? payload.site_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
  const registryConsents =
    payload.registry_consents && typeof payload.registry_consents === "object"
      ? (payload.registry_consents as AuthUser["registry_consents"])
      : {};
  return {
    user_id: userId,
    username,
    full_name: fullName || username,
    public_alias: typeof payload.public_alias === "string" && payload.public_alias.trim() ? payload.public_alias.trim() : null,
    role,
    site_ids: siteIds,
    approval_status: approvalStatus as AuthState,
    latest_access_request: null,
    registry_consents: registryConsents,
  };
}

export function optimisticSitesForUser(user: AuthUser): SiteRecord[] {
  return (user.site_ids ?? []).map((siteId) => ({
    site_id: siteId,
    display_name: siteId,
    hospital_name: siteId,
  }));
}

export function resolveSelectedSiteId(
  sites: SiteRecord[],
  currentSiteId: string | null,
  preferredSiteId?: string | null,
): string | null {
  const normalizedPreferredSiteId = String(preferredSiteId ?? "").trim();
  if (normalizedPreferredSiteId && sites.some((site) => site.site_id === normalizedPreferredSiteId)) {
    return normalizedPreferredSiteId;
  }
  if (currentSiteId && sites.some((site) => site.site_id === currentSiteId)) {
    return currentSiteId;
  }
  return sites[0]?.site_id ?? null;
}

export function isTokenExpired(token: string): boolean {
  const exp = readJwtExpiration(token);
  if (exp === null) {
    return false;
  }
  return exp <= Math.floor(Date.now() / 1000);
}

export function isAuthBootstrapError(message: string): boolean {
  return ["Invalid token.", "Missing bearer token.", "User no longer exists."].includes(message);
}
