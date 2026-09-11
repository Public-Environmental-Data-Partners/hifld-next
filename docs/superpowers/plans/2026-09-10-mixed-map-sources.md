# Explicit mixed-source MCP maps

Approved design: `view_map` accepts shared layer styling and an explicit source union:
`query`, `catalog`, `pmtiles`, `tilejson`, or `vector_tiles`. Only query sources
require SQL; query inputs retain catalog aliases. Existing query-map tools remain
compatible. External URLs are public HTTPS and are fetched by the browser, never
passed to DuckDB or fetched by the MCP server.

1. Backend: typed input union, catalog PMTiles resolution, tool registration,
   durable refresh, format discovery, regression tests (delegated).
2. Widget: validated runtime union, independent per-layer metadata loading,
   PMTiles protocol, TileJSON/XYZ support, shared styling and visibility, and
   query-token isolation. Preserve real source provenance in selections.
3. Validate legacy and mixed maps, invalid metadata/URLs, toggling, refresh,
   and failed-source isolation. Run Python and UI quality gates.
4. Browser-test real public tiles and a query layer; inspect features and network
   errors, not just successful tool responses. Review before PR/deployment.

Runtime query layers retain their existing fields. External runtime layers use
`layer_id`, `layer_name`, `source`, `style`, and `visible`; no fabricated query IDs
or tokens. The durable specification retains the original catalog references.
MCP widget network policy must permit public HTTPS tile requests while retaining
the existing script/frame restrictions.

Pending DuckDB diagnostics, admission isolation, and bbox-retention fixes are
preserved in this worktree and will be verified with the feature.

## Verification

- Python: 346 passed, 5 skipped; Ruff and both type checkers clean.
- Widget: 87 unit tests passed; Biome/typecheck/build passed; two Chromium
  integration tests passed, including an opaque-origin iframe.
- Real local `view_map` calls used a read-only forwarded production catalog and
  public production objects. Browser harness applied the returned resource CSP
  and forwarded an HTTPS test origin to the actual local MCP HTTP server.
- NFHL catalog-only: 2.5 seconds from widget opening, 831 rendered polygon
  fragments, 11 PMTiles requests, zero query-tile requests, no browser errors.
- Mixed NFHL + hospital SQL: tool configuration 4.7 seconds; both layers loaded
  6.7 seconds after opening, 36 distinct hospitals. Both visibility toggles
  restored the features; no HIFLD query token was sent to PMTiles.
- Visual review exposed polygon vertices being rendered as points; added
  geometry-type filters with a failing-then-passing regression test.
- External-only worker registration now uses the existing classic `.cjs`
  worker required by opaque-origin MCP frames, with a regression test.

These are local application tests against real production data, not a claim
that the new application version has been deployed or tested inside Claude.
