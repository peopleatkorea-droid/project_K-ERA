# K-ERA Tauri Migration Plan

## Goal

Move the hospital-side K-ERA workspace to Tauri without forcing a big-bang rewrite.

The migration is intentionally split into three phases:

1. Phase 1: native image hot path
2. Phase 2: local workspace transport seam
3. Phase 3: Python analysis sidecar seam

The web control plane stays on Next.js. The Tauri app targets the local-node workspace.

## Phase 1

Scope:

- Tauri shell
- native patient-list image path
- native visit-image path
- preview cache generated from local files

Why first:

- The biggest user complaint is image delay and preview misses.
- This is the highest-signal performance win with the smallest blast radius.

Implemented files:

- [frontend/src-tauri/tauri.conf.json](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/src-tauri/tauri.conf.json)
- [frontend/src-tauri/src/main.rs](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/src-tauri/src/main.rs)
- [frontend/lib/desktop-ipc.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/desktop-ipc.ts)
- [frontend/lib/desktop-transport.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/desktop-transport.ts)

Status:

- Implemented
- Patient-list thumbnails and visit previews now use `SQLite -> local file path -> Tauri asset protocol`

## Phase 2

Scope:

- all local-node patient / visit / image CRUD
- list / case / history reads used by the workspace
- keep React components unchanged while moving transport logic out of UI code

Why second:

- After the hot path is native, the next risk is transport sprawl.
- The workspace should not care whether a call goes through HTTP or desktop IPC.

Implemented seam:

- [frontend/lib/local-workspace-runtime.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/local-workspace-runtime.ts)

Wired through:

- [frontend/lib/cases.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/cases.ts)

Current behavior:

- desktop-native for patient-list page and visit-image loading
- desktop-native for patient / visit / image CRUD used by the case workspace
- desktop-native for case history reads and raw image blob loading used by edit-draft hydration
- desktop-native for `fetchCases` and `fetchSiteActivity` via local SQLite control/data-plane reads
- remaining local-node fetch wiring in [cases.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/cases.ts), [admin.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/admin.ts), and [artifacts.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/artifacts.ts) now routes through desktop IPC instead of browser `fetch`

Next native candidates inside Phase 2:

- broader patient/image list screens outside the main case workspace
- remaining admin dashboards that still assume web-only route handlers

## Phase 3

Scope:

- case validation
- contribution generation
- ROI / lesion preview workflows
- validation artifact reads
- live lesion preview orchestration

Why third:

- Python ML must remain isolated from UI concerns.
- Tauri should own windowing and local file I/O, while Python remains the execution engine for ML.

Implemented seam:

- [frontend/lib/analysis-runtime.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/analysis-runtime.ts)
- [frontend/lib/desktop-sidecar-config.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/desktop-sidecar-config.ts)

Wired through:

- [frontend/lib/training.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/training.ts)
- [frontend/lib/cases.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/cases.ts)
- [frontend/lib/artifacts.ts](/c:/Users/jeong/Downloads/Web%20Apps/project_K-ERA/frontend/lib/artifacts.ts)

Current behavior:

- desktop command bridge is now wired for case validation / compare / AI clinic / contribution / ROI-preview / lesion-preview / live-lesion job polling
- desktop command bridge is also wired for site validations, model-version reads, training job launch/cancel, cross-validation, and AI-clinic embedding admin flows
- when `NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT` is left at the desktop default (`sidecar`), those ML-heavy commands now use a desktop-managed Python stdio sidecar instead of browser HTTP fetches to the local node
- ML sidecar status / ensure / stop are available through desktop IPC, and the desktop shell keeps stderr logs under `.desktop-runtime/`
- validation / ROI / stored-lesion artifact file reads are desktop-native when Tauri is available
- repeated site-job polling inside the case workspace and admin workspace is now centralized behind a shared runtime seam, so future desktop push-events only need to replace one polling layer
- live lesion preview polling is also routed through a dedicated runtime helper, so the case workspace no longer embeds the retry loop directly
- sidecar transport is now a dedicated seam, so additional desktop diagnostics or event streaming can be added without UI rewrites

Next sidecar candidates inside Phase 3:

- move job status streaming to push-based desktop events instead of polling
- move Python sidecar lifecycle/status into a visible desktop diagnostics surface
- finish cargo/tauri packaging verification on Windows install builds

## Operating Rule

The migration boundary is now:

- UI components depend on `../lib/api`
- `../lib/api` delegates local-node workspace operations to `local-workspace-runtime`
- analysis-heavy operations delegate to `analysis-runtime`
- native file and SQLite access live behind Tauri transport only

That keeps the move incremental and reversible at each stage.
