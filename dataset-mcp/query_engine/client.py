"""Bounded asynchronous HTTP client for read-only ClickHouse queries."""

import asyncio
import logging
import re
from time import monotonic
from uuid import UUID, uuid4

import httpx

from query_engine.routing import ReplicaRouter

_DEFAULT_RESPONSE_LIMIT = 8 * 1024 * 1024
_ERROR_BODY_LIMIT = 64 * 1024
_LOGGER = logging.getLogger(__name__)


class ClickHouseError(RuntimeError):
    """Stable error safe to expose outside the query service."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class ClickHouseClient:
    """Execute concurrent ClickHouse queries with per-request resource limits."""

    def __init__(
        self,
        url: str,
        username: str,
        password: str,
        *,
        max_threads: int = 2,
        max_memory_bytes: int = 1_073_741_824,
        control_username: str | None = None,
        control_password: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        discover_replicas: bool = False,
        max_pending_queries: int = 64,
    ) -> None:
        if max_threads < 1:
            raise ValueError("max_threads must be positive")
        if max_memory_bytes < 1:
            raise ValueError("max_memory_bytes must be positive")
        if max_pending_queries < 1:
            raise ValueError("max_pending_queries must be positive")
        self._router = ReplicaRouter(url, discover_replicas)
        self._max_pending = max_pending_queries
        self._pending = 0
        self._client = httpx.AsyncClient(
            base_url=url.rstrip("/") + "/",
            auth=httpx.BasicAuth(username, password),
            transport=transport,
            headers={"Accept-Encoding": "identity"},
            trust_env=False,
        )
        self._max_threads = max_threads
        self._max_memory_bytes = max_memory_bytes
        self._control = httpx.AsyncClient(
            base_url=url.rstrip("/") + "/",
            auth=httpx.BasicAuth(control_username or username, control_password or password),
            transport=transport,
            headers={"Accept-Encoding": "identity"},
            trust_env=False,
        )

    async def query(
        self,
        sql: str,
        *,
        timeout_seconds: float,
        max_response_bytes: int = _DEFAULT_RESPONSE_LIMIT,
        query_id: str | None = None,
    ) -> bytes:
        """Run one query and return a response that never exceeds the byte budget."""
        if timeout_seconds <= 0:
            raise ClickHouseError("query_limits_invalid", "query time limit must be positive")
        if max_response_bytes < 1:
            raise ClickHouseError("query_limits_invalid", "query response limit must be positive")
        if query_id is not None:
            try:
                UUID(query_id)
            except ValueError as exc:
                raise ClickHouseError("query_id_invalid", "query identifier is invalid") from exc

        if self._pending >= self._max_pending:
            raise ClickHouseError("worker_unavailable", "query queue is full; retry shortly")
        self._pending += 1
        deadline = monotonic() + timeout_seconds
        delay = 0.1
        try:
            async with asyncio.timeout(timeout_seconds):
                while True:
                    endpoint = await self._router.select()
                    try:
                        return await self._attempt(
                            sql, endpoint, deadline - monotonic(), max_response_bytes
                        )
                    except ClickHouseError as error:
                        if error.code != "query_busy":
                            raise
                    # Only retry explicit admission refusals, never an ambiguous
                    # transport failure or a query that has started executing.
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 1.0)
        except TimeoutError as exc:
            raise ClickHouseError("query_timeout", "query exceeded its time limit") from exc
        except OSError as exc:
            raise ClickHouseError("clickhouse_unavailable", "query service is unavailable") from exc
        finally:
            self._pending -= 1

    async def _attempt(
        self, sql: str, endpoint: str, timeout_seconds: float, max_response_bytes: int
    ) -> bytes:
        internal_query_id = str(uuid4())
        # Storage reads must not retain an admission slot for repeated 30-second
        # socket timeouts after the enclosing request has already been cancelled.
        read_timeout_ms = max(1, min(5000, int(timeout_seconds * 1000)))
        params = {
            "query_id": internal_query_id,
            "max_threads": str(self._max_threads),
            "max_memory_usage": str(self._max_memory_bytes),
            "max_execution_time": str(min(60.0, max(1.0, timeout_seconds))),
            "wait_end_of_query": "1",
            "output_format_json_quote_64bit_integers": "0",
            "output_format_json_named_tuples_as_objects": "1",
            "s3_request_timeout_ms": str(read_timeout_ms),
            "s3_connect_timeout_ms": str(min(1000, read_timeout_ms)),
            "s3_retry_attempts": "1",
            "s3_max_single_read_retries": "1",
        }
        request = self._client.build_request(
            "POST",
            endpoint,
            params=params,
            content=sql.encode(),
            timeout=httpx.Timeout(timeout_seconds),
        )
        response: httpx.Response | None = None
        try:
            async with asyncio.timeout(timeout_seconds):
                response = await self._client.send(request, stream=True)
                body = await self._read_bounded(response, max_response_bytes)
                response_is_error = response.is_error
        except asyncio.CancelledError:
            await self._finish_cancellation(internal_query_id, endpoint)
            raise
        except (TimeoutError, httpx.TimeoutException) as exc:
            await self._finish_cancellation(internal_query_id, endpoint)
            raise ClickHouseError("query_timeout", "query exceeded its time limit") from exc
        except httpx.HTTPError as exc:
            await self._finish_cancellation(internal_query_id, endpoint)
            raise ClickHouseError("clickhouse_unavailable", "query service is unavailable") from exc
        except ClickHouseError:
            await self._finish_cancellation(internal_query_id, endpoint)
            raise
        finally:
            if response is not None:
                await response.aclose()

        if response_is_error:
            raise _server_error(body)
        return body

    async def close(self) -> None:
        """Close the underlying connection pool."""
        await self._client.aclose()
        await self._control.aclose()

    async def _read_bounded(self, response: httpx.Response, limit: int) -> bytes:
        if response.headers.get("Content-Encoding", "identity") != "identity":
            raise ClickHouseError("query_failed", "Unexpected compressed query response")
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ClickHouseError(
                    "response_too_large", "query response exceeded the size limit"
                )
            chunks.append(chunk)
        return b"".join(chunks)

    async def _finish_cancellation(self, query_id: str, endpoint: str) -> None:
        # Cleanup owns its five-second budget, even when the outer request
        # deadline expires during an HTTP-timeout cleanup or cancellation repeats.
        cleanup = asyncio.create_task(self._kill_query(query_id, endpoint))
        interrupted = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                interrupted = True
        cleanup.result()
        if interrupted:
            raise asyncio.CancelledError

    async def _kill_query(self, query_id: str, endpoint: str) -> None:
        request = self._control.build_request(
            "POST",
            endpoint,
            params={"wait_end_of_query": "1"},
            content=f"KILL QUERY WHERE query_id = '{query_id}' SYNC".encode(),
            timeout=httpx.Timeout(5.0),
        )
        response: httpx.Response | None = None
        try:
            async with asyncio.timeout(5):
                response = await self._control.send(request, stream=True)
                await self._read_bounded(response, _ERROR_BODY_LIMIT)
            if response.is_error:
                _LOGGER.warning(
                    "ClickHouse query cancellation was rejected; configure cancellation credentials"
                )
        except (TimeoutError, httpx.HTTPError, ClickHouseError):
            _LOGGER.warning(
                "ClickHouse query cancellation failed; "
                "the query may continue until its server limit",
            )
        finally:
            if response is not None:
                await response.aclose()


def _server_error(body: bytes) -> ClickHouseError:
    text = body.decode("utf-8", errors="replace").lower()
    if re.match(r"\s*code:\s*202\.", text):
        return ClickHouseError("query_busy", "query service is busy")
    if "code: 159" in text or "timeout_exceeded" in text or "timeout exceeded" in text:
        return ClickHouseError("query_timeout", "query exceeded its time limit")
    if "code: 241" in text or "memory_limit_exceeded" in text or "memory limit" in text:
        return ClickHouseError("query_memory_limit", "query exceeded its memory limit")
    schema_markers = (
        "code: 47",
        "code: 53",
        "code: 60",
        "unknown identifier",
        "unknown table",
        "type_mismatch",
    )
    if any(marker in text for marker in schema_markers):
        return ClickHouseError("query_schema", "query does not match the available schema")
    return ClickHouseError("query_failed", "query execution failed")
