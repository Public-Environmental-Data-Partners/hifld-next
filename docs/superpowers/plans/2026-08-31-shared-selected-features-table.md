# Shared Selected Features Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a shared selected-features table after every MCP map highlight and clear all selection UI consistently.

**Architecture:** A new React-only `@hifld/map-ui` package owns normalized property-table markup and pure column derivation. The webapp preserves its advanced selection panel around that renderer, while the MCP app adds a compact selected-features panel and reuses its existing selection state and clear routine.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, MapLibre GL, npm local `file:` dependencies.

---

### Task 1: Create the shared table package test-first

**Files:**
- Create: `packages/map-ui/package.json`
- Create: `packages/map-ui/package-lock.json`
- Create: `packages/map-ui/tsconfig.json`
- Create: `packages/map-ui/src/index.ts`
- Create: `packages/map-ui/src/SelectedFeaturesTable.tsx`
- Create: `packages/map-ui/tests/SelectedFeaturesTable.test.tsx`

- [ ] Write failing tests for sorted union column derivation, semantic headers
  and cells, highlighted-row state, row activation, trailing actions, and no
  table for an empty row set.

  ```tsx
  render(
    <SelectedFeaturesTable
      features={[
        { id: "one", properties: { State: "DC", Name: "Union Station" } },
        { id: "two", properties: { Name: "Richmond" } },
      ]}
      highlightedFeatureId="two"
    />,
  );
  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "State"]);
  expect(screen.getByRole("row", { name: /Richmond/ })).toHaveAttribute("data-highlighted", "true");
  ```

- [ ] Run `npm test` from `packages/map-ui` and verify the tests fail because
  the component and exports do not exist.
- [ ] Implement `SelectedFeatureTableRow`, `selectedFeaturePropertyColumns`,
  and `SelectedFeaturesTable`. Keep values normalized as strings and expose
  stable `data-slot` attributes without framework-specific styling.
- [ ] Run `npm run typecheck && npm test` from `packages/map-ui` and verify all
  package tests pass.

### Task 2: Integrate the shared renderer into the webapp

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Modify: `webapp/src/components/map/FeatureTablePanel.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx`

- [ ] Add a failing regression asserting the selected tab still renders the
  same property columns, actions, search-filtered rows, and row zoom behavior
  through the shared renderer.
- [ ] Run the focused webapp test and verify it fails before the dependency and
  integration exist.
- [ ] Add `"@hifld/map-ui": "file:../packages/map-ui"`. Replace only the
  selected property table's `<table>` markup with `SelectedFeaturesTable`;
  preserve selectors, search, sorting, comparison, actions, callbacks, and the
  existing resizable panel.
- [ ] Run the focused test, then `npm run check`, `npm run typecheck`,
  `npm test`, and `npm run build` from `webapp`.

### Task 3: Render and clear MCP selections consistently

**Files:**
- Modify: `dataset-mcp/ui/package.json`
- Modify: `dataset-mcp/ui/package-lock.json`
- Modify: `dataset-mcp/ui/src/components/MapView.tsx`
- Modify: `dataset-mcp/ui/src/styles.css`
- Modify: `dataset-mcp/ui/tests/MapView.test.tsx`

- [ ] Add failing interaction tests asserting a one-feature click and a
  multi-feature box selection render the shared table, an unsupported host does
  not hide it, and either Clear control removes the table and all count/status
  text including `0 features highlighted`.
- [ ] Run `npm test -- tests/MapView.test.tsx` from `dataset-mcp/ui` and verify
  the new assertions fail for the missing table/clear behavior.
- [ ] Add `"@hifld/map-ui": "file:../../packages/map-ui"`. Render a compact
  panel only when `highlightedFeatures.length > 0`, use the shared table for
  both clicks and boxes, and remove the separate single-feature details card.
  Route the panel Clear button and toolbar eraser through the same
  `clearSelection` function. Reset `selectionContextStatus` immediately when
  clearing so no stale or zero-count status remains visible.
- [ ] Run the focused test, then `npm run check`, `npm run typecheck`,
  `npm test`, and `npm run build` from `dataset-mcp/ui`.

### Task 4: Final compatibility verification

**Files:**
- Review all Task 1-3 files.

- [ ] Run `npm run typecheck && npm test` from `packages/map-ui`.
- [ ] Run the complete required webapp gate including build.
- [ ] Run the complete MCP UI gate including build.
- [ ] Inspect the diff for changes to webapp selection semantics, MCP tool
  contracts, query tokens, tile routes, PMTiles paths, or public API fields.
- [ ] Report the separately diagnosed spinner cause with exact evidence; do not
  attribute it to PMTiles unless a PMTiles request actually fails.

