import asyncio

import httpx
import pytest
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from app.catalog.client import CatalogClient, CatalogClientError, catalog_request_scope
from app.catalog.models import StacCatalog
from app.http_app import CatalogRequestScope


def root(name: str) -> dict[str, object]:
    return {
        "type": "Catalog",
        "stac_version": "1.1.0",
        "id": "root",
        "description": "root",
        "links": [{"rel": "child", "href": "public/catalog.json", "title": name}],
    }


def collection(name: str) -> dict[str, object]:
    return {
        "type": "Catalog",
        "stac_version": "1.1.0",
        "id": "public",
        "title": name,
        "description": "Published collection",
        "links": [],
    }


@pytest.mark.asyncio
async def test_catalog_reuses_stac_reads_only_within_one_request(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="uvicorn.error.catalog")
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        payload = (
            root("root title")
            if request.url.path == "/api/collections"
            else collection(str(calls // 2))
        )
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        catalog = CatalogClient("http://catalog.test", http)
        with catalog_request_scope():
            first = await catalog.resolve_collection("public")
            first.name = "modified by caller"
            second = await catalog.resolve_collection("public")
            assert second.name == "1"
            assert calls == 2
        with catalog_request_scope():
            assert (await catalog.resolve_collection("public")).name == "2"
        await catalog.resolve_collection("public")
        assert calls == 6
    assert "cache_hit=true" in caplog.text
    assert "elapsed_ms=" in caplog.text
    assert "catalog.test" not in caplog.text


@pytest.mark.asyncio
async def test_catalog_cache_does_not_cross_client_boundaries() -> None:
    async with (
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json=root("root title")
                    if request.url.path == "/api/collections"
                    else collection("One"),
                )
            )
        ) as first,
        httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json=root("root title")
                    if request.url.path == "/api/collections"
                    else collection("Two"),
                )
            )
        ) as second,
    ):
        with catalog_request_scope():
            assert (
                await CatalogClient("http://catalog.test", first).resolve_collection("public")
            ).name == "One"
            assert (
                await CatalogClient("http://catalog.test", second).resolve_collection("public")
            ).name == "Two"


@pytest.mark.asyncio
async def test_concurrent_http_requests_have_separate_catalog_scopes() -> None:
    calls = 0
    child_calls = 0

    async def catalog_handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls, child_calls
        calls += 1
        if request.url.path == "/api/collections":
            payload = root("root title")
        else:
            child_calls += 1
            payload = collection(str(child_calls))
        await asyncio.sleep(0)
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(catalog_handler)) as catalog_http:
        catalog = CatalogClient("http://catalog.test", catalog_http)

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            first = await catalog.resolve_collection("public")
            second = await catalog.resolve_collection("public")
            assert first.name == second.name
            await JSONResponse({"name": second.name})(scope, receive, send)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=CatalogRequestScope(app)), base_url="http://app.test"
        ) as http:
            results = await asyncio.gather(http.get("/"), http.get("/"))
            assert {result.json()["name"] for result in results} == {"1", "2"}
            assert calls == 4


@pytest.mark.asyncio
async def test_request_cache_is_bounded_and_does_not_store_failed_reads() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503 if calls == 1 else 200, json=root("Public"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        catalog = CatalogClient("http://catalog.test", http)
        with catalog_request_scope():
            with pytest.raises(CatalogClientError):
                await catalog._get_model("/api/collections", StacCatalog)
            for index in range(33):
                await catalog._get_model(f"/api/collections/{index}", StacCatalog)
            assert calls == 34
            await catalog._get_model("/api/collections/0", StacCatalog)
            assert calls == 34
            await catalog._get_model("/api/collections/32", StacCatalog)
            assert calls == 35
