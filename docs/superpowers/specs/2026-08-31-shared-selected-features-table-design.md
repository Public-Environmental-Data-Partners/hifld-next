# Shared Selected Features Table Design

## Goal

Show a readable selected-features table after every non-empty MCP map highlight,
reuse the same table renderer in the webapp, and make clearing a selection return
the MCP map to a completely unselected state.

## Package Boundary

Create `packages/map-ui` as a small React package alongside the React-free
`packages/map-core`. `map-ui` owns a semantic property table over normalized
feature rows whose properties are strings. It does not own MapLibre state,
selection gestures, MCP host context, catalog metadata, feature comparison,
search state, or application-specific buttons.

The shared component accepts rows, an optional ordered column list, an optional
highlighted row ID, an optional row callback, and optional trailing row content.
It derives a sorted union of property columns when columns are omitted. Stable
`data-slot` attributes let the webapp and MCP app retain their own surrounding
theme without coupling the package to Tailwind or shadcn.

## MCP Behavior

- Every non-empty click or box highlight renders the shared table below the map.
- A single click uses the table too; the separate single-feature details card is
  removed.
- The table header shows the selection count, cap warning when applicable, host
  context status when relevant, and a Clear button.
- The existing top-right eraser remains available, matching the original map.
- Either Clear action removes the rendered feature highlights, selection box,
  selected rows, cap state, and visible status. No zero-row status is rendered.
- An unsupported MCP host may still be reported for a non-empty selection, but
  it never replaces or hides the selected rows.

## Webapp Compatibility

The webapp's selected tab keeps its layer/version selectors, search, sorting,
row zoom, external-map/report actions, comparison tab, and resizable panel. Only
the property table markup is delegated to `@hifld/map-ui`; the existing behavior
and data preparation remain local.

## Spinner and Local Storage

The seeded PMTiles objects are present and support HTTP byte ranges and CORS.
The MCP query map does not read PMTiles: it executes GeoParquet queries and
serves generated MVT from `/tiles/{query_id}/{z}/{x}/{y}.mvt`. The current MCP
tool and tile routes are healthy in a direct local flow, so PMTiles are not the
cause of an MCP component spinner. Spinner diagnosis remains a separate runtime
concern and will not be mixed into the table extraction.

## Verification

- `map-ui`: column derivation, row rendering, highlighting, row action, and empty
  behavior tests.
- MCP UI: single and box selections show the table; both Clear actions remove
  table and status; unsupported hosts still show rows; no zero-feature status.
- Webapp: existing selected-table behavior plus full check, typecheck, test, and
  build gates.

