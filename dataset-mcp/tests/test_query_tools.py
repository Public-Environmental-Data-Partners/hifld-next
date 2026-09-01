import pytest
from pydantic import ValidationError

from app.tools.query import (
    MapCameraInput,
    MapDefinitionInput,
    MapLayerStyleInput,
    MapQueryLayerInput,
    get_query_page,
    query_geoparquet,
    refresh_query_map,
    view_query_map,
)


class Service:
    validated = False
    paged = False

    def validate_sql(self, sql: str, aliases: tuple[str, ...]) -> None:
        self.validated = True

    async def query(
        self,
        sources: list[dict[str, object]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> dict[str, object]:
        assert self.validated
        alias = str(sources[0]["alias"])
        return {
            "columns": [
                {"name": "geometry", "type": "GEOMETRY", "nullable": False},
                {"name": "name", "type": "VARCHAR", "nullable": True},
                {"name": "traffic", "type": "INTEGER", "nullable": True},
            ],
            "rows": [],
            "query_token": f"signed-{alias}",
            "resolved_sources": [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ],
        }

    def validate_token(self, token: str) -> dict[str, object]:
        if token == "signed":
            return {}
        assert token in {"signed-roads", "signed-bridges"}
        return {
            "token_version": 1,
            "expires_at": "2026-09-01T18:00:00+00:00",
        }

    async def page(self, token: str, offset: int, limit: int) -> dict[str, object]:
        self.paged = True
        return {
            "rows": [],
            "offset": offset,
            "resolved_sources": [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ],
        }

    async def map_configuration(self, token: str) -> dict[str, object]:
        alias = token.removeprefix("signed-")
        query_id = {
            "roads": "roadsquery1234567890ABCD",
            "bridges": "bridgesquery123456789AB",
        }[alias]
        return {
            "query_token": token,
            "query_id": query_id,
            "map_configuration": {
                "tile_url": f"https://maps.example/tiles/{query_id}/{{z}}/{{x}}/{{y}}.mvt",
                "worker_url": "https://maps.example/assets/maplibre-gl-worker.mjs",
                "source_layer": "hifld",
                "geometry_column": "geometry",
                "result_crs": "EPSG:4326",
                "query_token": "signed-roads",
                "expires_at": "2026-09-01T18:00:00+00:00",
                "initial_bounds": [-80.0, 35.0, -75.0, 40.0],
            },
        }


@pytest.mark.asyncio
async def test_query_returns_initial_page_and_later_page_revalidates() -> None:
    service = Service()
    result = await query_geoparquet(service, [{"alias": "roads"}], "SELECT * FROM roads")
    assert result.structured_content["query_token"] == "signed-roads"
    assert "resolved_sources" not in result.structured_content
    assert "secret-bucket" not in str(result.structured_content)
    assert '"query_token":"signed-roads"' in result.text
    assert "secret-bucket" not in result.text
    page = await get_query_page(service, "signed", 100)
    assert page.structured_content["offset"] == 100
    assert "resolved_sources" not in page.structured_content
    assert "secret-bucket" not in str(page.structured_content)
    assert '"offset":100' in page.text
    assert "secret-bucket" not in page.text
    assert service.paged


@pytest.mark.asyncio
async def test_view_query_map_returns_only_the_map_contract() -> None:
    result = await view_query_map(
        Service(),
        title="Transportation comparison",
        basemap="satellite",
        layers=(
            MapQueryLayerInput(
                layer_name="Roads",
                sources=[{"alias": "roads"}],
                sql="SELECT geometry, name FROM roads",
                result_crs="EPSG:4326",
                style=MapLayerStyleInput(
                    color="#2166ac",
                    color_property="traffic",
                    color_scheme="viridis",
                    breaks=[100, 500],
                    point_radius_property="traffic",
                    point_radius_scale="sqrt",
                    line_width_property="traffic",
                    line_width_scale="log",
                ),
            ),
            MapQueryLayerInput(
                layer_name="Bridges",
                sources=[{"alias": "bridges"}],
                sql="SELECT geometry, name FROM bridges",
                result_crs="EPSG:4326",
                visible=False,
            ),
        ),
        camera=MapCameraInput(center=(-77.04, 38.9), zoom=10),
    )

    assert result.structured_content == {
        "title": "Transportation comparison",
        "basemap": "satellite",
        "worker_url": "https://maps.example/assets/maplibre-gl-worker.mjs",
        "camera": {"center": [-77.04, 38.9], "zoom": 10.0},
        "layers": [
            {
                "query_id": "roadsquery1234567890ABCD",
                "layer_name": "Roads",
                "tile_url": ("https://maps.example/tiles/roadsquery1234567890ABCD/{z}/{x}/{y}.mvt"),
                "source_layer": "hifld",
                "geometry_column": "geometry",
                "result_crs": "EPSG:4326",
                "query_token": "signed-roads",
                "expires_at": "2026-09-01T18:00:00+00:00",
                "initial_bounds": [-80.0, 35.0, -75.0, 40.0],
                "columns": [
                    {"name": "geometry", "type": "GEOMETRY", "nullable": False},
                    {"name": "name", "type": "VARCHAR", "nullable": True},
                    {"name": "traffic", "type": "INTEGER", "nullable": True},
                ],
                "style": {
                    "color": "#2166ac",
                    "color_property": "traffic",
                    "color_scheme": "viridis",
                    "breaks": [100.0, 500.0],
                    "point_radius_property": "traffic",
                    "point_radius_scale": "sqrt",
                    "line_width_property": "traffic",
                    "line_width_scale": "log",
                },
                "visible": True,
            },
            {
                "query_id": "bridgesquery123456789AB",
                "layer_name": "Bridges",
                "tile_url": ("https://maps.example/tiles/bridgesquery123456789AB/{z}/{x}/{y}.mvt"),
                "source_layer": "hifld",
                "geometry_column": "geometry",
                "result_crs": "EPSG:4326",
                "query_token": "signed-bridges",
                "expires_at": "2026-09-01T18:00:00+00:00",
                "initial_bounds": [-80.0, 35.0, -75.0, 40.0],
                "columns": [
                    {"name": "geometry", "type": "GEOMETRY", "nullable": False},
                    {"name": "name", "type": "VARCHAR", "nullable": True},
                    {"name": "traffic", "type": "INTEGER", "nullable": True},
                ],
                "visible": False,
            },
        ],
        "map_spec": {
            "title": "Transportation comparison",
            "basemap": "satellite",
            "camera": {"center": [-77.04, 38.9], "zoom": 10.0},
            "layers": [
                {
                    "layer_name": "Roads",
                    "sources": [{"alias": "roads"}],
                    "sql": "SELECT geometry, name FROM roads",
                    "result_crs": "EPSG:4326",
                    "color": "#2166ac",
                    "color_property": "traffic",
                    "color_scheme": "viridis",
                    "breaks": [100.0, 500.0],
                    "point_radius_property": "traffic",
                    "point_radius_scale": "sqrt",
                    "line_width_property": "traffic",
                    "line_width_scale": "log",
                    "visible": True,
                },
                {
                    "layer_name": "Bridges",
                    "sources": [{"alias": "bridges"}],
                    "sql": "SELECT geometry, name FROM bridges",
                    "result_crs": "EPSG:4326",
                    "visible": False,
                },
            ],
        },
    }
    assert result.meta is None
    assert result.text == ("Opened map 'Transportation comparison' with 2 layers: Roads, Bridges.")
    assert "signed" not in result.text
    assert result.structured_content["layers"][0]["query_token"] == "signed-roads"


@pytest.mark.asyncio
async def test_refresh_query_map_replays_the_durable_map_definition() -> None:
    result = await refresh_query_map(
        Service(),
        MapDefinitionInput(
            title="Roads",
            basemap="street",
            layers=[
                MapQueryLayerInput(
                    layer_name="Roads",
                    sources=[{"alias": "roads"}],
                    sql="SELECT geometry, name FROM roads",
                )
            ],
        ),
    )

    assert result.structured_content["layers"][0]["query_token"] == "signed-roads"
    assert result.structured_content["layers"][0]["expires_at"] == ("2026-09-01T18:00:00+00:00")
    assert result.structured_content["map_spec"] == {
        "title": "Roads",
        "basemap": "street",
        "layers": [
            {
                "layer_name": "Roads",
                "sources": [{"alias": "roads"}],
                "sql": "SELECT geometry, name FROM roads",
                "visible": True,
            }
        ],
    }


@pytest.mark.asyncio
async def test_view_query_map_rejects_duplicate_layer_names() -> None:
    layers = (
        MapQueryLayerInput(
            layer_name="Roads", sources=[{"alias": "roads"}], sql="SELECT * FROM roads"
        ),
        MapQueryLayerInput(
            layer_name=" roads ",
            sources=[{"alias": "bridges"}],
            sql="SELECT * FROM bridges",
        ),
    )

    with pytest.raises(ValueError, match="unique"):
        await view_query_map(Service(), title="Comparison", layers=layers)


@pytest.mark.asyncio
async def test_view_query_map_rejects_a_style_property_missing_from_query_result() -> None:
    layer = MapQueryLayerInput(
        layer_name="Roads",
        sources=[{"alias": "roads"}],
        sql="SELECT geometry, name FROM roads",
        style=MapLayerStyleInput(color_property="missing"),
    )

    with pytest.raises(ValueError, match="missing.*query result"):
        await view_query_map(Service(), title="Roads", layers=(layer,))


def test_map_camera_rejects_conflicting_or_invalid_targets() -> None:
    with pytest.raises(ValidationError, match="bounds or center"):
        MapCameraInput(bounds=(-80, 35, -75, 40), center=(-77, 38))
    with pytest.raises(ValidationError, match="increasing coordinates"):
        MapCameraInput(bounds=(-75, 40, -80, 35))
    with pytest.raises(ValidationError, match="zoom requires center"):
        MapCameraInput(zoom=10)
