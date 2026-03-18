import "server-only";

import { NextRequest } from "next/server";

import type { AggregationRecord, AggregationRunResponse, AuthUser, ModelUpdateRecord, ModelVersionRecord } from "../types";
import { controlPlaneSql } from "./db";
import { requireMainAppBridgeUser } from "./main-app-bridge-users";
import { fetchLegacyLocalNodeApi, normalizeStringArray, readBearerToken, rowValue, trimText } from "./main-app-bridge-shared";

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

function recordFromValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromValue(value: unknown): string | null {
  const normalized = trimText(value);
  return normalized || null;
}

function optionalStringFromValue(value: unknown): string | undefined {
  const normalized = trimText(value);
  return normalized || undefined;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function booleanFromValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function isoStringOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberRecordFromValue(value: unknown): Record<string, number> | null {
  const record = recordFromValue(value);
  const entries = Object.entries(record)
    .map(([key, rawValue]) => [key, numberFromValue(rawValue)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);
  return entries.length ? Object.fromEntries(entries) : null;
}

function serializeMainModelVersionRow(row: Record<string, unknown>): ModelVersionRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  const metadata = recordFromValue(rowValue<unknown>(row as never, "metadata_json"));
  const merged = { ...payload, ...metadata };
  const rowReady = rowValue<boolean | null>(row as never, "ready");
  const rowCurrent = rowValue<boolean | null>(row as never, "is_current");
  return {
    version_id: trimText(rowValue<string>(row as never, "version_id")) || trimText(merged.version_id),
    version_name: trimText(rowValue<string>(row as never, "version_name")) || trimText(merged.version_name),
    architecture: trimText(rowValue<string>(row as never, "architecture")) || trimText(merged.architecture),
    stage: trimText(rowValue<string | null>(row as never, "stage")) || stringFromValue(merged.stage),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")),
    ready: rowReady ?? booleanFromValue(merged.ready),
    is_current: rowCurrent ?? booleanFromValue(merged.is_current),
    publish_required: booleanFromValue(merged.publish_required),
    distribution_status: stringFromValue(merged.distribution_status),
    download_url: trimText(rowValue<string>(row as never, "download_url")) || stringFromValue(merged.download_url),
    source_provider: trimText(rowValue<string>(row as never, "source_provider")) || stringFromValue(merged.source_provider),
    filename: stringFromValue(merged.filename),
    size_bytes: numberFromValue(rowValue<number | string | null>(row as never, "size_bytes")) ?? numberFromValue(merged.size_bytes),
    sha256: trimText(rowValue<string>(row as never, "sha256")) || stringFromValue(merged.sha256),
    notes: optionalStringFromValue(merged.notes),
    notes_ko: optionalStringFromValue(merged.notes_ko),
    notes_en: optionalStringFromValue(merged.notes_en),
    model_path: optionalStringFromValue(merged.model_path),
    aggregation_id: stringFromValue(merged.aggregation_id),
    base_version_id: stringFromValue(merged.base_version_id),
    requires_medsam_crop: booleanFromValue(merged.requires_medsam_crop),
    training_input_policy: optionalStringFromValue(merged.training_input_policy),
    crop_mode: (stringFromValue(merged.crop_mode) as ModelVersionRecord["crop_mode"]) ?? undefined,
    ensemble_mode: stringFromValue(merged.ensemble_mode),
    component_model_version_ids: normalizeStringArray(merged.component_model_version_ids),
    ensemble_weights: numberRecordFromValue(merged.ensemble_weights),
    decision_threshold: numberFromValue(merged.decision_threshold),
    threshold_selection_metric: stringFromValue(merged.threshold_selection_metric),
    threshold_selection_metrics: recordFromValue(merged.threshold_selection_metrics),
  };
}

function serializeMainModelUpdateRow(row: Record<string, unknown>): ModelUpdateRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  return {
    update_id: trimText(rowValue<string>(row as never, "update_id")) || trimText(payload.update_id),
    contribution_group_id: stringFromValue(payload.contribution_group_id),
    site_id: trimText(rowValue<string | null>(row as never, "site_id")) || stringFromValue(payload.site_id),
    base_model_version_id:
      trimText(rowValue<string | null>(row as never, "base_model_version_id")) || stringFromValue(payload.base_model_version_id),
    architecture: stringFromValue(payload.architecture),
    upload_type: stringFromValue(payload.upload_type),
    execution_device: stringFromValue(payload.execution_device),
    artifact_path: stringFromValue(payload.artifact_path),
    central_artifact_key: stringFromValue(payload.central_artifact_key),
    central_artifact_path: stringFromValue(payload.central_artifact_path),
    central_artifact_name: stringFromValue(payload.central_artifact_name),
    central_artifact_size_bytes: numberFromValue(payload.central_artifact_size_bytes),
    central_artifact_sha256: stringFromValue(payload.central_artifact_sha256),
    artifact_download_url: stringFromValue(payload.artifact_download_url),
    artifact_distribution_status: stringFromValue(payload.artifact_distribution_status),
    artifact_source_provider: stringFromValue(payload.artifact_source_provider),
    artifact_storage: stringFromValue(payload.artifact_storage),
    n_cases: numberFromValue(payload.n_cases),
    contributed_by: stringFromValue(payload.contributed_by),
    case_reference_id: stringFromValue(payload.case_reference_id),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")) || isoStringOrNull(payload.created_at),
    training_input_policy: stringFromValue(payload.training_input_policy),
    training_summary: recordFromValue(payload.training_summary),
    status: trimText(rowValue<string>(row as never, "status")) || stringFromValue(payload.status),
    reviewed_by: trimText(rowValue<string | null>(row as never, "reviewer_user_id")) || stringFromValue(payload.reviewed_by),
    reviewed_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "reviewed_at")) || isoStringOrNull(payload.reviewed_at),
    reviewer_notes: trimText(rowValue<string>(row as never, "reviewer_notes")) || stringFromValue(payload.reviewer_notes),
    approval_report_path: stringFromValue(payload.approval_report_path),
    approval_report: recordFromValue(payload.approval_report) as ModelUpdateRecord["approval_report"],
    quality_summary: recordFromValue(payload.quality_summary) as ModelUpdateRecord["quality_summary"],
  };
}

function serializeMainAggregationRow(row: Record<string, unknown>): AggregationRecord {
  const payload = recordFromValue(rowValue<unknown>(row as never, "payload_json"));
  const summary = recordFromValue(rowValue<unknown>(row as never, "summary_json"));
  return {
    aggregation_id: trimText(rowValue<string>(row as never, "aggregation_id")) || trimText(payload.aggregation_id),
    base_model_version_id:
      trimText(rowValue<string | null>(row as never, "base_model_version_id")) || stringFromValue(payload.base_model_version_id),
    new_version_name:
      trimText(rowValue<string>(row as never, "new_version_name")) ||
      stringFromValue(summary.new_version_name) ||
      stringFromValue(payload.new_version_name) ||
      "pending-aggregation",
    architecture: stringFromValue(summary.architecture) || stringFromValue(payload.architecture),
    site_weights: numberRecordFromValue(summary.site_weights) || numberRecordFromValue(payload.site_weights) || undefined,
    total_cases: numberFromValue(summary.total_cases) ?? numberFromValue(payload.total_cases),
    created_at: isoStringOrNull(rowValue<string | Date | null>(row as never, "created_at")),
  };
}

async function syncModelVersionsFromLocal(request: NextRequest, token: string): Promise<void> {
  const records = await fetchLegacyLocalNodeApi<ModelVersionRecord[]>(request, "/api/admin/model-versions", {}, token);
  if (!records.length) {
    return;
  }
  await persistModelVersionRecords(records);
}

async function persistModelVersionRecords(records: ModelVersionRecord[]): Promise<void> {
  const sql = await controlPlaneSql();
  for (const record of records) {
    const versionId = trimText(record.version_id);
    const versionName = trimText(record.version_name);
    const architecture = trimText(record.architecture);
    if (!versionId || !versionName || !architecture) {
      continue;
    }
    const createdAt = isoStringOrNull(record.created_at) || new Date().toISOString();
    const downloadUrl = trimText(record.download_url);
    const sourceProvider = trimText(record.source_provider);
    const sha256 = trimText(record.sha256);
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
        ${versionName},
        ${architecture},
        ${trimText(record.stage)},
        ${JSON.stringify(record)}::jsonb,
        ${sourceProvider},
        ${downloadUrl},
        ${sha256},
        ${Math.max(0, Math.floor(Number(record.size_bytes || 0)))},
        ${Boolean(record.ready)},
        ${Boolean(record.is_current)},
        ${JSON.stringify(record)}::jsonb,
        ${createdAt},
        now()
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
  }
}

async function syncModelUpdatesFromLocal(
  request: NextRequest,
  token: string,
  options: {
    siteId?: string | null;
    statusFilter?: string | null;
  } = {},
): Promise<void> {
  await syncModelVersionsFromLocal(request, token);
  const params = new URLSearchParams();
  if (trimText(options.siteId)) {
    params.set("site_id", trimText(options.siteId));
  }
  if (trimText(options.statusFilter)) {
    params.set("status_filter", trimText(options.statusFilter));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  const records = await fetchLegacyLocalNodeApi<ModelUpdateRecord[]>(request, `/api/admin/model-updates${suffix}`, {}, token);
  if (!records.length) {
    return;
  }
  await persistModelUpdateRecords(records);
}

async function persistModelUpdateRecords(records: ModelUpdateRecord[]): Promise<void> {
  const sql = await controlPlaneSql();
  for (const record of records) {
    const updateId = trimText(record.update_id);
    if (!updateId) {
      continue;
    }
    const createdAt = isoStringOrNull(record.created_at) || new Date().toISOString();
    const reviewedAt = isoStringOrNull(record.reviewed_at);
    await sql`
      insert into model_updates (
        update_id,
        site_id,
        base_model_version_id,
        status,
        payload_json,
        reviewer_user_id,
        reviewer_notes,
        created_at,
        reviewed_at,
        updated_at
      ) values (
        ${updateId},
        ${trimText(record.site_id)},
        ${trimText(record.base_model_version_id)},
        ${trimText(record.status) || "pending_review"},
        ${JSON.stringify(record)}::jsonb,
        ${trimText(record.reviewed_by)},
        ${trimText(record.reviewer_notes)},
        ${createdAt},
        ${reviewedAt},
        now()
      )
      on conflict (update_id) do update set
        site_id = excluded.site_id,
        base_model_version_id = excluded.base_model_version_id,
        status = excluded.status,
        payload_json = excluded.payload_json,
        reviewer_user_id = excluded.reviewer_user_id,
        reviewer_notes = excluded.reviewer_notes,
        reviewed_at = excluded.reviewed_at,
        updated_at = now()
    `;
  }
}

async function syncAggregationsFromLocal(request: NextRequest, token: string): Promise<void> {
  await syncModelVersionsFromLocal(request, token);
  const records = await fetchLegacyLocalNodeApi<AggregationRecord[]>(request, "/api/admin/aggregations", {}, token);
  if (!records.length) {
    return;
  }
  await persistAggregationRecords(records);
}

async function persistAggregationRecords(records: AggregationRecord[]): Promise<void> {
  const sql = await controlPlaneSql();
  for (const record of records) {
    const aggregationId = trimText(record.aggregation_id);
    if (!aggregationId) {
      continue;
    }
    const createdAt = isoStringOrNull(record.created_at) || new Date().toISOString();
    await sql`
      insert into aggregations (
        aggregation_id,
        base_model_version_id,
        new_version_name,
        status,
        payload_json,
        summary_json,
        created_at,
        updated_at
      ) values (
        ${aggregationId},
        ${trimText(record.base_model_version_id)},
        ${trimText(record.new_version_name) || "pending-aggregation"},
        ${"completed"},
        ${JSON.stringify(record)}::jsonb,
        ${JSON.stringify(record)}::jsonb,
        ${createdAt},
        now()
      )
      on conflict (aggregation_id) do update set
        base_model_version_id = excluded.base_model_version_id,
        new_version_name = excluded.new_version_name,
        payload_json = excluded.payload_json,
        summary_json = excluded.summary_json,
        updated_at = now()
    `;
  }
}

export async function listMainModelVersions(request: NextRequest): Promise<ModelVersionRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  await syncModelVersionsFromLocal(request, token);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
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
      created_at
    from model_versions
    order by is_current desc, created_at desc
  `;
  return rows.map((row) => serializeMainModelVersionRow(row as Record<string, unknown>));
}

export async function listMainModelUpdates(
  request: NextRequest,
  options: {
    siteId?: string | null;
    statusFilter?: string | null;
  } = {},
): Promise<ModelUpdateRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const normalizedSiteId = trimText(options.siteId);
  const normalizedStatus = trimText(options.statusFilter);
  await syncModelUpdatesFromLocal(request, token, {
    siteId: normalizedSiteId,
    statusFilter: normalizedStatus,
  });
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      update_id,
      site_id,
      base_model_version_id,
      status,
      payload_json,
      reviewer_user_id,
      reviewer_notes,
      created_at,
      reviewed_at
    from model_updates
    order by created_at desc
  `;
  const permittedSiteIds = new Set(normalizeStringArray(user.site_ids));
  return rows
    .map((row) => serializeMainModelUpdateRow(row as Record<string, unknown>))
    .filter((record) => {
      if (normalizedSiteId && record.site_id !== normalizedSiteId) {
        return false;
      }
      if (normalizedStatus && record.status !== normalizedStatus) {
        return false;
      }
      if (user.role === "admin") {
        return true;
      }
      return record.site_id ? permittedSiteIds.has(record.site_id) : false;
    });
}

export async function listMainAggregations(request: NextRequest): Promise<AggregationRecord[]> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  await syncAggregationsFromLocal(request, token);
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      aggregation_id,
      base_model_version_id,
      new_version_name,
      payload_json,
      summary_json,
      created_at
    from aggregations
    order by created_at desc
  `;
  return rows.map((row) => serializeMainAggregationRow(row as Record<string, unknown>));
}

export async function deleteMainModelVersion(
  request: NextRequest,
  versionId: string,
): Promise<{ model_version: ModelVersionRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ model_version: ModelVersionRecord }>(
    request,
    `/api/admin/model-versions/${encodeURIComponent(normalizedVersionId)}`,
    { method: "DELETE" },
    token,
  );
  const sql = await controlPlaneSql();
  await sql`delete from model_versions where version_id = ${normalizedVersionId}`;
  return response;
}

export async function publishMainModelVersion(
  request: NextRequest,
  versionId: string,
  payload: {
    download_url?: string;
    set_current?: boolean;
  },
): Promise<{ model_version: ModelVersionRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ model_version: ModelVersionRecord }>(
    request,
    `/api/admin/model-versions/${encodeURIComponent(normalizedVersionId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        download_url: trimText(payload.download_url),
        set_current: Boolean(payload.set_current),
      }),
    },
    token,
  );
  if (response.model_version) {
    await persistModelVersionRecords([response.model_version]);
  }
  return response;
}

export async function autoPublishMainModelVersion(
  request: NextRequest,
  versionId: string,
  payload: {
    set_current?: boolean;
  },
): Promise<{ model_version: ModelVersionRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedVersionId = trimText(versionId);
  if (!normalizedVersionId) {
    throw new Error("Model version id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ model_version: ModelVersionRecord }>(
    request,
    `/api/admin/model-versions/${encodeURIComponent(normalizedVersionId)}/auto-publish`,
    {
      method: "POST",
      body: JSON.stringify({
        set_current: Boolean(payload.set_current),
      }),
    },
    token,
  );
  if (response.model_version) {
    await persistModelVersionRecords([response.model_version]);
  }
  return response;
}

export async function reviewMainModelUpdate(
  request: NextRequest,
  updateId: string,
  payload: {
    decision?: "approved" | "rejected";
    reviewer_notes?: string;
  },
): Promise<{ update: ModelUpdateRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertAdminWorkspacePermission(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ update: ModelUpdateRecord }>(
    request,
    `/api/admin/model-updates/${encodeURIComponent(normalizedUpdateId)}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decision: payload.decision,
        reviewer_notes: trimText(payload.reviewer_notes),
      }),
    },
    token,
  );
  if (response.update) {
    await persistModelUpdateRecords([response.update]);
  }
  return response;
}

export async function publishMainModelUpdate(
  request: NextRequest,
  updateId: string,
  payload: {
    download_url?: string;
  },
): Promise<{ update: ModelUpdateRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ update: ModelUpdateRecord }>(
    request,
    `/api/admin/model-updates/${encodeURIComponent(normalizedUpdateId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        download_url: trimText(payload.download_url),
      }),
    },
    token,
  );
  if (response.update) {
    await persistModelUpdateRecords([response.update]);
  }
  return response;
}

export async function autoPublishMainModelUpdate(
  request: NextRequest,
  updateId: string,
): Promise<{ update: ModelUpdateRecord }> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const normalizedUpdateId = trimText(updateId);
  if (!normalizedUpdateId) {
    throw new Error("Model update id is required.");
  }
  const response = await fetchLegacyLocalNodeApi<{ update: ModelUpdateRecord }>(
    request,
    `/api/admin/model-updates/${encodeURIComponent(normalizedUpdateId)}/auto-publish`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    token,
  );
  if (response.update) {
    await persistModelUpdateRecords([response.update]);
  }
  return response;
}

export async function runMainFederatedAggregation(
  request: NextRequest,
  payload: {
    update_ids?: string[];
    new_version_name?: string;
  },
): Promise<AggregationRunResponse> {
  const token = readBearerToken(request);
  const { user } = await requireMainAppBridgeUser(request);
  assertPlatformAdmin(user);
  const response = await fetchLegacyLocalNodeApi<AggregationRunResponse>(
    request,
    "/api/admin/aggregations/run",
    {
      method: "POST",
      body: JSON.stringify({
        update_ids: Array.isArray(payload.update_ids) ? payload.update_ids : [],
        new_version_name: trimText(payload.new_version_name) || undefined,
      }),
    },
    token,
  );
  await syncModelVersionsFromLocal(request, token);
  await syncModelUpdatesFromLocal(request, token);
  await syncAggregationsFromLocal(request, token);
  return response;
}
