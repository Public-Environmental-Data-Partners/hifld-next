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
        assert float(request.url.params["max_execution_time"]) == server_limit
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
    assert first.url.params["max_execution_time"] == "2.5"
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
