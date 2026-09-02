# MCP Map Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real default basemap plus constrained agent-controlled layer styling and initial camera options to `view_query_map`.

**Architecture:** Reuse the webapp's trusted OpenFreeMap style origin and presentation vocabulary without copying its stateful workspace machinery. Validate inputs at the FastMCP tool boundary, include them in the map result, validate again in React, and compose the query MVT overlay onto the selected base style after it loads.

**Tech Stack:** FastMCP, Pydantic, React, Zod, MapLibre GL JS, Vitest, pytest

---

### Task 1: Tool presentation contract

**Files:**
- Modify: `dataset-mcp/app/tools/query.py`
- Modify: `dataset-mcp/app/mcp_server.py`
- Test: `dataset-mcp/tests/test_query_tools.py`
- Test: `dataset-mcp/tests/test_http_app.py`

- [ ] Add failing tests that call `view_query_map` with basemap, style, and camera values and assert those validated values are returned in `map_configuration`.
- [ ] Run `uv run pytest tests/test_query_tools.py tests/test_http_app.py -q` and confirm the new assertions fail because the inputs are not accepted.
- [ ] Add strict Pydantic presentation models, pass them through the FastMCP tool signature, and merge their JSON-safe values into a copied map configuration.
- [ ] Run the targeted tests and confirm they pass.

### Task 2: Basemap CSP

**Files:**
- Modify: `dataset-mcp/app/mcp_server.py`
- Test: `dataset-mcp/tests/test_http_app.py`

- [ ] Add a failing assertion that the app resource CSP permits `https://tiles.openfreemap.org` for both connections and resources.
- [ ] Run the targeted CSP test and confirm it fails.
- [ ] Add the fixed basemap origin to `UIResourceConfig` and its `ResourceCSP` output without widening arbitrary egress.
- [ ] Run the targeted test and confirm it passes.

### Task 3: React basemap and presentation rendering

**Files:**
- Modify: `dataset-mcp/ui/src/mcp/contracts.ts`
- Modify: `dataset-mcp/ui/src/components/MapView.tsx`
- Test: `dataset-mcp/ui/tests/contracts.test.ts`
- Test: `dataset-mcp/ui/tests/MapView.test.tsx`

- [ ] Add failing contract tests for the strict basemap, style, and camera structures.
- [ ] Add failing MapView tests proving `bright` is the default style URL, the query source and layers are added after style load beneath labels, explicit style values reach MapLibre, explicit camera overrides dataset bounds, and `none` uses a local blank style.
- [ ] Run `npm test -- --run tests/contracts.test.ts tests/MapView.test.tsx` and confirm the new expectations fail.
- [ ] Extend the Zod contract and implement pure basemap, camera, and layer-style helpers in `MapView.tsx`; compose the query overlay in the MapLibre load handler.
- [ ] Run the targeted UI tests and confirm they pass.

### Task 4: Documentation, builds, and acceptance

**Files:**
- Modify: `dataset-mcp/README.md`
- Generated locally: `dataset-mcp/ui/dist/index.html`

- [ ] Document the new `view_query_map` inputs, the OpenFreeMap default, and the stateless presentation behavior.
- [ ] Run `npm run check`, `npm run typecheck`, `npm test`, and `npm run build` from `dataset-mcp/ui`.
- [ ] Run `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `uv run basedpyright`, and `uv run pytest` from `dataset-mcp`.
- [ ] Invoke the live FastMCP query and map tools and verify the returned configuration uses the default basemap, camera/style overrides survive the tool call, and a real signed query tile still returns successfully.
