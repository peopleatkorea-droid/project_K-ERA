# K-ERA Tauri Packaged Runtime Layout

## Goal

Define the packaged desktop runtime contract so the installed app and the developer repo path are no longer confused.

## Packaged Mode Rules

- packaged mode does not read repo `.env.local`
- packaged mode does not treat repo root as a normal backend candidate
- packaged mode does not treat repo `.venv` or system Python as an implicit managed-runtime dependency
- packaged mode must resolve bundled resources or fail with visible diagnostics

Runtime mode is selected as:

- `debug` build => `dev`
- `release` build => `packaged`
- override: `KERA_DESKTOP_RUNTIME_MODE=dev|packaged`

## Resource Contract

The packaged Tauri app is expected to ship these resources from [tauri.conf.json](/c:/Users/USER/Downloads/project_K-ERA/frontend/src-tauri/tauri.conf.json#L36):

- `python-runtime/`
- `backend/app.py`
- `backend/src/`
- `backend/MedSAM-main/`

The packaged frontend is expected to come from:

- [desktop-dist/index.html](/c:/Users/USER/Downloads/project_K-ERA/frontend/desktop-dist/index.html#L1)
- [build-desktop-shell.mjs](/c:/Users/USER/Downloads/project_K-ERA/frontend/scripts/build-desktop-shell.mjs#L60)

## Runtime Lookup Order

Backend lookup:

1. explicit `KERA_DESKTOP_BACKEND_ROOT`
2. explicit `KERA_DESKTOP_RUNTIME_ROOT`
3. bundled Tauri `resources/backend`
4. bundled Tauri `resources/python-backend`
5. app-local runtime cache under `LOCALAPPDATA\\KERA\\runtime\\backend`
6. repo root only in `dev` mode

Python lookup for managed runtime:

1. explicit `KERA_DESKTOP_LOCAL_BACKEND_PYTHON`
2. app-local bundled runtime under `LOCALAPPDATA\\KERA\\runtime\\python`
3. bundled backend-adjacent runtime under `backend/python` or `backend/python-runtime`
4. repo `.venv` and system Python only in `dev` mode

## Verification

Run these from [frontend/package.json](/c:/Users/USER/Downloads/project_K-ERA/frontend/package.json#L5):

1. `npm run desktop:bundle`
2. `npm run desktop:verify`
3. `npm run desktop:smoke`
4. `npm run desktop:package`
5. `npm run test:run`
6. `npm run build`
7. `cargo check`
8. `npm run desktop:smoke-installed` after running the installer on a Windows machine

`desktop:verify` checks:

- packaged `desktop-dist` exists
- `desktop-dist/index.html` is not a `localhost:3000` stub
- packaged CSS and JS assets exist
- Tauri bundle resource inputs exist before packaging

`desktop:smoke` runs the full local desktop verification chain:

- `desktop:bundle`
- `desktop:verify`
- `test:run`
- `build`
- `cargo check`

`desktop:package` runs:

- `tauri:build`
- `desktop:verify-package`

`desktop:smoke-installed` verifies the installed app layout:

- desktop executable exists under a real install directory
- bundled `resources/` exists after installation
- installed backend entry exists
- installed backend source tree exists
- installed Python runtime exists
- optional launch smoke can confirm `%LOCALAPPDATA%\\KERA` and runtime paths are created

There is also a Windows CI workflow at [.github/workflows/desktop-verify.yml](/c:/Users/USER/Downloads/project_K-ERA/.github/workflows/desktop-verify.yml#L1).

## Diagnostics Surface

The desktop shell should expose:

- runtime mode
- backend source
- environment source
- bundled resource path
- runtime/log directory
- backend candidate list
- Python candidate list
- explicit runtime errors and warnings

Those fields are returned by [main.rs](/c:/Users/USER/Downloads/project_K-ERA/frontend/src-tauri/src/main.rs#L1704) through `get_desktop_app_config`.
