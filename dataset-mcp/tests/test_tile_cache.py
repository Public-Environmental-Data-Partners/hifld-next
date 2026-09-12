import asyncio

import pytest

from app.query.tile_cache import TileCache, TileCacheCapacityError, TileCacheKey
from query_worker.protocol import WorkerTile


def _key(sql: str = "SELECT geometry FROM roads") -> TileCacheKey:
    return TileCacheKey(
        canonical_sql=sql,
        sources=(("roads", "v1", ("gs://datasets/roads.parquet",), None, None, None, None),),
        geometry_column="geometry",
        result_crs="EPSG:4326",
        z=0,
        x=0,
        y=0,
        feature_cap=20_000,
    )


def _tile(content: bytes) -> WorkerTile:
    return WorkerTile(content=content, elapsed_ms=1, bytes_read=2, files_read=1)


@pytest.mark.asyncio
async def test_cache_returns_successful_tile_until_ttl_expires() -> None:
    now = 100.0

    def clock() -> float:
        return now

    cache = TileCache(max_bytes=10_000, ttl_seconds=10, clock=clock)
    calls = 0

    async def compute() -> WorkerTile:
        nonlocal calls
        calls += 1
        return _tile(b"one")

    assert await cache.get_or_compute(_key(), compute) == _tile(b"one")
    assert await cache.get_or_compute(_key(), compute) == _tile(b"one")
    assert calls == 1

    now += 10
    assert await cache.get_or_compute(_key(), compute) == _tile(b"one")
    assert calls == 2


@pytest.mark.asyncio
async def test_cache_evicts_least_recently_used_tile_to_respect_byte_limit() -> None:
    cache = TileCache(max_bytes=7_000, ttl_seconds=10)
    calls: list[str] = []

    async def compute_one() -> WorkerTile:
        calls.append("one")
        return _tile(b"1" * 6_000)

    async def compute_two() -> WorkerTile:
        calls.append("two")
        return _tile(b"2" * 6_000)

    await cache.get_or_compute(_key("one"), compute_one)
    await cache.get_or_compute(_key("two"), compute_two)
    await cache.get_or_compute(_key("one"), compute_one)

    assert calls == ["one", "two", "one"]


@pytest.mark.asyncio
async def test_cache_charges_key_memory_and_cannot_grow_with_empty_tiles() -> None:
    cache = TileCache(max_bytes=1, ttl_seconds=10)
    calls = 0

    async def compute() -> WorkerTile:
        nonlocal calls
        calls += 1
        return _tile(b"")

    for index in range(100):
        await cache.get_or_compute(_key(f"SELECT {index} FROM roads"), compute)

    assert calls == 100
    assert cache.entry_count == 0
    assert cache.cached_bytes == 0


@pytest.mark.asyncio
async def test_cache_limits_empty_tiles_by_entry_count() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10, max_entries=2)
    calls: list[str] = []

    async def compute_one() -> WorkerTile:
        calls.append("one")
        return _tile(b"")

    async def compute_two() -> WorkerTile:
        calls.append("two")
        return _tile(b"")

    async def compute_three() -> WorkerTile:
        calls.append("three")
        return _tile(b"")

    await cache.get_or_compute(_key("one"), compute_one)
    await cache.get_or_compute(_key("two"), compute_two)
    await cache.get_or_compute(_key("three"), compute_three)
    await cache.get_or_compute(_key("one"), compute_one)

    assert calls == ["one", "two", "three", "one"]


@pytest.mark.asyncio
async def test_cache_does_not_cache_compute_errors() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10)
    calls = 0

    async def compute() -> WorkerTile:
        nonlocal calls
        calls += 1
        raise RuntimeError("worker failed")

    with pytest.raises(RuntimeError, match="worker failed"):
        await cache.get_or_compute(_key(), compute)
    with pytest.raises(RuntimeError, match="worker failed"):
        await cache.get_or_compute(_key(), compute)
    assert calls == 2


@pytest.mark.asyncio
async def test_cache_coalesces_simultaneous_requests_for_the_same_key() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10)
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def compute() -> WorkerTile:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return _tile(b"tile")

    first = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await started.wait()
    second = asyncio.create_task(cache.get_or_compute(_key(), compute))
    release.set()

    assert await first == _tile(b"tile")
    assert await second == _tile(b"tile")
    assert calls == 1


@pytest.mark.asyncio
async def test_cancelling_one_waiter_does_not_cancel_shared_computation() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10)
    started = asyncio.Event()
    release = asyncio.Event()
    cancelled = asyncio.Event()

    async def compute() -> WorkerTile:
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return _tile(b"tile")

    first = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await started.wait()
    second = asyncio.create_task(cache.get_or_compute(_key(), compute))
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()

    assert await second == _tile(b"tile")
    assert not cancelled.is_set()


@pytest.mark.asyncio
async def test_last_waiter_cancellation_cancels_and_cleans_up_shared_computation() -> None:
    cache = TileCache(max_bytes=100, ttl_seconds=10)
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def compute() -> WorkerTile:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        raise AssertionError("unreachable")

    waiter = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await started.wait()
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter

    assert cancelled.is_set()
    assert cache.in_flight_count == 0


@pytest.mark.asyncio
async def test_cache_rejects_new_distinct_work_when_in_flight_capacity_is_full() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10, max_in_flight=1)
    started = asyncio.Event()

    async def compute() -> WorkerTile:
        started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    running = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await started.wait()
    with pytest.raises(TileCacheCapacityError):
        await cache.get_or_compute(_key("other"), compute)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running


@pytest.mark.asyncio
async def test_retiring_computation_keeps_capacity_until_cancellation_cleanup_finishes() -> None:
    cache = TileCache(max_bytes=10_000, ttl_seconds=10, max_in_flight=1)
    started = asyncio.Event()
    cancelled = asyncio.Event()
    cleanup_release = asyncio.Event()
    calls = 0

    async def compute() -> WorkerTile:
        nonlocal calls
        calls += 1
        if calls == 1:
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                await cleanup_release.wait()
                raise
        return _tile(b"fresh")

    first = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await started.wait()
    first.cancel()
    await cancelled.wait()
    first.cancel()
    await asyncio.sleep(0)
    assert not first.done()

    with pytest.raises(TileCacheCapacityError):
        await cache.get_or_compute(_key("other"), compute)
    replacement = asyncio.create_task(cache.get_or_compute(_key(), compute))
    await asyncio.sleep(0)
    assert calls == 1

    cleanup_release.set()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert await replacement == _tile(b"fresh")
    assert calls == 2
