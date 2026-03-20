import "server-only";

import { NextRequest } from "next/server";
import type { Row } from "postgres";

import type { AccessRequestRecord, AuthResponse, AuthState, AuthUser, ManagedUserRecord } from "../types";
import type { ControlPlaneMembership, ControlPlaneUser } from "./types";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import { controlPlaneSql } from "./db";
import {
  latestAccessRequestForCanonicalUser,
  preloadAccessRequestLookups,
  serializeAccessRequestRecordWithLookups,
  upsertAccessRequestRecord,
  upsertSiteRecord,
} from "./main-app-bridge-records";
import {
  buildLocalAuthResponse,
  DEFAULT_PROJECT_ID,
  legacyEmailForLocalUser,
  MainAppTokenClaims,
  mapLegacyRoleToMembershipRole,
  normalizeRegistryConsents,
  normalizeSiteIdPreservingCase,
  normalizeStringArray,
  readMainAppTokenClaims,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";
import { verifyControlPlanePassword } from "./passwords";
import { getControlPlaneUser } from "./store";

export type LocalMainAppUser = AuthUser;

export type CanonicalUserContext = {
  canonicalUserId: string;
  localUser: LocalMainAppUser;
  user: AuthUser;
};

type ManagedUserSerializationLookups = {
  canonicalUsersById: Map<string, ControlPlaneUser>;
  latestRequestsByUserId: Map<string, AccessRequestRecord | null>;
};

function serializeBulkMembership(row: Row): ControlPlaneMembership {
  return {
    membership_id: rowValue<string>(row, "membership_id"),
    site_id: rowValue<string>(row, "site_id"),
    role: rowValue<ControlPlaneMembership["role"]>(row, "role"),
    status: rowValue<ControlPlaneMembership["status"]>(row, "status"),
    approved_at: rowValue<string | Date | null>(row, "approved_at")
      ? new Date(rowValue<string | Date>(row, "approved_at")).toISOString()
      : null,
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    site: rowValue<string | null>(row, "site_id")
      ? {
          site_id: rowValue<string>(row, "site_id"),
          display_name: rowValue<string>(row, "display_name"),
          hospital_name: rowValue<string>(row, "hospital_name"),
          source_institution_id: rowValue<string | null>(row, "source_institution_id"),
          status: rowValue<string>(row, "status_1") || rowValue<string>(row, "status"),
          created_at: new Date(rowValue<string | Date>(row, "created_at_1") || rowValue<string | Date>(row, "created_at")).toISOString(),
        }
      : null,
  };
}

function serializeBulkCanonicalUser(row: Row, memberships: ControlPlaneMembership[]): ControlPlaneUser {
  return {
    user_id: rowValue<string>(row, "user_id"),
    email: rowValue<string>(row, "email"),
    full_name: rowValue<string>(row, "full_name"),
    google_sub: rowValue<string | null>(row, "google_sub"),
    global_role: rowValue<ControlPlaneUser["global_role"]>(row, "global_role"),
    status: rowValue<ControlPlaneUser["status"]>(row, "status"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    memberships,
  };
}

export async function preloadManagedUserLookups(rows: Row[]): Promise<ManagedUserSerializationLookups> {
  const userIds = Array.from(new Set(rows.map((row) => trimText(rowValue<string>(row, "user_id"))).filter(Boolean)));
  if (userIds.length === 0) {
    return {
      canonicalUsersById: new Map(),
      latestRequestsByUserId: new Map(),
    };
  }
  const sql = await controlPlaneSql();
  const [userRows, membershipRows, latestRequestRows] = await Promise.all([
    sql`
      select user_id, email, google_sub, full_name, global_role, status, created_at
      from users
      where user_id = any(${userIds})
    `,
    sql`
      select
        m.user_id,
        m.membership_id,
        m.site_id,
        m.role,
        m.status,
        m.approved_at,
        m.created_at,
        s.site_id,
        s.display_name,
        s.hospital_name,
        s.source_institution_id,
        s.status as status_1,
        s.created_at as created_at_1
      from site_memberships as m
      left join sites as s on s.site_id = m.site_id
      where m.user_id = any(${userIds})
      order by m.created_at asc
    `,
    sql`
      select distinct on (user_id)
        request_id,
        user_id,
        email,
        requested_site_id,
        requested_site_label,
        requested_site_source,
        requested_role,
        message,
        status,
        reviewed_by,
        reviewer_notes,
        created_at,
        reviewed_at
      from access_requests
      where user_id = any(${userIds})
      order by user_id, created_at desc
    `,
  ]);
  const membershipsByUserId = new Map<string, ControlPlaneMembership[]>();
  for (const row of membershipRows) {
    const userId = trimText(rowValue<string>(row, "user_id"));
    if (!userId) {
      continue;
    }
    const items = membershipsByUserId.get(userId) ?? [];
    items.push(serializeBulkMembership(row));
    membershipsByUserId.set(userId, items);
  }
  const canonicalUsersById = new Map<string, ControlPlaneUser>();
  for (const row of userRows) {
    const userId = trimText(rowValue<string>(row, "user_id"));
    if (!userId) {
      continue;
    }
    canonicalUsersById.set(userId, serializeBulkCanonicalUser(row, membershipsByUserId.get(userId) ?? []));
  }
  const latestRequestLookups = await preloadAccessRequestLookups(latestRequestRows);
  const latestRequestsByUserId = new Map<string, AccessRequestRecord | null>();
  for (const row of latestRequestRows) {
    const userId = trimText(rowValue<string>(row, "user_id"));
    if (!userId) {
      continue;
    }
    latestRequestsByUserId.set(userId, serializeAccessRequestRecordWithLookups(row, latestRequestLookups));
  }
  for (const userId of userIds) {
    if (!latestRequestsByUserId.has(userId)) {
      latestRequestsByUserId.set(userId, null);
    }
  }
  return {
    canonicalUsersById,
    latestRequestsByUserId,
  };
}

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

async function canonicalUserRowForTokenClaims(claims: MainAppTokenClaims): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const claimSub = trimText(claims.sub);
  const claimUsername = trimText(claims.username).toLowerCase();
  const claimEmail = claimUsername.includes("@") ? normalizeEmail(claimUsername) : "";
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
    where user_id = ${claimSub || null}
       or legacy_local_user_id = ${claimSub || null}
       or username = ${claimUsername || null}
       or email = ${claimEmail || null}
    order by
      case
        when user_id = ${claimSub || null} then 0
        when legacy_local_user_id = ${claimSub || null} then 1
        when username = ${claimUsername || null} then 2
        when email = ${claimEmail || null} then 3
        else 4
      end
    limit 1
  `;
  return rows[0] ?? null;
}

async function canonicalUserRowForLogin(login: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const normalized = trimText(login).toLowerCase();
  const email = normalized.includes("@") ? normalizeEmail(normalized) : "";
  const rows = await sql`
    select
      user_id,
      legacy_local_user_id,
      username,
      public_alias,
      email,
      full_name,
      password,
      role,
      site_ids,
      registry_consents,
      global_role,
      status,
      created_at
    from users
    where username = ${normalized || null}
       or email = ${email || null}
    order by
      case
        when username = ${normalized || null} then 0
        when email = ${email || null} then 1
        else 2
      end
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

export async function serializeManagedUserRecord(
  row: Row,
  lookups?: ManagedUserSerializationLookups,
): Promise<ManagedUserRecord> {
  const canonicalUserId = rowValue<string>(row, "user_id");
  const canonicalUser =
    lookups && lookups.canonicalUsersById.has(canonicalUserId)
      ? lookups.canonicalUsersById.get(canonicalUserId) ?? null
      : await getControlPlaneUser(canonicalUserId);
  const latestRequest =
    lookups && lookups.latestRequestsByUserId.has(canonicalUserId)
      ? lookups.latestRequestsByUserId.get(canonicalUserId) ?? null
      : await latestAccessRequestForCanonicalUser(canonicalUserId);
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

function fallbackUserFromClaims(claims: MainAppTokenClaims): AuthUser {
  const fallbackUserId = trimText(claims.sub) || makeControlPlaneId("user");
  const fallbackUsername = trimText(claims.username) || fallbackUserId;
  return {
    user_id: fallbackUserId,
    username: fallbackUsername,
    full_name: trimText(claims.full_name) || fallbackUsername,
    public_alias: trimText(claims.public_alias) || null,
    role: (trimText(claims.role) || "viewer") as AuthUser["role"],
    site_ids: normalizeStringArray(claims.site_ids),
    approval_status: (claims.approval_status || "application_required") as AuthState,
    latest_access_request: null,
    registry_consents: normalizeRegistryConsents(claims.registry_consents),
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
    registry_consents: normalizeRegistryConsents(
      canonicalRow ? rowValue<unknown>(canonicalRow, "registry_consents") : localUser.registry_consents,
    ),
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

export async function buildMainAuthUser(
  canonicalUserId: string,
  fallback?: Partial<AuthUser>,
): Promise<AuthUser> {
  const canonicalUser = await getControlPlaneUser(canonicalUserId);
  const canonicalRow = await canonicalUserRowById(canonicalUserId);
  if (!canonicalUser || !canonicalRow) {
    throw new Error("Authentication required.");
  }
  const latestRequest = await latestAccessRequestForCanonicalUser(canonicalUserId);
  const approvedSiteIds = canonicalUser.memberships
    .filter((membership) => membership.status === "approved")
    .map((membership) => membership.site_id);
  return {
    user_id: canonicalUserId,
    username:
      trimText(rowValue<string>(canonicalRow, "username")) ||
      trimText(canonicalUser.email) ||
      trimText(fallback?.username) ||
      canonicalUserId,
    full_name: trimText(canonicalUser.full_name) || trimText(fallback?.full_name) || canonicalUserId,
    public_alias:
      trimText(rowValue<string | null>(canonicalRow, "public_alias")) ||
      trimText(fallback?.public_alias) ||
      null,
    role: deriveLegacyRoleFromCanonical(
      canonicalUser,
      ((trimText(fallback?.role) || trimText(rowValue<string>(canonicalRow, "role")) || "viewer") as AuthUser["role"]),
    ),
    site_ids: approvedSiteIds,
    approval_status: deriveApprovalStatusFromCanonical(canonicalUser, latestRequest),
    latest_access_request: latestRequest,
    registry_consents: normalizeRegistryConsents(rowValue<unknown>(canonicalRow, "registry_consents")),
  };
}

export async function requireMainAppBridgeUser(request: NextRequest): Promise<CanonicalUserContext> {
  const claims = await readMainAppTokenClaims(request);
  const canonicalRow = await canonicalUserRowForTokenClaims(claims);
  if (!canonicalRow) {
    throw new Error("Authentication required.");
  }
  const canonicalUserId = rowValue<string>(canonicalRow, "user_id");
  const localUser = fallbackUserFromClaims(claims);
  const user = await buildMainAuthUser(canonicalUserId, localUser);
  return {
    canonicalUserId,
    localUser,
    user,
  };
}

export async function authenticateMainAppUser(
  usernameOrEmail: string,
  password: string,
): Promise<CanonicalUserContext> {
  const normalizedLogin = trimText(usernameOrEmail);
  const normalizedPassword = String(password || "");
  if (!normalizedLogin || !normalizedPassword) {
    throw new Error("Username and password are required.");
  }
  const row = await canonicalUserRowForLogin(normalizedLogin);
  if (!row) {
    throw new Error("Invalid credentials.");
  }
  const status = trimText(rowValue<string>(row, "status")) || "active";
  if (status !== "active") {
    throw new Error("This account is disabled.");
  }
  if (!verifyControlPlanePassword(normalizedPassword, trimText(rowValue<string>(row, "password")))) {
    throw new Error("Invalid credentials.");
  }
  const canonicalUserId = rowValue<string>(row, "user_id");
  const user = await buildMainAuthUser(canonicalUserId, {
    username: trimText(rowValue<string>(row, "username")) || normalizedLogin,
    full_name: trimText(rowValue<string>(row, "full_name")) || normalizedLogin,
    public_alias: trimText(rowValue<string | null>(row, "public_alias")) || null,
    role: (trimText(rowValue<string>(row, "role")) || "viewer") as AuthUser["role"],
    site_ids: normalizeStringArray(rowValue<unknown>(row, "site_ids")),
    approval_status: "application_required",
    registry_consents: normalizeRegistryConsents(rowValue<unknown>(row, "registry_consents")),
  });
  if (user.role !== "admin" && user.role !== "site_admin") {
    throw new Error("Local username/password login is restricted to admin and site admin accounts. Researchers use Google sign-in.");
  }
  return {
    canonicalUserId,
    localUser: user,
    user,
  };
}

export async function buildMainAuthResponse(canonicalUserId: string, fallback?: Partial<AuthUser>): Promise<AuthResponse> {
  const user = await buildMainAuthUser(canonicalUserId, fallback);
  return buildLocalAuthResponse(user);
}
