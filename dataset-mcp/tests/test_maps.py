from __future__ import annotations

import json
import logging

import pytest
from fastmcp import Client
from pydantic import ValidationError

from app.errors import AppError, ErrorCode
from app.mcp_server import AppDependencies, UIResourceConfig, create_mcp_server
from app.tools import maps
from app.tools.maps import (
    CatalogMapSourceInput,
    MapDefinitionInput,
    MapLayerInput,
    PmtilesMapSourceInput,
    QueryMapSourceInput,
    TileJSONMapSourceInput,
    VectorTilesMapSourceInput,
    refresh_map,
    view_map,
)
from tests.test_query_tools import Service


class Catalog:
    async def resolve_map_source(
        self, collection_id: int, dataset_id: int, file_id: int, file_source_id: int
    ) -> dict[str, str]:
        assert (collection_id, dataset_id, file_id, file_source_id) == (3, 12, 99, 44)
        return {"type": "pmtiles", "url": "https://cdn.example/roads.pmtiles"}


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["view", "refresh", "prepare"])
@pytest.mark.parametrize("failed", [False, True])
async def test_map_duration_logs_allowlisted_outcome_only(caplog, operation, failed) -> None:
    class InstrumentedService(Service):
        def validate_sql(self, sql, aliases):
            if failed:
                raise ValueError(
                    "sensitive-query signed-secret gs://private-bucket/private.parquet"
                )
            super().validate_sql(sql, aliases)

    layer = MapLayerInput(
        layer_name="sensitive-layer",
        source=QueryMapSourceInput(
            inputs=[{"alias": "roads", "private": "signed-secret"}],
            sql="SELECT * FROM roads -- sensitive-query",
        ),
    )
    spec = MapDefinitionInput(title="sensitive-title", layers=[layer])
    service = InstrumentedService()
    caplog.set_level(logging.INFO, logger="uvicorn.error.maps")

    async def invoke():
        if operation == "prepare":
            return await maps.prepare_map_layer(service, layer)
        if operation == "refresh":
            return await refresh_map(
                service, Catalog(), spec, worker_url="https://assets.example/worker.mjs"
            )
        return await view_map(
            service,
            Catalog(),
            title=spec.title,
            layers=spec.layers,
            worker_url="https://assets.example/worker.mjs",
        )

    if failed:
        with pytest.raises(ValueError):
            await invoke()
    else:
        await invoke()
    records = [record for record in caplog.records if record.name == "uvicorn.error.maps"]
    assert len(records) == 1
    event = json.loads(records[0].getMessage())
    duration = event.pop("duration_ms")
    assert isinstance(duration, (int, float)) and duration >= 0
    assert event == {
        "event": "map_preparation",
        "stage": "query_layer" if operation == "prepare" else "configuration",
        "outcome": "failed" if failed else "ready",
    }
    assert records[0].exc_info is None
    assert "sensitive" not in caplog.text
    assert "signed-secret" not in caplog.text
    assert "private-bucket" not in caplog.text


@pytest.mark.asyncio
async def test_view_map_combines_query_catalog_and_explicit_sources() -> None:
    spec = MapDefinitionInput(
        title="Mixed sources",
        layers=[
            MapLayerInput(
                layer_name="Query",
                source=QueryMapSourceInput(
                    inputs=[{"alias": "roads"}], sql="SELECT geometry, name FROM roads"
                ),
                color="#2166ac",
            ),
            MapLayerInput(
                layer_name="Catalog",
                source=CatalogMapSourceInput(
                    collection_id=3, dataset_id=12, file_id=99, file_source_id=44
                ),
                visible=False,
            ),
            MapLayerInput(
                layer_name="PMTiles",
                source=PmtilesMapSourceInput(
                    url="https://cdn.example/data.pmtiles", source_layer="roads"
                ),
            ),
            MapLayerInput(
                layer_name="TileJSON",
                source=TileJSONMapSourceInput(url="https://tiles.example/metadata.json"),
            ),
            MapLayerInput(
                layer_name="Vector",
                source=VectorTilesMapSourceInput(
                    tiles=["https://tiles.example/{z}/{x}/{y}.mvt"], source_layer="roads"
                ),
            ),
        ],
    )

    class PreviewService(Service):
        async def query(self, *args, **kwargs):
            result = await super().query(*args, **kwargs)
            result["rows"] = [
                {"name": "Main Street", "geometry": {"$type": "geometry", "omitted": True}}
            ]
            result["result_status"] = "rows_returned"
            return result

    result = await view_map(
        PreviewService(),
        Catalog(),
        title=spec.title,
        layers=spec.layers,
        basemap=spec.basemap,
        worker_url="https://assets.example/worker.mjs",
    )

    assert result.text.startswith("Prepared map configuration 'Mixed sources'")
    assert "Rendering is pending" in result.text
    assert result.structured_content["worker_url"] == "https://assets.example/worker.mjs"
    layers = result.structured_content["layers"]
    assert layers[0]["query_id"] == "roadsquery1234567890ABCD"
    assert "preparation_status" not in layers[0]
    assert layers[0]["preview"]["rows"][0]["name"] == "Main Street"
    assert "Main Street" in result.text
    assert "secret-bucket" not in str(result)
    assert layers[1] == {
        "layer_id": "external-1",
        "layer_name": "Catalog",
        "source": {"type": "pmtiles", "url": "https://cdn.example/roads.pmtiles"},
        "visible": False,
    }
    assert layers[2]["source"] == {
        "type": "pmtiles",
        "url": "https://cdn.example/data.pmtiles",
        "source_layer": "roads",
    }
    assert layers[3]["source"] == {
        "type": "tilejson",
        "url": "https://tiles.example/metadata.json",
    }
    assert layers[4]["source"] == {
        "type": "vector_tiles",
        "tiles": ["https://tiles.example/{z}/{x}/{y}.mvt"],
        "source_layer": "roads",
    }
    assert "query_id" not in layers[1]
    assert "Empty layers:" not in result.text
    assert result.structured_content["map_spec"] == spec.model_dump(mode="json", exclude_none=True)


@pytest.mark.asyncio
async def test_prepare_map_layer_returns_validated_runtime_without_source_secrets() -> None:
    prepare = getattr(maps, "prepare_map_layer", None)
    assert prepare is not None
    result = await prepare(
        Service(),
        MapLayerInput(
            layer_name="Roads",
            source=QueryMapSourceInput(inputs=[{"alias": "roads"}], sql="SELECT * FROM roads"),
            visible=False,
            color="#2166ac",
        ),
    )
    runtime = result.structured_content["layer"]
    assert runtime["query_id"] == "roadsquery1234567890ABCD"
    assert runtime["result_status"] == "empty_result"
    assert runtime["visible"] is False
    assert runtime["style"] == {"color": "#2166ac"}
    assert result.structured_content["worker_url"].startswith("https://maps.example/")
    assert "secret-bucket" not in str(result)


@pytest.mark.asyncio
async def test_prepare_map_layer_rejects_invalid_sql_before_preview() -> None:
    class RejectingService(Service):
        def validate_sql(self, sql, aliases):
            raise ValueError("SQL policy rejected")

        async def query(self, *args, **kwargs):
            pytest.fail("invalid SQL must never execute")

    prepare = getattr(maps, "prepare_map_layer", None)
    assert prepare is not None
    with pytest.raises(ValueError, match="SQL policy rejected"):
        await prepare(
            RejectingService(),
            MapLayerInput(
                layer_name="Roads",
                source=QueryMapSourceInput(inputs=[{"alias": "roads"}], sql="DELETE FROM roads"),
            ),
        )


@pytest.mark.asyncio
async def test_refresh_query_map_returns_prepared_query_with_empty_preview() -> None:
    result = await refresh_map(
        Service(),
        Catalog(),
        MapDefinitionInput(
            title="Roads",
            layers=[
                MapLayerInput(
                    layer_name="Roads",
                    source=QueryMapSourceInput(
                        inputs=[{"alias": "roads"}], sql="SELECT * FROM roads"
                    ),
                )
            ],
        ),
        worker_url="https://assets.example/worker.mjs",
    )
    assert result.structured_content["layers"][0]["preview"]["rows"] == []
    assert "Empty layers: Roads" in result.text


@pytest.mark.asyncio
async def test_view_map_returns_query_error_instead_of_map() -> None:
    class FailingService(Service):
        async def query(self, *args, **kwargs):
            raise AppError(ErrorCode.QUERY_EXECUTION_FAILED, "Unsupported JOIN ON expression")

    server = create_mcp_server(
        AppDependencies(catalog=Catalog(), query=FailingService()),
        ui_html="<html></html>",
        resource_config=UIResourceConfig(tile_origin="https://maps.example"),
    )
    async with Client(server) as client:
        result = await client.call_tool(
            "view_map",
            {
                "title": "NYC",
                "layers": [
                    {
                        "layer_name": "Hospitals",
                        "source": {
                            "type": "query",
                            "inputs": [{"alias": "roads"}],
                            "sql": "SELECT * FROM roads",
                        },
                    }
                ],
            },
            raise_on_error=False,
        )
        descriptions = {tool.name: tool.description for tool in await client.list_tools()}
    assert result.is_error
    assert "Unsupported JOIN ON expression" in str(result.content)
    assert "Hospitals" in str(result.content)
    assert "map_spec" not in result.structured_content
    assert "query_parquet" in descriptions["view_map"]
    assert "preview" in descriptions["view_map"]


@pytest.mark.asyncio
async def test_view_map_rejects_sql_policy_before_returning_placeholders() -> None:
    class RejectingService(Service):
        def validate_sql(self, sql, aliases):
            raise ValueError("SQL policy rejected")

    with pytest.raises(ValueError, match="SQL policy rejected"):
        await view_map(
            RejectingService(),
            Catalog(),
            title="Roads",
            layers=[
                MapLayerInput(
                    layer_name="Roads",
                    source=QueryMapSourceInput(
                        inputs=[{"alias": "roads"}], sql="DELETE FROM roads"
                    ),
                )
            ],
            worker_url="https://assets.example/worker.mjs",
        )


@pytest.mark.asyncio
async def test_registered_prepare_map_layer_sanitizes_preparation_failure() -> None:
    class FailingService(Service):
        async def query(self, *args, **kwargs):
            raise RuntimeError("gs://secret-bucket/private.parquet")

    server = create_mcp_server(
        AppDependencies(catalog=Catalog(), query=FailingService()), ui_html="<html></html>"
    )
    async with Client(server) as client:
        result = await client.call_tool(
            "prepare_map_layer",
            {
                "layer": {
                    "layer_name": "Roads",
                    "source": {
                        "type": "query",
                        "inputs": [{"alias": "roads"}],
                        "sql": "SELECT * FROM roads",
                    },
                }
            },
            raise_on_error=False,
        )
    assert result.is_error
    assert result.structured_content == {
        "error": {"code": "internal_error", "message": "request could not be completed"}
    }
    assert "secret-bucket" not in str(result)


@pytest.mark.asyncio
async def test_external_only_map_uses_configured_worker_url_and_refreshes() -> None:
    spec = MapDefinitionInput(
        title="External",
        layers=[
            MapLayerInput(
                layer_name="Roads",
                source=PmtilesMapSourceInput(url="https://cdn.example/roads.pmtiles"),
            )
        ],
    )
    result = await refresh_map(
        Service(), Catalog(), spec, worker_url="https://assets.example/worker.mjs"
    )
    assert result.structured_content["worker_url"] == "https://assets.example/worker.mjs"
    assert result.text.startswith("Prepared map configuration 'External' with 1 layer: Roads.")
    assert "Rendering is pending" in result.text


@pytest.mark.asyncio
async def test_external_map_allows_trusted_local_http_worker_url() -> None:
    result = await refresh_map(
        Service(),
        Catalog(),
        MapDefinitionInput(
            title="Local development",
            layers=[
                MapLayerInput(
                    layer_name="Roads",
                    source=PmtilesMapSourceInput(url="https://cdn.example/roads.pmtiles"),
                )
            ],
        ),
        worker_url="http://localhost:8000/assets/maplibre-gl-worker.mjs",
    )
    assert result.structured_content["worker_url"] == (
        "http://localhost:8000/assets/maplibre-gl-worker.mjs"
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/data.pmtiles",
        "https://user:secret@example.com/data.pmtiles",
        "https://localhost/data.pmtiles",
        "https://host.local/data.pmtiles",
        "https://host.internal/data.pmtiles",
        "https://intranet/data.pmtiles",
        "https://127.0.0.1/data.pmtiles",
        "https://10.0.0.1/data.pmtiles",
        "https://2130706433/data.pmtiles",
        "https://0x7f000001/data.pmtiles",
        "https://0177.0.0.1/data.pmtiles",
        "https://example.com/data.pmtiles#fragment",
    ],
)
def test_external_sources_reject_non_public_https_urls(url: str) -> None:
    with pytest.raises(ValidationError):
        PmtilesMapSourceInput(url=url)


def test_external_source_accepts_trailing_dot_and_global_ipv6() -> None:
    assert PmtilesMapSourceInput(url="https://tiles.example./data.pmtiles").url.endswith(".pmtiles")
    assert PmtilesMapSourceInput(url="https://[2606:4700:4700::1111]/data.pmtiles").url.startswith(
        "https://["
    )


def test_vector_tiles_require_source_layer_and_xyz_https_templates() -> None:
    with pytest.raises(ValidationError):
        VectorTilesMapSourceInput(  # pyright: ignore[reportCallIssue]
            tiles=["https://tiles.example/{z}/{x}/{y}.mvt"]
        )
    with pytest.raises(ValidationError, match="XYZ"):
        VectorTilesMapSourceInput(tiles=["https://tiles.example/tiles.mvt"], source_layer="roads")


@pytest.mark.asyncio
async def test_registered_external_only_map_uses_classic_worker_bundle() -> None:
    server = create_mcp_server(
        AppDependencies(catalog=Catalog(), query=Service()),
        ui_html="<html></html>",
        resource_config=UIResourceConfig(
            tile_origin="https://maps.example",
            worker_asset_origin="https://assets.example",
        ),
    )
    async with Client(server) as client:
        result = await client.call_tool(
            "view_map",
            {
                "title": "External",
                "layers": [
                    {
                        "layer_name": "Roads",
                        "source": {
                            "type": "pmtiles",
                            "url": "https://cdn.example/roads.pmtiles",
                        },
                    }
                ],
            },
        )

    assert result.structured_content is not None
    assert result.structured_content["worker_url"] == (
        "https://assets.example/assets/maplibre-gl-worker.cjs"
    )
