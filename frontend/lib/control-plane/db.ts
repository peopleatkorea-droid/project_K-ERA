import postgres from "postgres";

import { controlPlaneDatabaseUrl } from "./config";

export type ControlPlaneSql = postgres.Sql<Record<string, unknown>>;

let cachedSql: ControlPlaneSql | null = null;
let schemaPromise: Promise<void> | null = null;
const CONTROL_PLANE_SCHEMA_NAME = "control_plane";
const CONTROL_PLANE_SCHEMA_VERSION = 3;
const SYSTEM_PROJECT_OWNER_ID = "system";
const DEFAULT_PROJECT_ID = "project_default";
const DEFAULT_PROJECT_NAME = "K-ERA Default Project";

function sqlClient(): ControlPlaneSql {
  if (cachedSql) {
    return cachedSql;
  }
  const databaseUrl = controlPlaneDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "No control-plane database is configured. Set KERA_CONTROL_PLANE_DATABASE_URL for a shared database, or KERA_LOCAL_CONTROL_PLANE_DATABASE_URL for a local cache.",
    );
  }
  cachedSql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return cachedSql;
}

function indexNameFor(tableName: string, suffix: string) {
  return `${tableName}_${suffix}`.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function createIndex(sql: ControlPlaneSql, tableName: string, suffix: string, statement: string): Promise<void> {
  const indexName = indexNameFor(tableName, suffix);
  await sql.unsafe(`create index if not exists ${indexName} on ${tableName} ${statement}`);
}

async function createUniqueIndex(sql: ControlPlaneSql, tableName: string, suffix: string, statement: string): Promise<void> {
  const indexName = indexNameFor(tableName, suffix);
  await sql.unsafe(`create unique index if not exists ${indexName} on ${tableName} ${statement}`);
}

async function ensureJsonbColumn(
  sql: ControlPlaneSql,
  tableName: string,
  columnName: string,
  defaultExpression: string,
): Promise<void> {
  const rows = await sql`
    select data_type
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `;
  const dataType = typeof rows[0]?.data_type === "string" ? rows[0].data_type : null;
  if (!dataType) {
    return;
  }
  if (dataType === "json") {
    await sql.unsafe(
      `alter table ${quoteIdentifier(tableName)} alter column ${quoteIdentifier(columnName)} type jsonb using ${quoteIdentifier(columnName)}::jsonb`,
    );
  }
  await sql.unsafe(
    `alter table ${quoteIdentifier(tableName)} alter column ${quoteIdentifier(columnName)} set default ${defaultExpression}`,
  );
}

async function reconcileLegacySchema(sql: ControlPlaneSql): Promise<void> {
  await sql`alter table if exists users add column if not exists username text`;
  await sql`alter table if exists users add column if not exists legacy_local_user_id text`;
  await sql`alter table if exists users add column if not exists public_alias text`;
  await sql`alter table if exists users add column if not exists password text`;
  await sql`alter table if exists users add column if not exists role text`;
  await sql`alter table if exists users add column if not exists site_ids jsonb default '[]'::jsonb`;
  await sql`alter table if exists users add column if not exists registry_consents jsonb default '{}'::jsonb`;
  await ensureJsonbColumn(sql, "users", "site_ids", "'[]'::jsonb");
  await ensureJsonbColumn(sql, "users", "registry_consents", "'{}'::jsonb");
  await sql`alter table if exists users add column if not exists email text`;
  await sql`alter table if exists users add column if not exists full_name text`;
  await sql`alter table if exists users add column if not exists global_role text`;
  await sql`alter table if exists users add column if not exists status text`;
  await sql`alter table if exists users add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists users add column if not exists updated_at timestamptz default now()`;
  await sql`
    update users
    set
      email = lower(coalesce(nullif(trim(email), ''), nullif(trim(username), ''), user_id || '@local.invalid')),
      full_name = coalesce(nullif(trim(full_name), ''), nullif(trim(username), ''), user_id),
      global_role = coalesce(nullif(trim(global_role), ''), case when coalesce(trim(role), '') = 'admin' then 'admin' else 'member' end),
      status = coalesce(nullif(trim(status), ''), 'active'),
      updated_at = now()
  `;
  await sql.unsafe(`
    with ranked as (
      select
        ctid,
        lower(email) as normalized_email,
        row_number() over (partition by lower(email) order by user_id) as row_number
      from users
      where email is not null and btrim(email) <> ''
    )
    update users as u
    set email = case
      when strpos(r.normalized_email, '@') > 0 then
        split_part(r.normalized_email, '@', 1) || '+' || u.user_id || '@' || split_part(r.normalized_email, '@', 2)
      else r.normalized_email || '+' || u.user_id || '@local.invalid'
    end,
    updated_at = now()
    from ranked as r
    where u.ctid = r.ctid and r.row_number > 1
  `);
  await sql.unsafe(`
    with ranked as (
      select
        ctid,
        google_sub,
        row_number() over (partition by google_sub order by user_id) as row_number
      from users
      where google_sub is not null and btrim(google_sub) <> ''
    )
    update users as u
    set google_sub = null,
        updated_at = now()
    from ranked as r
    where u.ctid = r.ctid and r.row_number > 1
  `);

  await sql`alter table if exists projects add column if not exists description text default ''`;
  await sql`alter table if exists projects add column if not exists owner_user_id text`;
  await sql`alter table if exists projects add column if not exists site_ids jsonb default '[]'::jsonb`;
  await ensureJsonbColumn(sql, "projects", "site_ids", "'[]'::jsonb");
  await sql`alter table if exists projects add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists projects add column if not exists updated_at timestamptz default now()`;
  await sql.unsafe(`alter table if exists projects alter column owner_user_id set default '${SYSTEM_PROJECT_OWNER_ID}'`);
  await sql`
    update projects
    set
      description = coalesce(description, ''),
      owner_user_id = coalesce(nullif(trim(owner_user_id), ''), ${SYSTEM_PROJECT_OWNER_ID}),
      site_ids = coalesce(site_ids, '[]'::jsonb),
      updated_at = now()
  `;
  await sql.unsafe(`alter table if exists projects alter column owner_user_id set not null`);

  await sql`alter table if exists sites add column if not exists project_id text default 'project_default'`;
  await sql`alter table if exists sites add column if not exists local_storage_root text default ''`;
  await sql`alter table if exists sites add column if not exists research_registry_enabled boolean not null default true`;
  await sql`alter table if exists sites add column if not exists status text`;
  await sql`alter table if exists sites add column if not exists updated_at timestamptz default now()`;
  await sql`
    update sites
    set
      project_id = coalesce(nullif(trim(project_id), ''), 'project_default'),
      display_name = coalesce(display_name, ''),
      hospital_name = coalesce(nullif(trim(hospital_name), ''), site_id),
      local_storage_root = coalesce(local_storage_root, ''),
      research_registry_enabled = coalesce(research_registry_enabled, true),
      status = coalesce(nullif(trim(status), ''), 'active'),
      updated_at = now()
  `;
  await sql.unsafe(`
    with ranked as (
      select
        ctid,
        source_institution_id,
        row_number() over (partition by source_institution_id order by site_id) as row_number
      from sites
      where source_institution_id is not null and btrim(source_institution_id) <> ''
    )
    update sites as s
    set source_institution_id = null,
        updated_at = now()
    from ranked as r
    where s.ctid = r.ctid and r.row_number > 1
  `);

  await sql`alter table if exists institution_directory add column if not exists source text default 'hira'`;
  await sql`alter table if exists institution_directory add column if not exists institution_type_code text default ''`;
  await sql`alter table if exists institution_directory add column if not exists institution_type_name text default ''`;
  await sql`alter table if exists institution_directory add column if not exists address text default ''`;
  await sql`alter table if exists institution_directory add column if not exists phone text default ''`;
  await sql`alter table if exists institution_directory add column if not exists homepage text default ''`;
  await sql`alter table if exists institution_directory add column if not exists sido_code text default ''`;
  await sql`alter table if exists institution_directory add column if not exists sggu_code text default ''`;
  await sql`alter table if exists institution_directory add column if not exists emdong_name text default ''`;
  await sql`alter table if exists institution_directory add column if not exists postal_code text default ''`;
  await sql`alter table if exists institution_directory add column if not exists x_pos text default ''`;
  await sql`alter table if exists institution_directory add column if not exists y_pos text default ''`;
  await sql`alter table if exists institution_directory add column if not exists ophthalmology_available boolean not null default true`;
  await sql`alter table if exists institution_directory add column if not exists open_status text default 'active'`;
  await sql`alter table if exists institution_directory add column if not exists source_payload jsonb default '{}'::jsonb`;
  await ensureJsonbColumn(sql, "institution_directory", "source_payload", "'{}'::jsonb");
  await sql`alter table if exists institution_directory add column if not exists synced_at timestamptz default now()`;

  await sql`alter table if exists access_requests add column if not exists email text`;
  await sql`alter table if exists access_requests add column if not exists requested_site_label text default ''`;
  await sql`alter table if exists access_requests add column if not exists requested_site_source text default 'site'`;
  await sql`alter table if exists access_requests add column if not exists reviewer_notes text default ''`;
  await sql`alter table if exists access_requests add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists access_requests add column if not exists reviewed_at timestamptz`;
  await sql`
    update access_requests
    set
      email = lower(coalesce(nullif(trim(email), ''), user_id || '@local.invalid')),
      requested_site_label = coalesce(requested_site_label, ''),
      requested_site_source = coalesce(nullif(trim(requested_site_source), ''), 'site'),
      reviewer_notes = coalesce(reviewer_notes, '')
  `;

  await sql`alter table if exists nodes add column if not exists current_model_version_id text`;
  await sql`alter table if exists nodes add column if not exists current_model_version_name text default ''`;
  await sql.unsafe(`
    do $$
    begin
      if to_regclass('nodes') is not null then
        update nodes
        set
          current_model_version_name = coalesce(current_model_version_name, ''),
          updated_at = now();
      end if;
    end $$;
  `);

  await sql`alter table if exists model_versions add column if not exists stage text`;
  await sql`alter table if exists model_versions add column if not exists payload_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists model_versions add column if not exists source_provider text`;
  await sql`alter table if exists model_versions add column if not exists download_url text`;
  await sql`alter table if exists model_versions add column if not exists sha256 text`;
  await sql`alter table if exists model_versions add column if not exists size_bytes bigint default 0`;
  await sql`alter table if exists model_versions add column if not exists metadata_json jsonb default '{}'::jsonb`;
  await ensureJsonbColumn(sql, "model_versions", "payload_json", "'{}'::jsonb");
  await ensureJsonbColumn(sql, "model_versions", "metadata_json", "'{}'::jsonb");
  await sql`alter table if exists model_versions add column if not exists updated_at timestamptz default now()`;
  await sql`
    update model_versions
    set
      source_provider = coalesce(nullif(trim(source_provider), ''), coalesce(payload_json::jsonb ->> 'source_provider', '')),
      download_url = coalesce(nullif(trim(download_url), ''), coalesce(payload_json::jsonb ->> 'download_url', '')),
      sha256 = coalesce(nullif(trim(sha256), ''), coalesce(payload_json::jsonb ->> 'sha256', '')),
      size_bytes = coalesce(size_bytes, 0),
      metadata_json = coalesce(metadata_json, payload_json::jsonb, '{}'::jsonb),
      updated_at = now()
  `;

  await sql`alter table if exists model_updates add column if not exists node_id text`;
  await sql`alter table if exists model_updates add column if not exists base_model_version_id text`;
  await sql`alter table if exists model_updates add column if not exists review_thumbnail_url text`;
  await sql`alter table if exists model_updates add column if not exists reviewer_user_id text`;
  await sql`alter table if exists model_updates add column if not exists reviewer_notes text default ''`;
  await sql`alter table if exists model_updates add column if not exists reviewed_at timestamptz`;
  await sql`alter table if exists model_updates add column if not exists updated_at timestamptz default now()`;
  await ensureJsonbColumn(sql, "model_updates", "payload_json", "'{}'::jsonb");
  await sql`
    update model_updates
    set
      node_id = coalesce(nullif(trim(node_id), ''), nullif(trim(payload_json::jsonb ->> 'node_id'), '')),
      base_model_version_id = coalesce(
        nullif(trim(base_model_version_id), ''),
        nullif(trim(payload_json::jsonb ->> 'base_model_version_id'), '')
      ),
      review_thumbnail_url = coalesce(
        nullif(trim(review_thumbnail_url), ''),
        nullif(trim(payload_json::jsonb ->> 'review_thumbnail_url'), '')
      ),
      reviewer_notes = coalesce(reviewer_notes, ''),
      updated_at = now()
  `;

  await sql`alter table if exists aggregations add column if not exists new_version_name text default ''`;
  await sql`alter table if exists aggregations add column if not exists payload_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists aggregations add column if not exists new_version_id text`;
  await sql`alter table if exists aggregations add column if not exists status text`;
  await sql`alter table if exists aggregations add column if not exists triggered_by_user_id text`;
  await sql`alter table if exists aggregations add column if not exists summary_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists aggregations add column if not exists finished_at timestamptz`;
  await sql`alter table if exists aggregations add column if not exists updated_at timestamptz default now()`;
  await ensureJsonbColumn(sql, "aggregations", "payload_json", "'{}'::jsonb");
  await ensureJsonbColumn(sql, "aggregations", "summary_json", "'{}'::jsonb");
  await sql`
    update aggregations
    set
      new_version_name = coalesce(new_version_name, ''),
      status = coalesce(nullif(trim(status), ''), 'completed'),
      summary_json = coalesce(summary_json, payload_json::jsonb, '{}'::jsonb),
      updated_at = now()
  `;

  await sql`alter table if exists release_rollouts add column if not exists previous_version_id text`;
  await sql`alter table if exists release_rollouts add column if not exists previous_version_name text default ''`;
  await sql`alter table if exists release_rollouts add column if not exists target_site_ids jsonb default '[]'::jsonb`;
  await sql`alter table if exists release_rollouts add column if not exists notes text default ''`;
  await sql`alter table if exists release_rollouts add column if not exists metadata_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists release_rollouts add column if not exists created_by_user_id text`;
  await sql`alter table if exists release_rollouts add column if not exists activated_at timestamptz`;
  await sql`alter table if exists release_rollouts add column if not exists superseded_at timestamptz`;
  await sql`alter table if exists release_rollouts add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists release_rollouts add column if not exists updated_at timestamptz default now()`;
  await ensureJsonbColumn(sql, "release_rollouts", "target_site_ids", "'[]'::jsonb");
  await ensureJsonbColumn(sql, "release_rollouts", "metadata_json", "'{}'::jsonb");
  await sql.unsafe(`
    do $$
    begin
      if to_regclass('release_rollouts') is not null then
        update release_rollouts
        set
          previous_version_name = coalesce(previous_version_name, ''),
          target_site_ids = coalesce(target_site_ids, '[]'::jsonb),
          notes = coalesce(notes, ''),
          metadata_json = coalesce(metadata_json, '{}'::jsonb),
          updated_at = now();
      end if;
    end $$;
  `);

  await sql`alter table if exists validation_runs add column if not exists project_id text default 'project_default'`;
  await sql`alter table if exists validation_runs add column if not exists model_version text default ''`;
  await sql`alter table if exists validation_runs add column if not exists node_id text`;
  await sql`alter table if exists validation_runs add column if not exists model_version_id text`;
  await sql`alter table if exists validation_runs add column if not exists case_predictions_path text default ''`;
  await sql`alter table if exists validation_runs add column if not exists n_cases integer`;
  await sql`alter table if exists validation_runs add column if not exists n_images integer`;
  await sql`alter table if exists validation_runs add column if not exists "AUROC" double precision`;
  await sql`alter table if exists validation_runs add column if not exists accuracy double precision`;
  await sql`alter table if exists validation_runs add column if not exists sensitivity double precision`;
  await sql`alter table if exists validation_runs add column if not exists specificity double precision`;
  await sql`alter table if exists validation_runs add column if not exists "F1" double precision`;
  await sql`alter table if exists validation_runs add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists validation_runs add column if not exists updated_at timestamptz default now()`;
  await ensureJsonbColumn(sql, "validation_runs", "summary_json", "'{}'::jsonb");
  await sql`
    update validation_runs
    set
      project_id = coalesce(
        nullif(trim(project_id), ''),
        nullif(trim(summary_json::jsonb ->> 'project_id'), ''),
        'project_default'
      ),
      model_version = coalesce(
        nullif(trim(model_version), ''),
        nullif(trim(summary_json::jsonb ->> 'model_version'), '')
      ),
      model_version_id = coalesce(
        nullif(trim(model_version_id), ''),
        nullif(trim(summary_json::jsonb ->> 'model_version_id'), '')
      ),
      case_predictions_path = coalesce(case_predictions_path, ''),
      n_cases = coalesce(n_cases, nullif(summary_json::jsonb ->> 'n_cases', '')::integer),
      n_images = coalesce(n_images, nullif(summary_json::jsonb ->> 'n_images', '')::integer),
      updated_at = now()
  `;

  await sql`alter table if exists audit_events add column if not exists payload_json jsonb default '{}'::jsonb`;
  await ensureJsonbColumn(sql, "audit_events", "payload_json", "'{}'::jsonb");
  await sql`alter table if exists audit_events add column if not exists created_at timestamptz default now()`;
}

async function readControlPlaneSchemaVersion(sql: ControlPlaneSql): Promise<number | null> {
  await sql.unsafe(`
    create table if not exists kera_schema_meta (
      schema_name text primary key,
      schema_version integer not null,
      updated_at timestamptz not null default now()
    )
  `);
  const rows = await sql`
    select schema_version
    from kera_schema_meta
    where schema_name = ${CONTROL_PLANE_SCHEMA_NAME}
    limit 1
  `;
  const value = rows[0]?.schema_version;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function writeControlPlaneSchemaVersion(sql: ControlPlaneSql): Promise<void> {
  await sql`
    insert into kera_schema_meta (
      schema_name,
      schema_version,
      updated_at
    ) values (
      ${CONTROL_PLANE_SCHEMA_NAME},
      ${CONTROL_PLANE_SCHEMA_VERSION},
      now()
    )
    on conflict (schema_name) do update set
      schema_version = excluded.schema_version,
      updated_at = now()
  `;
}

export async function ensureControlPlaneSchema(): Promise<void> {
  if (schemaPromise) {
    return schemaPromise;
  }
  const sql = sqlClient();
  schemaPromise = (async () => {
    const currentVersion = await readControlPlaneSchemaVersion(sql);
    if (currentVersion !== null && currentVersion >= CONTROL_PLANE_SCHEMA_VERSION) {
      return;
    }

    await reconcileLegacySchema(sql);

    await sql`
      create table if not exists users (
        user_id text primary key,
        legacy_local_user_id text,
        username text,
        email text not null,
        google_sub text,
        public_alias text,
        password text not null default '',
        role text not null default 'viewer',
        full_name text not null,
        site_ids jsonb not null default '[]'::jsonb,
        registry_consents jsonb not null default '{}'::jsonb,
        global_role text not null default 'member',
        status text not null default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "users", "email", "(email)");
    await createUniqueIndex(sql, "users", "legacy_local_user_id", "(legacy_local_user_id) where legacy_local_user_id is not null");
    await createUniqueIndex(sql, "users", "username", "(username) where username is not null");
    await createUniqueIndex(sql, "users", "google_sub", "(google_sub) where google_sub is not null");
    await createUniqueIndex(sql, "users", "public_alias", "(public_alias) where public_alias is not null");

    await sql`
      create table if not exists projects (
        project_id text primary key,
        name text not null,
        description text not null default '',
        owner_user_id text not null default 'system',
        site_ids jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
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

    await sql`
      create table if not exists sites (
        site_id text primary key,
        project_id text not null default 'project_default',
        display_name text not null default '',
        hospital_name text not null default '',
        source_institution_id text,
        local_storage_root text not null default '',
        research_registry_enabled boolean not null default true,
        status text not null default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "sites", "source_institution_id", "(source_institution_id) where source_institution_id is not null");
    await createIndex(sql, "sites", "project", "(project_id)");

    await sql`
      create table if not exists institution_directory (
        institution_id text primary key,
        source text not null default 'hira',
        name text not null,
        institution_type_code text not null default '',
        institution_type_name text not null default '',
        address text not null default '',
        phone text not null default '',
        homepage text not null default '',
        sido_code text not null default '',
        sggu_code text not null default '',
        emdong_name text not null default '',
        postal_code text not null default '',
        x_pos text not null default '',
        y_pos text not null default '',
        ophthalmology_available boolean not null default true,
        open_status text not null default 'active',
        source_payload jsonb not null default '{}'::jsonb,
        synced_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "institution_directory", "name", "(name)");
    await createIndex(sql, "institution_directory", "region", "(sido_code, sggu_code)");

    await sql`
      create table if not exists site_memberships (
        membership_id text primary key,
        user_id text not null references users (user_id) on delete cascade,
        site_id text not null references sites (site_id) on delete cascade,
        role text not null,
        status text not null default 'approved',
        approved_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "site_memberships", "user_site", "(user_id, site_id)");
    await createIndex(sql, "site_memberships", "site_role", "(site_id, role)");

    await sql`
      create table if not exists access_requests (
        request_id text primary key,
        user_id text not null references users (user_id) on delete cascade,
        email text not null,
        requested_site_id text not null,
        requested_site_label text not null default '',
        requested_site_source text not null default 'site',
        requested_role text not null,
        message text not null default '',
        status text not null default 'pending',
        reviewed_by text references users (user_id) on delete set null,
        reviewer_notes text not null default '',
        created_at timestamptz not null default now(),
        reviewed_at timestamptz
      )
    `;
    await createIndex(sql, "access_requests", "status", "(status, created_at desc)");
    await createIndex(sql, "access_requests", "user", "(user_id, created_at desc)");
    await createIndex(sql, "access_requests", "site", "(requested_site_id, created_at desc)");

    await sql`
      create table if not exists nodes (
        node_id text primary key,
        site_id text not null references sites (site_id) on delete cascade,
        registered_by_user_id text not null references users (user_id) on delete cascade,
        device_name text not null,
        os_info text not null default '',
        app_version text not null default '',
        current_model_version_id text,
        current_model_version_name text not null default '',
        token_hash text not null,
        status text not null default 'active',
        last_seen_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "nodes", "site_status", "(site_id, status)");

    await sql`
      create table if not exists model_versions (
        version_id text primary key,
        version_name text not null,
        architecture text not null,
        stage text,
        payload_json jsonb not null default '{}'::jsonb,
        source_provider text not null default '',
        download_url text not null default '',
        sha256 text not null default '',
        size_bytes bigint not null default 0,
        ready boolean not null default false,
        is_current boolean not null default false,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "model_versions", "current", "(is_current)");
    await createIndex(sql, "model_versions", "stage", "(stage, created_at desc)");

    await sql`
      create table if not exists model_updates (
        update_id text primary key,
        site_id text references sites (site_id) on delete set null,
        node_id text references nodes (node_id) on delete set null,
        base_model_version_id text references model_versions (version_id) on delete set null,
        status text not null default 'pending',
        payload_json jsonb not null default '{}'::jsonb,
        review_thumbnail_url text,
        reviewer_user_id text references users (user_id) on delete set null,
        reviewer_notes text not null default '',
        created_at timestamptz not null default now(),
        reviewed_at timestamptz,
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "model_updates", "status", "(status, created_at desc)");

    await sql`
      create table if not exists aggregations (
        aggregation_id text primary key,
        base_model_version_id text references model_versions (version_id) on delete set null,
        new_version_name text not null default '',
        new_version_id text references model_versions (version_id) on delete set null,
        status text not null default 'queued',
        triggered_by_user_id text references users (user_id) on delete set null,
        payload_json jsonb not null default '{}'::jsonb,
        summary_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        finished_at timestamptz,
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "aggregations", "status", "(status, created_at desc)");

    await sql`
      create table if not exists release_rollouts (
        rollout_id text primary key,
        version_id text not null references model_versions (version_id) on delete cascade,
        version_name text not null,
        architecture text not null,
        previous_version_id text references model_versions (version_id) on delete set null,
        previous_version_name text not null default '',
        stage text not null,
        status text not null default 'active',
        target_site_ids jsonb not null default '[]'::jsonb,
        notes text not null default '',
        metadata_json jsonb not null default '{}'::jsonb,
        created_by_user_id text references users (user_id) on delete set null,
        activated_at timestamptz,
        superseded_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "release_rollouts", "status", "(status, created_at desc)");
    await createIndex(sql, "release_rollouts", "version", "(version_id, created_at desc)");

    await sql`
      create table if not exists validation_runs (
        validation_id text primary key,
        project_id text not null default 'project_default',
        site_id text references sites (site_id) on delete set null,
        node_id text references nodes (node_id) on delete set null,
        model_version text not null default '',
        model_version_id text references model_versions (version_id) on delete set null,
        run_date timestamptz,
        n_cases integer,
        n_images integer,
        "AUROC" double precision,
        accuracy double precision,
        sensitivity double precision,
        specificity double precision,
        "F1" double precision,
        case_predictions_path text not null default '',
        summary_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "validation_runs", "site_run_date", "(site_id, run_date desc)");

    await sql`
      create table if not exists retrieval_corpus_profiles (
        profile_id text primary key,
        retrieval_signature text not null,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "retrieval_corpus_profiles", "signature", "(retrieval_signature)");

    await sql`
      create table if not exists retrieval_corpus_entries (
        entry_id text primary key,
        site_id text references sites (site_id) on delete cascade,
        node_id text references nodes (node_id) on delete set null,
        profile_id text not null references retrieval_corpus_profiles (profile_id) on delete cascade,
        retrieval_signature text not null,
        case_reference_id text not null,
        culture_category text not null,
        culture_species text not null default '',
        embedding_dim integer not null,
        embedding_json jsonb not null default '[]'::jsonb,
        thumbnail_url text,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "retrieval_corpus_entries", "site_profile_case", "(site_id, profile_id, case_reference_id)");
    await createIndex(sql, "retrieval_corpus_entries", "profile_signature", "(profile_id, retrieval_signature)");
    await createIndex(sql, "retrieval_corpus_entries", "site_created", "(site_id, created_at desc)");

    await sql`
      create table if not exists audit_events (
        event_id text primary key,
        actor_type text not null,
        actor_id text,
        action text not null,
        target_type text not null,
        target_id text,
        payload_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "audit_events", "created_at", "(created_at desc)");

    await sql`
      create table if not exists desktop_releases (
        release_id text primary key,
        channel text not null,
        label text not null,
        version text not null,
        platform text not null default 'windows',
        installer_type text not null default 'nsis',
        download_url text not null,
        folder_url text,
        sha256 text not null default '',
        size_bytes bigint,
        notes text,
        active boolean not null default true,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "desktop_releases", "channel_version", "(channel, version)");
    await createIndex(sql, "desktop_releases", "active_updated", "(active, updated_at desc)");

    await sql`
      create table if not exists desktop_download_events (
        event_id text primary key,
        release_id text not null references desktop_releases (release_id) on delete cascade,
        user_id text references users (user_id) on delete set null,
        username text not null default '',
        user_role text not null default '',
        site_id text references sites (site_id) on delete set null,
        metadata_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "desktop_download_events", "release_created", "(release_id, created_at desc)");
    await createIndex(sql, "desktop_download_events", "user_created", "(user_id, created_at desc)");
    await writeControlPlaneSchemaVersion(sql);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export async function controlPlaneSql(): Promise<ControlPlaneSql> {
  await ensureControlPlaneSchema();
  return sqlClient();
}
