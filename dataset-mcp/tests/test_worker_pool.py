from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from query_worker.pool import WorkerPool, WorkerPoolConfig
from query_worker.protocol import WorkerFailure, WorkerPage, WorkerQuery
from query_worker.runtime import WorkerRuntimeConfig


def _request(sql: str, *, limit: int = 10) -> WorkerQuery:
    return WorkerQuery(
        canonical_sql=sql,
        sources=(),
        limit=limit,
        offset=0,
        deadline=datetime.now(tz=UTC) + timedelta(seconds=30),
        deterministic_order=True,
    )


def _pool(tmp_path: Path, *, timeout: float = 2.0) -> WorkerPool:
    return WorkerPool(
        WorkerPoolConfig(
            worker_count=1,
            soft_timeout_seconds=timeout,
            hard_timeout_seconds=max(timeout, 1.0),
            recycle_after_requests=100,
        ),
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path / "spill"),
            load_extensions=False,
        ),
    )


@pytest.mark.asyncio
async def test_pool_executes_request_in_spawned_worker_and_closes(tmp_path: Path) -> None:
    pool = _pool(tmp_path)
    await pool.start()
    pids = pool.worker_pids

    result = await pool.execute(_request("SELECT 42 AS answer"))
    await pool.close()

    assert isinstance(result, WorkerPage)
    assert result.rows == ({"answer": 42},)
    assert len(pids) == 1
    assert pids[0] != 0
    assert pool.worker_pids == ()


@pytest.mark.asyncio
async def test_pool_terminates_timed_out_worker_and_replaces_it(tmp_path: Path) -> None:
    pool = _pool(tmp_path, timeout=0.05)
    await pool.start()
    original_pid = pool.worker_pids[0]
    try:
        timed_out = await pool.execute(
            _request("SELECT sum(i) FROM range(100000000000) AS values(i)")
        )
        replacement_pid = pool.worker_pids[0]
        follow_up = await pool.execute(_request("SELECT 7 AS value"))
    finally:
        await pool.close()

    assert timed_out == WorkerFailure(
        code="query_timeout", message="The query exceeded its execution timeout"
    )
    assert replacement_pid != original_pid
    assert isinstance(follow_up, WorkerPage)
    assert follow_up.rows == ({"value": 7},)


@pytest.mark.asyncio
async def test_pool_recycles_worker_after_configured_request_count(tmp_path: Path) -> None:
    pool = WorkerPool(
        WorkerPoolConfig(
            worker_count=1,
            soft_timeout_seconds=2,
            hard_timeout_seconds=2,
            recycle_after_requests=1,
        ),
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path / "spill"),
            load_extensions=False,
        ),
    )
    await pool.start()
    original_pid = pool.worker_pids[0]
    try:
        first = await pool.execute(_request("SELECT 1 AS value"))
        replacement_pid = pool.worker_pids[0]
        second = await pool.execute(_request("SELECT 2 AS value"))
    finally:
        await pool.close()

    assert isinstance(first, WorkerPage)
    assert isinstance(second, WorkerPage)
    assert replacement_pid != original_pid
