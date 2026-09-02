from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.http.tiles import create_tile_router
from query_worker.protocol import WorkerFailure, WorkerTile, WorkerTileQuery
from query_worker.tiles import (
    MAX_TILE_BYTES,
    build_tile_sql,
    execute_tile,
    validate_tile_coordinates,
)

NOW = datetime.now(UTC)


def tile_request(**changes: int | str | None) -> WorkerTileQuery:
    values: dict[str, int | str | None] = {
        "z": 4,
        "x": 3,
        "y": 6,
        "geometry_column": "geometry",
        "result_crs": "EPSG:4326",
        "feature_cap": 20_000,
    }
    values.update(changes)
    return WorkerTileQuery(
        canonical_sql="SELECT * FROM roads",
        sources=(),
        z=int(values["z"]),
        x=int(values["x"]),
        y=int(values["y"]),
        geometry_column=str(values["geometry_column"]),
        result_crs=None if values["result_crs"] is None else str(values["result_crs"]),
        feature_cap=int(values["feature_cap"]),
        deadline=NOW + timedelta(seconds=10),
    )


@pytest.mark.parametrize(
    ("z", "x", "y"),
    [(-1, 0, 0), (23, 0, 0), (2, -1, 0), (2, 0, -1), (2, 4, 0), (2, 0, 4)],
)
def test_tile_coordinate_validation_matches_spike(z: int, x: int, y: int) -> None:
    assert not validate_tile_coordinates(z, x, y)


def test_tile_sql_preserves_bbox_order_and_exact_clipping_shape() -> None:
    sql = build_tile_sql(
        "SELECT geometry, bbox, name, details FROM roads",
        tile_request(),
        columns=(
            ("geometry", "GEOMETRY"),
            ("bbox", "STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)"),
            ("name", "VARCHAR"),
            ("details", "STRUCT(code VARCHAR)"),
        ),
    )

    assert "ST_TileEnvelope(4, 3, 6)" in sql
    assert "ST_Transform(env, 'EPSG:3857', 'EPSG:4326', always_xy := true)" in sql
    assert (
        '"bbox".xmax >= b.xmin AND "bbox".xmin <= b.xmax\n'
        '      AND "bbox".ymax >= b.ymin AND "bbox".ymin <= b.ymax'
    ) in sql
    assert 'ST_Intersects("geometry", b.env)' in sql
    assert "ST_AsMVTGeom(" in sql
    assert "ST_Transform(source_geometry, 'EPSG:4326', 'EPSG:3857', always_xy := true)" in sql
    assert "ST_AsMVT(f, 'hifld', 4096, 'geom', '_mcp_feature_id')" in sql
    assert "FROM (SELECT geometry, bbox, name, details FROM roads) AS _mcp_result" in sql
    assert 'SELECT "name",' in sql
    assert (
        '"geometry",'
        not in sql.split("candidate_features AS", maxsplit=1)[1].split(
            "AS source_geometry", maxsplit=1
        )[0]
    )
    assert (
        '"bbox",'
        not in sql.split("candidate_features AS", maxsplit=1)[1].split(
            "AS source_geometry", maxsplit=1
        )[0]
    )
    outer_projection = sql.split("candidate_features AS", maxsplit=1)[1]
    assert '"details"' not in outer_projection


def test_tile_sql_assigns_a_content_id_before_geometry_clipping() -> None:
    sql = build_tile_sql(
        "SELECT geometry, name, population FROM roads",
        tile_request(),
        columns=(
            ("geometry", "GEOMETRY"),
            ("name", "VARCHAR"),
            ("population", "INTEGER"),
        ),
    )

    assert "identified_features AS" in sql
    assert 'hash(source_geometry, "name", "population")' in sql
    assert 'AS "__hifld_feature_hash"' in sql
    assert 'CAST((("__hifld_feature_hash" & 9223372036854775807)' in sql
    assert '% 2147483647) AS BIGINT) AS "_mcp_feature_id"' in sql
    assert 'CAST("__hifld_feature_hash" AS VARCHAR) AS "__hifld_feature_key"' in sql
    assert "ST_X(ST_Transform(ST_Centroid(source_geometry), 'EPSG:4326', 'EPSG:4326'," in sql
    assert 'AS "__hifld_centroid_lng"' in sql
    assert "ST_Y(ST_Transform(ST_Centroid(source_geometry), 'EPSG:4326', 'EPSG:4326'," in sql
    assert 'AS "__hifld_centroid_lat"' in sql
    assert "ST_AsMVT(f, 'hifld', 4096, 'geom', '_mcp_feature_id')" in sql
    assert "ST_AsMVTGeom(" in sql
    assert sql.index("hash(source_geometry") < sql.index("ST_AsMVTGeom(")


def test_tile_sql_excludes_reserved_feature_id_property_from_mvt_properties() -> None:
    sql = build_tile_sql(
        "SELECT geometry, _mcp_feature_id, __hifld_centroid_lng, "
        "__hifld_centroid_lat, __hifld_feature_key, name FROM roads",
        tile_request(),
        columns=(
            ("geometry", "GEOMETRY"),
            ("_mcp_feature_id", "BIGINT"),
            ("__hifld_centroid_lng", "DOUBLE"),
            ("__hifld_centroid_lat", "DOUBLE"),
            ("__hifld_feature_key", "VARCHAR"),
            ("name", "VARCHAR"),
        ),
    )

    assert 'SELECT "name",' in sql
    assert 'SELECT "_mcp_feature_id",' not in sql
    assert 'SELECT "__hifld_centroid_lng",' not in sql
    assert 'SELECT "__hifld_centroid_lat",' not in sql
    assert 'SELECT "__hifld_feature_key",' not in sql
    assert 'hash(source_geometry, "name")' in sql


def test_tile_sql_rejects_untrusted_identifiers_and_crs() -> None:
    with pytest.raises(ValueError, match="identifier"):
        build_tile_sql(
            "SELECT 1",
            tile_request(geometry_column='geometry"; DROP TABLE roads;--'),
            columns=(("geometry", "GEOMETRY"),),
        )
    with pytest.raises(ValueError, match="CRS"):
        build_tile_sql(
            "SELECT 1",
            tile_request(result_crs="EPSG:4326'); DROP TABLE roads;--"),
            columns=(("geometry", "GEOMETRY"),),
        )


def test_tile_sql_requires_a_crs() -> None:
    with pytest.raises(ValueError, match="result CRS"):
        build_tile_sql(
            "SELECT geometry FROM roads",
            tile_request(result_crs=None),
            columns=(("geometry", "GEOMETRY"),),
        )


@pytest.mark.skipif(
    not os.environ.get("DUCKDB_EXTENSION_DIRECTORY"),
    reason="spatial extension directory is not configured",
)
def test_tile_sql_executes_against_inside_outside_and_exact_filter_fixtures() -> None:
    connection = duckdb.connect(
        config={"extension_directory": os.environ["DUCKDB_EXTENSION_DIRECTORY"]}
    )
    connection.execute("LOAD spatial")
    connection.execute(
        """
        CREATE TABLE roads AS
        SELECT * FROM (VALUES
          (ST_Point(10, -10),
           {'xmin': 10.0, 'ymin': -10.0, 'xmax': 10.0, 'ymax': -10.0}, 'inside'),
          (ST_Point(-10, -10),
           {'xmin': -10.0, 'ymin': -10.0, 'xmax': -10.0, 'ymax': -10.0}, 'outside'),
          (ST_Point(-20, -20),
           {'xmin': 1.0, 'ymin': -20.0, 'xmax': 2.0, 'ymax': -19.0}, 'false_bbox')
        ) AS fixtures(geometry, bbox, name)
        """
    )
    columns = tuple(
        (str(row[0]), str(row[1]))
        for row in connection.execute("DESCRIBE SELECT * FROM roads").fetchall()
    )
    sql = build_tile_sql(
        "SELECT * FROM roads",
        tile_request(z=1, x=1, y=1),
        columns=columns,
    )

    mvt, candidate_count = connection.execute(sql).fetchone()
    assert candidate_count == 1
    assert bytes(mvt)
    worker_result = execute_tile(
        connection,
        "SELECT * FROM roads",
        tile_request(z=1, x=1, y=1),
    )
    assert isinstance(worker_result, WorkerTile)
    assert worker_result.content


def test_tile_sql_casts_properties_to_stable_mvt_types() -> None:
    sql = build_tile_sql(
        "SELECT geometry, plus4, inspected_at, ratio, feature_uuid FROM stations",
        tile_request(),
        columns=(
            ("geometry", "GEOMETRY"),
            ("plus4", "INTEGER"),
            ("inspected_at", "TIMESTAMP"),
            ("ratio", "DECIMAL(10,2)"),
            ("feature_uuid", "UUID"),
        ),
    )

    assert 'CAST("plus4" AS INTEGER) AS "plus4"' in sql
    assert 'CAST("inspected_at" AS VARCHAR) AS "inspected_at"' in sql
    assert 'CAST("ratio" AS DOUBLE) AS "ratio"' in sql
    assert 'CAST("feature_uuid" AS VARCHAR) AS "feature_uuid"' in sql


class FakeRows:
    def __init__(self, rows: list[tuple[bytes | int | None, ...]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[tuple[bytes | int | None, ...]]:
        return self._rows


class FakeConnection:
    def __init__(
        self,
        description: list[tuple[str, str]],
        rows: list[tuple[bytes | int | None, ...]],
    ) -> None:
        self.description = description
        self.rows = rows
        self.sql: list[str] = []

    def execute(self, sql: str) -> FakeRows:
        self.sql.append(sql)
        if sql.startswith("DESCRIBE"):
            return FakeRows([(name, logical_type) for name, logical_type in self.description])
        return FakeRows(self.rows)


def test_execute_tile_returns_dense_failure_for_feature_or_byte_cap() -> None:
    description = [("geometry", "GEOMETRY"), ("name", "VARCHAR")]
    too_many = execute_tile(
        FakeConnection(description, [(b"tile", 20_001)]), "SELECT 1", tile_request()
    )
    assert too_many == WorkerFailure(
        code="tile_too_dense", message="Tile exceeds the feature or byte limit."
    )

    too_large = execute_tile(
        FakeConnection(description, [(b"x" * (MAX_TILE_BYTES + 1), 1)]),
        "SELECT 1",
        tile_request(),
    )
    assert too_large == WorkerFailure(
        code="tile_too_dense", message="Tile exceeds the feature or byte limit."
    )


def test_execute_tile_returns_mvt_and_empty_content() -> None:
    description = [("geometry", "GEOMETRY"), ("name", "VARCHAR")]
    rendered = execute_tile(FakeConnection(description, [(b"mvt", 1)]), "SELECT 1", tile_request())
    assert isinstance(rendered, WorkerTile)
    assert rendered.content == b"mvt"

    empty = execute_tile(FakeConnection(description, [(None, 0)]), "SELECT 1", tile_request())
    assert isinstance(empty, WorkerTile)
    assert empty.content == b""


def test_execute_tile_propagates_storage_errors_to_worker_runtime() -> None:
    class StorageFailureConnection(FakeConnection):
        def execute(self, sql: str) -> FakeRows:
            del sql
            raise duckdb.IOException("storage read failed")

    with pytest.raises(duckdb.IOException, match="storage read failed"):
        execute_tile(
            StorageFailureConnection([], []),
            "SELECT * FROM roads",
            tile_request(),
        )


class TileService:
    def __init__(self, result: WorkerTile | WorkerFailure) -> None:
        self.result = result
        self.calls: list[tuple[str, int, int, int, float]] = []
        self.identity_calls: list[tuple[str, str]] = []

    def validate_query_identity(self, token: str, query_id: str) -> None:
        self.identity_calls.append((token, query_id))

    async def render_tile(
        self, token: str, z: int, x: int, y: int, *, timeout_seconds: float
    ) -> WorkerTile | WorkerFailure:
        self.calls.append((token, z, x, y, timeout_seconds))
        return self.result


def make_client(service: TileService) -> TestClient:
    app = FastAPI()
    app.include_router(create_tile_router(service))
    return TestClient(app)


def test_http_tile_validates_coordinates_before_service_dispatch() -> None:
    service = TileService(WorkerTile(b"mvt", 1.0, 0, 0))
    response = make_client(service).get(
        "/tiles/2/4/0.mvt", headers={"X-HIFLD-Query-Token": "signed"}
    )
    assert response.status_code == 404
    assert service.calls == []


def test_http_tile_revalidates_token_with_ten_second_timeout_and_safe_cors() -> None:
    service = TileService(WorkerTile(b"mvt", 1.0, 0, 0))
    response = make_client(service).get(
        "/tiles/2/1/1.mvt", headers={"X-HIFLD-Query-Token": "signed"}
    )

    assert response.status_code == 200
    assert response.content == b"mvt"
    assert response.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["access-control-allow-headers"] == "X-HIFLD-Query-Token"
    assert response.headers["vary"] == "X-HIFLD-Query-Token"
    assert service.calls == [("signed", 2, 1, 1, 10.0)]


def test_http_query_id_tile_binds_path_identity_before_rendering() -> None:
    service = TileService(WorkerTile(b"mvt", 1.0, 0, 0))
    query_id = "capitolsquery123456789AB"
    response = make_client(service).get(
        f"/tiles/{query_id}/2/1/1.mvt",
        headers={"X-HIFLD-Query-Token": "signed"},
    )

    assert response.status_code == 200
    assert service.identity_calls == [("signed", query_id)]
    assert service.calls == [("signed", 2, 1, 1, 10.0)]


def test_http_query_id_tile_preflight_allows_sandbox_token_header() -> None:
    query_id = "capitolsquery123456789AB"
    response = make_client(TileService(WorkerTile(b"", 1.0, 0, 0))).options(
        f"/tiles/{query_id}/0/0/0.mvt"
    )

    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["access-control-allow-headers"] == "X-HIFLD-Query-Token"


def test_http_tile_returns_204_for_an_empty_tile_and_typed_dense_error() -> None:
    empty = make_client(TileService(WorkerTile(b"", 1.0, 0, 0))).get(
        "/tiles/0/0/0.mvt", headers={"X-HIFLD-Query-Token": "signed"}
    )
    assert empty.status_code == 204

    dense = make_client(
        TileService(WorkerFailure("tile_too_dense", "Tile exceeds the feature or byte limit."))
    ).get("/tiles/0/0/0.mvt", headers={"X-HIFLD-Query-Token": "signed"})
    assert dense.status_code == 422
    assert dense.json() == {
        "code": "tile_too_dense",
        "message": "Tile exceeds the feature or byte limit.",
    }


def test_http_tile_requires_query_token_and_preflight_allows_only_token_header() -> None:
    service = TileService(WorkerTile(b"mvt", 1.0, 0, 0))
    client = make_client(service)
    missing = client.get("/tiles/0/0/0.mvt")
    assert missing.status_code == 400
    assert missing.json()["code"] == "query_token_invalid"

    options = client.options("/tiles/0/0/0.mvt")
    assert options.status_code == 204
    assert options.headers["access-control-allow-methods"] == "GET, OPTIONS"
    assert options.headers["access-control-allow-headers"] == "X-HIFLD-Query-Token"
