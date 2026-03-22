# K-ERA Tauri Embedded UI Plan

## Goal

Turn the current Tauri desktop build from a `localhost:3000` launcher into a packaged desktop app that ships its own UI bundle.

This is not a full desktop rewrite.

The repo already contains most of the correct direction:

- `frontend/desktop-shell/` contains a standalone React desktop entry
- `frontend/scripts/build-desktop-shell.mjs` already builds a static bundle into `frontend/desktop-dist/`
- `frontend/src-tauri/src/main.rs` already supports desktop-local config, desktop-local runtime paths, and managed backend lifecycle
- `frontend/lib/desktop-app-config.ts` and `frontend/lib/desktop-diagnostics.ts` already expose desktop setup and runtime status to the UI

The work now is to make that path canonical for packaged builds, remove remaining repo/dev assumptions, and finish installer/runtime productization.

## Scope

In scope:

- packaged desktop UI for the hospital-local workspace
- desktop-managed local backend and ML runtime
- installer-oriented config, storage, diagnostics, and first-run setup
- Windows-first packaging flow

Out of scope:

- moving the central control plane into Tauri
- exposing server-only secrets to the desktop UI bundle
- replacing the existing web control-plane APIs

## Current State

### What already exists

1. Packaged UI build path exists.
   `frontend/package.json` already defines `desktop:build` and uses it from `tauri:build`.

2. A real embedded desktop shell already exists.
   `frontend/desktop-shell/main.tsx` is a React app with:
   - runtime settings
   - local login flow
   - diagnostics
   - `CaseWorkspace` mounting

3. Tauri runtime config already has installer-oriented paths.
   `frontend/src-tauri/src/main.rs` already writes config and storage state under desktop-local paths such as `LOCALAPPDATA\\KERA`, with repo fallbacks for dev.

4. Desktop runtime lifecycle already exists in part.
   The UI can query and start the local backend and ML backend through desktop IPC.

### What is still wrong

1. The checked-in `frontend/desktop-dist/index.html` is still a stale redirect stub to `http://127.0.0.1:3000/`.

2. Packaged builds still inherit some repo/dev assumptions:
   - `.env.local` fallback
   - repo-root backend discovery
   - fallback paths under the repo when installed runtime assets are missing

3. Worker/product runtime is not fully owned by the desktop app yet.

4. There is no clean separation between:
   - dev shell behavior
   - packaged runtime behavior

## Target Architecture

The target boundary should be:

`embedded desktop UI -> Tauri IPC -> desktop-managed local backend / ML runtime -> remote control-plane APIs`

Concretely:

- UI bundle is loaded from `frontendDist`
- UI never requires `next dev` or `localhost:3000`
- Tauri owns app config, runtime startup, runtime logs, and storage locations
- Python/backend runtime is launched from packaged app-local resources
- central APIs and secret-bearing flows remain behind remote server endpoints

## Product Decisions

### 1. Desktop scope stays narrow

The packaged desktop app should target only the hospital-local workspace:

- patient
- image
- validation
- training
- local admin / diagnostics

The web control plane remains a web app.

This matches the existing migration boundary and avoids dragging Next server features into the desktop bundle.

### 2. Dev mode and packaged mode must diverge cleanly

Dev mode can keep the fast feedback loop:

- `npm run dev`
- `tauri dev`
- repo-root fallbacks when useful

Packaged mode must not depend on:

- repo checkout
- `.env.local`
- `.venv`
- `localhost:3000`

### 3. Secrets stay off the UI bundle

Moving to embedded UI does not change the security model:

- server-only secrets stay on remote services or on managed backend processes only
- the desktop UI bundle receives only public or machine-local configuration
- DB master credentials, LLM keys, and control-plane secrets do not move into React or static assets

## Delivery Plan

## Phase A: Promote `desktop-shell` to the packaged frontend

Objective:
Make the packaged build always ship the real embedded UI bundle.

Tasks:

1. Make `frontend/scripts/build-desktop-shell.mjs` the only producer of `frontend/desktop-dist/` for packaged builds.
2. Remove the stale redirect-style `desktop-dist` artifact from the expected packaged path.
3. Treat `desktop-dist/` as generated output, not hand-maintained source.
4. Keep `tauri dev` behavior separate from packaged behavior.

Acceptance:

- `npm run desktop:build` produces a standalone `desktop-dist/index.html` with bundled assets.
- `tauri build` launches the embedded UI without contacting `http://127.0.0.1:3000`.
- Packaged startup no longer shows a waiting screen for a local web server.

Estimated effort:
`1-2 days`

## Phase B: Remove packaged repo assumptions

Objective:
Ensure installed builds run without a source checkout.

Tasks:

1. Split path resolution in Rust into:
   - dev fallback resolution
   - packaged runtime resolution
2. Stop treating repo-root `.env.local` as a normal packaged source of truth.
3. Make desktop config under app-local data the canonical packaged config store.
4. Resolve backend entry, storage root, logs, and runtime state from app-local directories first.
5. Fail with explicit diagnostics when packaged runtime assets are missing.

Acceptance:

- Installed app runs on a clean machine without repo files.
- `LOCALAPPDATA\\KERA` contains config, logs, runtime state, and storage hints.
- Missing runtime assets produce a visible diagnostics error instead of silent repo fallback.

Estimated effort:
`2-4 days`

## Phase C: Bundle backend runtime and Python

Objective:
Ship the backend runtime with the desktop app.

Tasks:

1. Define a packaged runtime layout, for example:
   - `runtime/backend/`
   - `runtime/python/`
   - `runtime/logs/`
2. Decide whether to ship:
   - embedded Python runtime plus project payload
   - or frozen executables for selected services
3. Update Rust launcher logic to prefer packaged runtime assets.
4. Package the local API backend and ML sidecar in a reproducible way.
5. Decide whether the worker is:
   - part of the backend process
   - a second managed process
   - or a task queue loop inside one packaged service

Acceptance:

- The desktop app can start the local API runtime and ML runtime on a machine without system Python.
- Runtime logs and process health are visible from the desktop diagnostics surface.
- Training and validation flows work without manual backend bootstrapping.

Estimated effort:
`1-2 weeks`

## Phase D: First-run setup and installer UX

Objective:
Make the app operable by non-developer users on hospital PCs.

Tasks:

1. Add a first-run setup flow in the desktop shell for:
   - storage path selection
   - node credentials
   - site pinning
   - backend mode
2. Add diagnostics and recovery actions:
   - start runtime
   - stop runtime
   - reset config
   - open logs / config path
3. Define install-time defaults for storage and log locations.
4. Clarify offline and partial-connectivity behavior.

Acceptance:

- First launch on a new machine leads to a guided setup, not a blank or broken workspace.
- Users can recover from bad config without editing files by hand.
- Support staff can inspect logs and config paths from the app.

Estimated effort:
`3-5 days`

## Phase E: Packaging, signing, and CI verification

Objective:
Make the desktop build releaseable.

Tasks:

1. Add CI steps for:
   - `npm run desktop:build`
   - `cargo test` / `cargo check`
   - `tauri build`
2. Add smoke tests for:
   - config bootstrapping
   - runtime startup
   - diagnostics rendering
3. Define release artifacts:
   - installer
   - portable build if needed
4. Add code signing and update strategy.

Acceptance:

- CI verifies the packaged desktop path, not only the web path.
- Release artifacts can be installed on a clean Windows machine and start successfully.

Estimated effort:
`3-5 days`, excluding certificate and distribution lead time

## Recommended Sequence

1. Finish Phase A immediately.
   The repo already has `desktop-shell`; the stale launcher artifact is now the biggest source of confusion.

2. Do Phase B before deep UI work.
   If packaged builds still depend on repo fallbacks, later QA results will be misleading.

3. Treat Phase C as the main productization milestone.
   This is where the app becomes a real standalone desktop product.

4. Do Phase D and E after runtime packaging is stable.
   Installer UX should be built on the real runtime, not on temporary dev assumptions.

## Main Risks

1. Mixing Next server concerns into the desktop bundle.
   Avoid this by keeping the control plane on the web.

2. Hiding missing packaged assets behind repo fallbacks.
   This makes local developer builds look healthy while installed builds fail.

3. Shipping secrets into the UI bundle.
   Keep secret-bearing flows behind backend or remote server boundaries.

4. Treating worker lifecycle as an afterthought.
   Training and job execution will look unstable if the desktop app does not own runtime orchestration.

## Suggested Milestone Definition

Use these labels to keep status clear:

- `Tauri migration`: desktop IPC, transport seams, shell wiring
- `Embedded UI`: packaged UI no longer depends on `localhost:3000`
- `Standalone runtime`: packaged app owns backend, Python, worker, logs, and config
- `Release-ready desktop`: installer, signing, CI, first-run UX, and clean-machine verification complete

Today the repo looks close to:

- `Tauri migration`: mostly done
- `Embedded UI`: partially implemented, not yet made canonical
- `Standalone runtime`: partially implemented
- `Release-ready desktop`: not done

## Rough Total Effort

If done on the existing codebase without expanding scope into the full web control plane:

- embedded UI promotion only: about `1 week`
- true standalone runtime on clean machines: about `2-3 weeks`
- release-ready installer and operational hardening: about `1 more week`

Practical total:
`3-5 weeks` of focused work for a solid Windows-first standalone desktop release.
