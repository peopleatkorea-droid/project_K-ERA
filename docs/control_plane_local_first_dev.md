# Local-First Control Plane Development

This repository now contains a minimal central control plane under the Next.js app:

- UI: `/control-plane`
- API base path: `/control-plane/api`

The path is intentionally namespaced so it does not collide with the existing FastAPI `/api/*` routes during migration.

## What is implemented

- development login
- Google token verification endpoint
- session-backed auth state
- site bootstrap through first node registration
- node registration
- node bootstrap
- node heartbeat
- current model release manifest
- model update upload metadata
- validation summary upload metadata
- aggregation status APIs
- admin review queue
- admin release publish form
- LLM relay
- local node credential persistence via DPAPI
- local runtime E2E smoke script

## Local development

1. Start a local PostgreSQL instance.
2. Copy `.env.example` to `.env.local`.
3. Set at least these values:

```powershell
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/kera_control_plane
KERA_CONTROL_PLANE_SESSION_SECRET=replace-with-a-long-random-secret
KERA_CONTROL_PLANE_DEV_AUTH=true
KERA_CONTROL_PLANE_ADMIN_EMAILS=admin@example.com
```

4. Start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

5. Open `http://127.0.0.1:3000/control-plane`

## First node registration

The recommended local-first flow is now:

1. Sign in on `/control-plane`
2. Register a node in the control-plane UI
3. The UI attempts to persist `node_id` / `node_token` into the local FastAPI node automatically
4. On Windows, the local node stores them with DPAPI under `KERA_CONTROL_PLANE_DIR`

If you prefer CLI-based registration, use:

```powershell
.\scripts\register_local_node.ps1 `
  -ApiBaseUrl http://127.0.0.1:8000 `
  -ControlPlaneBaseUrl http://127.0.0.1:3000/control-plane/api `
  -ControlPlaneUserToken <control-plane-access-token> `
  -SiteId my-site `
  -DisplayName "My Site" `
  -HospitalName "My Hospital" `
  -Overwrite
```

## Local node client wiring

The Python side now has a remote control plane client:

- `src/kera_research/services/remote_control_plane.py`
- `src/kera_research/services/node_credentials.py`

These environment variables point the local node at the new central API:

```powershell
KERA_CONTROL_PLANE_API_BASE_URL=http://127.0.0.1:3000/control-plane/api
KERA_LOCAL_CONTROL_PLANE_DATABASE_URL=sqlite:///C:/Users/USER/Downloads/KERA_DATA/control_plane_cache.db
KERA_CONTROL_PLANE_HEARTBEAT_INTERVAL_SECONDS=300
KERA_CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS=900
KERA_SITE_STORAGE_SOURCE=local
```

`KERA_CONTROL_PLANE_NODE_ID` and `KERA_CONTROL_PLANE_NODE_TOKEN` are now optional overrides.
The default path is the persisted local credential store.
The local node no longer needs `KERA_CONTROL_PLANE_DATABASE_URL` when it is configured to use the remote control-plane API.

Once these are set, the FastAPI local node will:

- refresh node bootstrap in the background
- send periodic heartbeat events to the control plane
- read the current model release from the remote API
- upload model update metadata and validation summaries through the remote API
- fall back to local cached state if the control plane is temporarily unavailable

## Runtime smoke test

Run the full local E2E smoke test with:

```powershell
.\scripts\run_control_plane_e2e_smoke.ps1
```

The script starts:

- Next.js control plane
- FastAPI local node

Then it verifies this sequence end-to-end:

- development login
- model publish
- node register
- node bootstrap
- current release lookup
- model update metadata upload
- validation summary upload

## Migration note

This is the first migration slice.

- The old FastAPI control-plane store still exists.
- The new Next.js control plane is running beside it.
- Local-node release lookup, model update upload, validation summary upload, bootstrap sync, and heartbeat now prefer the new HTTP client.
- Site summary/activity, model-version listing, and patient trajectory routes now continue to work in split mode by using remote bootstrap plus local cache instead of returning empty results.
