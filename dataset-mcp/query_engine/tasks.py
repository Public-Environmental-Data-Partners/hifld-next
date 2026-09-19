"""Concurrent request work must finish cleanup before its owner returns."""

import asyncio
from collections.abc import Awaitable


async def gather_owned[T](*work: Awaitable[T]) -> list[T]:
    tasks = [asyncio.ensure_future(item) for item in work]
    try:
        return list(await asyncio.gather(*tasks))
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
