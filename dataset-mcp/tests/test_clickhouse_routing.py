import asyncio
import socket

import pytest

from query_engine.routing import ReplicaRouter


@pytest.mark.asyncio
async def test_discovery_deduplicates_caches_and_refreshes(monkeypatch):
    import query_engine.routing as routing

    now = 1.0
    calls = 0

    async def resolve(host, port, *, type):
        nonlocal calls
        calls += 1
        assert host == "replicas" and port == 8123
        assert type == socket.SOCK_STREAM
        return [
            (socket.AF_INET, type, 6, "", ("10.0.0.1", port)),
            (socket.AF_INET, type, 6, "", ("10.0.0.1", port)),
            (socket.AF_INET6, type, 6, "", ("::1", port, 0, 0)),
        ]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
    monkeypatch.setattr(routing, "monotonic", lambda: now)
    router = ReplicaRouter("http://replicas:8123", True)
    assert await router.addresses() == ("http://10.0.0.1:8123/", "http://[::1]:8123/")
    assert await router.select() != await router.select()
    assert calls == 1
    now = 7.0
    await router.addresses()
    assert calls == 2


@pytest.mark.asyncio
async def test_empty_dns_does_not_fall_back_to_load_balanced_service(monkeypatch):
    async def resolve(*args, **kwargs):
        return []

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
    with pytest.raises(OSError, match="no ready replicas"):
        await ReplicaRouter("http://replicas", True).select()


@pytest.mark.parametrize("url", ["https://replicas", "http://replicas/proxy"])
def test_discovery_rejects_non_internal_origin(url):
    with pytest.raises(ValueError, match="internal HTTP"):
        ReplicaRouter(url, True)


@pytest.mark.asyncio
async def test_external_mode_preserves_endpoint():
    assert await ReplicaRouter("https://external:8443/proxy", False).select() == (
        "https://external:8443/proxy/"
    )
