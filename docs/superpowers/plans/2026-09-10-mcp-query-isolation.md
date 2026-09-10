# MCP query isolation implementation plan

> **For agentic workers:** Use subagent-driven-development, test-first, with independent review before deployment.

**Goal:** Allow 30-second flood tile execution without one query occupying both workers; enable partition pruning.

**Architecture:** Two spawned workers, one active request per canonical SQL/source identity. Acquire identity admission before a worker, with a bounded admission wait. Execution deadlines start after admission. Keep process termination/replacement and query cancellation cleanup. Enable Hive partition reading while retaining leading-zero string partition values. Give the pod 4Gi memory for two 1Gi DuckDB workers and overhead.

**Tech Stack:** Python asyncio, DuckDB, FastAPI, Helm, GitHub Actions.

## Reader and configuration

- [ ] Add regression tests proving `state_fips='36'` yields a file filter and 1/2 files in EXPLAIN, preserving `'01'` as text; retain unpartitioned reads.
- [ ] Enable Hive handling in `dataset-mcp/query_worker/runtime.py` using the trusted object list, without interpolating caller SQL or changing partition column types.
- [ ] Update defaults/caps in `app/config.py`, `app/http/tiles.py`, `app/http/queries.py`, and `app/http_app.py` from 10 to 30 seconds; tests must reject >30.
- [ ] Set production defaults to two workers, one DuckDB thread each, 1GiB per worker. Update Helm requests to 2Gi and limit to 4Gi; retain total CPU limit 2.
- [ ] Run targeted runtime/config/tile tests then Ruff and types.

## Admission isolation

- [ ] Add spawned-worker tests in `tests/test_worker_pool.py`: two long identical queries must leave another worker available to `SELECT 42`; queued waits expire without consuming slots; canceled waiters leave no retained admission state.
- [ ] Add a ref-counted per-query asyncio lock keyed by `(canonical_sql, sources)` in `query_worker/pool.py`. Acquire it before `_available.get()` under a 30-second admission timeout; release/refcount-clean in `finally`.
- [ ] Reject already-expired requests at entry; reset the execution deadline only after admission, so queued work has an execution budget. Bound worker-slot waiting using the same admission timeout. Existing in-flight cancellation still retires its worker once.
- [ ] Run pool tests and all MCP lint/type/test gates.

## Review and deploy

- [ ] Review source diff for spec compliance, then concurrency/cancellation/resource safety.
- [ ] Open PR, merge after passing verification, wait for SHA image publication.
- [ ] Deploy pinned SHA through hifld-next-iac deploy-containers workflow; do not apply unrelated Terraform drift.
- [ ] Replay exact Manhattan request, fetch flood and hospital tiles concurrently, and verify rendered/selectable features and hospital hide/show through deployed worker and tiles.
- [ ] Report measured timings and any remaining failures, not merely HTTP/tool success.
