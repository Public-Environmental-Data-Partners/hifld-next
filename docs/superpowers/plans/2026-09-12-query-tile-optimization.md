# Query tile optimization implementation plan

**Goal:** Make spatially optimized Parquet effective for dynamic tiles, reuse bounded
tile work, and prevent tile fan-out from monopolizing execution admission.

**Approved design:** Inline constant tile envelopes in our wrapper; resolve covering
paths from GeoParquet metadata only for unchanged source geometries; cache encoded
tiles by validated query and resolved source identity; preserve token authorization,
cancellation, source revalidation, and hard memory/execution bounds.

**Scope:** MCP application and worker changes, local verification, no deployment.
Infrastructure autoscaling and shared/distributed cache deployment require a separate
IaC rollout. Result materialization remains conditional on profiling, not this patch.

## Tasks

- [x] Add Parquet-reader filter regression to `dataset-mcp/tests/test_covering_pruning.py`,
  verify failure, replace bounds CTE references in `query_worker/tiles.py` with
  inline expressions, verify equivalent tiles and predicate pushdown.
- [x] Add metadata covering parser and safe carry-through tests. Resolve all files'
  declared paths consistently in the worker, validate identifiers/types, cache
  bounded metadata briefly, and skip unsafe query/CRS shapes.
- [x] Add bounded successful-tile cache with expiration, concurrent request
  coalescing, cancellation ownership, stable source identity, and eviction tests.
  Revalidate tokens/sources before cache access. Do not cache failures.
- [x] Add conditional SQL token round-trip tests, fix CASE/IF normalization and
  clarify invalid versus expired token errors without leaking SQL or tokens.
- [x] Fix admission fairness without admitting unlimited expensive requests;
  test that one query cannot exclude another and cancelled work frees capacity.
- [x] Run targeted tests, full MCP pytest, Ruff lint/format, Pyright and BasedPyright.
  Re-run remote NFHL regression with implemented code and report density limit
  separately rather than claiming successful map rendering.

## Evidence and safeguards

Existing controlled test: 2M points, 123 groups, identical tile bytes; inline 12ms
versus CTE 87ms. Remote Florida test: inline 10.8s; CTE interrupted at 91.6s.
Metadata permits 77 groups to narrow to 4. EPSG:4269 boundary sampling and regional
geometry tests had no false negatives, but arbitrary projected CRS control failed.
Do not generalize four-corner bounds to arbitrary projections. Keep exact geometry
intersection after conservative prefilters. Do not silently truncate dense tiles.

Final local verification: 381 tests passed, 5 skipped; Ruff lint/format, Pyright,
BasedPyright clean. Actual updated worker against production Florida objects,
tile 14/4538/6974: 9.848s cold, 3.643s warm, identical 237853-byte tiles. Direct
scalar covering projections were essential: a reconstructed struct took 47-49s
cold despite predicates appearing inside the scan. Regression tests now inspect
the full retained-covering plan. No deployment or visual-rendering claim.

Remaining broader roadmap: IaC autoscaling/metrics and resource sizing, frontend
transient retries, stale-host-widget remediation, density handling policy, and
optional bounded analytical-result materialization. These are not implemented
by this application-focused patch.
