# Repository Instructions

## UX Change Policy

- Do not change UX/UI without explicit user approval.
- Treat the current UI as user-owned work product. Do not "clean up", redesign, simplify, restyle, or reorganize it unless the user explicitly asks for that.
- This includes landing screens, onboarding, login flow, layout, copy, visual hierarchy, navigation, and default information density.
- Landing pages are especially sensitive. Unless the user clearly approves a landing-page redesign, preserve the existing layout, spacing, copy, component structure, and information density.
- Refactors, performance work, and architecture cleanup must preserve the current UX unless the user explicitly approves a product or design change first.
- If a technical task appears to require a UX change, stop and ask for approval before implementing it.

## Python Environment Policy

- Treat [`pyproject.toml`](/c:/Users/USER/Downloads/project_K-ERA/pyproject.toml) and [`uv.lock`](/c:/Users/USER/Downloads/project_K-ERA/uv.lock) as the source of truth for Python dependencies.
- Prefer `uv sync`, `uv run`, and `uv add` over ad-hoc `pip install` or direct `python -m ...` when working on Python environment, dependency, and test tasks.
- Do not add new Python dependencies only to `requirements.txt` or `requirements-*.txt` unless the task explicitly targets legacy installer compatibility too.
- This repo still has existing scripts that assume a repo-root `.venv`; prefer keeping `uv` environments compatible with that path, for example `uv venv .venv`, unless you are also updating the scripts that hardcode `.venv`.
- When updating docs, scripts, or runtime error messages, prefer `uv`-based guidance unless the specific flow is still intentionally legacy.
