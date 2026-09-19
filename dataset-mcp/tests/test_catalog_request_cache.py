import asyncio

import httpx
import pytest
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.catalog import client as client_module
from app.catalog.client import CatalogClient, CatalogClientError, catalog_request_scope
from app.http_app import CatalogRequestScope


@pytest.mark.asyncio
async def test_catalog_reuses_reads_only_within_one_request(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="uvicorn.error.catalog")
    scope = getattr(client_module, "catalog_request_scope", None)
    assert scope is not None
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"id": 1, "slug": "public", "name": str(calls)})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        catalog = CatalogClient("http://catalog.test", http)
        with scope():
            first = await catalog.resolve_collection(1)
            first.name = "modified by caller"
            second = await catalog.resolve_collection(1)
            assert second.name == "1"
            assert calls == 1
        with scope():
            assert (await catalog.resolve_collection(1)).name == "2"
        await catalog.resolve_collection(1)
        assert calls == 3
    assert "cache_hit=true" in caplog.text
    assert "elapsed_ms=" in caplog.text
    assert "catalog.test" not in caplog.text


@pytest.mark.asyncio
async def test_catalog_cache_does_not_cross_client_boundaries() -> None:
    scope = getattr(client_module, "catalog_request_scope", None)
    assert scope is not None
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"id": 1, "slug": "one", "name": "One"})
            )
        ) as first,
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json={"id": 1, "slug": "two", "name": "Two"})
            )
        ) as second,
    ):
        with scope():
            assert (
                await CatalogClient("http://catalog.test", first).resolve_collection(1)
            ).slug == "one"
            assert (
                await CatalogClient("http://catalog.test", second).resolve_collection(1)
            ).slug == "two"


@pytest.mark.asyncio
async def test_concurrent_http_requests_have_separate_catalog_scopes() -> None:
    calls = 0

    async def catalog_handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        name = str(calls)
        await asyncio.sleep(0)
        return httpx.Response(200, json={"id": 1, "slug": "public", "name": name})

    async with httpx.AsyncClient(transport=httpx.MockTransport(catalog_handler)) as catalog_http:
        catalog = CatalogClient("http://catalog.test", catalog_http)

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            first = await catalog.resolve_collection(1)
            second = await catalog.resolve_collection(1)
            assert first.name == second.name
            await JSONResponse({"name": second.name})(scope, receive, send)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=CatalogRequestScope(app)), base_url="http://app.test"
        ) as http:
            results = await asyncio.gather(http.get("/"), http.get("/"))
            assert {result.json()["name"] for result in results} == {"1", "2"}
            assert calls == 2


@pytest.mark.asyncio
async def test_request_cache_is_bounded_and_does_not_store_failed_reads() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"id": 1, "slug": "public", "name": "Public"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        catalog = CatalogClient("http://catalog.test", http)
        with catalog_request_scope():
            with pytest.raises(CatalogClientError):
                await catalog.resolve_collection(1)
            for collection in range(1, 34):
                await catalog.resolve_collection(collection)
            assert calls == 34
            await catalog.resolve_collection(1)
            assert calls == 34
            await catalog.resolve_collection(33)
            assert calls == 35
