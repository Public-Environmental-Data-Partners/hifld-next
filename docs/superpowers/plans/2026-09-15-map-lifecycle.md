# Map lifecycle and native storage discovery

> Execute the user-approved design with subagent-driven-development and regression tests before implementation. Preserve unrelated Portolan work in the root workspace.

**Goal:** Remove avoidable map preparation overhead, preserve tiles across visibility changes, expose empty/error outcomes, and let independent layers load independently.

**Architecture:** Catalog supplies trusted native GCS patterns, DuckDB owns file discovery. URL formatting performs no authenticated storage initialization. Map preparation and widget loading use explicit per-layer states; query execution and cache limits remain bounded. Preserve public routes and existing response fields, adding state fields compatibly.

**Tech stack:** FastAPI, DuckDB/httpfs, Pydantic, React, MapLibre, MCP Apps, WebMCP.

## Tasks and acceptance

- [x] Confirm native GCS glob support with deployed DuckDB: anonymous `glob('gs://.../**/*.parquet')` returns 30 NFHL files in 0.135s.
- [x] Native GCS resolver and covering metadata: preserve trusted patterns; reject traversal/bucket escape; let DuckDB enumerate. Test concrete files, native globs, heterogeneous coverings and SeaweedFS regressions. Compare actual NFHL tile bytes with the explicit-file baseline.
- [x] Catalog API: pure public URL/URI formatting without GCS auth clients; stop query-source expansion outside DuckDB; preserve usable download/catalog source representations. Run all dataset-api quality gates. Commits e281ca0, 513ea3d; 61 passed, 1 integration skip; spec and quality reviews approved.
- [x] Map toggle: retain source tiles without MapLibre layout reload/unload; hidden features must not participate in selection. Browser hide/show at fixed viewport must make zero new tile requests.
- [x] Empty results and guidance: expose first-page emptiness (not an empty later page or inferred viewport emptiness) in query, URL, map and WebMCP responses. Shared guidance prefers PMTiles for display and verifies categorical values. Preserve sanitized backend errors.
- [x] Independent layer lifecycle: avoid waiting for SQL preparation before showing ready PMTiles; maintain per-layer failure/empty status and host feedback, compatible resource URI and retry/refresh behavior. Spec and quality re-reviews approved, including late idle callbacks and refresh preserving valid tokens until actual expiry.
- [x] Instrument preparation/catalog/worker durations without tokens or sensitive payloads. End-to-end tests cover NYC mixed-case empty query, corrected NYC hospitals, Miami PMTiles plus spatial join, toggles, errors and expiry. Large-join timeouts remain an explicitly recorded limitation, not a passing render result.
- [ ] Full gates: dataset-api Ruff/format/Pyright/BasedPyright/pytest; MCP same Python gates plus UI checks; webapp check/typecheck/test/build; map packages; independent spec then quality reviews; PR and CI.

## Boundaries

No generic SQL-to-Hive predicate rewriter. Do not remove the preview purely for speed: measured total gain was negligible; any deferred preparation must preserve schema validation and honest asynchronous outcomes. No production manual deployment, new credentials, bucket mutation, or resource-URI versioning. Existing short cache TTL bounds same-version object replacement staleness; native patterns are not claimed to be immutable object snapshots.

## Evidence collected during implementation

- Native GCS glob vs explicit 30-file NFHL input produced identical 237,853-byte MVT, SHA256 `de59ac31a10b70c3472380724980f913920cd2e84163ac8dc58fcb490c7404df`. Local fresh-worker timings 35.479s vs 54.675s are a single pair, not a reliable speedup estimate.
- New widget with production backend: corrected NYC hospitals rendered 73 viewport features (72 unique NAME values), zero errors; hide/show made zero additional tile requests or source reloads. PMTiles-only Miami rendered 831 polygons/multipolygons with seven range requests; hide/show made zero additional requests.
- New local MCP backend + widget using production catalog via loopback port-forward: corrected NYC rendered the same 73 features, hide/show zero extra requests. Original mixed-case query returned `empty_result` in tool and host feedback, zero query tile requests.
- Browser regression covers actual rendered point picking, cached toggles, tile failure, and normal/opaque iframe origins: four passed before deferred-layer integration. Full final rerun required after integration.
- Paint-only hiding keeps MapLibre source tiles retained. Tradeoff: hidden sources remain active during viewport changes; this avoids fixed-viewport hide/show reloads but is not a claim of zero hidden-layer traffic while panning.
- Backend empty-status commits ef5c662 and 76ccf3c passed 386 Python tests (five skips), lint and both type checkers; independent spec/quality reviews approved.

## Controlled native-glob comparison

Local sequential ABBA comparison of base `53b05af` and current application service, using identical Miami hospital/NFHL spatial-join SQL, tile `8/70/109`, DuckDB environment, one thread, 1 GiB worker memory, and the deployed catalog through a loopback port-forward. Each process performs URL preparation (including preview) followed by a tile request, then repeats with the same worker. No concurrent builds/tests/browser queries. The old resolver supplies 30 concrete public HTTPS NFHL files; the new resolver supplies one native `gs://.../**/*.parquet` pattern. Catalog changes are not deployed, so both versions still pay the old catalog's storage expansion cost.

| Version/order | Initial preparation | Initial tile | Initial total | Repeated total |
| --- | ---: | ---: | ---: | ---: |
| Baseline A | 33.769s | 74.136s | 107.905s | 30.379s |
| Native B | 27.317s | 22.250s | 49.566s | 8.052s |
| Native B | 26.616s | 23.018s | 49.634s | 8.556s |
| Baseline A | 34.864s | 31.207s | 66.071s | 25.546s |

Every result is 3,886 bytes with SHA256 `5f35e023c2b8908a6db9dfcaed9fca527394f0458158f899b3e47c4c3b79bae7`. This supports an improvement for this request, not a universal latency guarantee. Initial worker state is fresh, but remote infrastructure caches are uncontrolled. These are application-service measurements, not total browser render times. Cold query preparation and execution remain too slow for consistently interactive loading; the separate live multi-tile spatial-join map has still encountered queue/tile timeouts. Do not claim that large-join issue solved.

An earlier worker-only comparison deliberately supplied identical explicit native file lists to both versions: about 50.9s initial / 10s repeat in both. That isolated covering implementation and did **not** measure the native-glob path.

## Final verification

- Dataset API: Ruff/format/Pyright/BasedPyright clean; 61 passed, 1 opt-in integration skip.
- MCP backend: 404 passed, 5 opt-in integration skips; Ruff/format/Pyright/BasedPyright clean. Existing sqlglotrs and Starlette deprecation warnings only.
- MCP UI: check/typecheck/build, 111 unit tests and 6 browser tests pass. Chromium needs execution outside the filesystem sandbox on this host; the initial sandbox launch failed before tests began, then the authorized rerun passed.
- Webapp: check/typecheck/build and 402 tests pass; 39 pre-existing informational lint diagnostics and dependency/build warnings remain.
- Shared map packages: type checks and 28 tests pass; frontend workspace contract: 7 tests pass.
- Latest real-data browser checks: exact NYC mixed-case query yields no tiles, visible "No rows returned", and asynchronous host `empty_result`; Miami simple hospital query + PMTiles displays 36 hospitals and 831 flood features, no errors, fixed-viewport toggles zero requests. Screenshots inspected locally.
- Failure isolation: deliberately invalid hospital column returns the actual sanitized binder error with `query_execution_failed` to widget and host; PMTiles stays visible and loaded, map status is `partial`. This live check caught and fixed frozen `AppError` breaking context-manager traceback handling. Regression tests reproduce both affected boundaries.
- Final reviews resolved late-idle visibility, authoritative basemap updates, token-refresh expiry, and WebMCP transient tile-error recovery. Unknown/identityless source failures remain conservatively failed rather than guessing recovery.
- No production deployment or storage changes. PR/CI handoff remains the final step.
