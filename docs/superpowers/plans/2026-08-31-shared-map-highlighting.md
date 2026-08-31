# Shared Map Core and MCP Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webapp-parity map highlighting that enriches the next MCP host turn and introduce a shared map-core package without regressing the webapp.

**Architecture:** A React-free `@hifld/map-core` package owns pure style, basemap, selection-geometry, and control-label semantics. The webapp keeps its existing wrappers and runtime behavior, while the MCP map adds its own selection state and an MCP Apps `updateModelContext` adapter. Both applications keep independent npm lockfiles and consume the package with local `file:` dependencies.

**Tech Stack:** TypeScript, React 19, MapLibre GL, Vitest, Vite, MCP Apps `@modelcontextprotocol/ext-apps`, npm local packages, Docker BuildKit.

---

### Task 1: Characterize webapp behavior before extraction

**Files:**
- Create: `webapp/src/components/viewer/__tests__/MapControls.test.tsx`
- Modify: `webapp/src/components/viewer/__tests__/utils.test.ts`
- Modify: `webapp/src/components/viewer/__tests__/useMapInitialization.test.tsx`

- [ ] Add tests that lock the current eight palette outputs, automatic break
  results, selection polygon coordinates, active/inactive control labels,
  basemap icon behavior, and clear-selection callback.

  ```tsx
  it("keeps the current region-highlight controls", async () => {
    const user = userEvent.setup();
    const onToggleSelection = vi.fn();
    const onClearSelection = vi.fn();
    render(
      <MapControls
        mapRef={{ current: null }}
        isSelectionActive={false}
        onToggleSelection={onToggleSelection}
        onClearSelection={onClearSelection}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Highlight a region" }));
    await user.click(screen.getByRole("button", { name: "Clear highlighted region" }));
    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
  ```
- [ ] Run the three targeted files and confirm they pass before production code
  moves:

  ```bash
  cd webapp
  npm test -- src/components/viewer/__tests__/MapControls.test.tsx src/components/viewer/__tests__/utils.test.ts src/components/viewer/__tests__/useMapInitialization.test.tsx
  ```

- [ ] Do not change webapp runtime behavior in this task.

### Task 2: Create the shared map-core package

**Files:**
- Create: `packages/map-core/package.json`
- Create: `packages/map-core/tsconfig.json`
- Create: `packages/map-core/src/index.ts`
- Create: `packages/map-core/src/style.ts`
- Create: `packages/map-core/src/selection.ts`
- Create: `packages/map-core/src/basemap.ts`
- Create: `packages/map-core/src/controls.ts`
- Create: `packages/map-core/tests/style.test.ts`
- Create: `packages/map-core/tests/selection.test.ts`
- Create: `packages/map-core/package-lock.json`

- [ ] Define a source-exported ESM package with no React or MapLibre runtime
  dependency. Export `ColorSchemeId`, `NumericScale`, `getColorRamp`,
  `computeQuantileBreaks`, `applyScale`, `getValueRange`,
  `buildColorExpression`, `getLegendItems`, `selectionBoxFeature`,
  `selectionScreenBounds`, `MAX_SELECTED_FEATURES`, the Bright/Esri basemap
  constants, and control-label helpers.

  ```ts
  export type ColorSchemeId =
    | "blues"
    | "greens"
    | "oranges"
    | "purples"
    | "viridis"
    | "plasma"
    | "rdyblu"
    | "rdyg";
  export type NumericScale = "linear" | "sqrt" | "log";
  export interface ScreenPoint { x: number; y: number }
  export interface LngLatPoint { lng: number; lat: number }

  export function selectionScreenBounds(
    start: ScreenPoint,
    end: ScreenPoint,
  ): [[number, number], [number, number]] {
    return [
      [Math.min(start.x, end.x), Math.min(start.y, end.y)],
      [Math.max(start.x, end.x), Math.max(start.y, end.y)],
    ];
  }
  ```
- [ ] Preserve the webapp's exact color interpolation, quantile behavior,
  expression tuple shapes, legend strings, and selection polygon winding in
  package tests.
- [ ] Run:

  ```bash
  cd packages/map-core
  npm install
  npm run typecheck
  npm test
  ```

### Task 3: Integrate map-core into the webapp without behavior changes

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Modify: `webapp/src/components/viewer/utils.ts`
- Modify: `webapp/src/components/viewer/useMapInitialization.ts`
- Modify: `webapp/src/components/viewer/MapControls.tsx`
- Modify: `webapp/src/components/map/featureSelection.ts`

- [ ] Add `"@hifld/map-core": "file:../packages/map-core"` and regenerate the
  existing lockfile from `webapp/`.

  ```ts
  import {
    MAX_SELECTED_FEATURES,
    applyScale,
    buildColorExpression,
    computeQuantileBreaks,
    getColorRamp,
    selectionBoxFeature,
  } from "@hifld/map-core";
  ```
- [ ] Replace only duplicated pure implementations with package imports.
  Preserve the existing exports from `utils.ts`, webapp-specific editor types,
  PMTiles/query sampling, hover expressions, basemap fallback, and React/shadcn
  control markup.
- [ ] Import the shared 100-feature constant and selection polygon helper while
  retaining the current per-loaded-layer cap and event sequencing.
- [ ] Run the targeted regression matrix from the design, then the required full
  webapp gate:

  ```bash
  cd webapp
  npm run check
  npm run typecheck
  npm test
  npm run build
  ```

  All commands must pass before assembly.

### Task 4: Integrate map-core into the MCP map styling and controls

**Files:**
- Modify: `dataset-mcp/ui/package.json`
- Modify: `dataset-mcp/ui/package-lock.json`
- Modify: `dataset-mcp/ui/src/components/mapStyle.ts`
- Modify: `dataset-mcp/ui/src/components/MapView.tsx`
- Modify: `dataset-mcp/ui/src/components/MapControls.tsx`
- Modify: `dataset-mcp/ui/tests/MapView.test.tsx`

- [ ] Add `"@hifld/map-core": "file:../../packages/map-core"` and regenerate
  the lockfile from `dataset-mcp/ui/`.

  ```ts
  import {
    ESRI_WORLD_IMAGERY_TILE_URL,
    OPENFREEMAP_BRIGHT_STYLE_URL,
    getColorRamp,
    selectionBoxFeature,
  } from "@hifld/map-core";
  ```
- [ ] Replace duplicate ramp/scale/basemap/control-label constants with shared
  imports. Keep MCP contract parsing, query-source sampling, legend assembly,
  MapLibre source setup, and host-specific markup local.
- [ ] Run MCP style and map tests, typecheck, and build before adding selection.

### Task 5: Add MCP feature highlighting and model-context snapshots

**Files:**
- Create: `dataset-mcp/ui/src/components/mapSelection.ts`
- Create: `dataset-mcp/ui/src/mcp/highlightContext.ts`
- Create: `dataset-mcp/ui/tests/mapSelection.test.ts`
- Create: `dataset-mcp/ui/tests/highlightContext.test.ts`
- Modify: `dataset-mcp/ui/src/components/MapView.tsx`
- Modify: `dataset-mcp/ui/src/components/MapControls.tsx`
- Modify: `dataset-mcp/ui/src/styles.css`
- Modify: `dataset-mcp/ui/tests/MapView.test.tsx`

- [ ] Define a narrow `HighlightedMapFeature` model with query/layer identity,
  stable feature identity, centroid, and normalized string properties. Never
  include geometry, SQL, tile URLs, or tokens.

  ```ts
  export interface HighlightedMapFeature {
    id: string;
    queryId: string;
    layerName: string;
    sourceLayerId: string;
    featureId: string;
    centroid: [number, number] | null;
    properties: Record<string, string>;
  }

  export interface MapHighlightSnapshot {
    map_title: string;
    selected_feature_count: number;
    was_capped: boolean;
    selection_bounds: [number, number, number, number] | null;
    selected_features: Array<{
      id: string;
      query_id: string;
      layer_name: string;
      source_layer_id: string;
      feature_id: string;
      centroid: [number, number] | null;
      properties: Record<string, string>;
    }>;
  }
  ```
- [ ] Implement point and box selection across every visible interactive query
  render layer. Match the webapp's mousedown/move/up flow, Shift activation,
  drag-pan disable/enable, persistent translucent selection box, reverse-drag
  normalization, synthetic-click suppression, dedupe, and per-layer cap.
- [ ] Add selection and clear buttons using the current webapp labels/icons.
  Keep the existing feature-details panel for a single click and add a concise
  highlighted-count/cap/context status for multi-feature selections; do not add
  a table.
- [ ] Build a complete context snapshot on every selection replacement and
  clear. If advertised, include text content and/or structured content under
  `map_highlight`; call `app.updateModelContext()` without `sendMessage()`.
  Catch host rejection and leave selection intact.

  ```ts
  const capability = app.getHostCapabilities()?.updateModelContext;
  const params = {
    ...(capability?.text
      ? { content: [{ type: "text" as const, text: highlightContextText(snapshot) }] }
      : {}),
    ...(capability?.structuredContent
      ? { structuredContent: { map_highlight: snapshot } }
      : {}),
  };
  await app.updateModelContext(params);
  ```
- [ ] Cover click, empty click, overlapping features, button/Shift drag,
  reverse drag, clear, 100-per-layer cap, unsupported host, rejected update,
  and exact secret-free payloads.
- [ ] Run:

  ```bash
  cd dataset-mcp/ui
  npm run check
  npm run typecheck
  npm test
  npm run build
  ```

### Task 6: Make Docker and CI resolve the shared package

**Files:**
- Create: `.dockerignore`
- Modify: `webapp/Dockerfile`
- Modify: `dataset-mcp/Dockerfile`
- Modify: `.github/workflows/publish-images.yml`
- Modify: `.github/workflows/dataset-mcp-quality.yml`
- Modify: `dataset-mcp/README.md`

- [ ] Change both image builds to repository-root context while preserving the
  app-internal working directories and runtime layouts. Copy only the relevant
  app plus `packages/map-core` in builder stages.

  ```dockerfile
  WORKDIR /workspace/webapp
  COPY packages/map-core /workspace/packages/map-core
  COPY webapp/package.json webapp/package-lock.json ./
  RUN npm ci
  COPY webapp/ ./
  RUN npm run build
  ```
- [ ] Add `packages/map-core/**` to publishing and MCP UI quality path filters.
- [ ] Document the root-context Docker commands:

  ```bash
  docker build -f webapp/Dockerfile -t hifld-webapp:test .
  docker build -f dataset-mcp/Dockerfile -t hifld-dataset-mcp:test .
  ```

- [ ] Run both builds when Docker is available and inspect that the MCP image
  still serves the single-file UI bundle.

### Task 7: Assemble and verify the full change

**Files:**
- Review all files from Tasks 1–6.

- [ ] Inspect `git diff` for accidental public route, response, environment,
  storage, query-token, map-layer ID, control-label, or webapp behavior changes.
- [ ] Run package, MCP UI, and webapp full gates again after all branches of work
  are assembled.
- [ ] Run the existing Python dataset-mcp targeted MCP/tool tests only if Python
  files changed during assembly; otherwise do not create unrelated churn.
- [ ] Report exact command results and any Docker limitation. Do not claim the
  change complete if the webapp gate is not fully green.
