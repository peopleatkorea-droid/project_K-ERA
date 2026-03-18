import "server-only";

import { NextRequest } from "next/server";

import type { PublicInstitutionRecord, PublicStatistics, SiteRecord } from "../types";
import { controlPlaneSql } from "./db";
import {
  ensureDefaultProject,
  serializeInstitutionRecord,
  serializeSiteRecord,
  upsertInstitutionRecord,
  upsertSiteRecord,
} from "./main-app-bridge-records";
import { fetchLegacyLocalNodeApi, trimText } from "./main-app-bridge-shared";

async function seedPublicSitesFromLocal(request: NextRequest): Promise<void> {
  const localSites = await fetchLegacyLocalNodeApi<SiteRecord[]>(request, "/api/public/sites");
  for (const site of localSites) {
    await upsertSiteRecord(site);
  }
}

async function seedInstitutionsFromLocal(
  request: NextRequest,
  query: string,
  options?: { sido_code?: string; sggu_code?: string; limit?: number },
): Promise<void> {
  const params = new URLSearchParams();
  if (trimText(query)) {
    params.set("q", trimText(query));
  }
  if (trimText(options?.sido_code)) {
    params.set("sido_code", trimText(options?.sido_code));
  }
  if (trimText(options?.sggu_code)) {
    params.set("sggu_code", trimText(options?.sggu_code));
  }
  params.set("limit", String(Math.max(1, Math.min(options?.limit ?? 12, 50))));
  const institutions = await fetchLegacyLocalNodeApi<PublicInstitutionRecord[]>(
    request,
    `/api/public/institutions/search?${params.toString()}`,
  );
  for (const institution of institutions) {
    await upsertInstitutionRecord(institution);
  }
}

export async function listPublicSites(request: NextRequest): Promise<SiteRecord[]> {
  await ensureDefaultProject();
  const sql = await controlPlaneSql();
  let rows = await sql`
    select site_id, display_name, hospital_name
    from sites
    where status = 'active'
    order by display_name asc, site_id asc
  `;
  if (!rows.length) {
    await seedPublicSitesFromLocal(request);
    rows = await sql`
      select site_id, display_name, hospital_name
      from sites
      where status = 'active'
      order by display_name asc, site_id asc
    `;
  }
  return rows.map((row) => serializeSiteRecord(row));
}

export async function searchPublicInstitutions(
  request: NextRequest,
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
  let rows = await sql.unsafe(
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
  if (!rows.length) {
    await seedInstitutionsFromLocal(request, query, options);
    rows = await sql.unsafe(
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
  }
  return rows.map((row) => serializeInstitutionRecord(row));
}

export async function fetchPublicStatistics(request: NextRequest): Promise<PublicStatistics> {
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
  if (!siteCount && !currentModelVersion && !totalCases && !totalImages) {
    return fetchLegacyLocalNodeApi<PublicStatistics>(request, "/api/public/statistics");
  }
  return {
    site_count: siteCount,
    total_cases: totalCases,
    total_images: totalImages,
    current_model_version: currentModelVersion,
    last_updated: new Date().toISOString(),
  };
}
