# ClickHouse preparation and admission implementation plan

**Goal:** Remove dataset-wide metadata validation and bound per-pod query execution while allowing independent ClickHouse replicas.

**Architecture:** Read one representative GeoParquet footer, preserving the original scan glob. Enforce two active queries using ClickHouse's query-user profile (not an MCP-local semaphore). MCP retries only explicit admission refusals within a bounded request budget. A headless Service supplies ready replica addresses; each attempt and its cancellation use the same address. Replica count and optional HPA belong to the ClickHouse deployment, independent of MCP replicas.

**Tech stack:** Python/httpx/asyncio, ClickHouse XML profiles, Helm, Docker.

## Tasks

- [x] Metadata: regression tests for one footer, scoped native discovery with LIMIT 1, cache and unchanged source; implement in query_engine/metadata.py.
- [x] Admission/routing: tests in test_clickhouse_client.py for code 202 retries, deadlines, bounded pending requests, replica distribution and cancellation affinity. Implement small endpoint resolver and client changes; wire Settings/production.
- [x] Infrastructure: readonly per-user concurrency setting defaults to 2, separate control profile remains available; headless Service, configurable replicas, optional CPU HPA. Document queue bounds, cold caches and single-server external URLs.
- [x] Verify targeted and full MCP lint/format/type/tests, Helm lint/render and Compose validation. Live local tests must demonstrate active query ceiling, two-server distribution/cancellation, and actual Miami widget rendering. Record remaining failures rather than claim success from tool responses.

No production deployment or unrelated API/webapp changes. Increasing timeouts and memory limits is not part of this change.

## Verification so far

- Full MCP suite: 483 passed, 11 opt-in tests skipped; Ruff check/format, Pyright and BasedPyright passed.
- Two real ClickHouse containers: six requests across two independent clients never exceeded two active executions on one server; round-robin queries reached both servers and cancellation cleared both. Both live tests passed.
- Helm lint, three-replica render, optional HPA render and Compose config passed. Existing ClusterIP Service preserved for upgrade compatibility; separate headless Service added.
- Independent spec and quality reviews approved after fixing strict admission-error classification and deadline-safe cancellation cleanup.
- Isolated NFHL metadata resolution: 1.843 seconds, retaining EPSG:4269 and bbox covering. This is not a full map timing or a cold storage benchmark.
- Initial end-to-end browser repeat hit the NFHL preview execution deadline, not an aggregate-memory exception. Do not equate passing admission tests with acceptable map latency.
- Final browser repeat: hospital preparation 1.34 seconds; NFHL preparation still failed at ~65 seconds including cleanup. Hospital tiles also encountered 504 timeouts while NFHL was active. Screenshot `/tmp/hifld-clickhouse-visual/miami-query-final.png`. Map performance remains a release blocker; no deployment performed.
