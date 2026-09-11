from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from pathlib import Path

import httpx
import pytest
from fastmcp import Client

import app.mcp_server as mcp_server_module
from app.catalog.client import CatalogClientError
from app.http_app import HttpDependencies, create_http_app
from app.mcp_server import (
    AppDependencies,
    UIResourceConfig,
    _error_result,
    create_mcp_server,
)
from app.observability import InMemoryMetricSink, InMemoryStructuredLogSink, QueryObservability
from query_worker.protocol import WorkerTile


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

    def validate_token(self, token: str) -> dict[str, str | int]:
        return {"token_version": 1, "expires_at": "2026-09-01T18:00:00+00:00"}

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
    ) -> dict[str, int | str | list[dict[str, str | bool]]]:
        alias = str(sources[0]["alias"])
        return {
            "limit": limit,
            "query_id": "capitolsquery123456789AB",
            "query_token": f"signed-{alias}",
            "columns": [
                {"name": "geometry", "type": "GEOMETRY", "nullable": False},
                {"name": "name", "type": "VARCHAR", "nullable": True},
            ],
        }

    async def page(self, token: str, offset: int, limit: int) -> dict[str, int]:
        return {"offset": offset, "limit": limit}

    async def map_configuration(self, token: str) -> dict[str, object]:
        query_id = "capitolsquery123456789AB"
        return {
            "query_token": token,
            "query_id": query_id,
            "map_configuration": {
                "tile_url": (f"https://tiles.example.test/tiles/{query_id}/{{z}}/{{x}}/{{y}}.mvt"),
                "worker_url": "https://assets.example.test/maplibre-gl-worker.mjs",
                "source_layer": "hifld",
                "geometry_column": "geometry",
                "result_crs": "EPSG:4326",
            },
        }


def _dependencies() -> AppDependencies:
    return AppDependencies(catalog=CatalogStub(), query=QueryStub())


def test_http_dependencies_default_to_thirty_second_tile_timeout() -> None:
    dependencies = HttpDependencies(tools=_dependencies())

    assert dependencies.tile_timeout_seconds == 30


@pytest.mark.parametrize("stringify", [False, True])
def test_map_argument_diagnostics_correlate_http_and_validation_without_values(
    stringify: bool,
    caplog: pytest.LogCaptureFixture,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATASET_MCP_BUILD_REVISION", "test-revision")
    caplog.set_level(logging.INFO, logger="uvicorn.error.argument_diagnostics")

    async def assert_diagnostics() -> None:
        app = create_http_app(_dependencies(), ui_html="<html/>", assets_directory=tmp_path)
        layers = [
            {
                "layer_name": "private-layer-name",
                "sources": [{"alias": "roads"}],
                "sql": "SELECT geometry FROM private_table",
            }
        ]
        camera = {"center": [-74, 40], "zoom": 10}
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
            ) as client:
                response = await client.post(
                    "/mcp/",
                    headers={
                        "Accept": "application/json, text/event-stream",
                        "Authorization": "Bearer private-credential",
                        "X-Request-ID": "untrusted-client-id",
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {
                            "name": "view_query_map",
                            "arguments": {
                                "title": "private-title",
                                "layers": json.dumps(layers) if stringify else layers,
                                "camera": json.dumps(camera) if stringify else camera,
                            },
                        },
                    },
                )
        assert response.status_code == 200
        assert '"isError":true' not in response.text
        events = [
            json.loads(record.message)
            for record in caplog.records
            if record.name == "uvicorn.error.argument_diagnostics"
        ]
        assert [event["stage"] for event in events] == ["http_ingress", "tool_dispatch"]
        assert events[0]["request_id"] == events[1]["request_id"]
        assert len(events[0]["request_id"]) == 32
        for event in events:
            assert event["layers_type"] == ("string" if stringify else "array")
            assert event["camera_type"] == ("string" if stringify else "object")
            assert event["revision"] == "test-revision"
            assert event["tool"] == "view_query_map"
        diagnostic_text = json.dumps(events)
        for secret in ["private", "SELECT", "Bearer", "untrusted-client-id", "-74"]:
            assert secret not in diagnostic_text

    asyncio.run(assert_diagnostics())


@pytest.mark.parametrize(
    "layers, camera",
    [
        ("not-json", None),
        ("{}", None),
        ('"[]"', None),
        ("[]", None),
        ("[{}]", None),
        ("[{}]", '{"center":[1000,40],"zoom":11}'),
    ],
)
def test_map_json_compatibility_does_not_bypass_validation(layers, camera) -> None:
    async def check() -> None:
        mcp = create_mcp_server(_dependencies(), ui_html="<html/>")
        async with Client(mcp) as client:
            result = await client.call_tool(
                "view_query_map",
                {
                    "title": "Invalid map",
                    "layers": layers,
                    "camera": camera,
                },
                raise_on_error=False,
            )
        assert result.is_error

    asyncio.run(check())


def test_query_parquet_and_tile_url_are_callable_without_opening_ui() -> None:
    async def check() -> None:
        mcp = create_mcp_server(_dependencies(), ui_html="<html/>")
        async with Client(mcp) as client:
            sources = [{"alias": "roads"}]
            query_result = await client.call_tool(
                "query_parquet",
                {
                    "sources": sources,
                    "sql": "SELECT geometry FROM roads",
                },
            )
            assert not query_result.is_error
            tile_result = await client.call_tool(
                "generate_mvt_tile_url",
                {
                    "sources": sources,
                    "sql": "SELECT geometry FROM roads",
                },
            )
            assert not tile_result.is_error
            assert "tile_url" in tile_result.structured_content
            tools = {tool.name: tool for tool in await client.list_tools()}
            assert tools["view_query_map"].inputSchema["properties"]["layers"]["type"] == "array"
            assert "ui" not in (tools["generate_mvt_tile_url"].meta or {})

    asyncio.run(check())


def test_only_view_query_map_opens_the_app_resource() -> None:
    async def assert_protocol() -> None:
        mcp = create_mcp_server(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
            resource_config=UIResourceConfig(
                tile_origin="https://tiles.example.test",
                worker_asset_origin="https://assets.example.test",
            ),
        )
        async with Client(mcp) as client:
            tools = await client.list_tools()
            by_name = {tool.name: tool for tool in tools}
            expected_model_tools = {
                "inspect_query_source",
                "list_collections",
                "get_collection",
                "search_datasets",
                "get_dataset",
                "get_dataset_file",
                "get_dataset_file_schema",
                "read_geoparquet_rows",
                "query_parquet",
                "generate_mvt_tile_url",
                "get_query_page",
                "view_query_map",
                "refresh_query_map",
                "view_map",
                "refresh_map",
            }
            assert set(by_name) == expected_model_tools
            for name in expected_model_tools:
                assert by_name[name].description
            map_guidance = by_name["view_map"].description or ""
            assert "Prefer published PMTiles" in map_guidance
            assert "Choose independently for each layer" in map_guidance
            assert "simplified" in map_guidance
            assert "joins" in map_guidance
            for name in ("view_map", "view_query_map"):
                guidance = by_name[name].description or ""
                assert "does not confirm" in guidance
                assert "map_status" in guidance
                assert "Do not change SQL" in guidance
            assert "view_map" in (by_name["view_query_map"].description or "")
            discovery_guidance = by_name["get_dataset_file"].description or ""
            assert "map_sources" in discovery_guidance
            assert "query_sources" in discovery_guidance
            assert "prebuilt" in (by_name["generate_mvt_tile_url"].description or "")
            for name in ("query_parquet", "view_map", "view_query_map", "generate_mvt_tile_url"):
                assert "inspect_query_source" in (by_name[name].description or "")
                assert "scalar bbox" in (by_name[name].description or "")
            assert by_name["view_query_map"].meta is not None
            assert by_name["view_query_map"].meta["ui"] == {
                "resourceUri": "ui://hifld/dataset-explorer.html",
                "visibility": ["model"],
            }
            assert by_name["refresh_query_map"].meta is not None
            assert by_name["refresh_query_map"].meta["ui"] == {
                "resourceUri": "ui://hifld/dataset-explorer.html",
                "visibility": ["app"],
            }
            for name in {
                "list_collections",
                "get_collection",
                "search_datasets",
                "get_dataset",
                "get_dataset_file",
                "get_dataset_file_schema",
                "read_geoparquet_rows",
                "query_parquet",
                "generate_mvt_tile_url",
                "get_query_page",
            }:
                assert by_name[name].meta is None or "ui" not in by_name[name].meta
            result = await client.call_tool("search_datasets", {"collection": "public", "limit": 5})
            assert result.structured_content == {"kind": "dataset_page", "limit": 5}
            assert result.content[0].text.startswith("Datasets:")

            map_result = await client.call_tool(
                "view_query_map",
                {
                    "title": "State capitols",
                    "layers": [
                        {
                            "layer_name": "Capitols",
                            "sources": [{"alias": "capitols"}],
                            "sql": "SELECT geometry, name FROM capitols",
                            "result_crs": "EPSG:4326",
                            "color": "#2166ac",
                            "color_property": "name",
                            "color_scheme": "plasma",
                            "opacity": 0.7,
                            "point_radius": 8,
                            "line_width": 3,
                        }
                    ],
                    "basemap": "satellite",
                    "camera": {
                        "center": [-77.04, 38.9],
                        "zoom": 11,
                        "bearing": 15,
                        "pitch": 30,
                        "padding": 32,
                    },
                },
            )
            assert map_result.structured_content is not None
            assert map_result.structured_content["basemap"] == "satellite"
            assert map_result.structured_content["title"] == "State capitols"
            assert map_result.structured_content["layers"][0]["layer_name"] == "Capitols"
            assert map_result.structured_content["layers"][0]["query_token"] == "signed-capitols"
            assert map_result.structured_content["layers"][0]["style"] == {
                "color": "#2166ac",
                "color_property": "name",
                "color_scheme": "plasma",
                "opacity": 0.7,
                "point_radius": 8.0,
                "line_width": 3.0,
            }
            assert map_result.structured_content["camera"] == {
                "center": [-77.04, 38.9],
                "zoom": 11.0,
                "bearing": 15.0,
                "pitch": 30.0,
                "padding": 32.0,
            }
            assert map_result.meta is None
            assert "signed" not in map_result.content[0].text

            refreshed = await client.call_tool(
                "refresh_query_map",
                {"map_spec": map_result.structured_content["map_spec"]},
            )
            assert refreshed.structured_content is not None
            assert (
                refreshed.structured_content["map_spec"]
                == (map_result.structured_content["map_spec"])
            )
            assert refreshed.structured_content["layers"][0]["expires_at"] == (
                "2026-09-01T18:00:00+00:00"
            )

            resources = await client.list_resources()
            assert resources[0].mimeType == "text/html;profile=mcp-app"
            assert resources[0].meta is not None
            assert resources[0].meta["ui"]["csp"] == {
                "connectDomains": [
                    "https://tiles.example.test",
                    "https://assets.example.test",
                    "https://tiles.openfreemap.org",
                    "https://services.arcgisonline.com",
                    "https:",
                ],
                "resourceDomains": [
                    "https://assets.example.test",
                    "https://tiles.openfreemap.org",
                    "https://services.arcgisonline.com",
                    "blob:",
                ],
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
                assert (await client.get("/mcp")).status_code == 405

    asyncio.run(assert_routes())


def test_mcp_transport_rejects_hostile_origins_and_invalid_hosts() -> None:
    async def assert_guard() -> None:
        app = create_http_app(
            HttpDependencies(
                tools=_dependencies(),
                mcp_allowed_hosts=("trusted.example.test",),
                mcp_allowed_origins=("https://trusted.example.test",),
            ),
            ui_html="<html><body>dataset explorer</body></html>",
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="https://trusted.example.test",
            ) as client:
                hostile_origin = await client.post(
                    "/mcp",
                    headers={"Origin": "https://evil.example.test"},
                )
                invalid_host = await client.post(
                    "/mcp",
                    headers={"Host": "evil.example.test"},
                )

        assert hostile_origin.status_code == 403
        assert invalid_host.status_code == 421

    asyncio.run(assert_guard())


def test_mcp_transport_uses_the_advertised_canonical_path_without_redirect() -> None:
    async def assert_canonical_path() -> None:
        app = create_http_app(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://test",
                follow_redirects=False,
            ) as client:
                canonical = await client.get("/mcp")
                slash_variant = await client.get("/mcp/")

        assert canonical.status_code == 405
        assert canonical.headers.get("location") is None
        assert slash_variant.status_code == 405
        assert slash_variant.headers.get("location") is None

    asyncio.run(assert_canonical_path())


def test_health_and_assets_bypass_expensive_request_concurrency(
    tmp_path: Path,
) -> None:
    async def assert_bypass() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        class BlockingQueryStub(QueryStub):
            async def query(
                self,
                sources: Sequence[dict[str, str]],
                sql: str,
                limit: int,
                geometry_column: str | None,
                result_crs: str | None,
            ) -> dict[str, int | str | list[dict[str, str | bool]]]:
                entered.set()
                await release.wait()
                return await super().query(
                    sources,
                    sql,
                    limit,
                    geometry_column,
                    result_crs,
                )

        (tmp_path / "ready.js").write_text("export {};", encoding="utf-8")
        query = BlockingQueryStub()
        app = create_http_app(
            HttpDependencies(
                tools=AppDependencies(catalog=CatalogStub(), query=query),
                query_service=query,
            ),
            ui_html="<html><body>dataset explorer</body></html>",
            assets_directory=tmp_path,
            max_concurrency=1,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                expensive_request = asyncio.create_task(
                    client.post(
                        "/api/queries",
                        json={
                            "sources": [
                                {
                                    "alias": "roads",
                                    "collection_id": 1,
                                    "dataset_id": 2,
                                    "file_id": 3,
                                    "file_source_id": 4,
                                }
                            ],
                            "sql": "SELECT id FROM roads",
                        },
                    )
                )
                await asyncio.wait_for(entered.wait(), timeout=1)
                health = await asyncio.wait_for(client.get("/healthz"), timeout=0.25)
                asset = await asyncio.wait_for(client.get("/assets/ready.js"), timeout=0.25)
                release.set()
                query_response = await expensive_request

        assert health.status_code == 200
        assert asset.status_code == 200
        assert query_response.status_code == 200

    asyncio.run(assert_bypass())


def test_saturated_tile_admission_does_not_block_mcp() -> None:
    async def assert_isolation() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        class BlockingTileService:
            def validate_query_identity(self, token: str, query_id: str) -> None:
                del token, query_id

            async def render_tile(
                self,
                token: str,
                z: int,
                x: int,
                y: int,
                *,
                timeout_seconds: float,
            ) -> WorkerTile:
                del token, z, x, y, timeout_seconds
                entered.set()
                await release.wait()
                return WorkerTile(b"mvt", 1.0, 0, 0)

        app = create_http_app(
            HttpDependencies(tools=_dependencies(), tile_service=BlockingTileService()),
            ui_html="<html><body>dataset explorer</body></html>",
            max_concurrency=1,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                tile_request = asyncio.create_task(
                    client.get(
                        "/tiles/0/0/0.mvt",
                        headers={"X-HIFLD-Query-Token": "signed-token"},
                    )
                )
                await asyncio.wait_for(entered.wait(), timeout=1)
                mcp_response = await asyncio.wait_for(client.get("/mcp"), timeout=0.25)
                release.set()
                tile_response = await tile_request

        assert mcp_response.status_code == 405
        assert tile_response.status_code == 200

    asyncio.run(assert_isolation())


def test_saturated_admission_returns_cors_overload_and_releases_slot() -> None:
    async def assert_overload() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        class BlockingTileService:
            def validate_query_identity(self, token: str, query_id: str) -> None:
                del token, query_id

            async def render_tile(
                self,
                token: str,
                z: int,
                x: int,
                y: int,
                *,
                timeout_seconds: float,
            ) -> WorkerTile:
                del token, z, x, y, timeout_seconds
                entered.set()
                await release.wait()
                return WorkerTile(b"mvt", 1.0, 0, 0)

        app = create_http_app(
            HttpDependencies(tools=_dependencies(), tile_service=BlockingTileService()),
            ui_html="<html><body>dataset explorer</body></html>",
            max_concurrency=1,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                first_request = asyncio.create_task(
                    client.get(
                        "/tiles/0/0/0.mvt",
                        headers={"X-HIFLD-Query-Token": "signed-token"},
                    )
                )
                await asyncio.wait_for(entered.wait(), timeout=1)
                overloaded = await asyncio.wait_for(
                    client.get(
                        "/tiles/0/0/1.mvt",
                        headers={"X-HIFLD-Query-Token": "signed-token"},
                    ),
                    timeout=0.25,
                )
                release.set()
                first_response = await first_request
                admitted_after_release = await client.get(
                    "/tiles/0/0/0.mvt",
                    headers={"X-HIFLD-Query-Token": "signed-token"},
                )

        assert overloaded.status_code == 503
        assert overloaded.json() == {
            "code": "server_overloaded",
            "message": "The server is handling too many expensive requests.",
        }
        assert overloaded.headers["access-control-allow-origin"] == "*"
        assert overloaded.headers["cache-control"] == "no-store"
        assert overloaded.headers["retry-after"] == "1"
        assert first_response.status_code == 200
        assert admitted_after_release.status_code == 200

    asyncio.run(assert_overload())


def test_saturated_query_resource_tile_admission_does_not_block_mcp() -> None:
    async def assert_isolation() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        class BlockingQueryTileService(QueryStub):
            def validate_query_identity(self, token: str, query_id: str) -> None:
                del token, query_id

            async def render_tile(
                self,
                token: str,
                z: int,
                x: int,
                y: int,
                *,
                timeout_seconds: float,
            ) -> WorkerTile:
                del token, z, x, y, timeout_seconds
                entered.set()
                await release.wait()
                return WorkerTile(b"mvt", 1.0, 0, 0)

        query = BlockingQueryTileService()
        app = create_http_app(
            HttpDependencies(
                tools=AppDependencies(catalog=CatalogStub(), query=query),
                query_service=query,
            ),
            ui_html="<html><body>dataset explorer</body></html>",
            max_concurrency=1,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                tile_request = asyncio.create_task(
                    client.get(
                        "/api/queries/query123/tiles/0/0/0.mvt",
                        headers={"X-HIFLD-Query-Token": "signed-token"},
                    )
                )
                await asyncio.wait_for(entered.wait(), timeout=1)
                mcp_response = await asyncio.wait_for(client.get("/mcp"), timeout=0.25)
                release.set()
                tile_response = await tile_request

        assert mcp_response.status_code == 405
        assert tile_response.status_code == 200

    asyncio.run(assert_isolation())


def test_http_app_wires_query_resources_to_the_shared_query_service() -> None:
    async def assert_query_route() -> None:
        query = QueryStub()
        app = create_http_app(
            HttpDependencies(
                tools=AppDependencies(catalog=CatalogStub(), query=query),
                query_service=query,
                webapp_origins=("https://webapp.example.test",),
            ),
            ui_html="<html><body>dataset explorer</body></html>",
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/queries",
                    json={
                        "sources": [
                            {
                                "alias": "roads",
                                "collection_id": 1,
                                "dataset_id": 2,
                                "file_id": 3,
                                "file_source_id": 4,
                            }
                        ],
                        "sql": "SELECT id FROM roads",
                    },
                )

        assert response.status_code == 200
        assert response.json() == {
            "limit": 100,
            "query_id": "capitolsquery123456789AB",
            "query_token": "signed-roads",
            "columns": [
                {"name": "geometry", "type": "GEOMETRY", "nullable": False},
                {"name": "name", "type": "VARCHAR", "nullable": True},
            ],
        }

    asyncio.run(assert_query_route())


@pytest.mark.parametrize("extension", ["mjs", "cjs"])
def test_worker_asset_allows_cross_origin_loading(tmp_path: Path, extension: str) -> None:
    async def assert_asset_headers() -> None:
        (tmp_path / f"maplibre-gl-worker.{extension}").write_text("/* worker */", encoding="utf-8")
        app = create_http_app(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
            assets_directory=tmp_path,
        )
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    f"/assets/maplibre-gl-worker.{extension}",
                    headers={"Origin": "https://sandbox.example.test"},
                )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"
        assert response.headers["cross-origin-resource-policy"] == "cross-origin"
        assert "javascript" in response.headers["content-type"]

    asyncio.run(assert_asset_headers())


def test_missing_built_ui_is_a_startup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp_server_module, "__file__", str(tmp_path / "app" / "mcp_server.py"))

    with pytest.raises(FileNotFoundError):
        mcp_server_module.default_ui_html()


def test_missing_built_assets_are_a_startup_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        create_http_app(
            _dependencies(),
            ui_html="<html><body>dataset explorer</body></html>",
            assets_directory=tmp_path / "missing-assets",
        )


@pytest.mark.parametrize(
    ("error_code", "expected_code", "expected_message"),
    [
        (
            "catalog_unavailable",
            "catalog_unavailable",
            "The catalog request could not be completed",
        ),
        (
            "catalog_contract_invalid",
            "catalog_contract_invalid",
            "The catalog response did not match its contract",
        ),
        (
            "future_catalog_code",
            "internal_error",
            "The request could not be completed",
        ),
    ],
)
def test_catalog_error_result_preserves_known_codes_and_fails_closed(
    error_code: str, expected_code: str, expected_message: str
) -> None:
    result = _error_result(CatalogClientError(error_code, "internal detail"))

    assert result.structured_content == {
        "error": {"code": expected_code, "message": expected_message}
    }


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
