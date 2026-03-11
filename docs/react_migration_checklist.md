# React Migration Checklist

This checklist replaces the Streamlit-first clinician workflow with a React/Next.js workspace while keeping the existing Python services and storage model intact.

## Current status

- Done: Next.js authentication and site access flow
- Done: Document-style case canvas for patient, visit, and image authoring
- Done: Saved-case validation from the web workspace
- Done: Draft autosave and recovery for case properties
- Done: Case contribution from the web workspace
- Done: ROI preview from the web workspace for saved cases
- Done: Validation and contribution history for a selected case
- Done: Web-native completion feedback for saved and contributed cases
- Done: Site activity summary in the web workspace
- Done: Site-level validation run and recent metrics in the web workspace
- Done: Legacy console gated to admin-only fallback access
- Done: Workspace-aligned auth shell polish and visual validation summary
- Done: Admin/site-admin operations workspace for access review, training, registry, and aggregation
- Done: Bulk import, project/site/user management, and advanced dashboard parity in React
- Done: HTTP-level API tests for access review, validation, contribution, training, aggregation, import, and management
- Done: Default launcher switched to FastAPI + React only
- Pending: Remove obsolete Streamlit-only source files after the web cutover settles

## Phase 1: Safe coexistence

- [x] Keep Streamlit as fallback while the web flow gains feature parity
- [x] Expose case summary and image content APIs for the React workspace
- [x] Add a React case canvas without removing the legacy console
- [x] Move case validation and artifact viewing into FastAPI + Next.js
- [x] Add draft autosave and recovery for the new case canvas
- [x] Move case contribution into FastAPI + Next.js

## Phase 2: Workflow parity

- [x] Move ROI preview into the web workspace
- [x] Show validation history per selected case
- [x] Add contribution history and pending update status in the web workspace
- [x] Replace remaining wizard-only completion messaging with web-native feedback
- [x] Add API-level tests for validation and contribution endpoints

## Phase 3: Dashboard and admin parity

- [x] Rebuild site dashboard views in React
- [x] Rebuild access request review in React
- [x] Rebuild site-level validation and model update monitoring in React
- [x] Rebuild initial training, cross-validation, and federated aggregation controls in React
- [x] Confirm all non-admin and admin daily tasks can be completed without Streamlit

## Phase 4: Streamlit retirement

- [x] Switch default launcher to FastAPI + React only
- [x] Restrict Streamlit to internal fallback use for one transition window
- [x] Remove the Streamlit wizard once production workflows are stable
- [ ] Delete obsolete Streamlit-only UI code after cutover

## Guardrails

- Reuse `control_plane.py`, `data_plane.py`, and `pipeline.py` instead of duplicating business logic
- Prefer additive API changes over schema rewrites unless a draft table becomes necessary
- Keep the residual Streamlit source isolated from the default launcher until it is deleted
- Validate each phase with `npm run build` and Python smoke tests before expanding scope
