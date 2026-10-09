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
