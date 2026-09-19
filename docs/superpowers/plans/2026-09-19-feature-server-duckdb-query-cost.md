# Feature server DuckDB query cost implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid unnecessary GeoParquet scans in OGC hits and item requests while preserving exact results.

**Architecture:** Keep the existing request-scoped DuckDB connection and query semantics. Pass explicit count/page switches into the provider's shared query runner so `resulttype=hits` executes only the exact count and `get(id)` fetches only the item. Do not substitute publisher counts for filtered counts or change OGC identifiers.

**Tech Stack:** Python 3.12, DuckDB, pygeoapi, pytest, Ruff, Pyright.

---

### Task 1: Skip the unnecessary second query

**Files:**
- Modify: `feature-server/app/provider/duckdb_provider.py`
- Test: `feature-server/tests/test_duckdb_provider.py`

- [x] **Step 1: Write failing tests.** Add a connection spy around a small local GeoParquet fixture. Assert `query(resulttype="hits")` executes `SELECT count(*)` but no `ST_AsGeoJSON` query, and `get(id)` executes `ST_AsGeoJSON` but no `SELECT count(*)` query. Assert returned payloads still match the current contract.
- [x] **Step 2: Verify red.** Run `uv run pytest -q tests/test_duckdb_provider.py`; both new assertions must fail for the existing extra queries.
- [x] **Step 3: Implement minimal switches.** Extend `_run(..., *, include_count: bool = True, include_page: bool = True)`; conditionally execute count and page SQL. `query()` calls `_run(..., include_page=resulttype != "hits")`; `get()` calls `_run(..., include_count=False)`. Return `0` for intentionally skipped count; it is ignored by `get()`.
- [x] **Step 4: Verify green.** Re-run the targeted test. Then run `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, `uv run basedpyright`, and `uv run pytest` from `feature-server/`.

### Task 2: Bound request-scoped DuckDB resources

**Files:**
- Modify: `feature-server/app/provider/duckdb_provider.py`
- Test: `feature-server/tests/test_duckdb_provider.py`

- [x] **Step 1: Write failing test.** Set `FEATURE_SERVER_TEMP_DIRECTORY` to a temporary directory, open `_connection()`, and assert DuckDB's `temp_directory` matches it. Verify configured memory and thread limits with `current_setting` if this is stable on the pinned DuckDB version.
- [x] **Step 2: Verify red.** Run the targeted test and confirm failure specifically from unset request limits.
- [x] **Step 3: Implement minimal settings.** After connecting, set `threads = 1` and `memory_limit = '512MiB'`. When `FEATURE_SERVER_TEMP_DIRECTORY` is set, configure it and `max_temp_directory_size = '1GiB'`; preserve local DuckDB defaults when unset. Do not add a shared connection because pygeoapi requests can run concurrently.
- [x] **Step 4: Verify green and full gate.** Run the same targeted and full feature-server commands in Task 1. Validate rendered Helm resources remain within the existing 1 CPU / 1 GiB memory / 1 GiB spill limits.

## Scope notes

- Defer GeoParquet covering prefilters: published `asset_objects.covering_json` values are currently null and unsafe filtering could omit features.
- Defer `feature_count` as an exact `numberMatched` replacement until it is checked against every published GeoParquet asset and overwrite behavior.
- No production cutover or public image push is part of this plan.
