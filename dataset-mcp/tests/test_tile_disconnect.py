import asyncio
from pathlib import Path

import pytest
from starlette.types import Message, Scope

from app.http_app import ConcurrencyLimiter, HttpDependencies, create_http_app
from tests.test_http_app import _dependencies


@pytest.mark.asyncio
async def test_one_tile_query_cannot_exclude_another_query():
    started = asyncio.Event()
    release = asyncio.Event()
    paths = []
    responses = []

    async def receive():
        await asyncio.Event().wait()

    async def send(message):
        responses.append(message)

    async def app(scope, receive, send):
        paths.append(scope["path"])
        if "flood" in scope["path"]:
            started.set()
            await release.wait()

    limiter = ConcurrencyLimiter(app, 1)
    scope = {"type": "http", "method": "GET", "path": "/tiles/flood/1/0/0.mvt"}
    task = asyncio.create_task(limiter(scope, receive, send))
    try:
        await started.wait()
        await limiter({**scope, "path": "/tiles/hospitals/1/0/0.mvt"}, receive, send)
        assert "/tiles/hospitals/1/0/0.mvt" in paths
        await limiter(scope, receive, send)
        assert responses[-2]["status"] == 503
    finally:
        release.set()
        await task


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path", ["/tiles/1/0/0.mvt", "/tiles/id/1/0/0.mvt", "/api/queries/id/tiles/1/0/0.mvt"]
)
async def test_disconnected_tile_cancels_work_before_releasing_capacity(path: str) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()
    cleanup = asyncio.Event()
    messages: asyncio.Queue[Message] = asyncio.Queue()
    await messages.put({"type": "http.request", "body": b"", "more_body": False})
    responses: list[Message] = []

    async def send(message: Message) -> None:
        responses.append(message)

    async def app(scope, receive, send):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
            await cleanup.wait()

    limiter = ConcurrencyLimiter(app, 1)
    scope: Scope = {"type": "http", "method": "GET", "path": path, "headers": []}
    task = asyncio.create_task(limiter(scope, messages.get, send))
    try:
        await asyncio.wait_for(started.wait(), 1)
        await messages.put({"type": "http.disconnect"})
        await asyncio.wait_for(cancelled.wait(), 0.2)
        assert not task.done()
        await limiter(scope, messages.get, send)
        assert responses[0]["status"] == 503
        cleanup.set()
        await asyncio.wait_for(task, 1)
        assert not limiter._tile_semaphore.locked()
    finally:
        cleanup.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_post_body_is_not_consumed_by_disconnect_monitor() -> None:
    received = []

    async def receive():
        return {"type": "http.request", "body": b'{"sql":"SELECT 1"}'}

    async def send(message):
        pass

    async def app(scope, receive, send):
        received.append(await receive())

    await ConcurrencyLimiter(app, 1)(
        {"type": "http", "method": "POST", "path": "/api/queries"}, receive, send
    )
    assert received == [{"type": "http.request", "body": b'{"sql":"SELECT 1"}'}]


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
async def test_completed_tile_stops_disconnect_monitor_and_preserves_errors(fail: bool) -> None:
    monitoring = asyncio.Event()
    stopped = asyncio.Event()

    async def receive():
        monitoring.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    async def send(message):
        pass

    async def app(scope, receive, send):
        await monitoring.wait()
        if fail:
            raise ValueError("tile failed")

    limiter = ConcurrencyLimiter(app, 1)
    operation = limiter(
        {"type": "http", "method": "GET", "path": "/tiles/1/0/0.mvt"}, receive, send
    )
    if fail:
        with pytest.raises(ValueError, match="tile failed"):
            await operation
    else:
        await operation
    assert stopped.is_set()
    assert not limiter._tile_semaphore.locked()


@pytest.mark.asyncio
async def test_outer_cancellation_cleans_up_tile_and_monitor() -> None:
    started = asyncio.Event()
    work_stopped = asyncio.Event()
    monitor_stopped = asyncio.Event()

    async def receive():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            monitor_stopped.set()

    async def send(message):
        pass

    async def app(scope, receive, send):
        try:
            await asyncio.Event().wait()
        finally:
            work_stopped.set()

    limiter = ConcurrencyLimiter(app, 1)
    task = asyncio.create_task(
        limiter({"type": "http", "method": "GET", "path": "/tiles/1/0/0.mvt"}, receive, send)
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert work_stopped.is_set()
    assert monitor_stopped.is_set()
    assert not limiter._tile_semaphore.locked()


@pytest.mark.asyncio
async def test_full_middleware_stack_accepts_disconnected_tile_without_response_error() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()
    messages: asyncio.Queue[Message] = asyncio.Queue()

    class Service:
        def validate_query_identity(self, token, query_id):
            pass

        async def render_tile(self, *args, **kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

    async def send(message):
        pass

    app = create_http_app(
        HttpDependencies(tools=_dependencies(), tile_service=Service()),
        assets_directory=Path(__file__).parents[1] / "ui/dist",
    )
    scope: Scope = {
        "type": "http",
        "method": "GET",
        "path": "/tiles/id/1/0/0.mvt",
        "query_string": b"",
        "headers": [(b"x-hifld-query-token", b"test")],
        "scheme": "http",
        "server": ("localhost", 80),
        "http_version": "1.1",
    }
    await messages.put({"type": "http.request", "body": b"", "more_body": False})
    task = asyncio.create_task(app(scope, messages.get, send))
    try:
        await asyncio.wait_for(started.wait(), 1)
        await messages.put({"type": "http.disconnect"})
        await asyncio.wait_for(task, 1)
        assert cancelled.is_set()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
