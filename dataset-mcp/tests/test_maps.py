from __future__ import annotations

import pytest
from fastmcp import Client
from pydantic import ValidationError

from app.mcp_server import AppDependencies, UIResourceConfig, create_mcp_server
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

    result = await view_map(
        Service(),
        Catalog(),
        title=spec.title,
        layers=spec.layers,
        basemap=spec.basemap,
        worker_url="https://assets.example/worker.mjs",
    )

    assert result.text.startswith("Prepared map configuration 'Mixed sources'")
    assert "Rendering is pending" in result.text
    assert result.structured_content["worker_url"] == (
        "https://maps.example/assets/maplibre-gl-worker.mjs"
    )
    layers = result.structured_content["layers"]
    assert layers[0]["query_id"] == "roadsquery1234567890ABCD"
    assert layers[0]["result_status"] == "empty_result"
    assert layers[0]["style"] == {"color": "#2166ac"}
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
    assert "Empty layers: Query" in result.text
    assert result.structured_content["map_spec"] == spec.model_dump(mode="json", exclude_none=True)


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
