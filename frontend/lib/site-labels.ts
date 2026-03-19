import type { SiteRecord } from "./types";

type SiteLike = Partial<Pick<SiteRecord, "site_id" | "display_name" | "hospital_name">> | null | undefined;

export function isVisibleSiteId(siteId: string | null | undefined): boolean {
  const normalizedSiteId = String(siteId ?? "").trim().toLowerCase();
  if (!normalizedSiteId) {
    return false;
  }
  return !normalizedSiteId.startsWith("smoke-");
}

export function filterVisibleSiteIds(siteIds: Array<string | null | undefined>): string[] {
  return siteIds.filter((siteId): siteId is string => isVisibleSiteId(siteId));
}

export function filterVisibleSites<T extends { site_id: string | null | undefined }>(sites: T[]): T[] {
  return sites.filter((site) => isVisibleSiteId(site.site_id));
}

export function getSiteDisplayName(site: SiteLike, fallback = ""): string {
  const hospitalName = String(site?.hospital_name ?? "").trim();
  if (hospitalName) {
    return hospitalName;
  }
  const displayName = String(site?.display_name ?? "").trim();
  if (displayName) {
    return displayName;
  }
  const siteId = String(site?.site_id ?? "").trim();
  return siteId || fallback;
}

export function getSiteAlias(site: SiteLike): string | null {
  const displayName = String(site?.display_name ?? "").trim();
  const primaryLabel = getSiteDisplayName(site);
  if (!displayName || displayName === primaryLabel) {
    return null;
  }
  return displayName;
}

export function getRequestedSiteLabel(
  request: { requested_site_label?: string | null; requested_site_id?: string | null } | null | undefined,
  fallback = "",
): string {
  const label = String(request?.requested_site_label ?? "").trim();
  if (label) {
    return label;
  }
  const siteId = String(request?.requested_site_id ?? "").trim();
  return siteId || fallback;
}
