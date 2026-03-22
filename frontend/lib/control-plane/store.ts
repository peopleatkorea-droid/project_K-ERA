import type { Row } from "postgres";

import { controlPlaneAdminEmails, controlPlaneLlmApiKey } from "./config";
import { controlPlaneSql } from "./db";
import { hashNodeToken, makeControlPlaneId, makeNodeToken, normalizeEmail, normalizeSiteId } from "./crypto";
import type {
  ControlPlaneAggregation,
  ControlPlaneAggregationStatus,
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
  const site: ControlPlaneSite = {
    site_id: rowValue<string>(row, "site_id"),
    display_name: rowValue<string>(row, "display_name"),
    hospital_name: rowValue<string>(row, "hospital_name"),
    source_institution_id: rowValue<string | null>(row, "source_institution_id"),
    status: rowValue<string>(row, "status"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
  const sourceInstitutionName = rowValue<string | null | undefined>(row, "source_institution_name");
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
      institution_directory.name as source_institution_name
    from site_memberships as m
    left join sites as s on s.site_id = m.site_id
    left join institution_directory
      on institution_directory.institution_id = coalesce(nullif(s.source_institution_id, ''), s.site_id)
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

export async function ensureControlPlaneIdentity(identity: ControlPlaneIdentity): Promise<ControlPlaneUser> {
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
  } else {
    const userCountRows = await sql`select count(*)::int as count from users`;
    const currentCount = Number(rowValue<number>(userCountRows[0], "count") || 0);
    if (currentCount === 0) {
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
      ${options.displayName.trim() || siteId},
      ${options.hospitalName.trim() || options.displayName.trim() || siteId},
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
}): Promise<ControlPlaneNode> {
  const sql = await controlPlaneSql();
  await sql`
    update nodes
    set
      app_version = case when ${payload.appVersion?.trim() || ""} = '' then app_version else ${payload.appVersion?.trim() || ""} end,
      os_info = case when ${payload.osInfo?.trim() || ""} = '' then os_info else ${payload.osInfo?.trim() || ""} end,
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
    current_release: await currentReleaseManifest(),
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
      status,
      last_seen_at,
      created_at
    from nodes
    order by created_at desc
  `;
  return rows.map((row) => serializeNode(row));
}
