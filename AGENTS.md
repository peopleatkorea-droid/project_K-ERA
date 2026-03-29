# Repository Instructions

## UX Change Policy

- Do not change UX/UI without explicit user approval.
- Treat the current UI as user-owned work product. Do not "clean up", redesign, simplify, restyle, or reorganize it unless the user explicitly asks for that.
- This includes landing screens, onboarding, login flow, layout, copy, visual hierarchy, navigation, and default information density.
- Landing pages are especially sensitive. Unless the user clearly approves a landing-page redesign, preserve the existing layout, spacing, copy, component structure, and information density.
- Refactors, performance work, and architecture cleanup must preserve the current UX unless the user explicitly approves a product or design change first.
- If a technical task appears to require a UX change, stop and ask for approval before implementing it.

### Critical Workflow Performance Priority

- The highest-priority product requirement in this repository is perceived responsiveness of the core case workflow.
- Protect this sequence above all secondary concerns:
  app start -> saved patient list appears as fast as possible;
  opening a saved case -> the full patient summary/timeline loads quickly and shows thumbnails for every visit that already has saved images;
  saving a new case -> save completes quickly and the next screen appears immediately;
  post-save analysis -> MedSAM / lesion masking may continue right after navigation, but heavy secondary work must not delay save completion or next-screen rendering.
- Do not block these UX-critical steps on vector indexing, embedding refresh, similar-case retrieval preparation, bulk cache warming, backfills, or other non-essential background work. Defer, queue, throttle, or run that work asynchronously instead.
- If a change would make the architecture cleaner but would slow patient-list startup, saved-case open, full-timeline thumbnail hydration, or new-case save/navigation, do not ship that change without explicit user approval.
- Performance fixes must preserve current UX semantics while making the workflow feel faster. Prefer transport, caching, batching, staged hydration, background jobs, and concurrency tuning over UX degradation.

### Protected Case Review UX

- Opening a saved case from the patient list must continue to show image thumbnails for all visits that already have saved images, without requiring the user to click each visit card first.
- Do not replace that behavior with per-visit click-to-load copy such as "Open this visit to load saved images." unless the user explicitly approves that UX change first.
- Performance work must preserve the current saved-case timeline behavior. Optimize transport, caching, concurrency, or prefetch strategy instead of degrading the case-open experience.
- The saved-case patient timeline must remain patient-complete. If the workspace knows or can fetch multiple visits for the selected patient, do not collapse the timeline to only the currently opened visit.
- Do not treat a locally seeded `[selectedCase]` array as authoritative patient history. Patient timeline caches must be hydrated from patient-scoped case summaries, and fallback seeds must be corrected by a real patient-level fetch.

## Python Environment Policy

- Treat [`pyproject.toml`](/c:/Users/USER/Downloads/project_K-ERA/pyproject.toml) and [`uv.lock`](/c:/Users/USER/Downloads/project_K-ERA/uv.lock) as the source of truth for Python dependencies.
- Prefer `uv sync`, `uv run`, and `uv add` over ad-hoc `pip install` or direct `python -m ...` when working on Python environment, dependency, and test tasks.
- Do not run manual `pip install` inside the repo-root `.venv`. Treat that as environment drift unless the user explicitly asks for a one-off debugging experiment.
- If the repo-root `.venv` looks wrong, do not patch it in place with ad-hoc `pip` commands. Re-run [`scripts/setup_local_node.ps1`](/c:/Users/USER/Downloads/project_K-ERA/scripts/setup_local_node.ps1) or use `uv sync --frozen` against the repo-root `.venv`.
- If a prior agent or developer manually mutated `.venv`, prefer recreating or re-syncing the environment over trying to preserve the drifted state.
- Do not add new Python dependencies only to `requirements.txt` or `requirements-*.txt` unless the task explicitly targets legacy installer compatibility too.
- This repo still has existing scripts that assume a repo-root `.venv`; prefer keeping `uv` environments compatible with that path, for example `uv venv .venv`, unless you are also updating the scripts that hardcode `.venv`.
- When updating docs, scripts, or runtime error messages, prefer `uv`-based guidance unless the specific flow is still intentionally legacy.

## Unattended Experiment Policy

- Any unattended run such as overnight, weekend, or long batch experiments must include failure-recovery design by default.
- Do not launch unattended experiments as a single fragile sequence where one failure stops the whole plan unless the user explicitly approves that tradeoff.
- Preferred default: per-experiment isolation, continue-on-failure queueing, persistent status files, per-run stdout/stderr logs, and resumable skip/restart behavior for completed runs.
- When practical, include at least one automatic retry for transient failures such as CUDA OOM, temporary file issues, or malformed cache state.
- Before launch, make sure the user has one clear place to check progress and one clear place to inspect failures the next morning.
- If a requested unattended plan cannot be made crash-safe within the current setup, say so explicitly and identify the missing recovery pieces before starting the run.
