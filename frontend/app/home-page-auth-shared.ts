import type { AuthState, AuthUser, SiteRecord } from "../lib/api";
import { isPlaceholderSiteLabel } from "../lib/site-labels";

export const TOKEN_KEY = "kera_web_token";
const SITE_RECORD_CACHE_KEY = "kera_cached_site_records_v1";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const CLIENT_BOOTSTRAP_TIMING_LOGS = process.env.NEXT_PUBLIC_KERA_BOOTSTRAP_TIMING_LOGS === "1";

export type OperationsSection = "management" | "dashboard" | "training" | "cross_validation" | "ssl";
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
  if (section === "management" || section === "training" || section === "cross_validation" || section === "dashboard" || section === "ssl") {
    return { mode: "operations", section };
  }
  return { mode: "operations", section: "management" };
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

function readCachedSiteRecordMap(): Map<string, SiteRecord> {
  if (typeof window === "undefined") {
    return new Map();
  }
  try {
    const rawValue = window.localStorage.getItem(SITE_RECORD_CACHE_KEY);
    if (!rawValue) {
      return new Map();
    }
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(
      parsed
        .filter(
          (value): value is SiteRecord =>
            Boolean(
              value &&
                typeof value === "object" &&
                typeof (value as SiteRecord).site_id === "string" &&
                (value as SiteRecord).site_id.trim().length > 0,
            ),
        )
        .map((site) => [site.site_id, site]),
    );
  } catch {
    return new Map();
  }
}

function trimSiteField(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function preferredSiteLabel(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  siteId: string,
  sourceInstitutionName?: string | null | undefined,
): string {
  const primaryLabel = trimSiteField(primary);
  const fallbackLabel = trimSiteField(fallback);
  const institutionLabel = trimSiteField(sourceInstitutionName);
  if (primaryLabel && !isPlaceholderSiteLabel(primaryLabel, siteId)) {
    return primaryLabel;
  }
  if (fallbackLabel && !isPlaceholderSiteLabel(fallbackLabel, siteId)) {
    return fallbackLabel;
  }
  return institutionLabel || primaryLabel || fallbackLabel || siteId;
}

export function mergeSiteRecordMetadata(primarySite: SiteRecord, fallbackSite?: SiteRecord | null): SiteRecord {
  const siteId = trimSiteField(primarySite.site_id) || trimSiteField(fallbackSite?.site_id);
  const sourceInstitutionName =
    trimSiteField(primarySite.source_institution_name) || trimSiteField(fallbackSite?.source_institution_name) || undefined;
  const siteAlias = trimSiteField(primarySite.site_alias) || trimSiteField(fallbackSite?.site_alias) || undefined;

  const mergedSite: SiteRecord = {
    ...(fallbackSite ?? {}),
    ...primarySite,
    site_id: siteId,
    display_name: preferredSiteLabel(primarySite.display_name, fallbackSite?.display_name, siteId, sourceInstitutionName),
    hospital_name: preferredSiteLabel(primarySite.hospital_name, fallbackSite?.hospital_name, siteId, sourceInstitutionName),
  };

  if (sourceInstitutionName) {
    mergedSite.source_institution_name = sourceInstitutionName;
  } else {
    delete mergedSite.source_institution_name;
  }
  if (siteAlias) {
    mergedSite.site_alias = siteAlias;
  } else {
    delete mergedSite.site_alias;
  }

  return mergedSite;
}

export function mergeSitesWithCachedMetadata(sites: SiteRecord[]): SiteRecord[] {
  if (sites.length === 0) {
    return sites;
  }
  const cachedSitesById = readCachedSiteRecordMap();
  return sites.map((site) => mergeSiteRecordMetadata(site, cachedSitesById.get(site.site_id)));
}

export function cacheSiteRecords(sites: SiteRecord[]): void {
  if (typeof window === "undefined" || sites.length === 0) {
    return;
  }
  const cachedSitesById = readCachedSiteRecordMap();
  for (const site of sites) {
    const siteId = trimSiteField(site.site_id);
    if (!siteId) {
      continue;
    }
    cachedSitesById.set(siteId, mergeSiteRecordMetadata({ ...site, site_id: siteId }, cachedSitesById.get(siteId)));
  }
  try {
    window.localStorage.setItem(SITE_RECORD_CACHE_KEY, JSON.stringify(Array.from(cachedSitesById.values())));
  } catch {
    // Ignore localStorage write failures and keep the optimistic fallback path.
  }
}

export function optimisticSitesForUser(user: AuthUser): SiteRecord[] {
  const cachedSitesById = readCachedSiteRecordMap();
  return (user.site_ids ?? []).map((siteId) => {
    const cachedSite = cachedSitesById.get(siteId);
    return (
      cachedSite ?? {
        site_id: siteId,
        display_name: siteId,
        hospital_name: siteId,
      }
    );
  });
}

export function siteRecordNeedsLabelHydration(site: SiteRecord | null | undefined): boolean {
  const siteId = trimSiteField(site?.site_id);
  if (!siteId) {
    return false;
  }
  if (trimSiteField(site?.source_institution_name)) {
    return false;
  }
  const hospitalName = trimSiteField(site?.hospital_name);
  if (hospitalName && !isPlaceholderSiteLabel(hospitalName, siteId)) {
    return false;
  }
  const displayName = trimSiteField(site?.display_name);
  if (displayName && !isPlaceholderSiteLabel(displayName, siteId)) {
    return false;
  }
  return true;
}

export function sitesNeedLabelHydration(sites: SiteRecord[]): boolean {
  return sites.some((site) => siteRecordNeedsLabelHydration(site));
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
