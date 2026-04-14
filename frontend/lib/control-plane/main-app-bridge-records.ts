import "server-only";

import type { Row } from "postgres";

import type {
  AccessRequestRecord,
  DesktopReleaseRecord,
  AuthState,
  ManagedSiteRecord,
  ProjectRecord,
  PublicInstitutionRecord,
  SiteRecord,
} from "../types";
import { getSiteAlias, getSiteOfficialName } from "../site-labels";
import { makeControlPlaneId, normalizeEmail } from "./crypto";
import { configuredDesktopCpuRelease, type ConfiguredDesktopRelease } from "./config";
import { controlPlaneSql } from "./db";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_NAME,
  normalizeSiteIdPreservingCase,
  normalizeStringArray,
  rowValue,
  trimText,
} from "./main-app-bridge-shared";

const SYSTEM_PROJECT_OWNER_ID = "system";

type AccessRequestResolutionLookups = {
  directSitesById: Map<string, Row>;
  mappedSitesBySourceInstitutionId: Map<string, Row>;
  institutionsById: Map<string, Row>;
};

function serializeDesktopReleaseRecord(row: Row): DesktopReleaseRecord {
  return {
    release_id: trimText(rowValue<string>(row, "release_id")),
    channel: trimText(rowValue<string>(row, "channel")),
    label: trimText(rowValue<string>(row, "label")),
    version: trimText(rowValue<string>(row, "version")),
    platform: trimText(rowValue<string>(row, "platform")) || "windows",
    installer_type: trimText(rowValue<string>(row, "installer_type")) || "nsis",
    download_url: trimText(rowValue<string>(row, "download_url")),
    folder_url: trimText(rowValue<string | null>(row, "folder_url")) || null,
    sha256: trimText(rowValue<string | null>(row, "sha256")) || null,
    size_bytes:
      typeof rowValue<number | null>(row, "size_bytes") === "number"
        ? rowValue<number | null>(row, "size_bytes")
        : Number.isFinite(Number(rowValue<string | null>(row, "size_bytes")))
          ? Number(rowValue<string | null>(row, "size_bytes"))
          : null,
    notes: trimText(rowValue<string | null>(row, "notes")) || null,
    active: Boolean(rowValue<boolean>(row, "active")),
    metadata_json:
      rowValue<Record<string, unknown> | null>(row, "metadata_json") &&
      typeof rowValue<Record<string, unknown> | null>(row, "metadata_json") === "object"
        ? (rowValue<Record<string, unknown>>(row, "metadata_json") ?? {})
        : {},
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    updated_at: new Date(rowValue<string | Date>(row, "updated_at")).toISOString(),
  };
}

function configuredDesktopReleases(): ConfiguredDesktopRelease[] {
  const cpuRelease = configuredDesktopCpuRelease();
  return cpuRelease ? [cpuRelease] : [];
}

export async function upsertDesktopReleaseRecord(record: ConfiguredDesktopRelease): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into desktop_releases (
      release_id,
      channel,
      label,
      version,
      platform,
      installer_type,
      download_url,
      folder_url,
      sha256,
      size_bytes,
      notes,
      active,
      metadata_json,
      created_at,
      updated_at
    ) values (
      ${trimText(record.releaseId)},
      ${trimText(record.channel)},
      ${trimText(record.label)},
      ${trimText(record.version)},
      ${trimText(record.platform)},
      ${trimText(record.installerType)},
      ${trimText(record.downloadUrl)},
      ${trimText(record.folderUrl) || null},
      ${trimText(record.sha256)},
      ${record.sizeBytes ?? null},
      ${trimText(record.notes) || null},
      ${true},
      ${JSON.stringify({
        source: "env",
      })}::jsonb,
      now(),
      now()
    )
    on conflict (release_id) do update set
      channel = excluded.channel,
      label = excluded.label,
      version = excluded.version,
      platform = excluded.platform,
      installer_type = excluded.installer_type,
      download_url = excluded.download_url,
      folder_url = excluded.folder_url,
      sha256 = excluded.sha256,
      size_bytes = excluded.size_bytes,
      notes = excluded.notes,
      active = excluded.active,
      metadata_json = excluded.metadata_json,
      updated_at = now()
  `;
}

export async function syncConfiguredDesktopReleases(): Promise<void> {
  const configured = configuredDesktopReleases();
  if (configured.length === 0) {
    return;
  }
  for (const release of configured) {
    await upsertDesktopReleaseRecord(release);
  }
  const sql = await controlPlaneSql();
  const configuredIds = configured.map((release) => release.releaseId);
  const configuredChannels = Array.from(new Set(configured.map((release) => release.channel)));
  await sql`
    update desktop_releases
    set
      active = case when release_id = any(${configuredIds}) then true else false end,
      updated_at = now()
    where channel = any(${configuredChannels})
  `;
}

export async function listActiveDesktopReleases(): Promise<DesktopReleaseRecord[]> {
  await syncConfiguredDesktopReleases();
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      release_id,
      channel,
      label,
      version,
      platform,
      installer_type,
      download_url,
      folder_url,
      sha256,
      size_bytes,
      notes,
      active,
      metadata_json,
      created_at,
      updated_at
    from desktop_releases
    where active = true
    order by updated_at desc, created_at desc
  `;
  return rows.map((row) => serializeDesktopReleaseRecord(row));
}

export async function desktopReleaseRowById(releaseId: string): Promise<Row | null> {
  await syncConfiguredDesktopReleases();
  const sql = await controlPlaneSql();
  const rows = await sql`
    select
      release_id,
      channel,
      label,
      version,
      platform,
      installer_type,
      download_url,
      folder_url,
      sha256,
      size_bytes,
      notes,
      active,
      metadata_json,
      created_at,
      updated_at
    from desktop_releases
    where release_id = ${trimText(releaseId)}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function appendDesktopDownloadEvent(input: {
  releaseId: string;
  userId?: string | null;
  username?: string | null;
  userRole?: string | null;
  siteId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const eventId = makeControlPlaneId("download");
  const sql = await controlPlaneSql();
  await sql`
    insert into desktop_download_events (
      event_id,
      release_id,
      user_id,
      username,
      user_role,
      site_id,
      metadata_json,
      created_at
    ) values (
      ${eventId},
      ${trimText(input.releaseId)},
      ${trimText(input.userId) || null},
      ${trimText(input.username)},
      ${trimText(input.userRole)},
      ${trimText(input.siteId) || null},
      ${JSON.stringify(input.metadata ?? {})}::jsonb,
      now()
    )
  `;
  return eventId;
}

export async function ensureDefaultProject(): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into projects (
      project_id,
      name,
      description,
      owner_user_id,
      site_ids,
      created_at,
      updated_at
    ) values (
      ${DEFAULT_PROJECT_ID},
      ${DEFAULT_PROJECT_NAME},
      ${""},
      ${SYSTEM_PROJECT_OWNER_ID},
      ${JSON.stringify([])}::jsonb,
      now(),
      now()
    )
    on conflict (project_id) do update set
      name = excluded.name,
      updated_at = now()
  `;
}

export async function upsertProjectRecord(
  record: Partial<ProjectRecord> & { project_id: string; name: string },
): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into projects (
      project_id,
      name,
      description,
      owner_user_id,
      site_ids,
      created_at,
      updated_at
    ) values (
      ${trimText(record.project_id)},
      ${trimText(record.name)},
      ${trimText(record.description)},
      ${trimText(record.owner_user_id) || SYSTEM_PROJECT_OWNER_ID},
      ${JSON.stringify(normalizeStringArray(record.site_ids))}::jsonb,
      ${trimText(record.created_at) || new Date().toISOString()},
      now()
    )
    on conflict (project_id) do update set
      name = excluded.name,
      description = excluded.description,
      owner_user_id = coalesce(excluded.owner_user_id, projects.owner_user_id),
      site_ids = excluded.site_ids,
      updated_at = now()
  `;
}

async function appendSiteToProject(projectId: string, siteId: string): Promise<void> {
  const sql = await controlPlaneSql();
  const rows = await sql`
    select site_ids
    from projects
    where project_id = ${projectId}
    limit 1
  `;
  const existing = normalizeStringArray(rows[0]?.site_ids);
  if (existing.includes(siteId)) {
    return;
  }
  await sql`
    update projects
    set
      site_ids = ${JSON.stringify([...existing, siteId])}::jsonb,
      updated_at = now()
    where project_id = ${projectId}
  `;
}

export async function upsertSiteRecord(
  record: Partial<ManagedSiteRecord> & {
    site_id: string;
    display_name: string;
    hospital_name: string;
  },
): Promise<void> {
  await ensureDefaultProject();
  const sql = await controlPlaneSql();
  const projectId = trimText(record.project_id) || DEFAULT_PROJECT_ID;
  await upsertProjectRecord({
    project_id: projectId,
    name: projectId === DEFAULT_PROJECT_ID ? DEFAULT_PROJECT_NAME : projectId,
    description: "",
    owner_user_id: SYSTEM_PROJECT_OWNER_ID,
    site_ids: [],
  });
  const siteId = normalizeSiteIdPreservingCase(record.site_id);
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
      ${projectId},
      ${trimText(record.display_name)},
      ${trimText(record.hospital_name) || trimText(record.display_name) || siteId},
      ${trimText(record.source_institution_id) || null},
      ${trimText(record.local_storage_root)},
      ${record.research_registry_enabled ?? true},
      ${"active"},
      ${trimText(record.created_at) || new Date().toISOString()},
      now()
    )
    on conflict (site_id) do update set
      project_id = coalesce(excluded.project_id, sites.project_id),
      display_name = excluded.display_name,
      hospital_name = excluded.hospital_name,
      source_institution_id = coalesce(excluded.source_institution_id, sites.source_institution_id),
      local_storage_root = case
        when excluded.local_storage_root = '' then sites.local_storage_root
        else excluded.local_storage_root
      end,
      research_registry_enabled = excluded.research_registry_enabled,
      status = excluded.status,
      updated_at = now()
  `;
  await appendSiteToProject(projectId, siteId);
}

export async function upsertInstitutionRecord(record: PublicInstitutionRecord): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into institution_directory (
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
      source_payload,
      synced_at
    ) values (
      ${trimText(record.institution_id)},
      ${trimText(record.source) || "hira"},
      ${trimText(record.name)},
      ${trimText(record.institution_type_code)},
      ${trimText(record.institution_type_name)},
      ${trimText(record.address)},
      ${trimText(record.phone)},
      ${trimText(record.homepage)},
      ${trimText(record.sido_code)},
      ${trimText(record.sggu_code)},
      ${trimText(record.emdong_name)},
      ${trimText(record.postal_code)},
      ${trimText(record.x_pos)},
      ${trimText(record.y_pos)},
      ${record.ophthalmology_available ?? true},
      ${trimText(record.open_status) || "active"},
      ${JSON.stringify({})}::jsonb,
      ${trimText(record.synced_at) || new Date().toISOString()}
    )
    on conflict (institution_id) do update set
      source = excluded.source,
      name = excluded.name,
      institution_type_code = excluded.institution_type_code,
      institution_type_name = excluded.institution_type_name,
      address = excluded.address,
      phone = excluded.phone,
      homepage = excluded.homepage,
      sido_code = excluded.sido_code,
      sggu_code = excluded.sggu_code,
      emdong_name = excluded.emdong_name,
      postal_code = excluded.postal_code,
      x_pos = excluded.x_pos,
      y_pos = excluded.y_pos,
      ophthalmology_available = excluded.ophthalmology_available,
      open_status = excluded.open_status,
      synced_at = excluded.synced_at
  `;
}

export async function hydrateSiteLabelsForInstitutionIds(institutionIds: string[]): Promise<void> {
  const normalizedInstitutionIds = Array.from(
    new Set(
      institutionIds
        .map((institutionId) => trimText(institutionId))
        .filter(Boolean),
    ),
  );
  if (normalizedInstitutionIds.length === 0) {
    return;
  }
  const sql = await controlPlaneSql();
  await sql`
    update sites as s
    set
      display_name = case
        when nullif(trim(s.display_name), '') is null
          or trim(s.display_name) = s.site_id
          or trim(s.display_name) = directory.name
          then ''
        else s.display_name
      end,
      hospital_name = case
        when nullif(trim(s.hospital_name), '') is null or trim(s.hospital_name) = s.site_id
          then directory.name
        else s.hospital_name
      end,
      updated_at = now()
    from institution_directory as directory
    where directory.institution_id = any(${normalizedInstitutionIds})
      and (s.site_id = directory.institution_id or nullif(s.source_institution_id, '') = directory.institution_id)
  `;
}

export async function upsertAccessRequestRecord(
  canonicalUserId: string,
  email: string,
  record: AccessRequestRecord,
): Promise<void> {
  const sql = await controlPlaneSql();
  await sql`
    insert into access_requests (
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
    ) values (
      ${trimText(record.request_id) || makeControlPlaneId("access")},
      ${canonicalUserId},
      ${normalizeEmail(email)},
      ${trimText(record.requested_site_id)},
      ${trimText(record.requested_site_label)},
      ${trimText(record.requested_site_source) || "site"},
      ${trimText(record.requested_role) || "viewer"},
      ${trimText(record.message)},
      ${trimText(record.status) || "pending"},
      ${trimText(record.reviewed_by) || null},
      ${trimText(record.reviewer_notes)},
      ${trimText(record.created_at) || new Date().toISOString()},
      ${trimText(record.reviewed_at) || null}
    )
    on conflict (request_id) do update set
      user_id = excluded.user_id,
      email = excluded.email,
      requested_site_id = excluded.requested_site_id,
      requested_site_label = excluded.requested_site_label,
      requested_site_source = excluded.requested_site_source,
      requested_role = excluded.requested_role,
      message = excluded.message,
      status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      reviewer_notes = excluded.reviewer_notes,
      created_at = excluded.created_at,
      reviewed_at = excluded.reviewed_at
  `;
}

export async function siteRowById(siteId: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
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
    where sites.site_id = ${siteId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function siteRowBySourceInstitutionId(sourceInstitutionId: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
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
    where sites.source_institution_id = ${sourceInstitutionId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function institutionRowById(institutionId: string): Promise<Row | null> {
  const sql = await controlPlaneSql();
  const rows = await sql`
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
    where institution_id = ${institutionId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function preloadAccessRequestLookups(rows: Row[]): Promise<AccessRequestResolutionLookups> {
  const requestedSiteIds = Array.from(
    new Set(rows.map((row) => trimText(rowValue<string>(row, "requested_site_id"))).filter(Boolean)),
  );
  const institutionIds = Array.from(
    new Set(
      rows
        .filter((row) => trimText(rowValue<string>(row, "requested_site_source") || "site") === "institution_directory")
        .map((row) => trimText(rowValue<string>(row, "requested_site_id")))
        .filter(Boolean),
    ),
  );
  const sql = await controlPlaneSql();
  const [siteRows, institutionRows] = await Promise.all([
    requestedSiteIds.length
      ? sql`
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
          where sites.site_id = any(${requestedSiteIds})
             or sites.source_institution_id = any(${requestedSiteIds})
        `
      : Promise.resolve([] as Row[]),
    institutionIds.length
      ? sql`
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
          where institution_id = any(${institutionIds})
        `
      : Promise.resolve([] as Row[]),
  ]);
  const directSitesById = new Map<string, Row>();
  const mappedSitesBySourceInstitutionId = new Map<string, Row>();
  for (const row of siteRows) {
    const siteId = trimText(rowValue<string>(row, "site_id"));
    const sourceInstitutionId = trimText(rowValue<string | null>(row, "source_institution_id"));
    if (siteId) {
      directSitesById.set(siteId, row);
    }
    if (sourceInstitutionId) {
      mappedSitesBySourceInstitutionId.set(sourceInstitutionId, row);
    }
  }
  const institutionsById = new Map<string, Row>();
  for (const row of institutionRows) {
    const institutionId = trimText(rowValue<string>(row, "institution_id"));
    if (institutionId) {
      institutionsById.set(institutionId, row);
    }
  }
  return {
    directSitesById,
    mappedSitesBySourceInstitutionId,
    institutionsById,
  };
}

export function serializeSiteRecord(row: Row): SiteRecord {
  const siteId = rowValue<string>(row, "site_id");
  const sourceInstitutionName = rowValue<string | null | undefined>(row, "source_institution_name");
  const trimmedSourceName = typeof sourceInstitutionName === "string" ? sourceInstitutionName.trim() : "";
  const rawSite = {
    site_id: siteId,
    display_name: rowValue<string>(row, "display_name"),
    hospital_name: rowValue<string>(row, "hospital_name"),
    source_institution_name: trimmedSourceName || undefined,
  };
  const officialName = getSiteOfficialName(rawSite, siteId);
  const siteAlias = getSiteAlias(rawSite);

  const baseRecord: SiteRecord = {
    site_id: siteId,
    display_name: officialName,
    hospital_name: officialName,
  };
  if (siteAlias) {
    baseRecord.site_alias = siteAlias;
  }
  if (trimmedSourceName) {
    baseRecord.source_institution_name = trimmedSourceName;
  }
  return baseRecord;
}

export function serializeManagedSiteRecord(row: Row): ManagedSiteRecord {
  const siteId = rowValue<string>(row, "site_id");
  const sourceInstitutionName = rowValue<string | null>(row, "source_institution_name");
  const rawSite = {
    site_id: siteId,
    display_name: rowValue<string>(row, "display_name"),
    hospital_name: rowValue<string>(row, "hospital_name"),
    source_institution_name: sourceInstitutionName,
  };
  const officialName = getSiteOfficialName(rawSite, siteId);
  const siteAlias = getSiteAlias(rawSite);
  return {
    site_id: siteId,
    project_id: rowValue<string>(row, "project_id"),
    display_name: officialName,
    hospital_name: officialName,
    site_alias: siteAlias,
    source_institution_id: rowValue<string | null>(row, "source_institution_id"),
    source_institution_name: sourceInstitutionName,
    source_institution_address: rowValue<string | null>(row, "source_institution_address"),
    local_storage_root: rowValue<string>(row, "local_storage_root"),
    research_registry_enabled: Boolean(rowValue<boolean>(row, "research_registry_enabled")),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

export function serializeProjectRecord(row: Row): ProjectRecord {
  return {
    project_id: rowValue<string>(row, "project_id"),
    name: rowValue<string>(row, "name"),
    description: rowValue<string>(row, "description"),
    owner_user_id: rowValue<string | null>(row, "owner_user_id") || "",
    site_ids: normalizeStringArray(rowValue<unknown>(row, "site_ids")),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
  };
}

export function serializeInstitutionRecord(row: Row): PublicInstitutionRecord {
  return {
    institution_id: rowValue<string>(row, "institution_id"),
    source: rowValue<string>(row, "source"),
    name: rowValue<string>(row, "name"),
    institution_type_code: rowValue<string>(row, "institution_type_code"),
    institution_type_name: rowValue<string>(row, "institution_type_name"),
    address: rowValue<string>(row, "address"),
    phone: rowValue<string>(row, "phone"),
    homepage: rowValue<string>(row, "homepage"),
    sido_code: rowValue<string>(row, "sido_code"),
    sggu_code: rowValue<string>(row, "sggu_code"),
    emdong_name: rowValue<string>(row, "emdong_name"),
    postal_code: rowValue<string>(row, "postal_code"),
    x_pos: rowValue<string>(row, "x_pos"),
    y_pos: rowValue<string>(row, "y_pos"),
    ophthalmology_available: Boolean(rowValue<boolean>(row, "ophthalmology_available")),
    open_status: rowValue<string>(row, "open_status"),
    synced_at: new Date(rowValue<string | Date>(row, "synced_at")).toISOString(),
  };
}

export function serializeAccessRequestRecordWithLookups(
  row: Row,
  lookups: AccessRequestResolutionLookups,
): AccessRequestRecord {
  const requestedSiteId = rowValue<string>(row, "requested_site_id");
  const requestedSiteSource = trimText(rowValue<string>(row, "requested_site_source") || "site") || "site";
  const directSite = lookups.directSitesById.get(requestedSiteId) ?? null;
  const mappedSite =
    directSite ??
    (requestedSiteSource === "institution_directory" ? lookups.mappedSitesBySourceInstitutionId.get(requestedSiteId) ?? null : null);
  const institution =
    requestedSiteSource === "institution_directory" && !directSite ? lookups.institutionsById.get(requestedSiteId) ?? null : null;
  const serializedMappedSite = mappedSite ? serializeSiteRecord(mappedSite) : null;
  const requestedSiteLabel =
    trimText(rowValue<string>(row, "requested_site_label")) ||
    serializedMappedSite?.display_name ||
    (institution ? rowValue<string>(institution, "name") : "");
  return {
    request_id: rowValue<string>(row, "request_id"),
    user_id: rowValue<string>(row, "user_id"),
    email: rowValue<string>(row, "email"),
    requested_site_id: requestedSiteId,
    requested_site_label: requestedSiteLabel,
    requested_site_source: directSite ? "site" : requestedSiteSource,
    resolved_site_id: serializedMappedSite?.site_id ?? null,
    resolved_site_label: serializedMappedSite?.display_name ?? null,
    requested_role: rowValue<string>(row, "requested_role"),
    message: rowValue<string>(row, "message"),
    status: rowValue<AuthState>(row, "status"),
    reviewed_by: rowValue<string | null>(row, "reviewed_by"),
    reviewer_notes: rowValue<string>(row, "reviewer_notes"),
    created_at: new Date(rowValue<string | Date>(row, "created_at")).toISOString(),
    reviewed_at: rowValue<string | Date | null>(row, "reviewed_at")
      ? new Date(rowValue<string | Date>(row, "reviewed_at")).toISOString()
      : null,
  };
}

export async function serializeAccessRequestRecord(row: Row): Promise<AccessRequestRecord> {
  const lookups = await preloadAccessRequestLookups([row]);
  return serializeAccessRequestRecordWithLookups(row, lookups);
}

export async function listAccessRequestsForCanonicalUser(canonicalUserId: string): Promise<AccessRequestRecord[]> {
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
    where user_id = ${canonicalUserId}
    order by created_at desc
  `;
  const lookups = await preloadAccessRequestLookups(rows);
  return rows.map((row) => serializeAccessRequestRecordWithLookups(row, lookups));
}

export async function latestAccessRequestForCanonicalUser(
  canonicalUserId: string,
): Promise<AccessRequestRecord | null> {
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
    where user_id = ${canonicalUserId}
    order by created_at desc
    limit 1
  `;
  if (!rows[0]) {
    return null;
  }
  const lookups = await preloadAccessRequestLookups(rows);
  return serializeAccessRequestRecordWithLookups(rows[0], lookups);
}
