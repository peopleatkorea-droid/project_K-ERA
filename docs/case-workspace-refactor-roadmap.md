# Case Workspace Refactor Roadmap

This roadmap keeps the protected case-review UX unchanged while reducing the size and coupling of the `case-workspace` stack.

## Guardrails

- Do not change landing/auth/admin UX as part of this work.
- Do not change the saved-case review behavior:
  opening a saved case must continue to auto-hydrate thumbnails for visits that already have saved images.
- Do not delay save completion or next-screen rendering with embedding refresh, vector indexing, or other secondary work.
- Prefer extracting pure helpers and controller seams before changing state orchestration.

## Phase 1

Status: completed

- Extract pure save/timeline helpers from `frontend/components/case-workspace.tsx`.
- Extract cache-key and timeline normalization helpers from `frontend/components/case-workspace/use-case-workspace-site-data.ts`.
- Add direct Vitest coverage for those helpers so protected workflow behavior is asserted without relying only on large integration tests.

## Phase 2

Status: in progress

- Split save-flow optimistic state construction from network mutation orchestration.
- Reduce `CaseWorkspace` prop-threading by introducing narrower controller objects for save/open/review actions.
- Keep the existing optimistic save and background refresh behavior intact.
- Completed slices:
  `use-case-workspace-saved-case-actions.ts` now owns saved-case open/edit/follow-up/new-draft actions.
  `use-case-workspace-research-registry-actions.ts` now owns registry include/exclude state mutations.
  `use-case-workspace-case-save-delete.ts` now owns save wrapper and saved-case delete mutations.
  `use-case-workspace-patient-list-artifacts.ts` now owns patient-list page loading, page prewarm orchestration, and MedSAM backlog state/actions.
  `use-case-workspace-draft-authoring.ts` now owns intake/image-authoring state derivations, file-pick flows, and draft lesion-box drawing actions.
  `use-case-workspace-review-actions.ts` now owns site-validation, contribution, and research-registry action flows.
  `use-case-workspace-ai-clinic.ts` now owns AI Clinic retrieval, expansion, preview hydration, and preview cleanup.
  `use-case-workspace-validation.ts` now owns validation, model-compare, and validation artifact hydration.
  `use-case-workspace-preview-artifacts.ts` now owns ROI/lesion preview panels plus saved ROI/lesion crop artifact hydration.
  `use-case-workspace-live-lesion.ts` now owns lesion-box persistence, live MedSAM preview polling, and pointer-driven lesion-box drawing state.
  `use-case-workspace-semantic-prompt.ts` now owns BiomedCLIP semantic prompt review state and toggle/fetch flows.
  `case-workspace-ai-clinic-helpers.ts` now owns similar-case preview carry-over logic with direct tests.
  `case-workspace-header.tsx` now owns workspace header composition, alert-center rendering, and top-level chrome actions.
  `case-workspace-main-content.tsx` now owns patient-list, saved-case, access-gate, and draft-canvas view composition.
  `case-workspace-research-registry-modal.tsx` now owns registry enrollment modal composition.
  `case-workspace-review-formatters.ts` now owns validation and AI Clinic display formatters.
  `case-workspace-review-sections.tsx` now owns validation / AI Clinic panel composition and contribution / completion panel composition.
  `case-workspace-draft-helpers.ts` now owns draft defaults, draft storage keys, visit-reference resolution, culture normalization, and organism summary helpers.
  `case-workspace-core-helpers.ts` now owns workspace-history state serialization, fallback rail summary derivation, compare-model selection, saved-image preview shaping, and lesion-box geometry helpers.
  `case-workspace-live-lesion-helpers.ts` now owns live lesion preview state transitions, saved-box grouping, pointer geometry, and persistable-box filtering with direct tests.
  `case-workspace-main-content-props.ts` now owns saved-case and draft view prop assembly so `CaseWorkspace` can stay focused on orchestration instead of nested render-object construction.
  `use-case-workspace-browser-history.ts` now owns browser back/forward synchronization for rail view and selected-case state.
  `use-case-workspace-draft-authoring.ts`, `case-workspace-save-flow.ts`, `case-workspace-saved-case.ts`, `use-case-workspace-live-lesion.ts`, and `use-case-workspace-analysis.ts` now import shared helpers directly instead of receiving them through `CaseWorkspace` props.
- Remaining slices:
  keep reducing `CaseWorkspace` itself, which is now down to roughly 2.07k lines,
  keep reducing `use-case-workspace-live-lesion.ts`, which is now down to roughly 750 lines,
  then split the remaining draft-status, left-rail derivation, and saved-case composition clusters without changing the saved-case UX.

## Phase 3

Status: in progress

- Break `useCaseWorkspaceSiteData` into patient-list loading, patient timeline hydration, and case-history loading layers.
- Preserve the current patient-complete timeline behavior and background thumbnail warming strategy.
- Completed slices:
  `use-case-workspace-selected-case-review.ts` now owns selected-case review hydration and deferred history loading.
  `use-case-workspace-case-index.ts` now owns recent-case loading and patient timeline hydration.
  `use-case-workspace-image-cache.ts` now owns visit-image cache, gallery hydration, and preview warming orchestration.
- Remaining slices:
  keep `useCaseWorkspaceSiteData` as a thin coordinator,
  then narrow `CaseWorkspace` controller props without changing the saved-case UX.

## Phase 4

Status: pending

- Apply the same pattern to `admin-workspace` controller state.
- Then address Python-side god objects:
  `SiteStore`, `ModelManager`, `ResearchWorkflowService`, and `api/app.py`.
