import "server-only";

import { NextRequest } from "next/server";

import type {
  AccessRequestRecord,
  AdminOverviewResponse,
  AuthUser,
  InstitutionDirectorySyncResponse,
  ManagedSiteRecord,
  ManagedUserRecord,
  ProjectRecord,
} from "../types";
import { makeControlPlaneId } from "./crypto";
import { controlPlaneSql } from "./db";
import {
  ensureDefaultProject,
  latestAccessRequestForCanonicalUser,
  listAccessRequestsForCanonicalUser,
  serializeAccessRequestRecord,
  serializeManagedSiteRecord,
  serializeProjectRecord,
  siteRowById,
  siteRowBySourceInstitutionId,
  upsertAccessRequestRecord,
  upsertProjectRecord,
  upsertSiteRecord,
} from "./main-app-bridge-records";
import {
  buildLegacyAuthUser,
  canonicalUserRowById,
  ensureCanonicalUserForSeed,
  requireMainAppBridgeUser,
  seedUsersFromLocal,
  serializeManagedUserRecord,
  syncCanonicalMemberships,
  upsertCanonicalUser,
} from "./main-app-bridge-users";
import {
  DEFAULT_PROJECT_ID,
  fetchLegacyLocalNodeApi,
  HIRA_SITE_ID_PATTERN,
  legacyEmailForLocalUser,
  mapLegacyRoleToMembershipRole,
  normalizeRegistryConsents,
  normalizeStringArray,
  readBearerToken,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";

export async function seedAccessRequestsFromLocal(
  request: NextRequest,
  token: string,
  canonicalUserId: string,
  email: string,
  scope: "self" | "reviewer",
  statusFilter = "pending",
): Promise<void> {
  const path =
    scope === "self"
      ? "/api/auth/access-requests"
      : `/api/admin/access-requests?status_filter=${encodeURIComponent(statusFilter)}`;
  const records = await fetchLegacyLocalNodeApi<AccessRequestRecord[]>(request, path, {}, token);
  for (const record of records) {
    const ownerCanonicalUserId =
      scope === "self"
        ? canonicalUserId
        : await ensureCanonicalUserForSeed({
            legacyLocalUserId: trimText(record.user_id) || null,
            email: trimText(record.email) || email,
            fullName: trimText(record.email) || trimText(record.user_id) || "External User",
          });
    await upsertAccessRequestRecord(ownerCanonicalUserId, trimText(record.email) || email, record);
  }
}

async function seedProjectsFromLocal(request: NextRequest, token: string): Promise<void> {
  const records = await fetchLegacyLocalNodeApi<ProjectRecord[]>(request, "/api/admin/projects", {}, token);
  for (const record of records) {
    await upsertProjectRecord(record);
  }
}

async function seedAdminSitesFromLocal(request: NextRequest, token: string): Promise<void> {
  const records = await fetchLegacyLocalNodeApi<ManagedSiteRecord[]>(request, "/api/admin/sites", {}, token);
  for (const record of records) {
    await upsertSiteRecord(record);
  }
}

function assertAdminWorkspacePermission(user: AuthUser): void {
  if (user.role !== "admin" && user.role !== "site_admin") {
    throw new Error("Admin or site admin access required.");
  }
}

function assertPlatformAdmin(user: AuthUser): void {
  if (user.role !== "admin") {
    throw new Error("Platform admin access required.");
  }
}

async function listReviewerAccessRequests(
  request: NextRequest,
  statusFilter: string | null,
): Promise<AccessRequestRecord[]> {
  const token = readBearerToken(request);
  const { canonicalUserId, localUser, user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
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
    order by created_at desc
  `;
  let records = await Promise.all(rows.map((row) => serializeAccessRequestRecord(row)));
  if (!records.length) {
    await seedAccessRequestsFromLocal(
      request,
      token,
      canonicalUserId,
      legacyEmailForLocalUser(localUser),
      "reviewer",
      statusFilter || "pending",
    );
    const refreshedRows = await sql`
      select
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
      order by created_at desc
    `;
    records = await Promise.all(refreshedRows.map((row) => serializeAccessRequestRecord(row)));
  }
  const normalizedStatus = trimText(statusFilter);
  const permittedSiteIds = new Set(normalizeStringArray(user.site_ids));
  return records.filter((record) => {
    if (normalizedStatus && record.status !== normalizedStatus) {
      return false;
    }
    if (user.role === "admin") {
      return true;
    }
    if (record.resolved_site_id && permittedSiteIds.has(record.resolved_site_id)) {
      return true;
    }
    return permittedSiteIds.has(record.requested_site_id);
  });
}

async function createAdminSiteRecord(
  user: AuthUser,
  payload: {
    project_id?: string;
    site_code?: string;
    display_name?: string;
    hospital_name?: string;
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  assertPlatformAdmin(user);
  const projectId = trimText(payload.project_id) || DEFAULT_PROJECT_ID;
  const sourceInstitutionId = trimText(payload.source_institution_id) || null;
  let siteCode = trimText(payload.site_code);
  if (sourceInstitutionId && HIRA_SITE_ID_PATTERN.test(sourceInstitutionId)) {
    siteCode = sourceInstitutionId;
  }
  if (!siteCode) {
    throw new Error("Site code is required.");
  }
  const displayName = trimText(payload.display_name) || trimText(payload.hospital_name) || siteCode;
  if (!displayName) {
    throw new Error("Site display name is required.");
  }
  const hospitalName = trimText(payload.hospital_name) || displayName;
  const existingSite = await siteRowById(siteCode);
  if (existingSite) {
    throw new Error(`Site ${siteCode} already exists.`);
  }
  if (sourceInstitutionId) {
    const mapped = await siteRowBySourceInstitutionId(sourceInstitutionId);
    if (mapped) {
      throw new Error(
        `Institution ${sourceInstitutionId} is already linked to site ${rowValue<string>(mapped, "site_id")}.`,
      );
    }
  }
  await upsertSiteRecord({
    site_id: siteCode,
    project_id: projectId,
    display_name: displayName,
    hospital_name: hospitalName,
    source_institution_id: sourceInstitutionId,
    local_storage_root: "",
    research_registry_enabled: payload.research_registry_enabled ?? true,
  });
  const created = await siteRowById(siteCode);
  if (!created) {
    throw new Error("Unable to create site.");
  }
  return serializeManagedSiteRecord(created);
}

async function updateAdminSiteRecord(
  user: AuthUser,
  siteId: string,
  payload: {
    display_name?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  assertPlatformAdmin(user);
  const existing = await siteRowById(siteId);
  if (!existing) {
    throw new Error(`Unknown site_id: ${siteId}`);
  }
  const displayName = trimText(payload.display_name) || rowValue<string>(existing, "display_name");
  const hospitalName = trimText(payload.hospital_name) || rowValue<string>(existing, "hospital_name");
  const sql = await controlPlaneSql();
  await sql`
    update sites
    set
      display_name = ${displayName},
      hospital_name = ${hospitalName},
      research_registry_enabled = ${payload.research_registry_enabled ?? Boolean(rowValue<boolean>(existing, "research_registry_enabled"))},
      updated_at = now()
    where site_id = ${siteId}
  `;
  const updated = await siteRowById(siteId);
  if (!updated) {
    throw new Error("Unable to update site.");
  }
  return serializeManagedSiteRecord(updated);
}

async function reviewMainAccessRequestRecord(
  request: NextRequest,
  requestId: string,
  reviewerCanonicalUserId: string,
  reviewer: AuthUser,
  payload: {
    decision?: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    create_site_if_missing?: boolean;
    project_id?: string;
    site_code?: string;
    display_name?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
    reviewer_notes?: string;
  },
): Promise<{ request: AccessRequestRecord; created_site?: ManagedSiteRecord | null }> {
  assertAdminWorkspacePermission(reviewer);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
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
    where request_id = ${requestId}
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Unknown access request.");
  }
  const current = await serializeAccessRequestRecord(row);
  if (current.status !== "pending") {
    throw new Error("Only pending requests can be reviewed.");
  }
  const decision = payload.decision;
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Invalid review decision.");
  }
  let createdSite: ManagedSiteRecord | null = null;
  let targetSiteId = trimText(payload.assigned_site_id) || current.resolved_site_id || current.requested_site_id;
  if (payload.create_site_if_missing) {
    assertPlatformAdmin(reviewer);
    if (decision !== "approved") {
      throw new Error("Site creation during request review is only available for approvals.");
    }
    if (current.requested_site_source !== "institution_directory") {
      throw new Error("Only institution-directory requests can create a new site during review.");
    }
    const mappedSite = await siteRowBySourceInstitutionId(current.requested_site_id);
    if (mappedSite) {
      targetSiteId = rowValue<string>(mappedSite, "site_id");
    } else {
      createdSite = await createAdminSiteRecord(reviewer, {
        project_id: payload.project_id,
        site_code: payload.site_code,
        display_name: payload.display_name || current.requested_site_label,
        hospital_name: payload.hospital_name || current.requested_site_label,
        source_institution_id: current.requested_site_id,
        research_registry_enabled: payload.research_registry_enabled ?? false,
      });
      targetSiteId = createdSite.site_id;
    }
  }
  if (decision === "approved") {
    if (!targetSiteId) {
      throw new Error("Approved access requests must be assigned to an existing site.");
    }
    const targetSite = await siteRowById(targetSiteId);
    if (!targetSite) {
      throw new Error("Approved access requests must be assigned to an existing site.");
    }
    if (reviewer.role !== "admin") {
      const reviewerSiteIds = new Set(normalizeStringArray(reviewer.site_ids));
      if (!reviewerSiteIds.has(targetSiteId)) {
        throw new Error("You cannot review requests for this site.");
      }
    }
    const canonicalRole = mapLegacyRoleToMembershipRole(trimText(payload.assigned_role) || current.requested_role);
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
        ${current.user_id},
        ${targetSiteId},
        ${canonicalRole},
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
  await sql`
    update access_requests
    set
      status = ${decision},
      requested_site_id = ${targetSiteId},
      requested_role = ${trimText(payload.assigned_role) || current.requested_role},
      reviewed_by = ${reviewerCanonicalUserId},
      reviewer_notes = ${trimText(payload.reviewer_notes)},
      reviewed_at = now()
    where request_id = ${requestId}
  `;
  const targetUserRows = await sql`
    select legacy_local_user_id, username, public_alias, full_name, role, site_ids, registry_consents
    from users
    where user_id = ${current.user_id}
    limit 1
  `;
  const target = targetUserRows[0];
  if (target) {
    const localView: AuthUser = {
      user_id: trimText(target.legacy_local_user_id) || current.user_id,
      username: trimText(target.username),
      full_name: trimText(target.full_name),
      public_alias: trimText(target.public_alias) || null,
      role: (trimText(target.role) || "viewer") as AuthUser["role"],
      site_ids: normalizeStringArray(target.site_ids),
      approval_status: decision === "approved" ? "approved" : "rejected",
      latest_access_request: null,
      registry_consents: normalizeRegistryConsents(target.registry_consents),
    };
    await buildLegacyAuthUser(current.user_id, localView);
  }
  const refreshedRows = await sql`
    select
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
    where request_id = ${requestId}
    limit 1
  `;
  const refreshed = refreshedRows[0] ? await serializeAccessRequestRecord(refreshedRows[0]) : current;
  return {
    request: refreshed,
    created_site: createdSite,
  };
}

export async function listMainAdminAccessRequests(
  request: NextRequest,
  statusFilter: string | null,
): Promise<AccessRequestRecord[]> {
  return listReviewerAccessRequests(request, statusFilter);
}

export async function fetchMainAdminOverview(request: NextRequest): Promise<AdminOverviewResponse> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const [sites, pendingRequests, localOverview] = await Promise.all([
    listMainAdminSites(request),
    listMainAdminAccessRequests(request, "pending"),
    fetchLegacyLocalNodeApi<AdminOverviewResponse>(request, "/api/admin/overview", {}, token),
  ]);
  return {
    ...localOverview,
    site_count: sites.length,
    pending_access_requests: pendingRequests.length,
  };
}

export async function listMainUsers(request: NextRequest): Promise<ManagedUserRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const sql = await controlPlaneSql();
  let rows = await sql`
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
    order by lower(username) asc, created_at asc
  `;
  if (rows.length <= 1) {
    await seedUsersFromLocal(request, token);
    rows = await sql`
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
      order by lower(username) asc, created_at asc
    `;
  }
  return Promise.all(rows.map((row) => serializeManagedUserRecord(row)));
}

export async function upsertMainUser(
  request: NextRequest,
  payload: {
    user_id?: string;
    username?: string;
    full_name?: string;
    password?: string;
    role?: string;
    site_ids?: string[];
  },
): Promise<ManagedUserRecord> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const role = trimText(payload.role);
  if (!["admin", "site_admin", "researcher", "viewer"].includes(role)) {
    throw new Error("Invalid user role.");
  }
  const siteIds = normalizeStringArray(payload.site_ids);
  if (role !== "admin" && !siteIds.length) {
    throw new Error("Non-admin accounts must be assigned to at least one site.");
  }
  const localProjection = await fetchLegacyLocalNodeApi<ManagedUserRecord>(
    request,
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        user_id: trimText(payload.user_id) || undefined,
        username: trimText(payload.username),
        full_name: trimText(payload.full_name),
        password: trimText(payload.password),
        role,
        site_ids: siteIds,
      }),
    },
    token,
  );
  const canonicalUserId = await upsertCanonicalUser(localProjection);
  await syncCanonicalMemberships(canonicalUserId, localProjection, { prune_absent: true });
  const canonicalRow = await canonicalUserRowById(canonicalUserId);
  if (!canonicalRow) {
    throw new Error("Unable to update user.");
  }
  return serializeManagedUserRecord(canonicalRow);
}

export async function reviewMainAccessRequest(
  request: NextRequest,
  requestId: string,
  payload: {
    decision?: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    create_site_if_missing?: boolean;
    project_id?: string;
    site_code?: string;
    display_name?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
    reviewer_notes?: string;
  },
): Promise<{ request: AccessRequestRecord; created_site?: ManagedSiteRecord | null }> {
  const { canonicalUserId, user } = await requireMainAppBridgeUser(request);
  return reviewMainAccessRequestRecord(request, requestId, canonicalUserId, user, payload);
}

export async function listMainProjects(request: NextRequest): Promise<ProjectRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  await ensureDefaultProject();
  const sql = await controlPlaneSql();
  let rows = await sql`
    select project_id, name, description, owner_user_id, site_ids, created_at
    from projects
    order by created_at asc
  `;
  if (user.role === "admin" && rows.length <= 1) {
    await seedProjectsFromLocal(request, token);
    rows = await sql`
      select project_id, name, description, owner_user_id, site_ids, created_at
      from projects
      order by created_at asc
    `;
  }
  return rows.map((row) => serializeProjectRecord(row));
}

export async function createMainProject(
  request: NextRequest,
  payload: { name?: string; description?: string },
): Promise<ProjectRecord> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const name = trimText(payload.name);
  if (!name) {
    throw new Error("Project name is required.");
  }
  const projectId = makeControlPlaneId("project");
  await upsertProjectRecord({
    project_id: projectId,
    name,
    description: trimText(payload.description),
    owner_user_id: user.user_id,
    site_ids: [],
  });
  const sql = await controlPlaneSql();
  const rows = await sql`
    select project_id, name, description, owner_user_id, site_ids, created_at
    from projects
    where project_id = ${projectId}
    limit 1
  `;
  if (!rows[0]) {
    throw new Error("Unable to create project.");
  }
  return serializeProjectRecord(rows[0]);
}

export async function listMainAdminSites(
  request: NextRequest,
  projectId?: string | null,
): Promise<ManagedSiteRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const normalizedProjectId = trimText(projectId || "");
  const siteIds = normalizeStringArray(user.site_ids);
  const queryValues: Array<string | string[]> = [];
  const conditions: string[] = [];
  if (normalizedProjectId) {
    queryValues.push(normalizedProjectId);
    conditions.push(`project_id = $${queryValues.length}`);
  }
  if (user.role !== "admin") {
    queryValues.push(siteIds);
    conditions.push(`site_id = any($${queryValues.length})`);
  }
  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  let rows = await sql.unsafe(
    `
      select
        site_id,
        project_id,
        display_name,
        hospital_name,
        source_institution_id,
        local_storage_root,
        research_registry_enabled,
        status,
        created_at
      from sites
      ${whereClause}
      order by display_name asc, site_id asc
    `,
    queryValues,
  );
  if (user.role === "admin" && !rows.length) {
    await seedAdminSitesFromLocal(request, token);
    rows = await sql.unsafe(
      `
        select
          site_id,
          project_id,
          display_name,
          hospital_name,
          source_institution_id,
          local_storage_root,
          research_registry_enabled,
          status,
          created_at
        from sites
        ${whereClause}
        order by display_name asc, site_id asc
      `,
      queryValues,
    );
  }
  return rows.map((row) => serializeManagedSiteRecord(row));
}

export async function createMainAdminSite(
  request: NextRequest,
  payload: {
    project_id?: string;
    site_code?: string;
    display_name?: string;
    hospital_name?: string;
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  const { user } = await requireMainAppBridgeUser(request);
  return createAdminSiteRecord(user, payload);
}

export async function updateMainAdminSite(
  request: NextRequest,
  siteId: string,
  payload: {
    display_name?: string;
    hospital_name?: string;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  const { user } = await requireMainAppBridgeUser(request);
  return updateAdminSiteRecord(user, siteId, payload);
}

export async function fetchMainInstitutionDirectoryStatus(request: NextRequest): Promise<InstitutionDirectorySyncResponse> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      count(*)::int as count,
      max(synced_at) as synced_at
    from institution_directory
  `;
  const count = Number(rows[0]?.count || 0);
  if (!count) {
    return fetchLegacyLocalNodeApi<InstitutionDirectorySyncResponse>(
      request,
      "/api/admin/institutions/status",
      {},
      token,
    );
  }
  return {
    source: "hira",
    total_count: count,
    institutions_synced: count,
    synced_at: rows[0]?.synced_at ? new Date(rows[0].synced_at as string | Date).toISOString() : null,
  };
}
