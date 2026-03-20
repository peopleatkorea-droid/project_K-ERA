import "server-only";

import { NextRequest } from "next/server";

import type {
  AccessRequestRecord,
  MainBootstrapResponse,
  AuthResponse,
  AuthUser,
  ResearchRegistrySettingsResponse,
  SiteRecord,
} from "../types";
import { makeControlPlaneId } from "./crypto";
import { controlPlaneDevAuthEnabled } from "./config";
import { controlPlaneSql } from "./db";
import { verifyGoogleIdentityToken } from "./google";
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
  updateMainAdminSite,
  upsertMainUser,
} from "./main-app-bridge-admin";
export {
  autoPublishMainModelUpdate,
  autoPublishMainModelVersion,
  deleteMainModelVersion,
  listMainAggregations,
  listMainModelUpdates,
  listMainModelVersions,
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
  institutionRowById,
  latestAccessRequestForCanonicalUser,
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
import { ensureControlPlaneIdentity } from "./store";

const AUTO_APPROVAL_REVIEWER_NOTE = "Automatically approved researcher access request.";
const BOOTSTRAP_TIMING_LOGS_ENABLED = trimText(process.env.KERA_BOOTSTRAP_TIMING_LOGS) === "1";

function logBootstrapTiming(message: string, payload: Record<string, unknown>): void {
  if (!BOOTSTRAP_TIMING_LOGS_ENABLED) {
    return;
  }
  console.info(`[kera-main-bootstrap] ${message}`, payload);
}

async function listSitesForMainUserRecord(user: AuthUser): Promise<SiteRecord[]> {
  const siteIds = normalizeStringArray(user.site_ids);
  if (user.role !== "admin" && !siteIds.length) {
    return [];
  }
  const sql = await controlPlaneSql();
  const rows =
    user.role === "admin"
      ? await sql`
          select site_id, display_name, hospital_name
          from sites
          order by display_name asc, site_id asc
        `
      : await sql`
          select site_id, display_name, hospital_name
          from sites
          where site_id = any(${siteIds})
          order by display_name asc, site_id asc
        `;
  return rows.map((row) => serializeSiteRecord(row));
}

export async function fetchSitesForMainUser(request: NextRequest): Promise<SiteRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listSitesForMainUserRecord(user);
}

export async function fetchMainUserAuth(request: NextRequest): Promise<AuthResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  return buildLocalAuthResponse(user);
}

export async function fetchMainBootstrap(request: NextRequest): Promise<MainBootstrapResponse> {
  const totalStartedAt = performance.now();
  const authStartedAt = performance.now();
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  const auth = await buildLocalAuthResponse(user);
  const authCompletedAt = performance.now();

  let sites: SiteRecord[] = [];
  let myAccessRequests: AccessRequestRecord[] = [];
  let sitesMs = 0;
  let requestsMs = 0;

  if (user.approval_status === "approved") {
    const sitesStartedAt = performance.now();
    sites = await listSitesForMainUserRecord(user);
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
  const user = await ensureControlPlaneIdentity(identity);
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
  const { canonicalUserId, user } = await authenticateMainAppUser(
    trimText(payload.username),
    trimText(payload.password),
  );
  return buildMainAuthResponse(canonicalUserId, user);
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
  return buildMainAuthResponse(user.user_id, {
    username: user.email,
    full_name: user.full_name,
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
      (site ? rowValue<string>(site, "display_name") : institution ? rowValue<string>(institution, "name") : requestedSiteId),
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
  if (resolvedSite) {
    const resolvedSiteId = rowValue<string>(resolvedSite, "site_id");
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
