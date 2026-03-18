import "server-only";

import { NextRequest } from "next/server";

import type {
  AccessRequestRecord,
  AuthResponse,
  AuthUser,
  ResearchRegistrySettingsResponse,
  SiteRecord,
} from "../types";
import { makeControlPlaneId } from "./crypto";
import { controlPlaneSql } from "./db";
import { verifyGoogleIdentityToken } from "./google";
export {
  createMainAdminSite,
  createMainProject,
  fetchMainAdminOverview,
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
  ensureDefaultProject,
  institutionRowById,
  latestAccessRequestForCanonicalUser,
  listAccessRequestsForCanonicalUser,
  serializeSiteRecord,
  siteRowById,
  upsertAccessRequestRecord,
} from "./main-app-bridge-records";
import { seedAccessRequestsFromLocal } from "./main-app-bridge-admin";
import {
  buildLegacyAuthUser,
  buildMainAuthFromLocalToken,
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

export async function fetchSitesForMainUser(request: NextRequest): Promise<SiteRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  const siteIds = normalizeStringArray(user.site_ids);
  if (!siteIds.length) {
    return [];
  }
  const sql = await controlPlaneSql();
  const rows = await sql`
    select site_id, display_name, hospital_name
    from sites
    where site_id = any(${siteIds})
    order by display_name asc, site_id asc
  `;
  return rows.map((row) => serializeSiteRecord(row));
}

export async function fetchMainUserAuth(request: NextRequest): Promise<AuthResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  return buildLocalAuthResponse(user);
}

export async function loginMainWithGoogle(request: NextRequest, idToken: string): Promise<AuthResponse> {
  const normalizedIdToken = trimText(idToken);
  if (!normalizedIdToken) {
    throw new Error("id_token is required.");
  }
  const identity = await verifyGoogleIdentityToken(normalizedIdToken);
  await ensureControlPlaneIdentity(identity);
  const localAuth = await fetchLegacyLocalNodeApi<AuthResponse>(
    request,
    "/api/auth/google",
    {
      method: "POST",
      body: JSON.stringify({ id_token: normalizedIdToken }),
    },
  );
  const localToken = trimText(localAuth.access_token);
  if (!localToken) {
    throw new Error("Local node did not return an access token.");
  }
  return buildMainAuthFromLocalToken(request, localToken);
}

export async function loginMainWithLocalCredentials(
  request: NextRequest,
  payload: { username?: string; password?: string },
): Promise<AuthResponse> {
  const localAuth = await fetchLegacyLocalNodeApi<AuthResponse>(
    request,
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        username: trimText(payload.username),
        password: trimText(payload.password),
      }),
    },
  );
  const localToken = trimText(localAuth.access_token);
  if (!localToken) {
    throw new Error("Local node did not return an access token.");
  }
  return buildMainAuthFromLocalToken(request, localToken);
}

export async function devLoginMain(request: NextRequest): Promise<AuthResponse> {
  const localAuth = await fetchLegacyLocalNodeApi<AuthResponse>(
    request,
    "/api/auth/dev-login",
    {
      method: "POST",
    },
  );
  const localToken = trimText(localAuth.access_token);
  if (!localToken) {
    throw new Error("Local node did not return an access token.");
  }
  return buildMainAuthFromLocalToken(request, localToken);
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
  const auth = await buildLocalAuthResponse(refreshedUser);
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
  const token = readBearerToken(request);
  const { canonicalUserId, localUser } = await requireMainAppBridgeUser(request);
  let records = await listAccessRequestsForCanonicalUser(canonicalUserId);
  if (!records.length) {
    await seedAccessRequestsFromLocal(request, token, canonicalUserId, legacyEmailForLocalUser(localUser), "self");
    records = await listAccessRequestsForCanonicalUser(canonicalUserId);
  }
  return records;
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
  const requestedRole = trimText(payload.requested_role) || "viewer";
  if (!["site_admin", "researcher", "viewer"].includes(requestedRole)) {
    throw new Error("Invalid requested role.");
  }
  const requestedSiteId = trimText(payload.requested_site_id);
  if (!requestedSiteId) {
    throw new Error("Requested institution is required.");
  }
  const site = await siteRowById(requestedSiteId);
  const institution = await institutionRowById(requestedSiteId);
  if (!site && !institution) {
    throw new Error("Unknown site.");
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
  const refreshedUser = await buildLegacyAuthUser(canonicalUserId, user);
  const auth = await buildLocalAuthResponse(refreshedUser);
  const stored = await listAccessRequestsForCanonicalUser(canonicalUserId);
  return {
    ...auth,
    request: stored[0] ?? requestRecord,
  };
}
