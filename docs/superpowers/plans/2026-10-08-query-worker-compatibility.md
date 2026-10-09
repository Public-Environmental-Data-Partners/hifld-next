# Spatial WebMCP worker compatibility

Approved scope: accept the deployed MCP MapLibre `.cjs` worker as well as the
existing `.mjs` worker. Preserve response contracts and all URL security checks.
No server, storage, worker implementation, or query behavior changes.

1. Add a regression for a spatial response advertising `.cjs`, and negative cases
   covering credentials, query strings, fragments, schemes, and lookalike paths.
   Run the query-api tests and observe the `.cjs` regression fail.
2. Allow the two exact worker paths in `QueryMapConfigurationSchema`; rerun the
   targeted tests, check, typecheck, full tests, and build.
3. Merge through CI, deploy pinned images, and verify the real spatial WebMCP
   query reaches a ready map layer with successful vector-tile requests.

Browser verification uses a probe at the unavailable native WebMCP registration
boundary; application tools, HTTP requests, query execution, and rendering remain
real. Report this limitation explicitly.

Completed: regression failed before the fix; all 18 targeted and 497 full tests,
lint, typecheck, build and CI passed. PR 65 merged as `a990aa6`; pinned container
rollout `37869924121` succeeded. Production spatial WebMCP returned five rows,
added a ready query layer and fetched a vector tile with HTTP 200. Published
PMTiles fetched byte ranges with HTTP 206; comparison and catalog tools passed,
with no browser page errors.
