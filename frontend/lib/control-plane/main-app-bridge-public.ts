import "server-only";

import { NextRequest } from "next/server";

import type { PublicInstitutionRecord, PublicStatistics, SiteRecord } from "../types";
import {
  controlPlaneHiraApiKey,
  controlPlaneHiraApiTimeoutMs,
  controlPlaneHiraHospitalInfoUrl,
} from "./config";
import { controlPlaneSql } from "./db";
import {
  ensureDefaultProject,
  serializeInstitutionRecord,
  serializeSiteRecord,
  upsertInstitutionRecord,
} from "./main-app-bridge-records";
import { trimText } from "./main-app-bridge-shared";

const HIRA_OPHTHALMOLOGY_SPECIALTY_CODE = "12";

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

function normalizeHiraInstitutionRecord(record: Record<string, unknown>, syncedAt: string): PublicInstitutionRecord | null {
  const institutionId = pickHiraField(record, "ykiho");
  if (!institutionId) {
    return null;
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

async function searchHiraInstitutionsLive(
  query: string,
  options?: { sido_code?: string; sggu_code?: string; limit?: number },
): Promise<PublicInstitutionRecord[]> {
  const serviceKey = controlPlaneHiraApiKey();
  const normalizedQuery = trimText(query);
  if (!serviceKey || !normalizedQuery) {
    return [];
  }
  const limit = Math.max(1, Math.min(options?.limit ?? 12, 50));
  const url = new URL(controlPlaneHiraHospitalInfoUrl());
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(limit));
  url.searchParams.set("dgsbjtCd", HIRA_OPHTHALMOLOGY_SPECIALTY_CODE);
  url.searchParams.set("yadmNm", normalizedQuery);
  url.searchParams.set("_type", "json");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(controlPlaneHiraApiTimeoutMs()),
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const responsePayload = payload.response;
  if (!responsePayload || typeof responsePayload !== "object") {
    return [];
  }
  const body = (responsePayload as { body?: unknown }).body;
  const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawItems =
    bodyRecord.items && typeof bodyRecord.items === "object"
      ? ((bodyRecord.items as Record<string, unknown>).item ?? bodyRecord.items)
      : bodyRecord.items;
  const normalizedSido = trimText(options?.sido_code);
  const normalizedSggu = trimText(options?.sggu_code);
  const syncedAt = new Date().toISOString();
  const liveItems = coerceHiraItems(rawItems)
    .map((item) => normalizeHiraInstitutionRecord(item, syncedAt))
    .filter((item): item is PublicInstitutionRecord => Boolean(item))
    .filter((item) => !normalizedSido || item.sido_code === normalizedSido)
    .filter((item) => !normalizedSggu || item.sggu_code === normalizedSggu);
  if (liveItems.length > 0) {
    await Promise.all(liveItems.map((item) => upsertInstitutionRecord(item)));
  }
  return liveItems;
}

export async function listPublicSites(_request: NextRequest): Promise<SiteRecord[]> {
  await ensureDefaultProject();
  const sql = await controlPlaneSql();
  const rows = await sql`
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
    where status = 'active'
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

export async function searchPublicInstitutions(
  _request: NextRequest,
  query: string,
  options?: { sido_code?: string; sggu_code?: string; limit?: number },
): Promise<PublicInstitutionRecord[]> {
  const sql = await controlPlaneSql();
  const conditions: string[] = [`open_status = 'active'`];
  const values: Array<string | number> = [];
  const normalizedQuery = trimText(query).toLowerCase();
  const normalizedSido = trimText(options?.sido_code);
  const normalizedSggu = trimText(options?.sggu_code);
  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    const likeIndex = values.length;
    conditions.push(
      `(lower(name) like $${likeIndex} or lower(address) like $${likeIndex} or lower(institution_id) like $${likeIndex})`,
    );
  }
  if (normalizedSido) {
    values.push(normalizedSido);
    conditions.push(`sido_code = $${values.length}`);
  }
  if (normalizedSggu) {
    values.push(normalizedSggu);
    conditions.push(`sggu_code = $${values.length}`);
  }
  const limit = Math.max(1, Math.min(options?.limit ?? 12, 50));
  values.push(limit);
  const rows = await sql.unsafe(
    `
      select
        institution_id,
        source,
        name,
        institution_type_code,
        institution_type_name,
        address,
        phone,
        homepage,
        sido_code,
        sggu_code,
        emdong_name,
        postal_code,
        x_pos,
        y_pos,
        ophthalmology_available,
        open_status,
        synced_at
      from institution_directory
      where ${conditions.join(" and ")}
      order by name asc
      limit $${values.length}
    `,
    values,
  );
  const serializedRows = rows.map((row) => serializeInstitutionRecord(row));
  if (serializedRows.length > 0 || !normalizedQuery) {
    return serializedRows;
  }
  const liveResults = await searchHiraInstitutionsLive(query, options);
  return liveResults.length > 0 ? liveResults : serializedRows;
}

export async function fetchPublicStatistics(_request: NextRequest): Promise<PublicStatistics> {
  const sql = await controlPlaneSql();
  const [siteCountRows, currentModelRows, validationRows] = await Promise.all([
    sql`select count(*)::int as count from sites where status = 'active'`,
    sql`
      select version_name
      from model_versions
      where is_current = true
      order by updated_at desc, created_at desc
      limit 1
    `,
    sql`
      select
        coalesce(sum(n_cases), 0)::int as total_cases,
        coalesce(sum(n_images), 0)::int as total_images
      from validation_runs
    `,
  ]);
  const siteCount = Number(siteCountRows[0]?.count || 0);
  const totalCases = Number(validationRows[0]?.total_cases || 0);
  const totalImages = Number(validationRows[0]?.total_images || 0);
  const currentModelVersion = trimText(currentModelRows[0]?.version_name) || null;
  return {
    site_count: siteCount,
    total_cases: totalCases,
    total_images: totalImages,
    current_model_version: currentModelVersion,
    last_updated: new Date().toISOString(),
  };
}
