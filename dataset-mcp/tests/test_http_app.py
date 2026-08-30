from __future__ import annotations

import asyncio
from collections.abc import Sequence

import httpx
from fastmcp import Client

from app.http_app import create_http_app
from app.mcp_server import (
    AppDependencies,
    UIResourceConfig,
    create_mcp_server,
)
from app.observability import InMemoryMetricSink, InMemoryStructuredLogSink, QueryObservability


class CatalogStub:
    async def list_collections(self) -> dict[str, str]:
        return {"collection": "public"}

    async def get_collection(self, identity: str) -> dict[str, str]:
        return {"id": identity}

    async def search_datasets(
        self, **filters: str | int | list[str] | None
    ) -> dict[str, str | int | list[str] | None]:
        return {"kind": "dataset_page", "limit": filters["limit"]}

    async def get_dataset(self, collection: str, identity: str) -> dict[str, str]:
        return {"collection": collection, "id": identity}

    async def get_dataset_file(
        self, collection: str, dataset: str, identity: str
    ) -> dict[str, str]:
        return {"collection": collection, "dataset": dataset, "id": identity}

    async def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> dict[str, str | None]:
        return {"collection": collection, "dataset": dataset, "id": identity, "version": version}


class QueryStub:
    def validate_sql(self, sql: str, aliases: Sequence[str]) -> None:
        return None

    def validate_token(self, token: str) -> dict[str, str]:
        return {"version": "1"}

    async def read_rows(
        self, source: dict[str, str], columns: Sequence[str], limit: int, offset: int
    ) -> dict[str, int]:
        return {"offset": offset, "limit": limit}

    async def query(
        self,
        sources: Sequence[dict[str, str]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> dict[str, int]:
        return {"limit": limit}

    async def page(self, token: str, offset: int, limit: int) -> dict[str, int]:
        return {"offset": offset, "limit": limit}


class MapStub:
    async def get_map_features(
        self,
        query_token: str,
        bbox: tuple[float, float, float, float],
        zoom: int,
        feature_cap: int,
    ) -> dict[str, int]:
        return {"feature_count": 0}


def _dependencies() -> AppDependencies:
    return AppDependencies(catalog=CatalogStub(), query=QueryStub(), map_features=MapStub())


def test_mcp_tools_link_the_app_resource_and_return_text_and_structured_content() -> None:
    async def assert_protocol() -> None:
        mcp = create_mcp_server(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
            resource_config=UIResourceConfig(
                tile_origin="https://tiles.example.test",
                basemap_origins=("https://basemap.example.test",),
                worker_asset_origin="https://assets.example.test",
            ),
        )
        async with Client(mcp) as client:
            tools = await client.list_tools()
            by_name = {tool.name: tool for tool in tools}
            expected_model_tools = {
                "list_collections",
                "get_collection",
                "search_datasets",
                "get_dataset",
                "get_dataset_file",
                "get_dataset_file_schema",
                "read_geoparquet_rows",
                "query_geoparquet",
                "get_query_page",
            }
            assert expected_model_tools <= set(by_name)
            for name in expected_model_tools:
                assert by_name[name].description
                assert by_name[name].meta is not None
                assert by_name[name].meta["ui"] == {
                    "resourceUri": "ui://hifld/dataset-explorer.html",
                    "visibility": ["model", "app"],
                }
            assert by_name["get_map_features"].meta is not None
            assert by_name["get_map_features"].meta["ui"] == {
                "resourceUri": "ui://hifld/dataset-explorer.html",
                "visibility": ["app"],
            }

            result = await client.call_tool("search_datasets", {"collection": "public", "limit": 5})
            assert result.structured_content == {"kind": "dataset_page", "limit": 5}
            assert result.content[0].text.startswith("Datasets:")

            resources = await client.list_resources()
            assert resources[0].mimeType == "text/html;profile=mcp-app"
            assert resources[0].meta is not None
            assert resources[0].meta["ui"]["csp"] == {
                "connectDomains": ["https://tiles.example.test", "https://basemap.example.test"],
                "resourceDomains": ["https://assets.example.test"],
            }

    asyncio.run(assert_protocol())


def test_http_routes_share_lifespan_and_bound_concurrency() -> None:
    async def assert_routes() -> None:
        app = create_http_app(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
            max_concurrency=1,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                health = await client.get("/healthz")
                assert health.status_code == 200
                assert health.json() == {"status": "ok"}
                assert (await client.get("/assets/missing.js")).status_code == 404
                assert (await client.get("/tiles/0/0/0.mvt")).status_code == 404
                assert (await client.get("/mcp/")).status_code in {200, 405}

    asyncio.run(assert_routes())


def test_observability_logs_only_allowlisted_fields() -> None:
    metrics = InMemoryMetricSink()
    logs = InMemoryStructuredLogSink()
    observer = QueryObservability(metrics=metrics, logs=logs)

    observer.record_query(
        stage="policy",
        duration_ms=12.5,
        query_hash="b" * 64,
        source_ids=("source-1",),
        source_versions=("v1",),
        token_version=1,
        limit=100,
        offset=0,
        error_code="sql_rejected",
        sql="SELECT name FROM roads WHERE name = 'should-not-appear'",
        token="signed.secret.token",
        row_value="row-secret",
        geometry="POINT (1 2)",
        credential="password",
    )

    assert metrics.events[0].name == "dataset_mcp_policy_duration_ms"
    serialized = logs.events[0].as_json()
    assert "b" * 64 in serialized
    forbidden_values = (
        "SELECT",
        "should-not-appear",
        "signed.secret",
        "row-secret",
        "POINT",
        "password",
    )
    for forbidden in forbidden_values:
        assert forbidden not in serialized
