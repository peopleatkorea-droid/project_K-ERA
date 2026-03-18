import "server-only";

import { NextRequest } from "next/server";
import type { Row } from "postgres";

import type { AccessRequestRecord, AuthResponse, AuthState, AuthUser, ManagedUserRecord } from "../types";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import { controlPlaneSql } from "./db";
import {
  ensureDefaultProject,
  latestAccessRequestForCanonicalUser,
  upsertAccessRequestRecord,
  upsertSiteRecord,
} from "./main-app-bridge-records";
import {
  buildLocalAuthResponse,
  DEFAULT_PROJECT_ID,
  fetchLegacyLocalNodeApi,
  fetchLocalNodeApi,
  legacyEmailForLocalUser,
  mapLegacyRoleToMembershipRole,
  normalizeRegistryConsents,
  normalizeSiteIdPreservingCase,
  normalizeStringArray,
  readBearerToken,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";
import { getControlPlaneUser } from "./store";

export type LocalMainAppUser = AuthUser;

export type CanonicalUserContext = {
  canonicalUserId: string;
  localUser: LocalMainAppUser;
  user: AuthUser;
};

export async function ensureCanonicalUserForSeed(input: {
  legacyLocalUserId?: string | null;
  email?: string | null;
  fullName?: string | null;
}): Promise<string> {
  const sql = await controlPlaneSql();
  const legacyLocalUserId = trimText(input.legacyLocalUserId) || null;
  const email = normalizeEmail(trimText(input.email) || `${legacyLocalUserId || makeControlPlaneId("user")}@local.invalid`);
  const rows = await sql`
    select user_id, created_at
    from users
    where legacy_local_user_id = ${legacyLocalUserId} or email = ${email}
    order by case when legacy_local_user_id = ${legacyLocalUserId} then 0 else 1 end
    limit 1
  `;
  if (rows[0]) {
    return rowValue<string>(rows[0], "user_id");
  }
  const userId = makeControlPlaneId("user");
  await sql`
    insert into users (
      user_id,
      legacy_local_user_id,
      username,
      email,
      password,
      role,
      full_name,
      site_ids,
      registry_consents,
      global_role,
      status,
      created_at,
      updated_at
    ) values (
      ${userId},
      ${legacyLocalUserId},
      ${email},
      ${email},
      ${"__bridge__"},
      ${"viewer"},
      ${trimText(input.fullName) || email},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({})}::jsonb,
      ${"member"},
      ${"active"},
      now(),
      now()
    )
  `;
  return userId;
}

export async function canonicalUserRowById(canonicalUserId: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      user_id,
      legacy_local_user_id,
      username,
      public_alias,
      email,
      full_name,
      role,
      site_ids,
      registry_consents,
      global_role,
      status,
      created_at
    from users
    where user_id = ${canonicalUserId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function seedUsersFromLocal(request: NextRequest, token: string): Promise<void> {
  const records = await fetchLegacyLocalNodeApi<ManagedUserRecord[]>(request, "/api/admin/users", {}, token);
  for (const record of records) {
    const canonicalUserId = await upsertCanonicalUser(record);
    await syncCanonicalMemberships(canonicalUserId, record, { prune_absent: true });
  }
}

async function canonicalUserRowForLocalUser(localUser: LocalMainAppUser): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const email = legacyEmailForLocalUser(localUser);
  const rows = await sql`
    select
      user_id,
      legacy_local_user_id,
      username,
      public_alias,
      email,
      full_name,
      role,
      site_ids,
      registry_consents,
      global_role,
      status,
      created_at
    from users
    where legacy_local_user_id = ${localUser.user_id} or email = ${email}
    order by case when legacy_local_user_id = ${localUser.user_id} then 0 else 1 end
    limit 1
  `;
  return rows[0] ?? null;
}

export async function upsertCanonicalUser(localUser: LocalMainAppUser): Promise<string> {
  const sql = await controlPlaneSql();
  const existing = await canonicalUserRowForLocalUser(localUser);
  const canonicalUserId = existing ? rowValue<string>(existing, "user_id") : makeControlPlaneId("user");
  const globalRole =
    trimText(existing ? rowValue<string>(existing, "global_role") : "") === "admin" || localUser.role === "admin"
      ? "admin"
      : "member";
  await sql`
    insert into users (
      user_id,
      legacy_local_user_id,
      username,
      email,
      google_sub,
      public_alias,
      password,
      role,
      full_name,
      site_ids,
      registry_consents,
      global_role,
      status,
      created_at,
      updated_at
    ) values (
      ${canonicalUserId},
      ${localUser.user_id},
      ${trimText(localUser.username).toLowerCase()},
      ${legacyEmailForLocalUser(localUser)},
      ${null},
      ${trimText(localUser.public_alias) || null},
      ${"__bridge__"},
      ${trimText(localUser.role) || "viewer"},
      ${trimText(localUser.full_name) || trimText(localUser.username) || localUser.user_id},
      ${JSON.stringify(normalizeStringArray(localUser.site_ids))}::jsonb,
      ${JSON.stringify(normalizeRegistryConsents(localUser.registry_consents))}::jsonb,
      ${globalRole},
      ${"active"},
      ${existing ? rowValue<string | Date>(existing, "created_at") : new Date().toISOString()},
      now()
    )
    on conflict (user_id) do update set
      legacy_local_user_id = excluded.legacy_local_user_id,
      username = excluded.username,
      email = excluded.email,
      public_alias = coalesce(excluded.public_alias, users.public_alias),
      role = excluded.role,
      full_name = excluded.full_name,
      site_ids = excluded.site_ids,
      registry_consents = excluded.registry_consents,
      global_role = case
        when users.global_role = 'admin' then users.global_role
        else excluded.global_role
      end,
      status = 'active',
      updated_at = now()
  `;
  return canonicalUserId;
}

export async function syncCanonicalMemberships(
  canonicalUserId: string,
  localUser: LocalMainAppUser,
  options?: { prune_absent?: boolean },
): Promise<void> {
  const sql = await controlPlaneSql();
  const siteIds = normalizeStringArray(localUser.site_ids).map((siteId) => normalizeSiteIdPreservingCase(siteId));
  const membershipRole = mapLegacyRoleToMembershipRole(localUser.role);
  if (options?.prune_absent) {
    if (siteIds.length) {
      await sql`
        delete from site_memberships
        where user_id = ${canonicalUserId}
          and status = 'approved'
          and not (site_id = any(${siteIds}))
      `;
    } else {
      await sql`
        delete from site_memberships
        where user_id = ${canonicalUserId}
          and status = 'approved'
      `;
    }
  }
  for (const siteId of siteIds) {
    await upsertSiteRecord({
      site_id: siteId,
      project_id: DEFAULT_PROJECT_ID,
      display_name: siteId,
      hospital_name: siteId,
      research_registry_enabled: true,
    });
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
        ${siteId},
        ${membershipRole},
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
  }
}

async function syncLatestLocalAccessRequest(canonicalUserId: string, localUser: LocalMainAppUser): Promise<void> {
  if (!localUser.latest_access_request) {
    return;
  }
  await upsertAccessRequestRecord(canonicalUserId, legacyEmailForLocalUser(localUser), localUser.latest_access_request);
}

export async function serializeManagedUserRecord(row: Row): Promise<ManagedUserRecord> {
  const canonicalUserId = rowValue<string>(row, "user_id");
  const canonicalUser = await getControlPlaneUser(canonicalUserId);
  const latestRequest = await latestAccessRequestForCanonicalUser(canonicalUserId);
  const fallbackRole = (trimText(rowValue<string>(row, "role")) || "viewer") as AuthUser["role"];
  const approvedSiteIds =
    canonicalUser?.memberships.filter((membership) => membership.status === "approved").map((membership) => membership.site_id) ??
    normalizeStringArray(rowValue<unknown>(row, "site_ids"));
  const localUserId = trimText(rowValue<string | null>(row, "legacy_local_user_id")) || canonicalUserId;
  return {
    user_id: localUserId,
    username: trimText(rowValue<string>(row, "username")) || trimText(rowValue<string>(row, "email")) || localUserId,
    full_name:
      trimText(rowValue<string>(row, "full_name")) ||
      trimText(rowValue<string>(row, "username")) ||
      trimText(rowValue<string>(row, "email")) ||
      localUserId,
    public_alias: trimText(rowValue<string | null>(row, "public_alias")) || null,
    role: deriveLegacyRoleFromCanonical(canonicalUser, fallbackRole),
    site_ids: approvedSiteIds,
    approval_status: deriveApprovalStatusFromCanonical(canonicalUser, latestRequest),
    latest_access_request: latestRequest,
    registry_consents: normalizeRegistryConsents(rowValue<unknown>(row, "registry_consents")),
  };
}

function deriveLegacyRoleFromCanonical(
  user: Awaited<ReturnType<typeof getControlPlaneUser>>,
  fallbackRole: AuthUser["role"],
): AuthUser["role"] {
  if (!user) {
    return fallbackRole;
  }
  if (user.global_role === "admin") {
    return "admin";
  }
  const approvedMemberships = user.memberships.filter((membership) => membership.status === "approved");
  if (approvedMemberships.some((membership) => membership.role === "site_admin")) {
    return "site_admin";
  }
  if (approvedMemberships.some((membership) => membership.role === "member")) {
    return "researcher";
  }
  if (approvedMemberships.some((membership) => membership.role === "viewer")) {
    return "viewer";
  }
  return fallbackRole;
}

function deriveApprovalStatusFromCanonical(
  user: Awaited<ReturnType<typeof getControlPlaneUser>>,
  latestRequest: AccessRequestRecord | null,
): AuthState {
  if (user?.global_role === "admin") {
    return "approved";
  }
  if (user?.memberships.some((membership) => membership.status === "approved")) {
    return "approved";
  }
  if (latestRequest?.status) {
    return latestRequest.status;
  }
  return "application_required";
}

export async function buildLegacyAuthUser(
  canonicalUserId: string,
  localUser: LocalMainAppUser,
): Promise<AuthUser> {
  const canonicalUser = await getControlPlaneUser(canonicalUserId);
  const canonicalRow = await canonicalUserRowById(canonicalUserId);
  const latestRequest = await latestAccessRequestForCanonicalUser(canonicalUserId);
  const approvedSiteIds = canonicalUser
    ? canonicalUser.memberships.filter((membership) => membership.status === "approved").map((membership) => membership.site_id)
    : normalizeStringArray(localUser.site_ids);
  const nextUser: AuthUser = {
    user_id: localUser.user_id,
    username: trimText(localUser.username),
    full_name: trimText(canonicalUser?.full_name) || trimText(localUser.full_name) || trimText(localUser.username),
    public_alias: trimText(localUser.public_alias) || null,
    role: deriveLegacyRoleFromCanonical(canonicalUser, localUser.role),
    site_ids: approvedSiteIds,
    approval_status: deriveApprovalStatusFromCanonical(canonicalUser, latestRequest),
    latest_access_request: latestRequest,
    registry_consents: normalizeRegistryConsents(canonicalRow?.registry_consents ?? localUser.registry_consents),
  };
  const sql = await controlPlaneSql();
  await sql`
    update users
    set
      legacy_local_user_id = ${localUser.user_id},
      username = ${nextUser.username.toLowerCase()},
      public_alias = ${nextUser.public_alias || null},
      role = ${nextUser.role},
      full_name = ${nextUser.full_name},
      site_ids = ${JSON.stringify(nextUser.site_ids || [])}::jsonb,
      registry_consents = ${JSON.stringify(nextUser.registry_consents || {})}::jsonb,
      updated_at = now()
    where user_id = ${canonicalUserId}
  `;
  return nextUser;
}

export async function requireMainAppBridgeUser(request: NextRequest): Promise<CanonicalUserContext> {
  return requireMainAppBridgeUserWithToken(request, readBearerToken(request));
}

async function requireMainAppBridgeUserWithToken(
  request: NextRequest,
  token: string,
): Promise<CanonicalUserContext> {
  const localUser = await fetchLocalNodeApi<LocalMainAppUser>(request, "/api/auth/me", {}, token);
  await ensureDefaultProject();
  const canonicalUserId = await upsertCanonicalUser(localUser);
  await syncCanonicalMemberships(canonicalUserId, localUser);
  await syncLatestLocalAccessRequest(canonicalUserId, localUser);
  const user = await buildLegacyAuthUser(canonicalUserId, localUser);
  return {
    canonicalUserId,
    localUser,
    user,
  };
}

export async function buildMainAuthFromLocalToken(request: NextRequest, localToken: string): Promise<AuthResponse> {
  const { user } = await requireMainAppBridgeUserWithToken(request, localToken);
  return buildLocalAuthResponse(user);
}
