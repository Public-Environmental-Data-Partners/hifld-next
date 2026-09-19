import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from xml.etree import ElementTree

import httpx
import pytest
from pydantic import ValidationError

from query_engine.client import ClickHouseClient, ClickHouseError
from query_engine.results import ClickHouseResult


def test_geometry_group_by_error_is_actionable_without_leaking_sql():
    from query_engine.client import _server_error

    error = _server_error(
        b"Code: 44. Data types Variant/Dynamic are not allowed in GROUP BY keys. "
        b"(ILLEGAL_COLUMN) secret-bucket SELECT private"
    )
    assert "GROUP BY" in error.message
    assert "geometry" in error.message
    assert "query_parquet" in error.message
    assert "secret" not in error.message


@pytest.mark.asyncio
async def test_invalid_join_error_is_actionable_without_leaking_backend_sql():
    client = ClickHouseClient(
        "http://engine",
        "u",
        "p",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                500,
                text="Code: 403. Cannot determine join keys. "
                "(INVALID_JOIN_ON_EXPRESSION) secret-bucket signed-secret SELECT private",
            )
        ),
    )
    try:
        with pytest.raises(ClickHouseError) as raised:
            await client.query("SELECT 1", timeout_seconds=1)
        assert "JOIN ON" in raised.value.message
        assert "query_parquet" in raised.value.message
        assert "secret" not in raised.value.message
        assert raised.value.code == "query_failed"
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout,maximum_ms", [(0.25, 250), (2, 2000), (60, 5000)])
async def test_storage_reads_cannot_keep_default_long_retry_budget(timeout, maximum_ms):
    def handler(request):
        params = request.url.params
        assert 0 < int(params["s3_request_timeout_ms"]) <= maximum_ms
        assert int(params["s3_connect_timeout_ms"]) <= maximum_ms
        assert params["s3_retry_attempts"] == "1"
        assert params["s3_max_single_read_retries"] == "1"
        return httpx.Response(200, content=b"ok")

    client = ClickHouseClient("http://engine", "u", "p", transport=httpx.MockTransport(handler))
    try:
        await client.query("SELECT 1", timeout_seconds=timeout)
    finally:
        await client.close()


def test_server_profile_allows_sixty_seconds_without_changing_cleanup_budget():
    profile = ElementTree.parse(
        Path(__file__).resolve().parents[2] / "ops/clickhouse/users.d/query-user.xml"
    )
    assert profile.findtext("profiles/hifld_readonly/max_execution_time") == "60"
    assert profile.findtext("profiles/hifld_readonly/constraints/max_execution_time/max") == "60"
    assert profile.findtext("profiles/hifld_control/max_execution_time") == "5"


class ChunkedStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout,server_limit", [(0.25, 1.0), (60, 60.0), (90, 60.0)])
async def test_server_timeout_respects_profile_bounds(timeout, server_limit):
    def handler(request: httpx.Request) -> httpx.Response:
        assert float(request.url.params["max_execution_time"]) == pytest.approx(
            server_limit, abs=0.01
        )
        return httpx.Response(200, content=b"ok")

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    try:
        assert await client.query("SELECT 1", timeout_seconds=timeout) == b"ok"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_query_posts_sql_with_auth_readonly_limits_and_unique_query_ids() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=b"result")

    client = ClickHouseClient(
        "http://clickhouse.test/",
        "reader",
        "secret",
        max_threads=3,
        max_memory_bytes=2048,
        transport=httpx.MockTransport(handler),
    )

    assert await client.query("SELECT 1", timeout_seconds=2.5) == b"result"
    assert await client.query("SELECT 2", timeout_seconds=2.5) == b"result"

    first = requests[0]
    assert first.method == "POST"
    assert first.content == b"SELECT 1"
    assert first.headers["authorization"] == "Basic cmVhZGVyOnNlY3JldA=="
    assert "readonly" not in first.url.params
    assert first.url.params["max_threads"] == "3"
    assert first.url.params["max_memory_usage"] == "2048"
    assert float(first.url.params["max_execution_time"]) == pytest.approx(2.5, abs=0.01)
    assert first.url.params["wait_end_of_query"] == "1"
    assert first.url.params["output_format_json_quote_64bit_integers"] == "0"
    assert first.url.params["output_format_json_named_tuples_as_objects"] == "1"
    assert "session_id" not in first.url.params
    assert first.url.params["query_id"] != requests[1].url.params["query_id"]
    await client.close()


@pytest.mark.asyncio
async def test_query_rejects_invalid_caller_query_id_without_requesting() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200)

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(ClickHouseError, match="query identifier is invalid"):
        await client.query("SELECT 1", timeout_seconds=1, query_id="not-a-uuid")
    assert not called


@pytest.mark.asyncio
async def test_query_bounds_success_response_while_streaming() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=ChunkedStream([b"1234", b"5678"]))

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(ClickHouseError, match="query response exceeded the size limit") as raised:
        await client.query("SELECT 1", timeout_seconds=1, max_response_bytes=7)
    assert raised.value.code == "response_too_large"


@pytest.mark.asyncio
async def test_query_bounds_error_response_and_does_not_leak_server_body() -> None:
    secret = "sensitive query and URL"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, stream=ChunkedStream([secret.encode() * 20]))

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(ClickHouseError) as raised:
        await client.query("SELECT secret", timeout_seconds=1, max_response_bytes=16)
    assert raised.value.code == "response_too_large"
    assert secret not in str(raised.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "code", "message"),
    [
        (b"Code: 159. DB::Exception: Timeout exceeded", "query_timeout", "time limit"),
        (b"Code: 241. DB::Exception: Memory limit exceeded", "query_memory_limit", "memory limit"),
        (b"Code: 47. DB::Exception: Unknown identifier password", "query_schema", "schema"),
        (b"Code: 47. Unknown identifier TOO_MANY_SIMULTANEOUS_QUERIES", "query_schema", "schema"),
    ],
)
async def test_query_maps_known_clickhouse_errors_to_safe_messages(
    body: bytes, code: str, message: str
) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(500, content=body))
    client = ClickHouseClient("http://clickhouse.test", "reader", "secret", transport=transport)
    with pytest.raises(ClickHouseError, match=message) as raised:
        await client.query("SELECT private_column", timeout_seconds=1)
    assert raised.value.code == code
    assert "private_column" not in str(raised.value)
    assert "password" not in str(raised.value)


@pytest.mark.asyncio
async def test_transport_timeout_attempts_synchronous_backend_kill() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.content.startswith(b"KILL QUERY"):
            return httpx.Response(200, content=b"")
        raise httpx.ReadTimeout("timed out", request=request)

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(ClickHouseError, match="time limit") as raised:
        await client.query("SELECT sleep(10)", timeout_seconds=0.1)
    assert raised.value.code == "query_timeout"
    assert len(requests) == 2
    assert requests[1].content.startswith(b"KILL QUERY WHERE query_id = '")
    assert requests[1].content.endswith(b"' SYNC")
    assert "readonly" not in requests[1].url.params


@pytest.mark.asyncio
async def test_task_cancellation_attempts_backend_kill_then_propagates() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.content.startswith(b"KILL QUERY"):
            return httpx.Response(200)
        raise asyncio.CancelledError

    client = ClickHouseClient(
        "http://clickhouse.test", "reader", "secret", transport=httpx.MockTransport(handler)
    )
    with pytest.raises(asyncio.CancelledError):
        await client.query("SELECT sleep(10)", timeout_seconds=1)
    assert len(requests) == 2
    assert requests[1].content.startswith(b"KILL QUERY")


def test_clickhouse_compact_result_validates_recursive_json_values() -> None:
    payload = {
        "meta": [{"name": "id", "type": "UInt64"}, {"name": "shape", "type": "Tuple"}],
        "data": [[1, {"point": [10.0, 20.0], "active": True}]],
        "rows": 1,
        "statistics": {"elapsed": 0.01, "rows_read": 4, "bytes_read": 128},
    }
    result = ClickHouseResult.model_validate_json(json.dumps(payload))
    assert result.data[0][1] == {"point": [10.0, 20.0], "active": True}


def test_clickhouse_compact_result_rejects_non_json_data() -> None:
    with pytest.raises(ValidationError):
        ClickHouseResult.model_validate({"meta": [], "data": [[{"bad": {1, 2}}]], "rows": 1})


@pytest.mark.asyncio
async def test_total_deadline_cancels_trickling_response():
    import asyncio

    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(10):
                await asyncio.sleep(0.01)
                yield b"x"

    statements = []

    async def handler(request):
        statements.append(request.content.decode())
        return (
            httpx.Response(200, stream=SlowStream())
            if len(statements) == 1
            else httpx.Response(200, content=b"")
        )

    client = ClickHouseClient("http://ch", "u", "p", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ClickHouseError, match="query_timeout"):
            await client.query("SELECT 1", timeout_seconds=0.025)
        assert len(statements) == 2
        assert statements[-1].startswith("KILL QUERY")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_admission_refusal_retries_without_killing_rejected_query():
    statements = []

    def handler(request):
        statements.append(request.content.decode())
        if len(statements) == 1:
            return httpx.Response(500, content=b"Code: 202. Too many simultaneous queries")
        return httpx.Response(200, content=b"ok")

    client = ClickHouseClient("http://ch", "u", "p", transport=httpx.MockTransport(handler))
    try:
        assert await client.query("SELECT 1", timeout_seconds=2) == b"ok"
        assert statements == ["SELECT 1", "SELECT 1"]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_busy_queue_has_total_deadline_without_backend_kill():
    statements = []

    def handler(request):
        statements.append(request.content.decode())
        return httpx.Response(500, content=b"Code: 202. Too many simultaneous queries")

    client = ClickHouseClient("http://ch", "u", "p", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ClickHouseError, match="query_timeout"):
            await client.query("SELECT 1", timeout_seconds=0.03)
        assert all(sql == "SELECT 1" for sql in statements)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_replica_routing_pins_cancellation(monkeypatch):
    from query_engine.routing import ReplicaRouter

    async def addresses(self):
        return ("http://10.0.0.1:8123/", "http://10.0.0.2:8123/")

    monkeypatch.setattr(ReplicaRouter, "addresses", addresses)
    requests = []

    def handler(request):
        requests.append(request)
        if request.content.startswith(b"KILL QUERY"):
            return httpx.Response(200)
        if len(requests) == 1:
            return httpx.Response(200, content=b"ok")
        raise httpx.ReadTimeout("timeout", request=request)

    client = ClickHouseClient(
        "http://ch:8123",
        "u",
        "p",
        discover_replicas=True,
        transport=httpx.MockTransport(handler),
    )
    try:
        assert await client.query("SELECT 1", timeout_seconds=1) == b"ok"
        with pytest.raises(ClickHouseError, match="query_timeout"):
            await client.query("SELECT 2", timeout_seconds=1)
        assert requests[0].url.host != requests[1].url.host
        assert requests[1].url.host == requests[2].url.host
    finally:
        await client.close()


def test_query_profile_caps_concurrency_without_limiting_control_user():
    profile = ElementTree.parse(
        Path(__file__).resolve().parents[2] / "ops/clickhouse/users.d/query-user.xml"
    )
    cap = profile.find("profiles/hifld_readonly/max_concurrent_queries_for_user")
    assert cap is not None
    assert cap.attrib == {"from_env": "CLICKHOUSE_MAX_CONCURRENT_QUERIES"}
    dockerfile = Path(__file__).resolve().parents[2] / "ops/clickhouse/Dockerfile"
    assert "ENV CLICKHOUSE_MAX_CONCURRENT_QUERIES=2" in dockerfile.read_text()
    assert (
        profile.find("profiles/hifld_readonly/constraints/max_concurrent_queries_for_user/readonly")
        is not None
    )
    assert profile.find("profiles/hifld_control/max_concurrent_queries_for_user") is None


@pytest.mark.asyncio
async def test_client_pending_capacity_is_bounded_and_released():
    entered = asyncio.Event()
    release = asyncio.Event()

    async def handler(request):
        entered.set()
        await release.wait()
        return httpx.Response(200, content=b"ok")

    client = ClickHouseClient(
        "http://ch", "u", "p", max_pending_queries=1, transport=httpx.MockTransport(handler)
    )
    first = asyncio.create_task(client.query("SELECT 1", timeout_seconds=2))
    try:
        await entered.wait()
        with pytest.raises(ClickHouseError, match="queue is full"):
            await client.query("SELECT 2", timeout_seconds=1)
        release.set()
        assert await first == b"ok"
        assert await client.query("SELECT 3", timeout_seconds=1) == b"ok"
    finally:
        release.set()
        await first
        await client.close()


@pytest.mark.asyncio
async def test_outer_deadline_does_not_interrupt_backend_cleanup():
    finished = asyncio.Event()

    async def handler(request):
        if request.content.startswith(b"KILL QUERY"):
            await asyncio.sleep(0.04)
            finished.set()
            return httpx.Response(200)
        await asyncio.sleep(0.01)
        raise httpx.ReadTimeout("timeout", request=request)

    client = ClickHouseClient("http://ch", "u", "p", transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(ClickHouseError, match="query_timeout"):
            await client.query("SELECT 1", timeout_seconds=0.03)
        assert finished.is_set()
    finally:
        await client.close()
