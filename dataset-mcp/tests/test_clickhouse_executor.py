import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from query_engine.client import ClickHouseClient
from query_worker.protocol import WorkerPage, WorkerQuery


@pytest.mark.asyncio
@pytest.mark.parametrize("empty", [False, True])
async def test_map_preview_does_not_materialize_geometry_but_still_detects_empty_results(empty):
    from query_engine.executor import ClickHouseExecutor

    statements = []

    def handler(request):
        sql = request.content.decode()
        statements.append(sql)
        schema = "LIMIT 0" in sql
        rows = [] if schema or empty else [[1]]
        return httpx.Response(
            200,
            json={
                "meta": [{"name": "geometry", "type": "Point" if schema else "UInt8"}],
                "data": rows,
                "rows": len(rows),
                "statistics": {"elapsed": 0.01, "rows_read": len(rows), "bytes_read": 0},
            },
        )

    engine = ClickHouseExecutor(
        ClickHouseClient("http://ch", "q", "pw", transport=httpx.MockTransport(handler))
    )
    try:
        result = await engine.execute(
            WorkerQuery(
                "SELECT ST_GeomFromText('POINT(1 2)') AS geometry",
                (),
                1,
                0,
                datetime.now(UTC) + timedelta(seconds=10),
                materialize_geometry=False,
            )
        )
        assert isinstance(result, WorkerPage)
        assert result.returned_count == (0 if empty else 1)
        assert "length(wkb(" not in statements[-1]
        assert '1 AS "geometry"' in statements[-1]
        if not empty:
            assert result.rows[0]["geometry"] == {"$type": "geometry", "omitted": True}
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_metadata_failure_cancels_sibling_before_returning():
    from query_engine.executor import ClickHouseExecutor
    from query_worker.protocol import WorkerFailure, WorkerSourceSpec

    started = asyncio.Event()
    cancelled = asyncio.Event()

    class Reader:
        async def resolve(self, source):
            if source.alias == "bad":
                await started.wait()
                raise httpx.ConnectError("unavailable")
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        async def close(self):
            pass

    engine = ClickHouseExecutor(ClickHouseClient("http://ch", "q", "pw"))
    await engine.metadata.close()
    engine.metadata = Reader()
    try:
        result = await engine.execute(
            WorkerQuery(
                "SELECT * FROM bad",
                (WorkerSourceSpec("bad", ()), WorkerSourceSpec("slow", ())),
                1,
                0,
                datetime.now(UTC) + timedelta(seconds=10),
            )
        )
        assert isinstance(result, WorkerFailure)
        assert cancelled.is_set(), "sibling metadata work outlived the failed request"
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_executor_bounds_page_and_preserves_safe_integer_encoding():
    from query_engine.executor import ClickHouseExecutor

    statements = []

    async def handler(request):
        statements.append(request.content.decode())
        return httpx.Response(
            200,
            json={
                "meta": [{"name": "id", "type": "UInt64"}],
                "data": [] if "LIMIT 0" in statements[-1] else [[9007199254740993], [2]],
                "rows": 0 if "LIMIT 0" in statements[-1] else 2,
                "rows_before_limit_at_least": 2,
                "statistics": {"elapsed": 0.01, "rows_read": 2, "bytes_read": 16},
            },
        )

    executor = ClickHouseExecutor(
        ClickHouseClient("http://ch", "q", "pw", transport=httpx.MockTransport(handler))
    )
    try:
        result = await executor.execute(
            WorkerQuery(
                "SELECT 9007199254740993 AS id", (), 1, 0, datetime.now(UTC) + timedelta(seconds=10)
            )
        )
    finally:
        await executor.close()
    assert isinstance(result, WorkerPage)
    assert result.rows == ({"id": "9007199254740993"},)
    assert result.has_more
    assert result.next_offset == 1
    assert "LIMIT 2" in statements[-1]


@pytest.mark.asyncio
async def test_executor_expired_deadline_never_calls_backend():
    from query_engine.executor import ClickHouseExecutor
    from query_worker.protocol import WorkerFailure

    async def handler(request):
        pytest.fail("expired query reached backend")

    executor = ClickHouseExecutor(
        ClickHouseClient("http://ch", "q", "pw", transport=httpx.MockTransport(handler))
    )
    try:
        result = await executor.execute(
            WorkerQuery("SELECT 1", (), 1, 0, datetime.now(UTC) - timedelta(seconds=1))
        )
        assert isinstance(result, WorkerFailure)
        assert result.code == "query_timeout"
    finally:
        await executor.close()
