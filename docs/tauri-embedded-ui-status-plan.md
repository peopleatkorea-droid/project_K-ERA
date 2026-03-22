# K-ERA Tauri Embedded UI Status And Execution Plan

## Snapshot

This status is based on the current repository state, not only on the earlier planning note.

The original plan in `docs/tauri-embedded-ui-plan.md` is still directionally correct, but parts of Phase A and Phase C have progressed further than that document suggests.

## Current Assessment

### Phase A: Embedded UI for packaged builds

Status:
`mostly implemented`

What is already done:

- `frontend/desktop-shell/` exists as a standalone desktop React entry
- `frontend/scripts/build-desktop-shell.mjs` generates a real static desktop bundle
- `frontend/src-tauri/tauri.conf.json` now uses `beforeBuildCommand: "npm run desktop:bundle"`
- `frontend/src-tauri/tauri.conf.json` still points `frontendDist` at `../desktop-dist`
- `frontend/desktop-dist/index.html` is now a real embedded shell document, not the old `localhost:3000` redirect stub

What still remains:

- `desktop-dist/` is still treated partly like a tracked artifact instead of a purely generated build output
- dev mode and packaged mode are both supported, but the boundary is not yet explicit enough in the codebase and docs

Practical reading:

- Packaged UI embedding is no longer the main blocker
- the plan document is outdated on this point

Completion estimate:
`85-90%`

### Phase B: Remove packaged repo assumptions

Status:
`partially implemented`

What is already done:

- desktop config is stored under app-local paths
- runtime state, storage state, logs, and desktop config paths are already desktop-local
- runtime launch sets `KERA_SKIP_LOCAL_ENV_FILE=1` for managed processes

What still remains:

- Rust still reads repo `.env.local` in `configured_env_values()`
- backend root candidate resolution still falls back to `project_root()`
- Python candidate resolution still falls back to repo `.venv`
- packaged mode does not yet hard-fail early enough when only repo fallbacks are available

Practical reading:

- the installed-runtime path exists
- the repo/dev fallback path is still too permissive

Completion estimate:
`45-55%`

### Phase C: Bundle backend runtime and Python

Status:
`mostly implemented, with release hardening remaining`

What is already done:

- `frontend/scripts/prepare-embedded-python.mjs` stages an embedded Python runtime
- `frontend/package.json` has `desktop:prepare-runtime`, `desktop:bundle`, and `tauri:build`
- `frontend/src-tauri/tauri.conf.json` bundles Python runtime and backend resources
- Tauri runtime can locate backend roots from bundled resources
- Tauri already manages local backend, local worker, and ML sidecar lifecycle
- runtime logs are written under desktop runtime directories
- packaged runtime readiness is surfaced directly in the desktop shell
- worker and ML runtime status are visible from both the desktop shell and admin diagnostics
- local verification now includes `desktop:smoke` and packaged installer artifact checks

What still remains:

- clean-machine install verification is not yet codified
- packaged runtime still needs real installed-machine validation
- signing and distribution policy are still outside the repo automation

Practical reading:

- the packaged runtime path is real and testable locally
- the main remaining work is now installer validation and release operations

Completion estimate:
`75-85%`

### Phase D: First-run setup and installer UX

Status:
`substantially implemented, but not installer-complete`

What is already done:

- desktop shell has runtime settings
- desktop shell can save and clear config
- desktop shell can bootstrap runtime and show diagnostics
- desktop shell already exposes node credentials, site pinning, backend mode, and ML transport settings
- desktop shell now derives a guided onboarding checklist from config + runtime state
- desktop shell now shows step progress, next action, and managed service health
- desktop shell can start, stop, refresh, and inspect runtime/log/resource paths directly
- desktop shell now provides a native storage directory picker for packaged setup
- diagnostics now expose local worker state alongside backend and ML sidecar

What still remains:

- there is still no installer-time bootstrap wizard
- setup still relies on the technical settings form for value entry
- clean-machine support flow still needs an actual non-developer smoke pass

Completion estimate:
`70-80%`

### Phase E: CI, signing, and release verification

Status:
`partially implemented, with clean-machine execution still pending`

What is already done locally:

- `npm run test:run` passes
- `npm run build` passes
- `cargo check` passes
- Windows desktop workflow exists for smoke, package verification, and artifact upload
- local installed-app smoke script now exists for post-install verification

What still remains:

- installed-app smoke has not yet been run on a true clean machine
- no signing or update distribution checklist has been productized
- MSI output still needs the same level of validation as the NSIS path

Completion estimate:
`45-55%`

## Real Status Summary

Using the milestone labels from the original plan:

- `Tauri migration`: mostly done
- `Embedded UI`: almost done
- `Standalone runtime`: halfway to two-thirds done
- `Release-ready desktop`: not done

Overall practical status:

- for architecture and code seams: `advanced`
- for packaged product behavior on clean machines: `late mid-stage`
- for release readiness: `mid-stage`

## Main Gaps Now

The main blockers are no longer UI embedding itself.

The real blockers are:

1. clean Windows install/first-launch verification has not been executed end-to-end
2. signing/distribution/update policy is not yet productized
3. first-run value entry still depends on the technical settings form
4. MSI/release artifact validation is not as mature as the NSIS path

## Recommended Execution Plan

## Step 1: Freeze the packaged/runtime boundary

Target:
Make it impossible to confuse packaged mode with dev mode.

Tasks:

1. Introduce an explicit packaged-runtime flag or detection path in Tauri startup code.
2. In packaged mode, stop reading repo `.env.local`.
3. In packaged mode, stop accepting `project_root()` and repo `.venv` as normal runtime candidates.
4. Keep those fallbacks only for dev mode.
5. Surface a diagnostics error if packaged runtime assets are missing.

Acceptance:

- packaged app does not silently use repo files
- packaged app either uses bundled resources or fails clearly

Suggested duration:
`2-3 days`

## Step 2: Lock the bundled runtime layout

Target:
Turn the current embedded Python and backend staging into a defined product contract.

Tasks:

1. Document the bundled runtime layout under `resources/`.
2. Verify Tauri build output contains:
   - Python runtime
   - backend entry
   - backend source tree
   - MedSAM assets
3. Make backend root and Python resolution prefer bundled resources first.
4. Remove ambiguous candidate ordering where possible.
5. Add a clean-machine validation checklist.

Acceptance:

- packaged runtime can be reasoned about from one documented layout
- resource lookup order is deterministic

Suggested duration:
`2-4 days`

## Step 3: Harden runtime orchestration

Target:
Make backend, worker, and ML sidecar lifecycle fully desktop-owned in release behavior.

Tasks:

1. Confirm startup/shutdown semantics for local backend, worker, and ML sidecar.
2. Ensure runtime logs are exposed consistently in diagnostics.
3. Decide the default runtime policy:
   - auto-start backend
   - auto-start worker
   - conditional ML sidecar start
4. Add explicit unhealthy-state messages and recovery suggestions.

Acceptance:

- desktop runtime behavior is predictable
- worker gaps no longer look like silent queue stalls

Suggested duration:
`2-3 days`

## Step 4: Turn settings into first-run onboarding

Target:
Replace technical configuration feel with installer-grade setup.

Tasks:

1. Add first-run detection.
2. Show a guided setup path before opening the workspace.
3. Separate required settings from advanced settings.
4. Add actions for opening config path, runtime path, and logs.
5. Add a basic setup-complete state.

Acceptance:

- new-machine launch is guided
- support staff can recover without manual file editing

Suggested duration:
`3-4 days`

## Step 5: Add release verification

Target:
Make desktop packaging testable and repeatable.

Tasks:

1. Add CI or scripted local verification for:
   - `npm run desktop:bundle`
   - `npm run build`
   - `cargo check`
   - `tauri build`
2. Add at least one clean-machine install smoke checklist.
3. Define release artifact expectations and versioning.

Acceptance:

- desktop path is verifiable outside a developer workstation
- failures are caught before manual installer testing

Suggested duration:
`2-4 days`

## Recommended Order

Do not spend the next cycle redesigning `desktop-shell`.

The recommended order is:

1. finish packaged-vs-dev boundary hardening
2. lock bundled runtime layout
3. harden process orchestration
4. polish first-run UX
5. add release verification

## Short-Term Plan

If the goal is the fastest path to a usable standalone desktop build, do this next:

### Sprint 1

- packaged-mode guardrails
- remove repo fallback from packaged runtime
- explicit diagnostics for missing bundled runtime

### Sprint 2

- bundled runtime layout cleanup
- worker/backend startup policy
- clean-machine packaging test

### Sprint 3

- first-run onboarding
- log/config open actions
- release verification script or CI

## Bottom Line

The project is past the "can we embed the UI?" stage.

The next real work is:

- productizing the packaged runtime
- removing hidden dev fallbacks
- validating clean-machine install behavior

That is the shortest path from "Tauri migration" to "actual standalone desktop product".
