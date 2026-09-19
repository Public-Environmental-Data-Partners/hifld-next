"""Bounded, in-process cache for successful vector tiles."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import monotonic

from query_worker.protocol import WorkerTile

type SourceIdentity = tuple[
    str,
    str,
    tuple[str, ...],
    str | None,
    str | None,
    bool | None,
    str | None,
]


@dataclass(frozen=True, slots=True)
class TileCacheKey:
    """All inputs that can affect an encoded tile, excluding bearer-token entropy."""

    canonical_sql: str
    sources: tuple[SourceIdentity, ...]
    geometry_column: str
    result_crs: str | None
    z: int
    x: int
    y: int
    feature_cap: int


class TileCacheCapacityError(Exception):
    """A distinct computation could not be admitted to the bounded cache."""


@dataclass(frozen=True, slots=True)
class _CacheEntry:
    tile: WorkerTile
    expires_at: float
    byte_size: int


@dataclass(slots=True)
class _InFlight:
    task: asyncio.Task[WorkerTile]
    waiters: int = 0
    retiring: bool = False
    retired: asyncio.Event | None = None


class TileCache:
    """TTL LRU cache that shares only successful tile computations."""

    def __init__(
        self,
        *,
        max_bytes: int = 256 * 1024 * 1024,
        ttl_seconds: float = 60.0,
        max_entries: int = 4_096,
        max_in_flight: int = 64,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if max_bytes < 1:
            raise ValueError("tile cache max_bytes must be positive")
        if ttl_seconds <= 0:
            raise ValueError("tile cache ttl_seconds must be positive")
        if max_entries < 1:
            raise ValueError("tile cache max_entries must be positive")
        if max_in_flight < 1:
            raise ValueError("tile cache max_in_flight must be positive")
        self._max_bytes = max_bytes
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._max_in_flight = max_in_flight
        self._clock = clock
        self._entries: OrderedDict[TileCacheKey, _CacheEntry] = OrderedDict()
        self._in_flight: dict[TileCacheKey, _InFlight] = {}
        self._bytes = 0
        self._lock = asyncio.Lock()

    @property
    def in_flight_count(self) -> int:
        return len(self._in_flight)

    @property
    def entry_count(self) -> int:
        return len(self._entries)

    @property
    def cached_bytes(self) -> int:
        return self._bytes

    async def get_or_compute(
        self,
        key: TileCacheKey,
        compute: Callable[[], Awaitable[WorkerTile]],
    ) -> WorkerTile:
        while True:
            retired: asyncio.Event | None = None
            async with self._lock:
                cached = self._cached(key)
                if cached is not None:
                    return cached
                in_flight = self._in_flight.get(key)
                if in_flight is None:
                    if len(self._in_flight) >= self._max_in_flight:
                        raise TileCacheCapacityError("tile cache computation capacity is exhausted")
                    task = asyncio.create_task(self._compute_and_store(key, compute))
                    in_flight = _InFlight(task=task)
                    self._in_flight[key] = in_flight
                if in_flight.retiring:
                    retired = in_flight.retired
                else:
                    in_flight.waiters += 1
                    break
            if retired is not None:
                await asyncio.shield(retired.wait())

        try:
            return await asyncio.shield(in_flight.task)
        finally:
            await self._release_waiter(key, in_flight)

    def _cached(self, key: TileCacheKey) -> WorkerTile | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.expires_at <= self._clock():
            self._remove_entry(key, entry)
            return None
        self._entries.move_to_end(key)
        return entry.tile

    async def _compute_and_store(
        self,
        key: TileCacheKey,
        compute: Callable[[], Awaitable[WorkerTile]],
    ) -> WorkerTile:
        tile = await compute()
        async with self._lock:
            self._store(key, tile)
        return tile

    async def _release_waiter(self, key: TileCacheKey, in_flight: _InFlight) -> None:
        cleanup_task: asyncio.Task[None] | None = None
        async with self._lock:
            current = self._in_flight.get(key)
            if current is not in_flight:
                return
            in_flight.waiters -= 1
            if in_flight.waiters == 0:
                if in_flight.task.done():
                    del self._in_flight[key]
                else:
                    in_flight.retiring = True
                    in_flight.retired = asyncio.Event()
                    cleanup_task = asyncio.create_task(self._retire(key, in_flight))
        if cleanup_task is not None:
            cancelled = False
            while True:
                try:
                    await asyncio.shield(cleanup_task)
                    break
                except asyncio.CancelledError:
                    # A repeated cancellation must not let the last waiter
                    # return before shared worker cleanup has completed.
                    cancelled = True
            if cancelled:
                raise asyncio.CancelledError

    async def _retire(self, key: TileCacheKey, in_flight: _InFlight) -> None:
        in_flight.task.cancel()
        try:
            await in_flight.task
        except BaseException:
            # A cancelled or failed computation is intentionally never cached.
            pass
        finally:
            async with self._lock:
                if self._in_flight.get(key) is in_flight:
                    del self._in_flight[key]
                retired = in_flight.retired
                if retired is not None:
                    retired.set()

    def _store(self, key: TileCacheKey, tile: WorkerTile) -> None:
        byte_size = self._entry_byte_size(key, tile)
        if byte_size > self._max_bytes:
            return
        previous = self._entries.get(key)
        if previous is not None:
            self._remove_entry(key, previous)
        self._entries[key] = _CacheEntry(
            tile=tile,
            expires_at=self._clock() + self._ttl_seconds,
            byte_size=byte_size,
        )
        self._bytes += byte_size
        while self._bytes > self._max_bytes or len(self._entries) > self._max_entries:
            _, evicted = self._entries.popitem(last=False)
            self._bytes -= evicted.byte_size

    @staticmethod
    def _entry_byte_size(key: TileCacheKey, tile: WorkerTile) -> int:
        """Conservative bound for cache-owned payload, key strings, and entry overhead."""
        source_strings = tuple(
            str(value)
            for source in key.sources
            for value in (*source[:2], *source[2], *source[3:])
            if value is not None
        )
        strings = (
            key.canonical_sql,
            key.geometry_column,
            key.result_crs,
            *source_strings,
        )
        string_bytes = sum(len(value.encode("utf-8")) for value in strings if value is not None)
        return len(tile.content) + string_bytes + 256

    def _remove_entry(self, key: TileCacheKey, entry: _CacheEntry) -> None:
        del self._entries[key]
        self._bytes -= entry.byte_size
