import postgres from "postgres";

import { controlPlaneDatabaseUrl } from "./config";

type ControlPlaneSql = postgres.Sql<Record<string, unknown>>;

let cachedSql: ControlPlaneSql | null = null;
let schemaPromise: Promise<void> | null = null;

function sqlClient(): ControlPlaneSql {
  if (cachedSql) {
    return cachedSql;
  }
  const databaseUrl = controlPlaneDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("KERA_CONTROL_PLANE_DATABASE_URL is not configured.");
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

async function createIndex(sql: ControlPlaneSql, tableName: string, suffix: string, statement: string): Promise<void> {
  const indexName = indexNameFor(tableName, suffix);
  await sql.unsafe(`create index if not exists ${indexName} on ${tableName} ${statement}`);
}

async function createUniqueIndex(sql: ControlPlaneSql, tableName: string, suffix: string, statement: string): Promise<void> {
  const indexName = indexNameFor(tableName, suffix);
  await sql.unsafe(`create unique index if not exists ${indexName} on ${tableName} ${statement}`);
}

async function reconcileLegacySchema(sql: ControlPlaneSql): Promise<void> {
  await sql`alter table if exists users add column if not exists username text`;
  await sql`alter table if exists users add column if not exists password text`;
  await sql`alter table if exists users add column if not exists role text`;
  await sql`alter table if exists users add column if not exists site_ids jsonb default '[]'::jsonb`;
  await sql`alter table if exists users add column if not exists registry_consents jsonb default '{}'::jsonb`;
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

  await sql`alter table if exists sites add column if not exists status text`;
  await sql`alter table if exists sites add column if not exists updated_at timestamptz default now()`;
  await sql`
    update sites
    set
      display_name = coalesce(nullif(trim(display_name), ''), site_id),
      hospital_name = coalesce(nullif(trim(hospital_name), ''), coalesce(nullif(trim(display_name), ''), site_id)),
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

  await sql`alter table if exists model_versions add column if not exists payload_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists model_versions add column if not exists source_provider text`;
  await sql`alter table if exists model_versions add column if not exists download_url text`;
  await sql`alter table if exists model_versions add column if not exists sha256 text`;
  await sql`alter table if exists model_versions add column if not exists size_bytes bigint default 0`;
  await sql`alter table if exists model_versions add column if not exists metadata_json jsonb default '{}'::jsonb`;
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

  await sql`alter table if exists aggregations add column if not exists payload_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists aggregations add column if not exists new_version_id text`;
  await sql`alter table if exists aggregations add column if not exists status text`;
  await sql`alter table if exists aggregations add column if not exists triggered_by_user_id text`;
  await sql`alter table if exists aggregations add column if not exists summary_json jsonb default '{}'::jsonb`;
  await sql`alter table if exists aggregations add column if not exists finished_at timestamptz`;
  await sql`alter table if exists aggregations add column if not exists updated_at timestamptz default now()`;
  await sql`
    update aggregations
    set
      status = coalesce(nullif(trim(status), ''), 'completed'),
      summary_json = coalesce(summary_json, payload_json::jsonb, '{}'::jsonb),
      updated_at = now()
  `;

  await sql`alter table if exists validation_runs add column if not exists node_id text`;
  await sql`alter table if exists validation_runs add column if not exists model_version_id text`;
  await sql`alter table if exists validation_runs add column if not exists created_at timestamptz default now()`;
  await sql`alter table if exists validation_runs add column if not exists updated_at timestamptz default now()`;
  await sql`
    update validation_runs
    set
      model_version_id = coalesce(
        nullif(trim(model_version_id), ''),
        nullif(trim(summary_json::jsonb ->> 'model_version_id'), '')
      ),
      updated_at = now()
  `;
}

export async function ensureControlPlaneSchema(): Promise<void> {
  if (schemaPromise) {
    return schemaPromise;
  }
  const sql = sqlClient();
  schemaPromise = (async () => {
    await reconcileLegacySchema(sql);

    await sql`
      create table if not exists users (
        user_id text primary key,
        email text not null,
        google_sub text,
        full_name text not null,
        global_role text not null default 'member',
        status text not null default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "users", "email", "(email)");
    await createUniqueIndex(sql, "users", "google_sub", "(google_sub) where google_sub is not null");

    await sql`
      create table if not exists sites (
        site_id text primary key,
        display_name text not null,
        hospital_name text not null default '',
        source_institution_id text,
        status text not null default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createUniqueIndex(sql, "sites", "source_institution_id", "(source_institution_id) where source_institution_id is not null");

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
      create table if not exists nodes (
        node_id text primary key,
        site_id text not null references sites (site_id) on delete cascade,
        registered_by_user_id text not null references users (user_id) on delete cascade,
        device_name text not null,
        os_info text not null default '',
        app_version text not null default '',
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
        new_version_id text references model_versions (version_id) on delete set null,
        status text not null default 'queued',
        triggered_by_user_id text references users (user_id) on delete set null,
        summary_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        finished_at timestamptz,
        updated_at timestamptz not null default now()
      )
    `;

    await sql`
      create table if not exists validation_runs (
        validation_id text primary key,
        site_id text references sites (site_id) on delete set null,
        node_id text references nodes (node_id) on delete set null,
        model_version_id text references model_versions (version_id) on delete set null,
        run_date timestamptz,
        summary_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await createIndex(sql, "validation_runs", "site_run_date", "(site_id, run_date desc)");

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
  })();
  return schemaPromise;
}

export async function controlPlaneSql(): Promise<ControlPlaneSql> {
  await ensureControlPlaneSchema();
  return sqlClient();
}
