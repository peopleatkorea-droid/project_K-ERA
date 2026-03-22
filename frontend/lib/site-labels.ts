import type { SiteRecord } from "./types";

export type SiteDisplayRecord = {
  site_id: string | null | undefined;
  display_name?: string | null | undefined;
  hospital_name?: string | null | undefined;
  source_institution_name?: string | null | undefined;
  [key: string]: unknown;
};

type SiteLike = SiteDisplayRecord | null | undefined;

function normalizeSiteToken(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function looksLikeSyntheticSiteToken(value: string | null | undefined): boolean {
  const normalizedValue = normalizeSiteToken(value);
  if (!normalizedValue) {
    return false;
  }
  return (
    normalizedValue.startsWith("smoke-") ||
    normalizedValue.startsWith("smoke_") ||
    normalizedValue.startsWith("http-") ||
    normalizedValue.startsWith("http_") ||
    normalizedValue === "smoke hospital" ||
    normalizedValue === "http hospital"
  );
}

export function isPlaceholderSiteLabel(label: string | null | undefined, siteId: string | null | undefined): boolean {
  const normalizedLabel = normalizeSiteToken(label);
  if (!normalizedLabel) {
    return true;
  }
  if (normalizedLabel === normalizeSiteToken(siteId)) {
    return true;
  }
  return looksLikeSyntheticSiteToken(normalizedLabel);
}

export function isVisibleSiteId(siteId: string | null | undefined): boolean {
  const normalizedSiteId = normalizeSiteToken(siteId);
  if (!normalizedSiteId) {
    return false;
  }
  return !looksLikeSyntheticSiteToken(normalizedSiteId);
}

export function filterVisibleSiteIds(siteIds: Array<string | null | undefined>): string[] {
  return siteIds.filter((siteId): siteId is string => isVisibleSiteId(siteId));
}

export function filterVisibleSites<T extends { site_id: string | null | undefined }>(sites: T[]): T[] {
  return sites.filter((site) => {
    if (!isVisibleSiteId(site.site_id)) {
      return false;
    }
    const siteRecord = site as T & { display_name?: string | null; hospital_name?: string | null };
    return !looksLikeSyntheticSiteToken(siteRecord.display_name) && !looksLikeSyntheticSiteToken(siteRecord.hospital_name);
  });
}

export function getSiteDisplayName(site: SiteLike, fallback = ""): string {
  const siteId = String(site?.site_id ?? "").trim();
  const hospitalName = String(site?.hospital_name ?? "").trim();
  if (hospitalName && !isPlaceholderSiteLabel(hospitalName, siteId)) {
    return hospitalName;
  }
  const sourceInstitutionName = String(site?.source_institution_name ?? "").trim();
  if (sourceInstitutionName) {
    return sourceInstitutionName;
  }
  const displayName = String(site?.display_name ?? "").trim();
  if (displayName && !isPlaceholderSiteLabel(displayName, siteId)) {
    return displayName;
  }
  if (hospitalName) {
    return hospitalName;
  }
  if (displayName) {
    return displayName;
  }
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
