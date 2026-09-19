# ClickHouse Query Engine Implementation Plan

## Approved timeout follow-up

Raise query and tile defaults/caps from 30 to 60 seconds in MCP settings,
HTTP tile admission, the ClickHouse HTTP client and the query-user profile.
Keep cancellation's five-second cleanup budget, memory limits and ingress's
120-second timeout unchanged. No deployment or commit is requested.

- [x] Update settings/HTTP/client tests to assert 60-second defaults and ceilings;
  assert the query-user XML default and constraint match. Run targeted tests red.
- [x] Set the corresponding defaults and constraints to 60, and update docs and
  the live test deadline to 60. Run targeted tests green.
- [x] Run Ruff/format/Pyright/BasedPyright/full pytest, rebuild the local ClickHouse
  image, update only the test container's profile, and rerun live NFHL MVT decoding.

Verification: 467 tests passed, 9 opt-in skips; lint, formatting and both type
checkers passed. Live NFHL page-plus-MVT decoding passed in 45.27 seconds total;
server cancellation passed in 1.09 seconds. These are whole-test durations, not
individual tile latency measurements. No commit or production deployment.

> **For agentic workers:** Use subagent-driven-development for isolated tasks and test-driven-development for behavior changes.

**Goal:** Replace the production MCP DuckDB worker pool with a shared ClickHouse query service, retaining the public API and SeaweedFS development workflow.

**Architecture:** Resolve catalog sources in the application, compile validated SELECT SQL into request-local subqueries, and submit independent HTTP queries to ClickHouse. No persistent source views or HTTP sessions. Native storage glob discovery and filesystem caching belong to ClickHouse. Tokens remain self-contained. A fixed PROJ executable function normalizes geometry in source subqueries before user SQL. There is no DuckDB fallback.

**Tech Stack:** Python/httpx/Pydantic/SQLGlot, ClickHouse 26.8, Docker Compose, Helm.

## Approved compatibility boundaries

- Ordinary queries preserve native geometry unless `result_crs` is supplied.
- Spatial queries default to EPSG:4326. Explicit `result_crs` chooses the common working CRS for every source, before joins; native bbox columns remain unchanged.
- Native MVT encoding receives a final EPSG:4326 geometry. Projection uses fixed, bounded PROJ/Shapely executable functions, not user-provided code.
- Preserve public routes, tool names, response fields, pagination and token semantics.
- Preserve common SELECT syntax through a narrow, tested SQL compiler, not unrestricted transpilation. Unsupported spatial functions get actionable validation errors.
- No deployment or edits to the separate Portolan worktree.

## Task 1: Safe compiler and source bindings (controller)

Files: `dataset-mcp/app/query/sql_policy.py`, `dataset-mcp/query_engine/sql.py`, `dataset-mcp/tests/test_clickhouse_sql.py`.

- [ ] Write failing tests for CTE lexical scoping, denied system tables, table functions, SETTINGS, arbitrary URLs and ST_Transform.
- [ ] Implement scoped validation and a compiler `compile_query(sql: str, sources: tuple[WorkerSourceSpec, ...], *, seaweed_endpoint: str | None = None) -> str` using SQLGlot AST replacement, never textual alias replacement.
- [ ] Compile source references to local `SELECT * FROM s3(...)` subqueries using validated catalog URIs; use native glob expansion. Restrict Seaweed endpoints to configured overrides.
- [ ] Translate explicitly supported spatial operations; reject others before network execution.
- [ ] Run `uv run pytest tests/test_clickhouse_sql.py tests/security -q`.

## Task 2: HTTP execution and bounded result decoding (implementer)

Files: `dataset-mcp/query_engine/client.py`, `dataset-mcp/query_engine/results.py`, `dataset-mcp/tests/test_clickhouse_client.py`.

- [ ] First add failing transport tests covering bounded response consumption, timeout/cancellation, independent query IDs and error redaction.
- [ ] Implement typed async ClickHouse HTTP client with no session_id, unique UUID query_id, explicit memory/thread/time limits, server-side cancellation on caller disconnect/timeout, and bounded streamed response bytes.
- [ ] Decode JSONCompact response through explicit Pydantic models. Retain public page serialization budgets and safe integer handling.
- [ ] Never return backend credentials, source URLs or arbitrary full backend exception text.
- [ ] Run targeted pytest, Ruff, Pyright and BasedPyright.

## Task 3: Executor and application integration (controller)

Files: `dataset-mcp/query_engine/executor.py`, `dataset-mcp/query_engine/tiles.py`, `dataset-mcp/app/config.py`, `dataset-mcp/app/production.py`, `dataset-mcp/app/query/application.py`.

- [ ] Add failing tests using WorkerQuery/WorkerTileQuery/WorkerBoundsQuery and existing response dataclasses.
- [ ] Implement executor with start/close/execute methods and no local process pool. Paginate through a bounded outer SELECT. Return geometry summaries for raw geometry fields.
- [ ] Describe output schema without fetching a preliminary row. Encode bounded native MVT with `MVTEncode`/`MVTEncodeGeom`, preserve layer `hifld`, property names and IDs.
- [ ] Retain covering/viewport pruning where provably safe; never push viewport predicates across join/aggregate semantics incorrectly.
- [ ] Normalize known source CRSs before spatial operations; reject unknown CRS, expose native geometry metadata in inspection, and preserve working CRS in tokens.
- [ ] Switch production composition to ClickHouse; update guidance and remove production DuckDB dependency/path.

## Task 4: Compose, Helm and verification

Files: `docker-compose.yaml`, `ops/clickhouse/`, `charts/dataset-mcp/`, `dataset-mcp/Dockerfile`, `dataset-mcp/README.md`, `.env.example`.

- [ ] Configure pinned ClickHouse service on the existing Seaweed network, bounded disposable filesystem cache, health check, local-only published HTTP port and separate restricted query credentials.
- [ ] Helm uses internal service only, explicit resource limits, read-only query profile, network restrictions, no Keeper or durable dataset import.
- [ ] Run Compose config/Helm render and actual Docker integration queries against Seaweed plus public hospital/NFHL Parquet.
- [ ] Verify point/polygon tiles decode, pagination, simultaneous identical aliases, cancellation, source isolation, mixed-CRS normalization and restart recovery.
- [ ] Run MCP full Ruff, format, Pyright, BasedPyright and pytest gates. Run frontend/API gates if touched. Report real failures and remaining limits, not just successful tool configuration.

## Verification commands

```sh
cd dataset-mcp
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run basedpyright
uv run pytest
```

Baseline before changes: 404 passed, 5 skipped after building the MCP UI.

## Implementation verification status

Implementation is local on `feat/clickhouse-query-engine`; nothing committed or deployed.
The full MCP suite most recently passed with 464 tests (9 opt-in skips), and both
type checkers and Ruff passed. Live GCS hospital/NFHL pagination, projection and
MVT generation passed. Seaweed mixed-CRS joins in both working CRSs, concurrent
identical aliases and server-side cancellation passed. Container imports work
without DuckDB installed. Helm lint/render and Compose validation passed.

An initial full live run passed all four tests, including decoding point/polygon tiles with the
frontend library, finite coordinates and safe feature IDs. Projection also runs
under the hardened non-root/read-only filesystem container configuration.
Final Ruff/format/Pyright/BasedPyright and all 465 unit tests pass (9 opt-in skips).
Review also identified and fixed orphaned sibling metadata tasks on failure;
owned concurrent work now cancels and awaits every child before returning.
Production load testing and authenticated private storage remain outside the
verified compatibility envelope. Task checkboxes
above are retained as the original review checklist, not a claim of verification.

Latest repeat while rebuilding the MCP image: three live tests passed, but the
NFHL MVT request hit its 30-second deadline. No server query remained afterward.
The isolated repeat passed in 43.57 seconds for the complete page-plus-tile test
(each request stayed within its own deadline). This is not a single-tile timing.
NFHL latency under contention is still not a reliable production acceptance result.
