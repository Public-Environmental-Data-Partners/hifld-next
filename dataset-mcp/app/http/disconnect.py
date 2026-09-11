"""Tie bodyless tile request execution to its HTTP connection lifetime."""

import asyncio

from starlette.types import ASGIApp, Receive, Scope, Send


async def serve_connected_tile(app: ASGIApp, scope: Scope, receive: Receive, send: Send) -> None:
    """Cancel abandoned GET tile work, waiting for worker cleanup before returning.

    Tile GET handlers do not read request bodies. This helper owns their receive
    channel; never apply it to POST handlers or streaming response endpoints.
    """

    async def serve() -> None:
        await app(scope, receive, send)

    async def disconnected() -> None:
        while True:
            if (await receive())["type"] == "http.disconnect":
                return

    request_task = asyncio.create_task(serve())
    disconnect_task = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait(
            (request_task, disconnect_task), return_when=asyncio.FIRST_COMPLETED
        )
        if request_task in done:
            await request_task
        else:
            await disconnect_task
    finally:
        for task in (request_task, disconnect_task):
            if not task.done():
                task.cancel()
        # The worker pool terminates/replaces a cancelled worker. Do not release
        # HTTP capacity while that cleanup is still running.
        await asyncio.gather(request_task, disconnect_task, return_exceptions=True)
