import type { Row } from "postgres";

import { controlPlaneAdminEmails, controlPlaneLlmApiKey } from "./config";
import { controlPlaneSql } from "./db";
import { hashNodeToken, makeControlPlaneId, makeNodeToken, normalizeEmail, normalizeSiteId } from "./crypto";
import { getSiteAlias, getSiteOfficialName } from "../site-labels";
import type {
  ControlPlaneAggregation,
  ControlPlaneAggregationStatus,
  ControlPlaneAuditEvent,
  ControlPlaneFederationMonitoringSummary,
  ControlPlaneGlobalRole,
  ControlPlaneBootstrap,
  ControlPlaneIdentity,
  ControlPlaneMembership,
  ControlPlaneMembershipStatus,
  ControlPlaneModelUpdate,
  ControlPlaneModelUpdateStatus,
  ControlPlaneModelVersion,
  ControlPlaneNode,
  ControlPlaneOverview,
  ControlPlaneReleaseManifest,
  ControlPlaneReleaseRollout,
  ControlPlaneReleaseRolloutStage,
  ControlPlaneReleaseRolloutStatus,
  ControlPlaneRolloutSiteAdoption,
  ControlPlaneRetrievalCorpusEntry,
  ControlPlaneRetrievalCorpusProfile,
  ControlPlaneRetrievalCorpusSearchHit,
  ControlPlaneSite,
  ControlPlaneSiteRole,
  ControlPlaneUser,
  ControlPlaneUserStatus,
  ControlPlaneValidationRun,
} from "./types";

function rowValue<T>(row: Row, key: string): T {
  return row[key] as T;
}

function serializeSite(row: Row | null): ControlPlaneSite | null {
  if (!row) {
    return null;
  }
  const siteId = rowValue<string>(row, "site_id");
  const sourceInstitutionName = rowValue<string | null | undefined>(row, "source_institution_name");
  const rawSite = {
    site_id: siteId,
    display_name: rowValue<string>(row, "display_name"),
    hospital_name: rowValue<string>(row, "hospital_name"),
    source_institution_name: sourceInstitutionName,
  };
  const officialName = getSiteOfficialName(rawSite, siteId);
  const siteAlias = getSiteAlias(rawSite);
  const site: ControlPlaneSite = {
    site_id: siteId,
    display_name: officialName,
    hospital_name: officialName,
    ...(siteAlias ? { site_alias: siteAlias } : {}),
    source_institution_id: rowValue<string | null>(row, "source_institution_id"),
    status: rowValue<string>(row, "status"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
  if (typeof sourceInstitutionName === "string" && sourceInstitutionName.trim()) {
    site.source_institution_name = sourceInstitutionName.trim();
  }
  return site;
}

function serializeMembership(row: Row): ControlPlaneMembership {
  return {
    membership_id: rowValue<string>(row, "membership_id"),
    site_id: rowValue<string>(row, "site_id"),
    role: rowValue<ControlPlaneSiteRole>(row, "role"),
    status: rowValue<ControlPlaneMembershipStatus>(row, "status"),
    approved_at: rowValue<string | Date | null>(row, "approved_at")
      ? new Date(rowValue<string | Date>(row, "approved_at")).toISOString()
      : null,
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    site: serializeSite(row),
  };
}

function serializeUser(row: Row, memberships: ControlPlaneMembership[]): ControlPlaneUser {
  return {
    user_id: rowValue<string>(row, "user_id"),
    email: rowValue<string>(row, "email"),
    full_name: rowValue<string>(row, "full_name"),
    google_sub: rowValue<string | null>(row, "google_sub"),
    global_role: rowValue<"admin" | "member">(row, "global_role"),
    status: rowValue<ControlPlaneUserStatus>(row, "status"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    memberships,
  };
}

function serializeNode(row: Row): ControlPlaneNode {
  return {
    node_id: rowValue<string>(row, "node_id"),
    site_id: rowValue<string>(row, "site_id"),
    registered_by_user_id: rowValue<string>(row, "registered_by_user_id"),
    device_name: rowValue<string>(row, "device_name"),
    os_info: rowValue<string>(row, "os_info"),
    app_version: rowValue<string>(row, "app_version"),
    current_model_version_id: rowValue<string | null>(row, "current_model_version_id"),
    current_model_version_name: rowValue<string | null>(row, "current_model_version_name"),
    status: rowValue<"active" | "revoked">(row, "status"),
    last_seen_at: rowValue<string | Date | null>(row, "last_seen_at")
      ? new Date(rowValue<string | Date>(row, "last_seen_at")).toISOString()
      : null,
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

function serializeModelVersion(row: Row): ControlPlaneModelVersion {
  const metadata = rowValue<Record<string, unknown> | null>(row, "metadata_json") || {};
  return {
    version_id: rowValue<string>(row, "version_id"),
    version_name: rowValue<string>(row, "version_name"),
    architecture: rowValue<string>(row, "architecture"),
    source_provider: rowValue<string>(row, "source_provider"),
    download_url: rowValue<string>(row, "download_url"),
    sha256: rowValue<string>(row, "sha256"),
    size_bytes: Number(rowValue<number | string>(row, "size_bytes") || 0),
    ready: Boolean(rowValue<boolean>(row, "ready")),
    is_current: Boolean(rowValue<boolean>(row, "is_current")),
    metadata_json: metadata,
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

function serializeModelUpdate(row: Row): ControlPlaneModelUpdate {
  return {
    update_id: rowValue<string>(row, "update_id"),
    site_id: rowValue<string | null>(row, "site_id"),
    node_id: rowValue<string | null>(row, "node_id"),
    base_model_version_id: rowValue<string | null>(row, "base_model_version_id"),
    status: rowValue<ControlPlaneModelUpdateStatus>(row, "status"),
    payload_json: rowValue<Record<string, unknown> | null>(row, "payload_json") || {},
    review_thumbnail_url: rowValue<string | null>(row, "review_thumbnail_url"),
    reviewer_user_id: rowValue<string | null>(row, "reviewer_user_id"),
    reviewer_notes: rowValue<string>(row, "reviewer_notes"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    reviewed_at: rowValue<string | Date | null>(row, "reviewed_at")
      ? new Date(rowValue<string | Date>(row, "reviewed_at")).toISOString()
      : null,
  };
}

function serializeAggregation(row: Row): ControlPlaneAggregation {
  return {
    aggregation_id: rowValue<string>(row, "aggregation_id"),
    base_model_version_id: rowValue<string | null>(row, "base_model_version_id"),
    new_version_id: rowValue<string | null>(row, "new_version_id"),
    status: rowValue<ControlPlaneAggregationStatus>(row, "status"),
    triggered_by_user_id: rowValue<string | null>(row, "triggered_by_user_id"),
    summary_json: rowValue<Record<string, unknown> | null>(row, "summary_json") || {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    finished_at: rowValue<string | Date | null>(row, "finished_at")
      ? new Date(rowValue<string | Date>(row, "finished_at")).toISOString()
      : null,
  };
}

function serializeReleaseRollout(row: Row): ControlPlaneReleaseRollout {
  return {
    rollout_id: rowValue<string>(row, "rollout_id"),
    version_id: rowValue<string>(row, "version_id"),
    version_name: rowValue<string>(row, "version_name"),
    architecture: rowValue<string>(row, "architecture"),
    previous_version_id: rowValue<string | null>(row, "previous_version_id"),
    previous_version_name: rowValue<string | null>(row, "previous_version_name"),
    stage: rowValue<ControlPlaneReleaseRolloutStage>(row, "stage"),
    status: rowValue<ControlPlaneReleaseRolloutStatus>(row, "status"),
    target_site_ids: Array.isArray(rowValue<unknown>(row, "target_site_ids"))
      ? (rowValue<unknown[]>(row, "target_site_ids").filter((item): item is string => typeof item === "string"))
      : [],
    notes: rowValue<string>(row, "notes"),
    metadata_json: rowValue<Record<string, unknown> | null>(row, "metadata_json") || {},
    created_by_user_id: rowValue<string | null>(row, "created_by_user_id"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    activated_at: rowValue<string | Date | null>(row, "activated_at")
      ? new Date(rowValue<string | Date>(row, "activated_at")).toISOString()
      : null,
    superseded_at: rowValue<string | Date | null>(row, "superseded_at")
      ? new Date(rowValue<string | Date>(row, "superseded_at")).toISOString()
      : null,
  };
}

function serializeAuditEvent(row: Row): ControlPlaneAuditEvent {
  return {
    event_id: rowValue<string>(row, "event_id"),
    actor_type: rowValue<string>(row, "actor_type"),
    actor_id: rowValue<string | null>(row, "actor_id"),
    action: rowValue<string>(row, "action"),
    target_type: rowValue<string>(row, "target_type"),
    target_id: rowValue<string | null>(row, "target_id"),
    payload_json: rowValue<Record<string, unknown> | null>(row, "payload_json") || {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

function serializeValidationRun(row: Row): ControlPlaneValidationRun {
  return {
    validation_id: rowValue<string>(row, "validation_id"),
    site_id: rowValue<string | null>(row, "site_id"),
    node_id: rowValue<string | null>(row, "node_id"),
    model_version_id: rowValue<string | null>(row, "model_version_id"),
    run_date: rowValue<string | Date | null>(row, "run_date")
      ? new Date(rowValue<string | Date>(row, "run_date")).toISOString()
      : null,
    summary_json: rowValue<Record<string, unknown> | null>(row, "summary_json") || {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

function serializeRetrievalCorpusProfile(row: Row): ControlPlaneRetrievalCorpusProfile {
  return {
    profile_id: rowValue<string>(row, "profile_id"),
    retrieval_signature: rowValue<string>(row, "retrieval_signature"),
    metadata_json: rowValue<Record<string, unknown> | null>(row, "metadata_json") || {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    updated_at: new Date(rowValue<string | Date>(row, "updated_at")).toISOString(),
  };
}

function serializeRetrievalCorpusEntry(row: Row): ControlPlaneRetrievalCorpusEntry {
  return {
    entry_id: rowValue<string>(row, "entry_id"),
    site_id: rowValue<string | null>(row, "site_id"),
    node_id: rowValue<string | null>(row, "node_id"),
    profile_id: rowValue<string>(row, "profile_id"),
    retrieval_signature: rowValue<string>(row, "retrieval_signature"),
    case_reference_id: rowValue<string>(row, "case_reference_id"),
    culture_category: rowValue<string>(row, "culture_category"),
    culture_species: rowValue<string>(row, "culture_species"),
    embedding_dim: Number(rowValue<number | string>(row, "embedding_dim") || 0),
    thumbnail_url: rowValue<string | null>(row, "thumbnail_url"),
    metadata_json: rowValue<Record<string, unknown> | null>(row, "metadata_json") || {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    updated_at: new Date(rowValue<string | Date>(row, "updated_at")).toISOString(),
  };
}

function normalizeEmbedding(values: unknown): number[] {
  if (!Array.isArray(values)) {
    throw new Error("Embedding must be an array.");
  }
  const normalized = values
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
  if (normalized.length === 0) {
    throw new Error("Embedding must contain at least one finite number.");
  }
  return normalized;
}

function normalizeVectorForCosine(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    throw new Error("Embedding norm is invalid.");
  }
  return vector.map((value) => value / norm);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("Embedding dimensions do not match.");
  }
  const lhs = normalizeVectorForCosine(left);
  const rhs = normalizeVectorForCosine(right);
  return lhs.reduce((sum, value, index) => sum + (value * rhs[index]), 0);
}

async function membershipsForUser(userId: string): Promise<ControlPlaneMembership[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
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
      s.status,
      s.created_at,
      coalesce(site_directory.name, source_directory.name) as source_institution_name
    from site_memberships as m
    left join sites as s on s.site_id = m.site_id
    left join institution_directory as site_directory
      on site_directory.institution_id = s.site_id
    left join institution_directory as source_directory
      on source_directory.institution_id = nullif(s.source_institution_id, '')
    where m.user_id = ${userId}
    order by m.created_at asc
  `;
  return rows.map((row) => serializeMembership(row));
}

async function userRowById(userId: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select user_id, email, google_sub, full_name, global_role, status, created_at
    from users
    where user_id = ${userId}
    limit 1
  `;
  return rows[0] ?? null;
}

async function userRowByEmail(email: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select user_id, email, google_sub, full_name, global_role, status, created_at
    from users
    where email = ${normalizeEmail(email)}
    limit 1
  `;
  return rows[0] ?? null;
}

async function writeAuditEvent(
  actorType: string,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into audit_events (
      event_id,
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      payload_json
    ) values (
      ${makeControlPlaneId("audit")},
      ${actorType},
      ${actorId},
      ${action},
      ${targetType},
      ${targetId},
      ${JSON.stringify(payload)}::jsonb
    )
  `;
}

export async function appendAuditEvent(input: {
  actorType: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditEvent(
    input.actorType,
    input.actorId ?? null,
    input.action,
    input.targetType,
    input.targetId ?? null,
    input.payload ?? {},
  );
}

function shouldPromoteToAdmin(email: string): boolean {
  return controlPlaneAdminEmails().includes(normalizeEmail(email));
}

export async function getControlPlaneUser(userId: string): Promise<ControlPlaneUser | null> {
  const row = await userRowById(userId);
  if (!row) {
    return null;
  }
  const memberships = await membershipsForUser(userId);
  return serializeUser(row, memberships);
}

export async function ensureControlPlaneIdentity(
  identity: ControlPlaneIdentity,
  options?: { skipAutoAdminPromotion?: boolean },
): Promise<ControlPlaneUser> {
  const sql = await controlPlaneSql();
  const email = normalizeEmail(identity.email);
  const existingByEmail = await userRowByEmail(email);
  const userId = existingByEmail ? rowValue<string>(existingByEmail, "user_id") : makeControlPlaneId("user");
  let nextRole: "admin" | "member" = shouldPromoteToAdmin(email) ? "admin" : "member";

  if (existingByEmail) {
    nextRole = rowValue<"admin" | "member">(existingByEmail, "global_role");
    if (shouldPromoteToAdmin(email)) {
      nextRole = "admin";
    }
  }

  await sql`
    insert into users (
      user_id,
      username,
      email,
      google_sub,
      password,
      role,
      full_name,
      site_ids,
      registry_consents,
      global_role,
      status
    ) values (
      ${userId},
      ${email},
      ${email},
      ${identity.googleSub || null},
      ${"__control_plane__"},
      ${nextRole === "admin" ? "admin" : "viewer"},
      ${identity.fullName.trim() || email},
      ${JSON.stringify([])}::jsonb,
      ${JSON.stringify({})}::jsonb,
      ${nextRole},
      ${"active"}
    )
    on conflict (email) do update set
      username = excluded.username,
      google_sub = coalesce(excluded.google_sub, users.google_sub),
      role = case
        when users.role = 'admin' then users.role
        else excluded.role
      end,
      full_name = excluded.full_name,
      global_role = case
        when users.global_role = 'admin' then users.global_role
        else excluded.global_role
      end,
      status = 'active',
      updated_at = now()
  `;

  const user = await getControlPlaneUser(userId);
  if (!user) {
    throw new Error("Unable to create or load the control-plane user.");
  }
  await writeAuditEvent("user", user.user_id, "auth.identity.upserted", "user", user.user_id, { email: user.email });
  return user;
}

export async function setControlPlaneUserGlobalRole(
  userId: string,
  globalRole: ControlPlaneGlobalRole,
): Promise<ControlPlaneUser> {
  const sql = await controlPlaneSql();
  await sql`
    update users
    set
      global_role = ${globalRole},
      updated_at = now()
    where user_id = ${userId}
  `;
  const user = await getControlPlaneUser(userId);
  if (!user) {
    throw new Error("Unable to update the control-plane user role.");
  }
  await writeAuditEvent("user", user.user_id, "user.role.updated", "user", user.user_id, {
    global_role: user.global_role,
  });
  return user;
}

export async function createSiteForUser(options: {
  userId: string;
  siteId: string;
  displayName: string;
  hospitalName: string;
  sourceInstitutionId?: string | null;
  role?: ControlPlaneSiteRole;
}): Promise<ControlPlaneSite> {
  const sql = await controlPlaneSql();
  const siteId = normalizeSiteId(options.siteId);
  const siteAlias = (() => {
    const trimmedDisplayName = options.displayName.trim();
    const trimmedHospitalName = options.hospitalName.trim();
    if (!trimmedDisplayName || trimmedDisplayName === trimmedHospitalName || trimmedDisplayName === siteId) {
      return "";
    }
    return trimmedDisplayName;
  })();
  const hospitalName = options.hospitalName.trim() || siteAlias || siteId;
  const now = new Date().toISOString();
  await sql`
    insert into sites (
      site_id,
      project_id,
      display_name,
      hospital_name,
      source_institution_id,
      local_storage_root,
      research_registry_enabled,
      status,
      created_at,
      updated_at
    ) values (
      ${siteId},
      ${"project_default"},
      ${siteAlias},
      ${hospitalName},
      ${options.sourceInstitutionId || null},
      ${""},
      ${true},
      ${"active"},
      ${now},
      ${now}
    )
    on conflict (site_id) do update set
      display_name = excluded.display_name,
      hospital_name = excluded.hospital_name,
      source_institution_id = coalesce(excluded.source_institution_id, sites.source_institution_id),
      updated_at = now()
  `;
  await sql`
    insert into site_memberships (
      membership_id,
      user_id,
      site_id,
      role,
      status,
      approved_at
    ) values (
      ${makeControlPlaneId("membership")},
      ${options.userId},
      ${siteId},
      ${options.role || "site_admin"},
      ${"approved"},
      now()
    )
    on conflict (user_id, site_id) do update set
      role = excluded.role,
      status = 'approved',
      approved_at = coalesce(site_memberships.approved_at, excluded.approved_at),
      updated_at = now()
  `;
  const rows = await sql`
    select site_id, display_name, hospital_name, source_institution_id, status, created_at
    from sites
    where site_id = ${siteId}
    limit 1
  `;
  const site = serializeSite(rows[0] ?? null);
  if (!site) {
    throw new Error("Unable to create site.");
  }
  await writeAuditEvent("user", options.userId, "site.created_or_bound", "site", site.site_id, {
    display_name: site.display_name,
  });
  return site;
}

export async function currentReleaseManifest(): Promise<ControlPlaneReleaseManifest | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where is_current = true
    order by updated_at desc
    limit 1
  `;
  return rows[0] ? serializeModelVersion(rows[0]) : null;
}

async function latestApplicableActiveRollout(siteId?: string | null): Promise<ControlPlaneReleaseRollout | null> {
  const sql = await controlPlaneSql();
  const normalizedSiteId = siteId?.trim() || "";
  const rows = normalizedSiteId
    ? await sql`
        select
          rollout_id,
          version_id,
          version_name,
          architecture,
          previous_version_id,
          previous_version_name,
          stage,
          status,
          target_site_ids,
          notes,
          metadata_json,
          created_by_user_id,
          activated_at,
          superseded_at,
          created_at
        from release_rollouts
        where
          status = 'active'
          and stage in ('pilot', 'partial', 'rollback')
          and exists (
            select 1
            from jsonb_array_elements_text(target_site_ids) as target_site(target_site_id)
            where target_site.target_site_id = ${normalizedSiteId}
          )
        order by created_at desc
        limit 1
      `
    : await sql`
        select
          rollout_id,
          version_id,
          version_name,
          architecture,
          previous_version_id,
          previous_version_name,
          stage,
          status,
          target_site_ids,
          notes,
          metadata_json,
          created_by_user_id,
          activated_at,
          superseded_at,
          created_at
        from release_rollouts
        where
          status = 'active'
          and stage in ('full', 'rollback')
          and jsonb_array_length(target_site_ids) = 0
        order by created_at desc
        limit 1
      `;
  return rows[0] ? serializeReleaseRollout(rows[0]) : null;
}

async function latestActiveReleaseRollout(): Promise<ControlPlaneReleaseRollout | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      rollout_id,
      version_id,
      version_name,
      architecture,
      previous_version_id,
      previous_version_name,
      stage,
      status,
      target_site_ids,
      notes,
      metadata_json,
      created_by_user_id,
      activated_at,
      superseded_at,
      created_at
    from release_rollouts
    where status = 'active'
    order by created_at desc
    limit 1
  `;
  return rows[0] ? serializeReleaseRollout(rows[0]) : null;
}

export async function currentReleaseManifestForSite(siteId?: string | null): Promise<ControlPlaneReleaseManifest | null> {
  const activeRollout = await latestApplicableActiveRollout(siteId);
  if (!activeRollout) {
    return currentReleaseManifest();
  }
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where version_id = ${activeRollout.version_id}
    limit 1
  `;
  return rows[0] ? serializeModelVersion(rows[0]) : currentReleaseManifest();
}

export async function listReleaseRollouts(): Promise<ControlPlaneReleaseRollout[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      rollout_id,
      version_id,
      version_name,
      architecture,
      previous_version_id,
      previous_version_name,
      stage,
      status,
      target_site_ids,
      notes,
      metadata_json,
      created_by_user_id,
      activated_at,
      superseded_at,
      created_at
    from release_rollouts
    order by created_at desc
  `;
  return rows.map((row) => serializeReleaseRollout(row));
}

export async function createReleaseRollout(input: {
  actorUserId: string;
  versionId: string;
  stage: ControlPlaneReleaseRolloutStage;
  targetSiteIds?: string[];
  notes?: string;
}): Promise<ControlPlaneReleaseRollout> {
  const sql = await controlPlaneSql();
  const normalizedVersionId = input.versionId.trim();
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const normalizedStage = input.stage;
  const normalizedTargetSiteIds = Array.from(
    new Set((input.targetSiteIds ?? []).map((value) => value.trim()).filter(Boolean)),
  );
  if ((normalizedStage === "pilot" || normalizedStage === "partial") && normalizedTargetSiteIds.length === 0) {
    throw new Error("Pilot and partial rollout require at least one target site.");
  }
  if (normalizedTargetSiteIds.length > 0) {
    const siteRows = await sql`
      select site_id
      from sites
      where site_id = any(${normalizedTargetSiteIds})
    `;
    const knownSiteIds = new Set(siteRows.map((row) => rowValue<string>(row, "site_id")));
    const unknownSiteIds = normalizedTargetSiteIds.filter((siteId) => !knownSiteIds.has(siteId));
    if (unknownSiteIds.length > 0) {
      throw new Error(`Unknown site ids: ${unknownSiteIds.join(", ")}`);
    }
  }

  const versionRows = await sql`
    select
      version_id,
      version_name,
      architecture,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where version_id = ${normalizedVersionId}
    limit 1
  `;
  const version = versionRows[0] ? serializeModelVersion(versionRows[0]) : null;
  if (!version) {
    throw new Error("Model version not found.");
  }
  if (!version.ready) {
    throw new Error("Only ready model versions can be rolled out.");
  }

  const previousCurrent = await currentReleaseManifest();
  await sql`
    update release_rollouts
    set
      status = 'superseded',
      superseded_at = now(),
      updated_at = now()
    where status = 'active' and architecture = ${version.architecture}
  `;
  if ((normalizedStage === "full" || normalizedStage === "rollback") && normalizedTargetSiteIds.length === 0) {
    await sql`update model_versions set is_current = false, updated_at = now() where is_current = true`;
    await sql`
      update model_versions
      set
        is_current = true,
        updated_at = now()
      where version_id = ${normalizedVersionId}
    `;
  }

  const rolloutId = makeControlPlaneId("rollout");
  const rows = await sql`
    insert into release_rollouts (
      rollout_id,
      version_id,
      version_name,
      architecture,
      previous_version_id,
      previous_version_name,
      stage,
      status,
      target_site_ids,
      notes,
      metadata_json,
      created_by_user_id,
      activated_at,
      created_at,
      updated_at
    ) values (
      ${rolloutId},
      ${version.version_id},
      ${version.version_name},
      ${version.architecture},
      ${previousCurrent?.version_id ?? null},
      ${previousCurrent?.version_name ?? ""},
      ${normalizedStage},
      ${"active"},
      ${JSON.stringify(normalizedTargetSiteIds)}::jsonb,
      ${input.notes?.trim() || ""},
      ${JSON.stringify({
        target_scope: normalizedTargetSiteIds.length > 0 ? "site_subset" : "all_sites",
        previous_is_current: previousCurrent?.version_id === version.version_id,
      })}::jsonb,
      ${input.actorUserId},
      now(),
      now(),
      now()
    )
    returning
      rollout_id,
      version_id,
      version_name,
      architecture,
      previous_version_id,
      previous_version_name,
      stage,
      status,
      target_site_ids,
      notes,
      metadata_json,
      created_by_user_id,
      activated_at,
      superseded_at,
      created_at
  `;
  const rollout = rows[0] ? serializeReleaseRollout(rows[0]) : null;
  if (!rollout) {
    throw new Error("Unable to create release rollout.");
  }
  await writeAuditEvent("user", input.actorUserId, "release_rollout.created", "release_rollout", rollout.rollout_id, {
    version_id: rollout.version_id,
    stage: rollout.stage,
    target_site_ids: rollout.target_site_ids,
  });
  return rollout;
}

export async function listAuditEvents(options: { limit?: number } = {}): Promise<ControlPlaneAuditEvent[]> {
  const sql = await controlPlaneSql();
  const limit = Math.max(1, Math.min(options.limit ?? 12, 100));
  const rows = await sql`
    select
      event_id,
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      payload_json,
      created_at
    from audit_events
    order by created_at desc
    limit ${limit}
  `;
  return rows.map((row) => serializeAuditEvent(row));
}

export async function listModelVersions(): Promise<ControlPlaneModelVersion[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    order by is_current desc, created_at desc
  `;
  return rows.map((row) => serializeModelVersion(row));
}

export async function publishModelVersion(input: {
  actorUserId: string;
  versionId?: string;
  versionName: string;
  architecture: string;
  sourceProvider?: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  ready?: boolean;
  isCurrent?: boolean;
  metadataJson?: Record<string, unknown>;
}): Promise<ControlPlaneModelVersion> {
  const sql = await controlPlaneSql();
  const versionId = input.versionId?.trim() || makeControlPlaneId("model");
  const setCurrent = input.isCurrent ?? true;
  const now = new Date().toISOString();
  if (setCurrent) {
    await sql`update model_versions set is_current = false, updated_at = now() where is_current = true`;
  }
  await sql`
    insert into model_versions (
      version_id,
      version_name,
      architecture,
      stage,
      payload_json,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at,
      updated_at
    ) values (
      ${versionId},
      ${input.versionName.trim()},
      ${input.architecture.trim()},
      ${"global"},
      ${JSON.stringify({
        version_id: versionId,
        version_name: input.versionName.trim(),
        architecture: input.architecture.trim(),
        download_url: input.downloadUrl.trim(),
        sha256: input.sha256.trim(),
        size_bytes: Math.max(0, Math.floor(input.sizeBytes || 0)),
        ...input.metadataJson,
      })}::jsonb,
      ${input.sourceProvider?.trim() || "download_url"},
      ${input.downloadUrl.trim()},
      ${input.sha256.trim()},
      ${Math.max(0, Math.floor(input.sizeBytes || 0))},
      ${input.ready ?? true},
      ${setCurrent},
      ${JSON.stringify(input.metadataJson || {})}::jsonb,
      ${now},
      ${now}
    )
    on conflict (version_id) do update set
      version_name = excluded.version_name,
      architecture = excluded.architecture,
      stage = excluded.stage,
      payload_json = excluded.payload_json,
      source_provider = excluded.source_provider,
      download_url = excluded.download_url,
      sha256 = excluded.sha256,
      size_bytes = excluded.size_bytes,
      ready = excluded.ready,
      is_current = excluded.is_current,
      metadata_json = excluded.metadata_json,
      updated_at = now()
  `;
  const rows = await sql`
    select
      version_id,
      version_name,
      architecture,
      source_provider,
      download_url,
      sha256,
      size_bytes,
      ready,
      is_current,
      metadata_json,
      created_at
    from model_versions
    where version_id = ${versionId}
    limit 1
  `;
  const version = rows[0] ? serializeModelVersion(rows[0]) : null;
  if (!version) {
    throw new Error("Unable to publish model version.");
  }
  await writeAuditEvent("user", input.actorUserId, "model_version.published", "model_version", version.version_id, {
    is_current: version.is_current,
  });
  return version;
}

async function requireMembershipOrCreateSite(
  user: ControlPlaneUser,
  payload: {
    siteId?: string | null;
    displayName?: string | null;
    hospitalName?: string | null;
    sourceInstitutionId?: string | null;
  },
): Promise<ControlPlaneSite> {
  const approvedMemberships = user.memberships.filter((membership) => membership.status === "approved");
  if (payload.siteId) {
    const match = approvedMemberships.find((membership) => membership.site_id === payload.siteId);
    if (match?.site) {
      return match.site;
    }
  }
  if (approvedMemberships.length === 1 && approvedMemberships[0].site) {
    return approvedMemberships[0].site;
  }
  if (approvedMemberships.length > 1) {
    throw new Error("Multiple approved sites are available. Pass a specific site_id.");
  }
  if (!payload.siteId || !payload.displayName) {
    throw new Error("site_id and display_name are required for the first node registration.");
  }
  return createSiteForUser({
    userId: user.user_id,
    siteId: payload.siteId,
    displayName: payload.displayName,
    hospitalName: payload.hospitalName || payload.displayName,
    sourceInstitutionId: payload.sourceInstitutionId,
  });
}

export async function registerNodeForUser(input: {
  user: ControlPlaneUser;
  deviceName: string;
  osInfo?: string;
  appVersion?: string;
  siteId?: string | null;
  displayName?: string | null;
  hospitalName?: string | null;
  sourceInstitutionId?: string | null;
}): Promise<{ node: ControlPlaneNode; nodeToken: string; bootstrap: ControlPlaneBootstrap }> {
  const sql = await controlPlaneSql();
  const site = await requireMembershipOrCreateSite(input.user, {
    siteId: input.siteId,
    displayName: input.displayName,
    hospitalName: input.hospitalName,
    sourceInstitutionId: input.sourceInstitutionId,
  });
  const nodeToken = makeNodeToken();
  const nodeId = makeControlPlaneId("node");
  await sql`
    insert into nodes (
      node_id,
      site_id,
      registered_by_user_id,
      device_name,
      os_info,
      app_version,
      token_hash,
      status,
      last_seen_at
    ) values (
      ${nodeId},
      ${site.site_id},
      ${input.user.user_id},
      ${input.deviceName.trim() || "local-node"},
      ${input.osInfo?.trim() || ""},
      ${input.appVersion?.trim() || ""},
      ${hashNodeToken(nodeToken)},
      ${"active"},
      now()
    )
  `;
  const nodeRows = await sql`
    select
      node_id,
      site_id,
      registered_by_user_id,
      device_name,
      os_info,
      app_version,
      current_model_version_id,
      current_model_version_name,
      status,
      last_seen_at,
      created_at
    from nodes
    where node_id = ${nodeId}
    limit 1
  `;
  const node = nodeRows[0] ? serializeNode(nodeRows[0]) : null;
  if (!node) {
    throw new Error("Unable to register node.");
  }
  await writeAuditEvent("user", input.user.user_id, "node.registered", "node", node.node_id, {
    site_id: node.site_id,
    device_name: node.device_name,
  });
  return {
    node,
    nodeToken,
    bootstrap: await buildBootstrapForNode(nodeId, nodeToken),
  };
}

export async function authenticateNode(nodeId: string, nodeToken: string): Promise<ControlPlaneNode | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      node_id,
      site_id,
      registered_by_user_id,
      device_name,
      os_info,
      app_version,
      current_model_version_id,
      current_model_version_name,
      status,
      last_seen_at,
      created_at,
      token_hash
    from nodes
    where node_id = ${nodeId}
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  if (rowValue<string>(row, "status") !== "active") {
    return null;
  }
  if (rowValue<string>(row, "token_hash") !== hashNodeToken(nodeToken)) {
    return null;
  }
  return serializeNode(row);
}

export async function recordNodeHeartbeat(nodeId: string, payload: {
  appVersion?: string;
  osInfo?: string;
  status?: string;
  currentModelVersionId?: string;
  currentModelVersionName?: string;
}): Promise<ControlPlaneNode> {
  const sql = await controlPlaneSql();
  await sql`
    update nodes
    set
      app_version = case when ${payload.appVersion?.trim() || ""} = '' then app_version else ${payload.appVersion?.trim() || ""} end,
      os_info = case when ${payload.osInfo?.trim() || ""} = '' then os_info else ${payload.osInfo?.trim() || ""} end,
      current_model_version_id = case
        when ${payload.currentModelVersionId?.trim() || ""} = '' then current_model_version_id
        else ${payload.currentModelVersionId?.trim() || ""}
      end,
      current_model_version_name = case
        when ${payload.currentModelVersionName?.trim() || ""} = '' then current_model_version_name
        else ${payload.currentModelVersionName?.trim() || ""}
      end,
      last_seen_at = now(),
      updated_at = now()
    where node_id = ${nodeId}
  `;
  const rows = await sql`
    select
      node_id,
      site_id,
      registered_by_user_id,
      device_name,
      os_info,
      app_version,
      current_model_version_id,
      current_model_version_name,
      status,
      last_seen_at,
      created_at
    from nodes
    where node_id = ${nodeId}
    limit 1
  `;
  const node = rows[0] ? serializeNode(rows[0]) : null;
  if (!node) {
    throw new Error("Unable to load node heartbeat state.");
  }
  await writeAuditEvent("node", node.node_id, "node.heartbeat", "node", node.node_id, {
    status: payload.status || "ok",
    current_model_version_id: payload.currentModelVersionId?.trim() || null,
  });
  return node;
}

export async function buildBootstrapForNode(nodeId: string, nodeToken: string): Promise<ControlPlaneBootstrap> {
  const node = await authenticateNode(nodeId, nodeToken);
  if (!node) {
    throw new Error("Invalid node credentials.");
  }
  const user = await getControlPlaneUser(node.registered_by_user_id);
  if (!user) {
    throw new Error("Node owner is missing.");
  }
  const site = user.memberships.find((membership) => membership.site_id === node.site_id)?.site;
  if (!site) {
    throw new Error("Node site is not available to the owner.");
  }
  return {
    project: {
      project_id: "project_default",
      name: "K-ERA Default Project",
    },
    user,
    memberships: user.memberships,
    site,
    node,
    current_release: await currentReleaseManifestForSite(node.site_id),
    settings: {
      llm_relay_enabled: Boolean(controlPlaneLlmApiKey()),
    },
  };
}

export async function createModelUpdateFromNode(input: {
  nodeId: string;
  baseModelVersionId?: string | null;
  payloadJson: Record<string, unknown>;
  reviewThumbnailUrl?: string | null;
}): Promise<ControlPlaneModelUpdate> {
  const sql = await controlPlaneSql();
  const nodeRows = await sql`select site_id from nodes where node_id = ${input.nodeId} limit 1`;
  const siteId = nodeRows[0] ? rowValue<string>(nodeRows[0], "site_id") : null;
  const requestedUpdateId = String(input.payloadJson.update_id || "").trim();
  const updateId = requestedUpdateId || makeControlPlaneId("update");
  const now = new Date().toISOString();
  await sql`
    insert into model_updates (
      update_id,
      site_id,
      node_id,
      base_model_version_id,
      status,
      payload_json,
      review_thumbnail_url,
      created_at,
      updated_at
    ) values (
      ${updateId},
      ${siteId},
      ${input.nodeId},
      ${input.baseModelVersionId || null},
      ${"pending"},
      ${JSON.stringify(input.payloadJson)}::jsonb,
      ${input.reviewThumbnailUrl || null},
      ${now},
      ${now}
    )
    on conflict (update_id) do update set
      site_id = excluded.site_id,
      node_id = excluded.node_id,
      base_model_version_id = excluded.base_model_version_id,
      payload_json = excluded.payload_json,
      review_thumbnail_url = coalesce(excluded.review_thumbnail_url, model_updates.review_thumbnail_url),
      updated_at = now()
  `;
  const rows = await sql`
    select
      update_id,
      site_id,
      node_id,
      base_model_version_id,
      status,
      payload_json,
      review_thumbnail_url,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    where update_id = ${updateId}
    limit 1
  `;
  const update = rows[0] ? serializeModelUpdate(rows[0]) : null;
  if (!update) {
    throw new Error("Unable to create model update.");
  }
  await writeAuditEvent("node", input.nodeId, "model_update.created", "model_update", update.update_id, {
    site_id: update.site_id,
  });
  return update;
}

export async function createValidationRunFromNode(input: {
  nodeId: string;
  summaryJson: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const sql = await controlPlaneSql();
  const nodeRows = await sql`select site_id from nodes where node_id = ${input.nodeId} limit 1`;
  const siteId = nodeRows[0] ? rowValue<string>(nodeRows[0], "site_id") : null;
  const requestedValidationId = String(input.summaryJson.validation_id || "").trim();
  const validationId = requestedValidationId || makeControlPlaneId("validation");
  const modelVersionId = String(input.summaryJson.model_version_id || "").trim() || null;
  const modelVersion = String(input.summaryJson.model_version || modelVersionId || "").trim() || "unknown";
  const rawRunDate = String(input.summaryJson.run_date || "").trim();
  const runDate = rawRunDate || new Date().toISOString();
  const projectId = String(input.summaryJson.project_id || "project_default").trim() || "project_default";
  const mergedSummary = {
    ...input.summaryJson,
    validation_id: validationId,
    site_id: siteId || input.summaryJson.site_id || null,
    node_id: input.nodeId,
  };

  await sql`
    insert into validation_runs (
      validation_id,
      site_id,
      node_id,
      project_id,
      model_version,
      model_version_id,
      run_date,
      case_predictions_path,
      summary_json
    ) values (
      ${validationId},
      ${siteId},
      ${input.nodeId},
      ${projectId},
      ${modelVersion},
      ${modelVersionId},
      ${runDate},
      ${""},
      ${JSON.stringify(mergedSummary)}::jsonb
    )
    on conflict (validation_id) do update set
      site_id = excluded.site_id,
      node_id = excluded.node_id,
      project_id = excluded.project_id,
      model_version = excluded.model_version,
      model_version_id = excluded.model_version_id,
      run_date = excluded.run_date,
      case_predictions_path = excluded.case_predictions_path,
      summary_json = excluded.summary_json,
      updated_at = now()
  `;
  await writeAuditEvent("node", input.nodeId, "validation_run.created", "validation_run", validationId, {
    site_id: siteId,
    model_version_id: modelVersionId,
  });
  return mergedSummary;
}

async function ensureRetrievalCorpusProfile(input: {
  profileId: string;
  retrievalSignature: string;
  metadataJson?: Record<string, unknown>;
}): Promise<ControlPlaneRetrievalCorpusProfile> {
  const sql = await controlPlaneSql();
  const profileId = input.profileId.trim();
  const retrievalSignature = input.retrievalSignature.trim();
  if (!profileId) {
    throw new Error("retrieval profile id is required.");
  }
  if (!retrievalSignature) {
    throw new Error("retrieval signature is required.");
  }

  const existingRows = await sql`
    select
      profile_id,
      retrieval_signature,
      metadata_json,
      created_at,
      updated_at
    from retrieval_corpus_profiles
    where profile_id = ${profileId}
    limit 1
  `;
  const existing = existingRows[0] ? serializeRetrievalCorpusProfile(existingRows[0]) : null;
  if (existing && existing.retrieval_signature !== retrievalSignature) {
    throw new Error(
      `Retrieval signature mismatch for profile ${profileId}. Expected ${existing.retrieval_signature}, received ${retrievalSignature}.`,
    );
  }

  await sql`
    insert into retrieval_corpus_profiles (
      profile_id,
      retrieval_signature,
      metadata_json,
      created_at,
      updated_at
    ) values (
      ${profileId},
      ${retrievalSignature},
      ${JSON.stringify(input.metadataJson || {})}::jsonb,
      now(),
      now()
    )
    on conflict (profile_id) do update set
      metadata_json = case
        when retrieval_corpus_profiles.metadata_json = '{}'::jsonb
          and excluded.metadata_json <> '{}'::jsonb
        then excluded.metadata_json
        else retrieval_corpus_profiles.metadata_json
      end,
      updated_at = now()
  `;

  const rows = await sql`
    select
      profile_id,
      retrieval_signature,
      metadata_json,
      created_at,
      updated_at
    from retrieval_corpus_profiles
    where profile_id = ${profileId}
    limit 1
  `;
  const profile = rows[0] ? serializeRetrievalCorpusProfile(rows[0]) : null;
  if (!profile) {
    throw new Error("Unable to upsert retrieval corpus profile.");
  }
  return profile;
}

export async function createRetrievalCorpusEntriesFromNode(input: {
  nodeId: string;
  profileId: string;
  retrievalSignature: string;
  profileMetadataJson?: Record<string, unknown>;
  replaceSiteProfileScope?: boolean;
  entries: Array<{
    entry_id?: string;
    case_reference_id?: string;
    culture_category?: string;
    culture_species?: string;
    embedding?: unknown;
    thumbnail_url?: string | null;
    metadata_json?: Record<string, unknown>;
  }>;
}): Promise<{
  profile: ControlPlaneRetrievalCorpusProfile;
  entries: ControlPlaneRetrievalCorpusEntry[];
  inserted_count: number;
  updated_count: number;
  deleted_count: number;
}> {
  const sql = await controlPlaneSql();
  const nodeRows = await sql`select site_id from nodes where node_id = ${input.nodeId} limit 1`;
  const siteId = nodeRows[0] ? rowValue<string>(nodeRows[0], "site_id") : null;
  if (!siteId) {
    throw new Error("Node site is unavailable.");
  }
  const profile = await ensureRetrievalCorpusProfile({
    profileId: input.profileId,
    retrievalSignature: input.retrievalSignature,
    metadataJson: input.profileMetadataJson,
  });

  const savedEntries: ControlPlaneRetrievalCorpusEntry[] = [];
  let insertedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  const retainedCaseReferenceIds = new Set<string>();

  for (const rawEntry of input.entries) {
    const caseReferenceId = String(rawEntry.case_reference_id || "").trim();
    const cultureCategory = String(rawEntry.culture_category || "").trim().toLowerCase();
    const cultureSpecies = String(rawEntry.culture_species || "").trim();
    if (!caseReferenceId) {
      throw new Error("case_reference_id is required for retrieval corpus upload.");
    }
    retainedCaseReferenceIds.add(caseReferenceId);
    if (!cultureCategory) {
      throw new Error("culture_category is required for retrieval corpus upload.");
    }
    const embedding = normalizeEmbedding(rawEntry.embedding);
    const metadataJson = rawEntry.metadata_json || {};
    const thumbnailUrl = rawEntry.thumbnail_url?.trim() || null;

    const existingRows = await sql`
      select
        entry_id,
        site_id,
        node_id,
        profile_id,
        retrieval_signature,
        case_reference_id,
        culture_category,
        culture_species,
        embedding_dim,
        thumbnail_url,
        metadata_json,
        created_at,
        updated_at
      from retrieval_corpus_entries
      where site_id = ${siteId}
        and profile_id = ${profile.profile_id}
        and case_reference_id = ${caseReferenceId}
      limit 1
    `;
    const existing = existingRows[0] ? serializeRetrievalCorpusEntry(existingRows[0]) : null;
    const entryId = existing?.entry_id || String(rawEntry.entry_id || "").trim() || makeControlPlaneId("retrieval");

    await sql`
      insert into retrieval_corpus_entries (
        entry_id,
        site_id,
        node_id,
        profile_id,
        retrieval_signature,
        case_reference_id,
        culture_category,
        culture_species,
        embedding_dim,
        embedding_json,
        thumbnail_url,
        metadata_json,
        created_at,
        updated_at
      ) values (
        ${entryId},
        ${siteId},
        ${input.nodeId},
        ${profile.profile_id},
        ${profile.retrieval_signature},
        ${caseReferenceId},
        ${cultureCategory},
        ${cultureSpecies},
        ${embedding.length},
        ${JSON.stringify(embedding)}::jsonb,
        ${thumbnailUrl},
        ${JSON.stringify(metadataJson)}::jsonb,
        now(),
        now()
      )
      on conflict (site_id, profile_id, case_reference_id) do update set
        node_id = excluded.node_id,
        retrieval_signature = excluded.retrieval_signature,
        culture_category = excluded.culture_category,
        culture_species = excluded.culture_species,
        embedding_dim = excluded.embedding_dim,
        embedding_json = excluded.embedding_json,
        thumbnail_url = coalesce(excluded.thumbnail_url, retrieval_corpus_entries.thumbnail_url),
        metadata_json = excluded.metadata_json,
        updated_at = now()
    `;

    const rows = await sql`
      select
        entry_id,
        site_id,
        node_id,
        profile_id,
        retrieval_signature,
        case_reference_id,
        culture_category,
        culture_species,
        embedding_dim,
        thumbnail_url,
        metadata_json,
        created_at,
        updated_at
      from retrieval_corpus_entries
      where site_id = ${siteId}
        and profile_id = ${profile.profile_id}
        and case_reference_id = ${caseReferenceId}
      limit 1
    `;
    const savedEntry = rows[0] ? serializeRetrievalCorpusEntry(rows[0]) : null;
    if (!savedEntry) {
      throw new Error("Unable to save retrieval corpus entry.");
    }
    if (existing) {
      updatedCount += 1;
    } else {
      insertedCount += 1;
    }
    savedEntries.push(savedEntry);
  }

  if (input.replaceSiteProfileScope) {
    const existingRows = await sql`
      select
        case_reference_id
      from retrieval_corpus_entries
      where site_id = ${siteId}
        and profile_id = ${profile.profile_id}
    `;
    for (const row of existingRows) {
      const caseReferenceId = rowValue<string>(row, "case_reference_id");
      if (retainedCaseReferenceIds.has(caseReferenceId)) {
        continue;
      }
      await sql`
        delete from retrieval_corpus_entries
        where site_id = ${siteId}
          and profile_id = ${profile.profile_id}
          and case_reference_id = ${caseReferenceId}
      `;
      deletedCount += 1;
    }
  }

  await writeAuditEvent("node", input.nodeId, "retrieval_corpus.synced", "retrieval_profile", profile.profile_id, {
    site_id: siteId,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    deleted_count: deletedCount,
  });

  return {
    profile,
    entries: savedEntries,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    deleted_count: deletedCount,
  };
}

export async function searchRetrievalCorpusEntries(input: {
  profileId: string;
  retrievalSignature: string;
  queryEmbedding: unknown;
  topK?: number;
  excludeSiteId?: string | null;
  excludeCaseReferenceId?: string | null;
}): Promise<ControlPlaneRetrievalCorpusSearchHit[]> {
  const sql = await controlPlaneSql();
  const profileId = input.profileId.trim();
  const retrievalSignature = input.retrievalSignature.trim();
  if (!profileId) {
    throw new Error("profile_id is required for retrieval search.");
  }
  if (!retrievalSignature) {
    throw new Error("retrieval_signature is required for retrieval search.");
  }

  const profileRows = await sql`
    select
      profile_id,
      retrieval_signature,
      metadata_json,
      created_at,
      updated_at
    from retrieval_corpus_profiles
    where profile_id = ${profileId}
    limit 1
  `;
  const profile = profileRows[0] ? serializeRetrievalCorpusProfile(profileRows[0]) : null;
  if (!profile) {
    return [];
  }
  if (profile.retrieval_signature !== retrievalSignature) {
    throw new Error(
      `Retrieval signature mismatch for profile ${profileId}. Expected ${profile.retrieval_signature}, received ${retrievalSignature}.`,
    );
  }

  const queryEmbedding = normalizeEmbedding(input.queryEmbedding);
  const topK = Math.max(1, Math.min(Number(input.topK || 3), 20));
  const rows = await sql`
    select
      e.entry_id,
      e.site_id,
      e.node_id,
      e.profile_id,
      e.retrieval_signature,
      e.case_reference_id,
      e.culture_category,
      e.culture_species,
      e.embedding_dim,
      e.embedding_json,
      e.thumbnail_url,
      e.metadata_json,
      e.created_at,
      e.updated_at,
      s.display_name as source_site_display_name,
      s.hospital_name as source_site_hospital_name
    from retrieval_corpus_entries e
    left join sites s on s.site_id = e.site_id
    where e.profile_id = ${profileId}
      and e.retrieval_signature = ${retrievalSignature}
  `;

  const hits: ControlPlaneRetrievalCorpusSearchHit[] = [];
  for (const row of rows) {
    const entry = serializeRetrievalCorpusEntry(row);
    if (input.excludeSiteId && entry.site_id === input.excludeSiteId) {
      continue;
    }
    if (input.excludeCaseReferenceId && entry.case_reference_id === input.excludeCaseReferenceId) {
      continue;
    }
    const embedding = normalizeEmbedding(rowValue<unknown>(row, "embedding_json"));
    if (embedding.length !== queryEmbedding.length) {
      continue;
    }
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    hits.push({
      ...entry,
      similarity: Math.round(similarity * 10000) / 10000,
      source_site_display_name: rowValue<string>(row, "source_site_display_name"),
      source_site_hospital_name: rowValue<string>(row, "source_site_hospital_name"),
    });
  }
  hits.sort((left, right) => right.similarity - left.similarity);
  return hits.slice(0, topK);
}

export async function listModelUpdates(): Promise<ControlPlaneModelUpdate[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      update_id,
      site_id,
      node_id,
      base_model_version_id,
      status,
      payload_json,
      review_thumbnail_url,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    order by created_at desc
  `;
  return rows.map((row) => serializeModelUpdate(row));
}

export async function listValidationRuns(): Promise<ControlPlaneValidationRun[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      validation_id,
      site_id,
      node_id,
      model_version_id,
      run_date,
      summary_json,
      created_at
    from validation_runs
    order by created_at desc
  `;
  return rows.map((row) => serializeValidationRun(row));
}

export async function listAggregations(): Promise<ControlPlaneAggregation[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_id,
      status,
      triggered_by_user_id,
      summary_json,
      created_at,
      finished_at
    from aggregations
    order by created_at desc
  `;
  return rows.map((row) => serializeAggregation(row));
}

export async function createAggregation(input: {
  actorUserId: string;
  baseModelVersionId?: string | null;
  summaryJson?: Record<string, unknown>;
  status?: Extract<ControlPlaneAggregationStatus, "queued" | "running">;
}): Promise<ControlPlaneAggregation> {
  const sql = await controlPlaneSql();
  const aggregationId = makeControlPlaneId("aggregation");
  const now = new Date().toISOString();
  await sql`
    insert into aggregations (
      aggregation_id,
      base_model_version_id,
      new_version_name,
      payload_json,
      status,
      triggered_by_user_id,
      summary_json,
      created_at,
      updated_at
    ) values (
      ${aggregationId},
      ${input.baseModelVersionId || null},
      ${String((input.summaryJson || {}).new_version_name || "pending-aggregation").trim() || "pending-aggregation"},
      ${JSON.stringify(input.summaryJson || {})}::jsonb,
      ${input.status || "queued"},
      ${input.actorUserId},
      ${JSON.stringify(input.summaryJson || {})}::jsonb,
      ${now},
      ${now}
    )
  `;
  const rows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_id,
      status,
      triggered_by_user_id,
      summary_json,
      created_at,
      finished_at
    from aggregations
    where aggregation_id = ${aggregationId}
    limit 1
  `;
  const aggregation = rows[0] ? serializeAggregation(rows[0]) : null;
  if (!aggregation) {
    throw new Error("Unable to create aggregation.");
  }
  await writeAuditEvent("user", input.actorUserId, "aggregation.created", "aggregation", aggregation.aggregation_id, {
    base_model_version_id: aggregation.base_model_version_id,
    status: aggregation.status,
  });
  return aggregation;
}

export async function completeAggregation(input: {
  aggregationId: string;
  actorUserId: string;
  status: Extract<ControlPlaneAggregationStatus, "completed" | "failed">;
  newVersionId?: string | null;
  summaryJson?: Record<string, unknown>;
}): Promise<ControlPlaneAggregation> {
  const sql = await controlPlaneSql();
  await sql`
    update aggregations
    set
      new_version_id = coalesce(${input.newVersionId || null}, new_version_id),
      status = ${input.status},
      summary_json = ${JSON.stringify(input.summaryJson || {})}::jsonb,
      finished_at = now(),
      updated_at = now()
    where aggregation_id = ${input.aggregationId}
  `;
  const rows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_id,
      status,
      triggered_by_user_id,
      summary_json,
      created_at,
      finished_at
    from aggregations
    where aggregation_id = ${input.aggregationId}
    limit 1
  `;
  const aggregation = rows[0] ? serializeAggregation(rows[0]) : null;
  if (!aggregation) {
    throw new Error("Unable to load aggregation.");
  }
  await writeAuditEvent("user", input.actorUserId, "aggregation.completed", "aggregation", aggregation.aggregation_id, {
    status: aggregation.status,
    new_version_id: aggregation.new_version_id,
  });
  return aggregation;
}

export async function reviewModelUpdate(input: {
  updateId: string;
  reviewerUserId: string;
  decision: Extract<ControlPlaneModelUpdateStatus, "approved" | "rejected">;
  reviewerNotes?: string;
}): Promise<ControlPlaneModelUpdate> {
  const sql = await controlPlaneSql();
  await sql`
    update model_updates
    set
      status = ${input.decision},
      reviewer_user_id = ${input.reviewerUserId},
      reviewer_notes = ${input.reviewerNotes?.trim() || ""},
      reviewed_at = now(),
      updated_at = now()
    where update_id = ${input.updateId}
  `;
  const rows = await sql`
    select
      update_id,
      site_id,
      node_id,
      base_model_version_id,
      status,
      payload_json,
      review_thumbnail_url,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    where update_id = ${input.updateId}
    limit 1
  `;
  const update = rows[0] ? serializeModelUpdate(rows[0]) : null;
  if (!update) {
    throw new Error("Model update not found.");
  }
  await writeAuditEvent("user", input.reviewerUserId, "model_update.reviewed", "model_update", update.update_id, {
    decision: update.status,
  });
  return update;
}

export async function controlPlaneOverview(): Promise<ControlPlaneOverview> {
  const sql = await controlPlaneSql();
  const [userCountRows, siteCountRows, nodeCountRows, pendingRows] = await Promise.all([
    sql`select count(*)::int as count from users`,
    sql`select count(*)::int as count from sites`,
    sql`select count(*)::int as count from nodes`,
    sql`select count(*)::int as count from model_updates where status = 'pending'`,
  ]);
  const currentRelease = await currentReleaseManifest();
  return {
    user_count: Number(rowValue<number>(userCountRows[0], "count") || 0),
    site_count: Number(rowValue<number>(siteCountRows[0], "count") || 0),
    node_count: Number(rowValue<number>(nodeCountRows[0], "count") || 0),
    pending_model_updates: Number(rowValue<number>(pendingRows[0], "count") || 0),
    current_model_version: currentRelease?.version_name || null,
  };
}

export async function assertAdminUser(userId: string): Promise<ControlPlaneUser> {
  const user = await getControlPlaneUser(userId);
  if (!user) {
    throw new Error("Authentication required.");
  }
  if (user.global_role !== "admin") {
    throw new Error("Admin access is required.");
  }
  return user;
}

export async function listRegisteredNodes(): Promise<ControlPlaneNode[]> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      node_id,
      site_id,
      registered_by_user_id,
      device_name,
      os_info,
      app_version,
      current_model_version_id,
      current_model_version_name,
      status,
      last_seen_at,
      created_at
    from nodes
    order by created_at desc
  `;
  return rows.map((row) => serializeNode(row));
}

function isRecentlySeen(timestamp: string | null, thresholdMs = 24 * 60 * 60 * 1000): boolean {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return (Date.now() - parsed.getTime()) <= thresholdMs;
}

export async function federationMonitoringSummary(): Promise<ControlPlaneFederationMonitoringSummary> {
  const [currentRelease, activeRollout, recentRollouts, recentAuditEvents, nodes] = await Promise.all([
    currentReleaseManifest(),
    latestActiveReleaseRollout(),
    listReleaseRollouts().then((items) => items.slice(0, 8)),
    listAuditEvents({ limit: 12 }),
    listRegisteredNodes(),
  ]);
  const sql = await controlPlaneSql();
  const siteRows = await sql`
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
    where sites.status = 'active'
    order by sites.site_id asc
  `;
  const latestValidationRows = await sql`
    select distinct on (site_id)
      site_id,
      model_version_id,
      model_version,
      run_date
    from validation_runs
    order by site_id asc, run_date desc nulls last, created_at desc
  `;
  const latestValidationBySite = new Map(
    latestValidationRows.map((row) => [
      rowValue<string>(row, "site_id"),
      {
        model_version_id: rowValue<string | null>(row, "model_version_id"),
        model_version: rowValue<string | null>(row, "model_version"),
        run_date: rowValue<string | Date | null>(row, "run_date")
          ? new Date(rowValue<string | Date>(row, "run_date")).toISOString()
          : null,
      },
    ]),
  );

  const siteAdoption: ControlPlaneRolloutSiteAdoption[] = siteRows.map((row) => {
    const siteId = rowValue<string>(row, "site_id");
    const site = serializeSite(row) ?? {
      site_id: siteId,
      display_name: siteId,
      hospital_name: siteId,
      source_institution_id: null,
      status: "active",
      created_at: new Date().toISOString(),
    };
    const siteNodes = nodes.filter((item) => item.site_id === siteId);
    const activeNodes = siteNodes.filter((item) => isRecentlySeen(item.last_seen_at));
    const targetedByRollout = Boolean(
      activeRollout &&
        activeRollout.target_site_ids.length > 0 &&
        activeRollout.target_site_ids.includes(siteId),
    );
    const expectedVersionId = targetedByRollout
      ? activeRollout?.version_id ?? null
      : currentRelease?.version_id ?? null;
    const expectedVersionName = targetedByRollout
      ? activeRollout?.version_name ?? null
      : currentRelease?.version_name ?? null;
    const alignedNodeCount = activeNodes.filter((item) => item.current_model_version_id === expectedVersionId).length;
    const unknownNodeCount = activeNodes.filter((item) => !item.current_model_version_id).length;
    const laggingNodeCount = Math.max(0, activeNodes.length - alignedNodeCount - unknownNodeCount);
    const latestNode = siteNodes
      .slice()
      .sort((left, right) => {
        const leftValue = left.last_seen_at ? new Date(left.last_seen_at).getTime() : 0;
        const rightValue = right.last_seen_at ? new Date(right.last_seen_at).getTime() : 0;
        return rightValue - leftValue;
      })[0] ?? null;
    const latestValidation = latestValidationBySite.get(siteId);
    return {
      site_id: siteId,
      site_display_name: site.hospital_name || site.display_name || siteId,
      node_count: siteNodes.length,
      active_node_count: activeNodes.length,
      aligned_node_count: alignedNodeCount,
      unknown_node_count: unknownNodeCount,
      lagging_node_count: laggingNodeCount,
      expected_version_id: expectedVersionId,
      expected_version_name: expectedVersionName,
      latest_reported_version_id: latestNode?.current_model_version_id ?? null,
      latest_reported_version_name: latestNode?.current_model_version_name ?? null,
      latest_validation_version_id: latestValidation?.model_version_id ?? null,
      latest_validation_version_name: latestValidation?.model_version ?? null,
      latest_validation_run_date: latestValidation?.run_date ?? null,
      last_seen_at: latestNode?.last_seen_at ?? null,
    };
  });

  const activeNodes = nodes.filter((item) => isRecentlySeen(item.last_seen_at));
  const alignedNodes = siteAdoption.reduce((sum, item) => sum + item.aligned_node_count, 0);
  const laggingNodes = siteAdoption.reduce((sum, item) => sum + item.lagging_node_count, 0);
  const unknownNodes = siteAdoption.reduce((sum, item) => sum + item.unknown_node_count, 0);

  return {
    current_release: currentRelease,
    active_rollout: activeRollout,
    recent_rollouts: recentRollouts,
    recent_audit_events: recentAuditEvents,
    node_summary: {
      total_nodes: nodes.length,
      active_nodes: activeNodes.length,
      aligned_nodes: alignedNodes,
      lagging_nodes: laggingNodes,
      unknown_nodes: unknownNodes,
    },
    site_adoption: siteAdoption,
  };
}
