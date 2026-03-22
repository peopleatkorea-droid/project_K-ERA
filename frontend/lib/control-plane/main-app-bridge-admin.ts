import "server-only";

import { NextRequest } from "next/server";
import type { Row } from "postgres";

import type {
  AccessRequestRecord,
  AdminOverviewResponse,
  AdminWorkspaceBootstrapResponse,
  AggregationRecord,
  AuthUser,
  InstitutionDirectorySyncResponse,
  ManagedSiteRecord,
  ManagedUserRecord,
  PublicInstitutionRecord,
  ProjectRecord,
} from "../types";
import {
  controlPlaneHiraApiKey,
  controlPlaneHiraApiTimeoutMs,
  controlPlaneHiraHospitalInfoUrl,
} from "./config";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import { controlPlaneSql } from "./db";
import {
  ensureDefaultProject,
  hydrateSiteLabelsForInstitutionIds,
  institutionRowById,
  preloadAccessRequestLookups,
  serializeAccessRequestRecordWithLookups,
  serializeAccessRequestRecord,
  serializeManagedSiteRecord,
  serializeProjectRecord,
  siteRowById,
  siteRowBySourceInstitutionId,
  upsertAccessRequestRecord,
  upsertInstitutionRecord,
  upsertSiteRecord,
} from "./main-app-bridge-records";
import {
  listMainAggregationsForUser,
  listMainModelUpdatesForUser,
  listMainModelVersionsForUser,
} from "./main-app-bridge-models";
import {
  buildLegacyAuthUser,
  canonicalUserRowById,
  preloadManagedUserLookups,
  requireMainAppBridgeUser,
  serializeManagedUserRecord,
  syncCanonicalMemberships,
} from "./main-app-bridge-users";
import {
  DEFAULT_PROJECT_ID,
  HIRA_SITE_ID_PATTERN,
  mapLegacyRoleToMembershipRole,
  normalizeRegistryConsents,
  normalizeStringArray,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";
import { hashControlPlanePassword } from "./passwords";

const FIXED_RESEARCHER_ROLE = "researcher";
const AUTO_APPROVAL_REVIEWER_NOTE = "Automatically approved researcher access request.";
const HIRA_OPHTHALMOLOGY_SPECIALTY_CODE = "12";

type HiraInstitutionPage = {
  pageNo: number;
  numRows: number;
  totalCount: number;
  items: PublicInstitutionRecord[];
};

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

function pickHiraField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const directValue = record[key];
    if (directValue !== undefined && directValue !== null && String(directValue).trim()) {
      return String(directValue).trim();
    }
  }
  const lowered = new Map<string, unknown>(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const loweredValue = lowered.get(key.toLowerCase());
    if (loweredValue !== undefined && loweredValue !== null && String(loweredValue).trim()) {
      return String(loweredValue).trim();
    }
  }
  return "";
}

function normalizeHiraInstitutionRecord(record: Record<string, unknown>, syncedAt: string): PublicInstitutionRecord {
  const institutionId = pickHiraField(record, "ykiho");
  if (!institutionId) {
    throw new Error("HIRA response item is missing ykiho.");
  }
  return {
    institution_id: institutionId,
    source: "hira",
    name: pickHiraField(record, "yadmNm") || institutionId,
    institution_type_code: pickHiraField(record, "clCd"),
    institution_type_name: pickHiraField(record, "clCdNm"),
    address: pickHiraField(record, "addr"),
    phone: pickHiraField(record, "telno"),
    homepage: pickHiraField(record, "hospUrl"),
    sido_code: pickHiraField(record, "sidoCd"),
    sggu_code: pickHiraField(record, "sgguCd"),
    emdong_name: pickHiraField(record, "emdongNm"),
    postal_code: pickHiraField(record, "postNo"),
    x_pos: pickHiraField(record, "XPos", "xPos"),
    y_pos: pickHiraField(record, "YPos", "yPos"),
    ophthalmology_available: true,
    open_status: "active",
    synced_at: syncedAt,
  };
}

function coerceHiraItems(value: unknown): Record<string, unknown>[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (typeof value === "object") {
    return [value as Record<string, unknown>];
  }
  return [];
}

function normalizeSiteAlias(alias: string, officialName: string, siteId: string): string {
  const trimmedAlias = trimText(alias);
  if (!trimmedAlias) {
    return "";
  }
  if (trimmedAlias === trimText(officialName) || trimmedAlias === trimText(siteId)) {
    return "";
  }
  return trimmedAlias;
}

async function officialInstitutionNameForId(sourceInstitutionId: string | null): Promise<string> {
  if (!sourceInstitutionId) {
    return "";
  }
  const institution = await institutionRowById(sourceInstitutionId);
  return institution ? trimText(rowValue<string>(institution, "name")) : "";
}

async function fetchHiraOphthalmologyPage(pageNo: number, numRows: number): Promise<HiraInstitutionPage> {
  const serviceKey = controlPlaneHiraApiKey();
  if (!serviceKey) {
    throw new Error("KERA_HIRA_API_KEY is not configured.");
  }
  const url = new URL(controlPlaneHiraHospitalInfoUrl());
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(numRows));
  url.searchParams.set("dgsbjtCd", HIRA_OPHTHALMOLOGY_SPECIALTY_CODE);
  url.searchParams.set("_type", "json");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(controlPlaneHiraApiTimeoutMs()),
  });
  const rawText = await response.text();
  if (response.status === 401) {
    throw new Error(
      "HIRA API returned 401 Unauthorized. In data.go.kr this usually means the application approval or service activation has not propagated yet.",
    );
  }
  if (!response.ok) {
    throw new Error(`HIRA API request failed with HTTP ${response.status}: ${rawText.trim().replace(/\s+/g, " ").slice(0, 240)}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected HIRA response format: ${rawText.trim().replace(/\s+/g, " ").slice(0, 240)}`);
  }

  const responsePayload = payload.response;
  if (!responsePayload || typeof responsePayload !== "object") {
    throw new Error("HIRA JSON response is missing the top-level response object.");
  }
  const header = (responsePayload as { header?: unknown }).header;
  const headerRecord = header && typeof header === "object" ? (header as Record<string, unknown>) : {};
  const resultCode = pickHiraField(headerRecord, "resultCode");
  const resultMessage = pickHiraField(headerRecord, "resultMsg");
  if (resultCode && resultCode !== "00") {
    throw new Error(`HIRA API returned resultCode=${resultCode}: ${resultMessage || "Unknown error"}`);
  }

  const body = (responsePayload as { body?: unknown }).body;
  const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawItems =
    bodyRecord.items && typeof bodyRecord.items === "object"
      ? ((bodyRecord.items as Record<string, unknown>).item ?? bodyRecord.items)
      : bodyRecord.items;
  const syncedAt = new Date().toISOString();
  const items = coerceHiraItems(rawItems).map((item) => normalizeHiraInstitutionRecord(item, syncedAt));
  const totalCountText = pickHiraField(bodyRecord, "totalCount");
  const parsedTotalCount = Number(totalCountText);

  return {
    pageNo,
    numRows,
    totalCount: Number.isFinite(parsedTotalCount) && parsedTotalCount > 0 ? parsedTotalCount : items.length,
    items,
  };
}

async function managedUserRowForMutation(input: {
  userId?: string;
  username?: string;
}): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const normalizedUserId = trimText(input.userId);
  const normalizedUsername = trimText(input.username).toLowerCase();
  const normalizedEmail = normalizedUsername.includes("@") ? normalizeEmail(normalizedUsername) : "";
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
    where user_id = ${normalizedUserId || null}
       or username = ${normalizedUsername || null}
       or email = ${normalizedEmail || null}
    order by
      case
        when user_id = ${normalizedUserId || null} then 0
        when username = ${normalizedUsername || null} then 1
        when email = ${normalizedEmail || null} then 2
        else 3
      end
    limit 1
  `;
  return rows[0] ?? null;
}

async function listReviewerAccessRequests(
  request: NextRequest,
  statusFilter: string | null,
): Promise<AccessRequestRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listReviewerAccessRequestsForUser(user, statusFilter);
}

async function listReviewerAccessRequestsForUser(
  user: AuthUser,
  statusFilter: string | null,
): Promise<AccessRequestRecord[]> {
  assertAdminWorkspacePermission(user);
  const normalizedStatus = trimText(statusFilter);
  const sql = await controlPlaneSql();
  const rows = normalizedStatus
    ? await sql`
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
        where status = ${normalizedStatus}
        order by created_at desc
      `
    : await sql`
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
  const lookups = await preloadAccessRequestLookups(rows);
  const records = rows.map((row) => serializeAccessRequestRecordWithLookups(row, lookups));
  const permittedSiteIds = new Set(normalizeStringArray(user.site_ids));
  return records.filter((record) => {
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
  const projectId = DEFAULT_PROJECT_ID;
  const sourceInstitutionId = trimText(payload.source_institution_id) || null;
  let siteCode = trimText(payload.site_code);
  if (sourceInstitutionId && HIRA_SITE_ID_PATTERN.test(sourceInstitutionId)) {
    siteCode = sourceInstitutionId;
  }
  if (!siteCode) {
    throw new Error("Site code is required.");
  }
  const officialInstitutionName = await officialInstitutionNameForId(sourceInstitutionId);
  const hospitalName = trimText(payload.hospital_name) || officialInstitutionName || siteCode;
  if (!hospitalName) {
    throw new Error("Site hospital name is required.");
  }
  const displayName = normalizeSiteAlias(trimText(payload.display_name), hospitalName, siteCode);
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
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  assertPlatformAdmin(user);
  const existing = await siteRowById(siteId);
  if (!existing) {
    throw new Error(`Unknown site_id: ${siteId}`);
  }
  const currentSourceInstitutionId = trimText(rowValue<string | null>(existing, "source_institution_id")) || null;
  const sourceInstitutionId =
    payload.source_institution_id === undefined ? currentSourceInstitutionId : trimText(payload.source_institution_id) || null;
  const officialInstitutionName = await officialInstitutionNameForId(sourceInstitutionId);
  const existingHospitalName = trimText(rowValue<string>(existing, "hospital_name"));
  const hospitalName = trimText(payload.hospital_name) || officialInstitutionName || existingHospitalName || siteId;
  const displayName = normalizeSiteAlias(
    payload.display_name === undefined ? trimText(rowValue<string>(existing, "display_name")) : trimText(payload.display_name),
    hospitalName,
    siteId,
  );
  if (sourceInstitutionId && sourceInstitutionId !== currentSourceInstitutionId) {
    const mapped = await siteRowBySourceInstitutionId(sourceInstitutionId);
    if (mapped && rowValue<string>(mapped, "site_id") !== siteId) {
      throw new Error(
        `Institution ${sourceInstitutionId} is already linked to site ${rowValue<string>(mapped, "site_id")}.`,
      );
    }
  }
  const sql = await controlPlaneSql();
  await sql`
    update sites
    set
      display_name = ${displayName},
      hospital_name = ${hospitalName},
      source_institution_id = ${sourceInstitutionId},
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
  if (decision === "approved" && trimText(payload.assigned_role) && trimText(payload.assigned_role) !== FIXED_RESEARCHER_ROLE) {
    throw new Error("Access requests can only be approved as researcher accounts.");
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
    const canonicalRole = mapLegacyRoleToMembershipRole(FIXED_RESEARCHER_ROLE);
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
      requested_role = ${decision === "approved" ? FIXED_RESEARCHER_ROLE : current.requested_role},
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
      registry_consents: normalizeRegistryConsents(rowValue<unknown>(target, "registry_consents")),
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
  const { user } = await requireMainAppBridgeUser(request);
  return fetchMainAdminOverviewForUser(user);
}

async function fetchMainAdminOverviewForUser(user: AuthUser): Promise<AdminOverviewResponse> {
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const [
    siteCountRows,
    pendingRequestRows,
    autoApprovedRequestRows,
    modelVersionRows,
    pendingUpdateRows,
    aggregationRows,
    currentModelRows,
  ] =
    await Promise.all([
      sql`select count(*)::int as count from sites`,
      sql`select count(*)::int as count from access_requests where status = 'pending'`,
      sql`
        select count(*)::int as count
        from access_requests
        where status = 'approved'
          and reviewer_notes = ${AUTO_APPROVAL_REVIEWER_NOTE}
      `,
      sql`select count(*)::int as count from model_versions`,
      sql`select count(*)::int as count from model_updates where status = 'pending'`,
      sql`select count(*)::int as count from aggregations`,
      sql`
        select version_name
        from model_versions
        where is_current = true
        order by updated_at desc, created_at desc
        limit 1
      `,
    ]);
  return {
    site_count: Number(siteCountRows[0]?.count || 0),
    model_version_count: Number(modelVersionRows[0]?.count || 0),
    pending_access_requests: Number(pendingRequestRows[0]?.count || 0),
    auto_approved_access_requests: Number(autoApprovedRequestRows[0]?.count || 0),
    pending_model_updates: Number(pendingUpdateRows[0]?.count || 0),
    current_model_version: trimText(currentModelRows[0]?.version_name) || null,
    aggregation_count: Number(aggregationRows[0]?.count || 0),
  };
}

export async function listMainUsers(request: NextRequest): Promise<ManagedUserRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listMainUsersForUser(user);
}

async function listMainUsersForUser(user: AuthUser): Promise<ManagedUserRecord[]> {
  assertPlatformAdmin(user);
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
    order by lower(username) asc, created_at asc
  `;
  const lookups = await preloadManagedUserLookups(rows);
  return Promise.all(rows.map((row) => serializeManagedUserRecord(row, lookups)));
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
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const role = trimText(payload.role);
  if (!["admin", "site_admin", "researcher", "viewer"].includes(role)) {
    throw new Error("Invalid user role.");
  }
  const username = trimText(payload.username).toLowerCase();
  if (!username) {
    throw new Error("Username is required.");
  }
  const siteIds = normalizeStringArray(payload.site_ids);
  if (role !== "admin" && !siteIds.length) {
    throw new Error("Non-admin accounts must be assigned to at least one site.");
  }
  if (siteIds.length) {
    const sql = await controlPlaneSql();
    const rows = await sql`
      select site_id
      from sites
      where site_id = any(${siteIds})
    `;
    const knownSiteIds = new Set(rows.map((row) => trimText(rowValue<string>(row, "site_id"))));
    const missing = siteIds.filter((siteId) => !knownSiteIds.has(siteId));
    if (missing.length) {
      throw new Error(`Unknown site assignment: ${missing.join(", ")}`);
    }
  }
  const existing = await managedUserRowForMutation({
    userId: trimText(payload.user_id),
    username,
  });
  const canonicalUserId = existing ? rowValue<string>(existing, "user_id") : makeControlPlaneId("user");
  const nextPassword = trimText(payload.password)
    ? hashControlPlanePassword(trimText(payload.password))
    : trimText(existing ? rowValue<string>(existing, "password") : "");
  if (!nextPassword) {
    throw new Error("Password is required for user creation.");
  }
  const fullName = trimText(payload.full_name) || username;
  const email = username.includes("@") ? normalizeEmail(username) : normalizeEmail(`${username}@local.invalid`);
  const sql = await controlPlaneSql();
  const existingRegistryConsents = existing
    ? normalizeRegistryConsents(rowValue<unknown>(existing, "registry_consents"))
    : {};
  await sql`
    insert into users (
      user_id,
      legacy_local_user_id,
      username,
      email,
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
      ${existing ? rowValue<string | null>(existing, "legacy_local_user_id") : null},
      ${username},
      ${email},
      ${existing ? rowValue<string | null>(existing, "public_alias") : null},
      ${nextPassword},
      ${role},
      ${fullName},
      ${JSON.stringify(role === "admin" ? [] : siteIds)}::jsonb,
      ${JSON.stringify(existingRegistryConsents)}::jsonb,
      ${role === "admin" ? "admin" : trimText(existing ? rowValue<string>(existing, "global_role") : "") === "admin" ? "admin" : "member"},
      ${"active"},
      ${existing ? rowValue<string | Date>(existing, "created_at") : new Date().toISOString()},
      now()
    )
    on conflict (user_id) do update set
      username = excluded.username,
      email = excluded.email,
      password = excluded.password,
      role = excluded.role,
      full_name = excluded.full_name,
      site_ids = excluded.site_ids,
      global_role = excluded.global_role,
      status = 'active',
      updated_at = now()
  `;
  await syncCanonicalMemberships(
    canonicalUserId,
    {
      user_id: canonicalUserId,
      username,
      full_name: fullName,
      public_alias: trimText(existing ? rowValue<string | null>(existing, "public_alias") : "") || null,
      role,
      site_ids: role === "admin" ? [] : siteIds,
      approval_status: role === "admin" || siteIds.length ? "approved" : "application_required",
      latest_access_request: null,
      registry_consents: existingRegistryConsents,
    },
    { prune_absent: true },
  );
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
  const { user } = await requireMainAppBridgeUser(request);
  return listMainProjectsForUser(user);
}

async function listMainProjectsForUser(user: AuthUser): Promise<ProjectRecord[]> {
  assertAdminWorkspacePermission(user);
  await ensureDefaultProject();
  const sql = await controlPlaneSql();
  const rows = await sql`
    select project_id, name, description, owner_user_id, site_ids, created_at
    from projects
    order by created_at asc
  `;
  const fixedRows = rows.filter((row) => trimText(rowValue<string>(row, "project_id")) === DEFAULT_PROJECT_ID);
  return (fixedRows.length ? fixedRows : rows.slice(0, 1)).map((row) => serializeProjectRecord(row));
}

export async function createMainProject(
  request: NextRequest,
  _payload: { name?: string; description?: string },
): Promise<ProjectRecord> {
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  throw new Error("Projects are fixed to the default workspace.");
}

export async function listMainAdminSites(
  request: NextRequest,
  projectId?: string | null,
): Promise<ManagedSiteRecord[]> {
  const { user } = await requireMainAppBridgeUser(request);
  return listMainAdminSitesForUser(user, projectId);
}

async function listMainAdminSitesForUser(
  user: AuthUser,
  projectId?: string | null,
): Promise<ManagedSiteRecord[]> {
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
  const rows = await sql.unsafe(
    `
      select
        sites.site_id,
        sites.project_id,
        sites.display_name,
        sites.hospital_name,
        sites.source_institution_id,
        sites.local_storage_root,
        sites.research_registry_enabled,
        sites.status,
        sites.created_at,
        coalesce(site_directory.name, source_directory.name) as source_institution_name,
        coalesce(site_directory.address, source_directory.address) as source_institution_address
      from sites
      left join institution_directory as site_directory
        on site_directory.institution_id = sites.site_id
      left join institution_directory as source_directory
        on source_directory.institution_id = nullif(sites.source_institution_id, '')
      ${whereClause}
      order by
        coalesce(
          nullif(trim(site_directory.name), ''),
          nullif(trim(source_directory.name), ''),
          nullif(trim(sites.hospital_name), ''),
          nullif(trim(sites.display_name), ''),
          sites.site_id
        ) asc,
        sites.site_id asc
    `,
    queryValues,
  );
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
    source_institution_id?: string | null;
    research_registry_enabled?: boolean;
  },
): Promise<ManagedSiteRecord> {
  const { user } = await requireMainAppBridgeUser(request);
  return updateAdminSiteRecord(user, siteId, payload);
}

export async function fetchMainInstitutionDirectoryStatus(request: NextRequest): Promise<InstitutionDirectorySyncResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  return fetchMainInstitutionDirectoryStatusForUser(user);
}

async function fetchMainInstitutionDirectoryStatusForUser(user: AuthUser): Promise<InstitutionDirectorySyncResponse> {
  assertAdminWorkspacePermission(user);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      count(*)::int as count,
      max(synced_at) as synced_at
    from institution_directory
  `;
  const count = Number(rows[0]?.count || 0);
  return {
    source: "hira",
    total_count: count,
    institutions_synced: count,
    synced_at: rows[0]?.synced_at ? new Date(rows[0].synced_at as string | Date).toISOString() : null,
  };
}

async function syncMainInstitutionDirectoryForUser(
  user: AuthUser,
  payload: {
    page_size?: number;
    max_pages?: number;
  } = {},
): Promise<InstitutionDirectorySyncResponse> {
  assertPlatformAdmin(user);
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(payload.page_size) || 100)));
  const maxPages =
    payload.max_pages === undefined || payload.max_pages === null
      ? null
      : Math.max(1, Math.floor(Number(payload.max_pages) || 1));

  let pageNo = 1;
  let pagesSynced = 0;
  let totalCount = 0;
  let institutionsSynced = 0;

  while (true) {
    const page = await fetchHiraOphthalmologyPage(pageNo, pageSize);
    totalCount = Math.max(totalCount, page.totalCount);
    if (page.items.length === 0) {
      break;
    }
    for (const item of page.items) {
      await upsertInstitutionRecord(item);
    }
    await hydrateSiteLabelsForInstitutionIds(page.items.map((item) => item.institution_id));
    institutionsSynced += page.items.length;
    pagesSynced += 1;

    if (maxPages !== null && pagesSynced >= maxPages) {
      break;
    }
    if (page.totalCount && pageNo * pageSize >= page.totalCount) {
      break;
    }
    pageNo += 1;
  }

  return {
    source: "hira",
    pages_synced: pagesSynced,
    total_count: totalCount,
    institutions_synced: institutionsSynced,
    synced_at: new Date().toISOString(),
  };
}

export async function syncMainInstitutionDirectory(
  request: NextRequest,
  payload: {
    page_size?: number;
    max_pages?: number;
  } = {},
): Promise<InstitutionDirectorySyncResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  return syncMainInstitutionDirectoryForUser(user, payload);
}

export async function fetchMainAdminWorkspaceBootstrap(
  request: NextRequest,
  options: {
    siteId?: string | null;
    scope?: "full" | "initial";
  } = {},
): Promise<AdminWorkspaceBootstrapResponse> {
  const { user } = await requireMainAppBridgeUser(request);
  const normalizedSiteId = trimText(options.siteId);
  const scope = options.scope === "initial" ? "initial" : "full";
  if (scope === "initial") {
    const [overview, projects, managedSites] = await Promise.all([
      fetchMainAdminOverviewForUser(user),
      listMainProjectsForUser(user),
      listMainAdminSitesForUser(user),
    ]);
    return {
      overview,
      pending_requests: [],
      approved_requests: [],
      model_versions: [],
      model_updates: [],
      aggregations: [],
      projects,
      managed_sites: managedSites,
      managed_users: [],
      institution_sync_status: {
        source: "hira",
        institutions_synced: 0,
        total_count: 0,
        synced_at: null,
      },
    };
  }
  const [
    overview,
    pendingRequests,
    approvedRequests,
    modelVersions,
    modelUpdates,
    aggregations,
    projects,
    managedSites,
    managedUsers,
    institutionSyncStatus,
  ] = await Promise.all([
    fetchMainAdminOverviewForUser(user),
    listReviewerAccessRequestsForUser(user, "pending"),
    listReviewerAccessRequestsForUser(user, "approved"),
    listMainModelVersionsForUser(user),
    listMainModelUpdatesForUser(user, { siteId: normalizedSiteId || undefined }),
    user.role === "admin" ? listMainAggregationsForUser(user) : Promise.resolve([] as AggregationRecord[]),
    listMainProjectsForUser(user),
    listMainAdminSitesForUser(user),
    user.role === "admin" ? listMainUsersForUser(user) : Promise.resolve([] as ManagedUserRecord[]),
    fetchMainInstitutionDirectoryStatusForUser(user),
  ]);

  return {
    overview,
    pending_requests: pendingRequests,
    approved_requests: approvedRequests,
    model_versions: modelVersions,
    model_updates: modelUpdates,
    aggregations,
    projects,
    managed_sites: managedSites,
    managed_users: managedUsers,
    institution_sync_status: institutionSyncStatus,
  };
}
