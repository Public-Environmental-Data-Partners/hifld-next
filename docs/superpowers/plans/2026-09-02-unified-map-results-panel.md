# Unified Map Results Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render query results and selected features in one collapsible, resizable map panel using the same shared table primitive.

**Architecture:** Add a small pure state reducer for the bottom panel, adapt query rows to `SelectedFeaturesTable`, and let the map route mount one panel whose content switches by mode. Existing selected-feature behavior remains in `FeatureTablePanel`; query-specific pagination remains in `QueryResultPanel`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, react-resizable-panels, `@hifld/map-ui`.

---

### Task 1: Define unified panel state

**Files:**
- Create: `webapp/src/components/map/mapDataPanelState.ts`
- Create: `webapp/src/components/map/__tests__/mapDataPanelState.test.ts`

- [ ] Write reducer tests for query toggling, selection auto-open, clear fallback, and explicit mode changes.
- [ ] Run `npm test -- src/components/map/__tests__/mapDataPanelState.test.ts` and verify the missing module failure.
- [ ] Implement a discriminated state and pure transition helpers with no React dependency.
- [ ] Re-run the targeted test and verify it passes.

### Task 2: Reuse the shared selected-features table for query rows

**Files:**
- Modify: `packages/map-ui/src/SelectedFeaturesTable.tsx`
- Modify: `packages/map-ui/tests/SelectedFeaturesTable.test.tsx`
- Modify: `webapp/src/components/map/QueryResultPanel.tsx`
- Create: `webapp/src/components/map/__tests__/QueryResultPanel.test.tsx`

- [ ] Write failing tests asserting a configurable table/search label and shared table data slots for query rows.
- [ ] Add optional accessible labels to `SelectedFeaturesTable`, retaining current selected-feature defaults.
- [ ] Convert query rows to stable shared-table rows, pass response-order columns, and keep status and pagination controls.
- [ ] Run the map-ui and QueryResultPanel targeted tests and verify they pass.

### Task 3: Mount one collapsible route panel

**Files:**
- Modify: `webapp/src/routes/collections.$collectionSlug.map.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx`

- [ ] Write failing route assertions for one bottom data panel, togglable View results, and selected-feature mode switching.
- [ ] Replace the two conditional resizable panels with one collapsible panel driven by the pure state helpers.
- [ ] Wire selection, clear selection, query execution, and View results into the unified state.
- [ ] Run targeted route tests and verify they pass.

### Task 4: Verify the workspace

**Files:**
- Modify only files listed above if verification exposes an implementation defect.

- [ ] Run `npm run check` from `webapp/`.
- [ ] Run `npm run typecheck` from `webapp/`.
- [ ] Run `npm test` from `webapp/`.
- [ ] Run focused `packages/map-ui` tests from the repository root.
- [ ] Review `git diff --check` and confirm no unrelated changes.

