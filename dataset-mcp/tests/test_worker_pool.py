import asyncio
import time
from datetime import UTC, datetime, timedelta
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import cast

import pytest

from query_worker.pool import WorkerPool, WorkerPoolConfig, _Pipe, _WorkerSlot
from query_worker.protocol import WorkerFailure, WorkerPage, WorkerQuery
from query_worker.runtime import WorkerRuntimeConfig


@pytest.mark.asyncio
async def test_identical_slow_queries_leave_a_worker_for_another_query(tmp_path: Path) -> None:
    pool = WorkerPool(
        WorkerPoolConfig(worker_count=2, soft_timeout_seconds=5, hard_timeout_seconds=5),
        WorkerRuntimeConfig(
            threads=1, memory_limit="256MiB", temp_directory=str(tmp_path), load_extensions=False
        ),
    )
    await pool.start()
    slow = _request("SELECT sum(i) FROM range(100000000000) AS values(i)")
    first = asyncio.create_task(pool.execute(slow))
    second = asyncio.create_task(pool.execute(slow))
    try:
        await asyncio.sleep(0.1)
        fast = await asyncio.wait_for(pool.execute(_request("SELECT 42 AS answer")), 2)
        assert isinstance(fast, WorkerPage)
        assert fast.rows == ({"answer": 42},)
        assert not first.done()
        assert not second.done()
    finally:
        first.cancel()
        second.cancel()
        await asyncio.gather(first, second, return_exceptions=True)
        await pool.close()


@pytest.mark.asyncio
async def test_admission_wait_is_bounded_without_replacing_busy_worker(tmp_path: Path) -> None:
    pool = WorkerPool(
        WorkerPoolConfig(
            worker_count=1,
            soft_timeout_seconds=5,
            hard_timeout_seconds=5,
            queue_timeout_seconds=0.05,
        ),
        WorkerRuntimeConfig(
            threads=1, memory_limit="256MiB", temp_directory=str(tmp_path), load_extensions=False
        ),
    )
    await pool.start()
    pids = pool.worker_pids
    first = asyncio.create_task(
        pool.execute(_request("SELECT sum(i) FROM range(100000000000) AS values(i)"))
    )
    try:
        await asyncio.sleep(0.1)
        result = await asyncio.wait_for(pool.execute(_request("SELECT 42")), 1)
        assert result == WorkerFailure("query_timeout", "The query exceeded its queue wait limit")
        assert pool.worker_pids == pids
        assert not first.done()
    finally:
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await pool.close()
    assert pool._admissions == {}


@pytest.mark.asyncio
async def test_cancelling_same_query_waiter_cleans_admission_state(tmp_path: Path) -> None:
    pool = _pool(tmp_path, timeout=5)
    await pool.start()
    slow = _request("SELECT sum(i) FROM range(100000000000) AS values(i)")
    first = asyncio.create_task(pool.execute(slow))
    second = asyncio.create_task(pool.execute(slow))
    try:
        await asyncio.sleep(0.1)
        pids = pool.worker_pids
        second.cancel()
        await asyncio.gather(second, return_exceptions=True)
        assert pool.worker_pids == pids
        assert not first.done()
    finally:
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await pool.close()
    assert pool._admissions == {}


@pytest.mark.asyncio
async def test_same_query_queue_timeout_leaves_running_query_untouched(tmp_path: Path) -> None:
    pool = WorkerPool(
        WorkerPoolConfig(
            worker_count=2,
            soft_timeout_seconds=5,
            hard_timeout_seconds=5,
            queue_timeout_seconds=0.05,
        ),
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path),
            load_extensions=False,
        ),
    )
    await pool.start()
    slow = _request("SELECT sum(i) FROM range(100000000000) AS values(i)")
    first = asyncio.create_task(pool.execute(slow))
    try:
        await asyncio.sleep(0.1)
        result = await asyncio.wait_for(pool.execute(slow), 1)
        assert result == WorkerFailure("query_timeout", "The query exceeded its queue wait limit")
        fast = await pool.execute(_request("SELECT 42 AS answer"))
        assert isinstance(fast, WorkerPage)
        assert not first.done()
    finally:
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await pool.close()
    assert pool._admissions == {}


def _request(sql: str, *, limit: int = 10) -> WorkerQuery:
    return WorkerQuery(
        canonical_sql=sql,
        sources=(),
        limit=limit,
        offset=0,
        deadline=datetime.now(tz=UTC) + timedelta(seconds=30),
        deterministic_order=True,
    )


@pytest.mark.asyncio
async def test_workers_have_separate_spill_directories_cleaned_on_close(tmp_path: Path) -> None:
    pool = WorkerPool(
        WorkerPoolConfig(worker_count=2),
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path),
            load_extensions=False,
        ),
    )
    await pool.start()
    try:
        first = await pool.execute(_request("SELECT current_setting('temp_directory') AS path"))
        second = await pool.execute(_request("SELECT current_setting('temp_directory') AS path"))
        assert isinstance(first, WorkerPage)
        assert isinstance(second, WorkerPage)
        first_path = first.rows[0]["path"]
        second_path = second.rows[0]["path"]
        assert isinstance(first_path, str) and isinstance(second_path, str)
        assert first_path != second_path
        assert Path(first_path).parent == tmp_path
        assert Path(second_path).parent == tmp_path
    finally:
        await pool.close()
    assert not list(tmp_path.iterdir())


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


@pytest.mark.asyncio
async def test_pool_reuses_worker_after_nonfatal_query_failure(tmp_path: Path) -> None:
    pool = _pool(tmp_path)
    await pool.start()
    original_pid = pool.worker_pids[0]
    try:
        failed = await pool.execute(_request("SELECT * FROM missing_table"))
        follow_up = await pool.execute(_request("SELECT 9 AS value"))
        reused_pid = pool.worker_pids[0]
    finally:
        await pool.close()

    assert failed == WorkerFailure(
        code="query_execution_failed",
        message="The bounded query could not be executed",
    )
    assert isinstance(follow_up, WorkerPage)
    assert follow_up.rows == ({"value": 9},)
    assert reused_pid == original_pid


@pytest.mark.asyncio
async def test_pool_reuses_worker_after_runtime_query_timeout_failure(tmp_path: Path) -> None:
    pool = _pool(tmp_path)
    await pool.start()
    original_pid = pool.worker_pids[0]
    try:
        failed = await pool.execute(
            WorkerQuery(
                canonical_sql="SELECT 1",
                sources=(),
                limit=1,
                offset=0,
                deadline=datetime.now(tz=UTC) - timedelta(seconds=1),
            )
        )
        follow_up = await pool.execute(_request("SELECT 9 AS value"))
        reused_pid = pool.worker_pids[0]
    finally:
        await pool.close()

    assert failed == WorkerFailure(code="query_timeout", message="The query deadline expired")
    assert isinstance(follow_up, WorkerPage)
    assert reused_pid == original_pid


@pytest.mark.asyncio
async def test_pool_cancellation_replaces_slot_once_even_when_cancelled_twice(
    tmp_path: Path,
) -> None:
    class BlockingConnection:
        def send(self, _request: object) -> None:
            return

        def poll(self, _timeout: float) -> bool:
            time.sleep(1)
            return False

        def recv(self) -> object:
            raise AssertionError("response should not be read")

        def close(self) -> None:
            return

    pool = _pool(tmp_path)
    pool._started = True
    slot = _WorkerSlot(
        process=cast("BaseProcess", object()),
        connection=cast("_Pipe", BlockingConnection()),
    )
    pool._workers.append(slot)
    pool._available.put_nowait(slot)
    replacement_count = 0
    replacement_done = asyncio.Event()

    async def replace(replaced: _WorkerSlot) -> None:
        nonlocal replacement_count
        replacement_count += 1
        await replacement_done.wait()
        pool._available.put_nowait(replaced)

    pool._replace = replace  # type: ignore[method-assign]
    task = asyncio.create_task(pool.execute(_request("SELECT 1")))
    await asyncio.sleep(0.05)
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    replacement_done.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert replacement_count == 1
    assert pool._available.qsize() == 1
