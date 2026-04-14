import "server-only";

import { NextRequest } from "next/server";

import type {
  AccessRequestRecord,
  MainBootstrapResponse,
  AuthResponse,
  AuthUser,
  DesktopReleaseDownloadResponse,
  DesktopReleaseRecord,
  ResearchRegistrySettingsResponse,
  SiteRecord,
} from "../types";
import { makeControlPlaneId } from "./crypto";
import { controlPlaneDevAuthEnabled } from "./config";
import { controlPlaneSql } from "./db";
import { verifyGoogleIdentityToken } from "./google";
import type { ControlPlaneUser } from "./types";
import { getSiteAlias, getSiteDisplayName, getSiteOfficialName } from "../site-labels";
export {
  createMainAdminSite,
  createMainProject,
  fetchMainAdminOverview,
  fetchMainAdminWorkspaceBootstrap,
  fetchMainInstitutionDirectoryStatus,
  listMainAdminAccessRequests,
  listMainAdminSites,
  listMainProjects,
  listMainUsers,
  reviewMainAccessRequest,
  syncMainInstitutionDirectory,
  updateMainAdminSite,
  upsertMainUser,
} from "./main-app-bridge-admin";
export {
  autoPublishMainModelUpdate,
  autoPublishMainModelVersion,
  createMainReleaseRollout,
  deleteMainModelVersion,
  fetchMainFederationMonitoring,
  listMainAggregations,
  listMainModelUpdates,
  listMainModelVersions,
  listMainReleaseRollouts,
  publishMainModelUpdate,
  publishMainModelVersion,
  reviewMainModelUpdate,
  runMainFederatedAggregation,
} from "./main-app-bridge-models";
export {
  fetchPublicStatistics,
  listPublicSites,
  searchPublicInstitutions,
} from "./main-app-bridge-public";
import {
  appendDesktopDownloadEvent,
  desktopReleaseRowById,
  institutionRowById,
  latestAccessRequestForCanonicalUser,
  listActiveDesktopReleases,
  listAccessRequestsForCanonicalUser,
  serializeSiteRecord,
  siteRowById,
  siteRowBySourceInstitutionId,
  upsertAccessRequestRecord,
} from "./main-app-bridge-records";
import {
  authenticateMainAppUser,
  buildLegacyAuthUser,
  buildMainAuthResponse,
  canonicalUserRowById,
  requireMainAppBridgeUser,
} from "./main-app-bridge-users";
import {
  buildLocalAuthResponse,
  fetchLegacyLocalNodeApi,
  legacyEmailForLocalUser,
  normalizeRegistryConsents,
  normalizeStringArray,
  readBearerToken,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";
import { appendAuditEvent, ensureControlPlaneIdentity } from "./store";

const AUTO_APPROVAL_REVIEWER_NOTE = "Automatically approved researcher access request.";
const BOOTSTRAP_TIMING_LOGS_ENABLED = trimText(process.env.KERA_BOOTSTRAP_TIMING_LOGS) === "1";

function logBootstrapTiming(message: string, payload: Record<string, unknown>): void {
  if (!BOOTSTRAP_TIMING_LOGS_ENABLED) {
    return;
  }
  console.info(`[kera-main-bootstrap] ${message}`, payload);
}

function hydrateMembershipSiteRecord(site: ControlPlaneUser["memberships"][number]["site"]): SiteRecord | null {
  if (!site) {
    return null;
  }
  const siteId = trimText(site.site_id);
  if (!siteId) {
    return null;
  }
  const officialName = getSiteOfficialName(site, siteId);
  const siteAlias = getSiteAlias(site);

  const hydratedSite: SiteRecord = {
    site_id: siteId,
    display_name: officialName,
    hospital_name: officialName,
    source_institution_name: trimText(site.source_institution_name) || undefined,
  };
  if (siteAlias) {
    hydratedSite.site_alias = siteAlias;
  }
  return hydratedSite;
}

function siteRecordsFromMemberships(canonicalUser: ControlPlaneUser): SiteRecord[] {
  const items = new Map<string, SiteRecord>();
  for (const membership of canonicalUser.memberships) {
    if (membership.status !== "approved") {
      continue;
    }
    const hydratedSite = hydrateMembershipSiteRecord(membership.site);
    if (!hydratedSite) {
      continue;
    }
    items.set(hydratedSite.site_id, hydratedSite);
  }
  return Array.from(items.values()).sort(
    (left, right) => left.hospital_name.localeCompare(right.hospital_name) || left.site_id.localeCompare(right.site_id),
  );
}

async function listSitesForMainUserRecord(user: AuthUser, canonicalUser?: ControlPlaneUser): Promise<SiteRecord[]> {
  const siteIds = normalizeStringArray(user.site_ids);
  if (user.role !== "admin" && !siteIds.length) {
    return [];
  }
  if (user.role !== "admin" && canonicalUser) {
    const membershipSites = siteRecordsFromMemberships(canonicalUser);
    if (membershipSites.length > 0) {
      return membershipSites;
    }
  }
  const sql = await controlPlaneSql();
  const rows =
    user.role === "admin"
      ? await sql`
          select
            sites.site_id,
            sites.display_name,
            sites.hospital_name,
            coalesce(site_directory.name, source_directory.name) as source_institution_name
          from sites
          left join institution_directory as site_directory
            on site_directory.institution_id = sites.site_id
          left join institution_directory as source_directory
            on source_directory.institution_id = nullif(sites.source_institution_id, '')
          order by
            coalesce(
              nullif(trim(site_directory.name), ''),
              nullif(trim(source_directory.name), ''),
              nullif(trim(sites.hospital_name), ''),
              nullif(trim(sites.display_name), ''),
              sites.site_id
            ) asc,
            sites.site_id asc
        `
      : await sql`
          select
            sites.site_id,
            sites.display_name,
            sites.hospital_name,
            coalesce(site_directory.name, source_directory.name) as source_institution_name
          from sites
          left join institution_directory as site_directory
            on site_directory.institution_id = sites.site_id
          left join institution_directory as source_directory
            on source_directory.institution_id = nullif(sites.source_institution_id, '')
          where sites.site_id = any(${siteIds})
          order by
            coalesce(
              nullif(trim(site_directory.name), ''),
              nullif(trim(source_directory.name), ''),
              nullif(trim(sites.hospital_name), ''),
              nullif(trim(sites.display_name), ''),
              sites.site_id
            ) asc,
            sites.site_id asc
        `;
  return rows.map((row) => serializeSiteRecord(row));
}

export async function fetchSitesForMainUser(request: NextRequest): Promise<SiteRecord[]> {
  const { canonicalUser, user } = await requireMainAppBridgeUser(request);
  return listSitesForMainUserRecord(user, canonicalUser);
}

export async function fetchMainUserAuth(request: NextRequest): Promise<AuthResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  return buildLocalAuthResponse(user);
}

function assertDesktopDownloadPermission(user: AuthUser): void {
  if (user.approval_status !== "approved" && user.role !== "admin" && user.role !== "site_admin") {
    throw new Error("Approved hospital access is required.");
  }
}

function assertDesktopDownloadSiteAccess(user: AuthUser, siteId: string | null): string | null {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) {
    if (user.role === "admin") {
      return null;
    }
    throw new Error("Choose a hospital before downloading the desktop app.");
  }
  if (user.role === "admin") {
    return normalizedSiteId;
  }
  const allowedSiteIds = normalizeStringArray(user.site_ids);
  if (!allowedSiteIds.includes(normalizedSiteId)) {
    throw new Error("You can only download installers for approved hospitals.");
  }
  return normalizedSiteId;
}

export async function fetchMainDesktopReleases(request: NextRequest): Promise<DesktopReleaseRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  assertDesktopDownloadPermission(user);
  return listActiveDesktopReleases();
}

export async function claimMainDesktopReleaseDownload(
  request: NextRequest,
  releaseId: string,
  payload?: { site_id?: string | null },
): Promise<DesktopReleaseDownloadResponse> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  assertDesktopDownloadPermission(user);
  const resolvedSiteId = assertDesktopDownloadSiteAccess(user, payload?.site_id ?? null);
  const releaseRow = await desktopReleaseRowById(releaseId);
  if (!releaseRow || !Boolean(rowValue<boolean>(releaseRow, "active"))) {
    throw new Error("The requested desktop installer is unavailable.");
  }
  const release = {
    release_id: trimText(rowValue<string>(releaseRow, "release_id")),
    channel: trimText(rowValue<string>(releaseRow, "channel")),
    label: trimText(rowValue<string>(releaseRow, "label")),
    version: trimText(rowValue<string>(releaseRow, "version")),
    platform: trimText(rowValue<string>(releaseRow, "platform")) || "windows",
    installer_type: trimText(rowValue<string>(releaseRow, "installer_type")) || "nsis",
    download_url: trimText(rowValue<string>(releaseRow, "download_url")),
    folder_url: trimText(rowValue<string | null>(releaseRow, "folder_url")) || null,
    sha256: trimText(rowValue<string | null>(releaseRow, "sha256")) || null,
    size_bytes:
      typeof rowValue<number | null>(releaseRow, "size_bytes") === "number"
        ? rowValue<number | null>(releaseRow, "size_bytes")
        : Number.isFinite(Number(rowValue<string | null>(releaseRow, "size_bytes")))
          ? Number(rowValue<string | null>(releaseRow, "size_bytes"))
          : null,
    notes: trimText(rowValue<string | null>(releaseRow, "notes")) || null,
    active: true,
    metadata_json:
      rowValue<Record<string, unknown> | null>(releaseRow, "metadata_json") &&
      typeof rowValue<Record<string, unknown> | null>(releaseRow, "metadata_json") === "object"
        ? (rowValue<Record<string, unknown>>(releaseRow, "metadata_json") ?? {})
        : {},
    created_at: new Date(rowValue<string | Date>(releaseRow, "created_at")).toISOString(),
    updated_at: new Date(rowValue<string | Date>(releaseRow, "updated_at")).toISOString(),
  } satisfies DesktopReleaseRecord;
  const eventId = await appendDesktopDownloadEvent({
    releaseId: release.release_id,
    userId: canonicalUserId,
    username: user.username,
    userRole: user.role,
    siteId: resolvedSiteId,
    metadata: {
      approval_status: user.approval_status,
      folder_url: release.folder_url,
    },
  });
  await appendAuditEvent({
    actorType: "user",
    actorId: canonicalUserId,
    action: "desktop_release.download_claimed",
    targetType: "desktop_release",
    targetId: release.release_id,
    payload: {
      channel: release.channel,
      version: release.version,
      site_id: resolvedSiteId,
      event_id: eventId,
    },
  });
  return {
    event_id: eventId,
    release,
    redirect_url: release.download_url,
    site_id: resolvedSiteId,
  };
}

export async function fetchMainBootstrap(request: NextRequest): Promise<MainBootstrapResponse> {
  const totalStartedAt = performance.now();
  const authStartedAt = performance.now();
  const { canonicalUser, canonicalUserId, user } = await requireMainAppBridgeUser(request);
  const auth = await buildLocalAuthResponse(user);
  const authCompletedAt = performance.now();

  let sites: SiteRecord[] = [];
  let myAccessRequests: AccessRequestRecord[] = [];
  let sitesMs = 0;
  let requestsMs = 0;

  if (user.approval_status === "approved") {
    const sitesStartedAt = performance.now();
    sites = await listSitesForMainUserRecord(user, canonicalUser);
    sitesMs = performance.now() - sitesStartedAt;
  } else {
    const requestsStartedAt = performance.now();
    myAccessRequests = await listAccessRequestsForCanonicalUser(canonicalUserId);
    requestsMs = performance.now() - requestsStartedAt;
  }

  const totalMs = performance.now() - totalStartedAt;
  logBootstrapTiming("completed", {
    user_id: user.user_id,
    role: user.role,
    approval_status: user.approval_status,
    auth_ms: Math.round(authCompletedAt - authStartedAt),
    sites_ms: Math.round(sitesMs),
    requests_ms: Math.round(requestsMs),
    total_ms: Math.round(totalMs),
    site_count: sites.length,
    request_count: myAccessRequests.length,
  });

  return {
    ...auth,
    sites,
    my_access_requests: myAccessRequests,
  };
}

export async function loginMainWithGoogle(request: NextRequest, idToken: string): Promise<AuthResponse> {
  const normalizedIdToken = trimText(idToken);
  if (!normalizedIdToken) {
    throw new Error("id_token is required.");
  }
  const identity = await verifyGoogleIdentityToken(normalizedIdToken);
  const user = await ensureControlPlaneIdentity(identity, { skipAutoAdminPromotion: true });
  const auth = await buildMainAuthResponse(user.user_id, {
    username: user.email,
    full_name: user.full_name,
  });
  if (auth.user.role === "admin" || auth.user.role === "site_admin") {
    throw new Error("Admin and site admin accounts must use local password sign-in.");
  }
  return auth;
}

export async function loginMainWithLocalCredentials(
  _request: NextRequest,
  payload: { username?: string; password?: string },
): Promise<AuthResponse> {
  const { user } = await authenticateMainAppUser(
    trimText(payload.username),
    trimText(payload.password),
  );
  return buildLocalAuthResponse(user);
}

export async function devLoginMain(_request: NextRequest): Promise<AuthResponse> {
  if (!controlPlaneDevAuthEnabled()) {
    throw new Error("Development auth is disabled.");
  }
  const user = await ensureControlPlaneIdentity({
    email: "admin@local.invalid",
    fullName: "Platform Administrator",
    googleSub: null,
  });
  return buildLocalAuthResponse({
    user_id: user.user_id,
    username: user.email,
    full_name: user.full_name,
    public_alias: null,
    role: "admin",
    site_ids: user.memberships.filter((membership) => membership.status === "approved").map((membership) => membership.site_id),
    approval_status: "approved",
    latest_access_request: null,
    registry_consents: {},
  });
}

export async function enrollMainResearchRegistry(
  request: NextRequest,
  siteId: string,
  payload?: { version?: string },
): Promise<ResearchRegistrySettingsResponse & { access_token: string; token_type: "bearer"; user: AuthUser }> {
  const token = readBearerToken(request);
  const { canonicalUserId, localUser } = await requireMainAppBridgeUser(request);
  const siteRecord = await siteRowById(siteId);
  if (!siteRecord) {
    throw new Error("Unknown site.");
  }
  if (!Boolean(rowValue<boolean>(siteRecord, "research_registry_enabled"))) {
    throw new Error("This site's research registry is disabled by the institution.");
  }
  const version = trimText(payload?.version) || "v1";
  const canonicalRow = await canonicalUserRowById(canonicalUserId);
  if (!canonicalRow) {
    throw new Error("Unable to load the current user.");
  }
  const registryConsents = normalizeRegistryConsents(rowValue<unknown>(canonicalRow, "registry_consents"));
  const nextEnrolledAt = new Date().toISOString();
  registryConsents[siteId] = {
    enrolled_at: nextEnrolledAt,
    version,
  };
  const sql = await controlPlaneSql();
  await sql`
    update users
    set
      registry_consents = ${JSON.stringify(registryConsents)}::jsonb,
      updated_at = now()
    where user_id = ${canonicalUserId}
  `;
  await fetchLegacyLocalNodeApi<ResearchRegistrySettingsResponse>(
    request,
    `/api/sites/${siteId}/research-registry/consent`,
    {
      method: "POST",
      body: JSON.stringify({ version }),
    },
    token,
  );
  const refreshedUser = await buildLegacyAuthUser(canonicalUserId, {
    ...localUser,
    registry_consents: registryConsents,
  });
  const auth = await buildMainAuthResponse(canonicalUserId, refreshedUser);
  return {
    site_id: siteId,
    research_registry_enabled: true,
    user_enrolled: true,
    user_enrolled_at: nextEnrolledAt,
    access_token: auth.access_token,
    token_type: auth.token_type,
    user: auth.user,
  };
}

export async function fetchMyAccessRequests(request: NextRequest): Promise<AccessRequestRecord[]> {
  const { canonicalUserId } = await requireMainAppBridgeUser(request);
  return listAccessRequestsForCanonicalUser(canonicalUserId);
}

export async function submitMainAccessRequest(
  request: NextRequest,
  payload: {
    requested_site_id?: string;
    requested_site_label?: string;
    requested_role?: string;
    message?: string;
  },
): Promise<
  AuthResponse & {
    request: AccessRequestRecord;
  }
> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  const requestedRole = "researcher";
  const requestedSiteId = trimText(payload.requested_site_id);
  const existingSiteIds = new Set(normalizeStringArray(user.site_ids));
  if (!requestedSiteId) {
    throw new Error("Requested institution is required.");
  }
  const site = await siteRowById(requestedSiteId);
  const institution = await institutionRowById(requestedSiteId);
  if (!site && !institution) {
    throw new Error("Unknown site.");
  }
  const mappedSite = site ? null : await siteRowBySourceInstitutionId(requestedSiteId);
  const resolvedSite = site ?? mappedSite;
  const resolvedSiteId = resolvedSite ? trimText(rowValue<string>(resolvedSite, "site_id")) : "";
  if (existingSiteIds.has(requestedSiteId) || (resolvedSiteId && existingSiteIds.has(resolvedSiteId))) {
    throw new Error("You already have access to this hospital.");
  }
  const latestRequest = await latestAccessRequestForCanonicalUser(canonicalUserId);
  if (latestRequest?.status === "pending") {
    throw new Error("There is already a pending approval request for this user.");
  }
  const requestRecord: AccessRequestRecord = {
    request_id: makeControlPlaneId("access"),
    user_id: canonicalUserId,
    email: legacyEmailForLocalUser(user),
    requested_site_id: requestedSiteId,
    requested_site_label:
      trimText(payload.requested_site_label) ||
      (site ? getSiteDisplayName(site as never, requestedSiteId) : institution ? rowValue<string>(institution, "name") : requestedSiteId),
    requested_site_source: site ? "site" : "institution_directory",
    requested_role: requestedRole,
    message: trimText(payload.message),
    status: "pending",
    reviewed_by: null,
    reviewer_notes: "",
    created_at: new Date().toISOString(),
    reviewed_at: null,
  };
  await upsertAccessRequestRecord(canonicalUserId, legacyEmailForLocalUser(user), requestRecord);
  if (resolvedSite && existingSiteIds.size === 0) {
    const sql = await controlPlaneSql();
    await sql`
      insert into site_memberships (
        membership_id,
        user_id,
        site_id,
        role,
        status,
        approved_at,
        created_at,
        updated_at
      ) values (
        ${makeControlPlaneId("membership")},
        ${canonicalUserId},
        ${resolvedSiteId},
        ${"member"},
        ${"approved"},
        now(),
        now(),
        now()
      )
      on conflict (user_id, site_id) do update set
        role = excluded.role,
        status = 'approved',
        approved_at = coalesce(site_memberships.approved_at, excluded.approved_at),
        updated_at = now()
    `;
    await sql`
      update access_requests
      set
        requested_site_id = ${resolvedSiteId},
        requested_site_source = ${"site"},
        requested_role = ${requestedRole},
        status = ${"approved"},
        reviewed_by = ${null},
        reviewer_notes = ${AUTO_APPROVAL_REVIEWER_NOTE},
        reviewed_at = now()
      where request_id = ${requestRecord.request_id}
    `;
  }
  const refreshedUser = await buildLegacyAuthUser(canonicalUserId, user);
  const auth = await buildMainAuthResponse(canonicalUserId, refreshedUser);
  const stored = await listAccessRequestsForCanonicalUser(canonicalUserId);
  return {
    ...auth,
    request: stored[0] ?? requestRecord,
  };
}
