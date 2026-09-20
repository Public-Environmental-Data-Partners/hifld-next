from pathlib import Path

import duckdb
import pytest
from pygeoapi.provider.base import ProviderItemNotFoundError

from app.provider.duckdb_provider import DuckDBGeoParquetProvider


class _RecordingConnection:
    def __init__(self, connection: duckdb.DuckDBPyConnection, statements: list[str]) -> None:
        self._connection = connection
        self._statements = statements

    @property
    def description(self) -> list[tuple[str, str]]:
        return self._connection.description

    def execute(self, statement: str, parameters: list[object]) -> duckdb.DuckDBPyConnection:
        self._statements.append(statement)
        return self._connection.execute(statement, parameters)

    def close(self) -> None:
        self._connection.close()


def test_hits_and_item_queries_only_run_the_needed_geoparquet_scan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "query_cost.parquet"
    with duckdb.connect() as connection:
        connection.execute("LOAD spatial")
        connection.execute("CREATE TABLE source (name VARCHAR, geometry BLOB)")
        connection.execute(
            "INSERT INTO source VALUES ('first', ST_AsWKB(ST_Point(0, 0))), "
            "('second', ST_AsWKB(ST_Point(1, 1)))"
        )
        connection.execute("COPY source TO ? (FORMAT PARQUET)", [str(path)])
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": str(path),
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
            "objects_json": '["query_cost.parquet"]',
            "source_uris_json": f'["{path}"]',
        }
    )
    statements: list[str] = []
    original_connection = provider._connection
    monkeypatch.setattr(
        provider,
        "_connection",
        lambda: _RecordingConnection(original_connection(), statements),
    )

    hits = provider.query(resulttype="hits")
    assert hits["numberMatched"] == 2
    assert hits["numberReturned"] == 0
    assert hits["features"] == []
    assert any("SELECT count(*)" in statement for statement in statements)
    assert not any("ST_AsGeoJSON" in statement for statement in statements)

    statements.clear()
    first_id = provider.query(limit=1)["features"][0]["id"]
    assert isinstance(first_id, str)
    statements.clear()
    feature = provider.get(first_id)
    assert feature["properties"] == {"name": "first"}
    assert any("ST_AsGeoJSON" in statement for statement in statements)
    assert not any("SELECT count(*)" in statement for statement in statements)


def test_provider_bounds_duckdb_resources_and_uses_spill_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FEATURE_SERVER_TEMP_DIRECTORY", str(tmp_path))
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": "unused.parquet",
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
        }
    )

    with provider._connection() as connection:
        settings = connection.execute(
            "SELECT current_setting('threads'), current_setting('memory_limit'), "
            "current_setting('temp_directory'), current_setting('max_temp_directory_size')"
        ).fetchone()

    assert settings is not None
    assert settings[0] == 1
    assert settings[1] == "512.0 MiB"
    assert settings[2] == str(tmp_path)
    assert settings[3] == "1.0 GiB"


def test_provider_uses_registry_resolved_public_gcs_storage() -> None:
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": "hifld/example/example/v1.0.0/geoparquet/data.parquet",
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
            "objects_json": '["hifld/example/example/v1.0.0/geoparquet/data.parquet"]',
            "source_uris_json": '["gs://hifld-next-portolan-published/hifld/example/example/v1.0.0/geoparquet/data.parquet"]',
        }
    )
    assert provider._objects == (
        "https://storage.googleapis.com/hifld-next-portolan-published/"
        "hifld/example/example/v1.0.0/geoparquet/data.parquet",
    )


def test_provider_uses_registry_resolved_local_published_storage() -> None:
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": "hifld/example/example/v1.0.0/geoparquet/data.parquet",
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
            "objects_json": '["hifld/example/example/v1.0.0/geoparquet/data.parquet"]',
            "source_uris_json": '["s3://hifld-local-published/hifld/example/example/v1.0.0/geoparquet/data.parquet"]',
            "seaweed_endpoint": "http://localhost:8333",
        }
    )
    assert provider._objects == (
        "s3://hifld-local-published/hifld/example/example/v1.0.0/geoparquet/data.parquet",
    )


def test_provider_returns_revision_bound_physical_ids(tmp_path: Path) -> None:
    path = tmp_path / "rows.parquet"
    connection = duckdb.connect()
    connection.execute("LOAD spatial")
    connection.execute("CREATE TABLE source (name VARCHAR, id INTEGER, geometry BLOB)")
    connection.execute(
        "INSERT INTO source VALUES ('first', 9, ST_AsWKB(ST_Point(0, 0))), "
        "('second', 10, ST_AsWKB(ST_Point(1, 1)))"
    )
    connection.execute("COPY source TO ? (FORMAT PARQUET)", [str(path)])
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": str(path),
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
        }
    )

    result = provider.query(limit=1)

    assert result["numberReturned"] == 1
    assert result["features"][0]["properties"] == {"name": "first", "id": 9}
    assert result["features"][0]["geometry"]["type"] == "Point"
    assert result["features"][0]["id"].endswith(".0")


def test_provider_transforms_crs84_bbox_and_gets_native_id(tmp_path: Path) -> None:
    path = tmp_path / "projected.parquet"
    connection = duckdb.connect()
    connection.execute("LOAD spatial")
    connection.execute("CREATE TABLE source (objectid INTEGER, geometry BLOB)")
    connection.execute(
        "INSERT INTO source VALUES (7, ST_AsWKB(ST_Point(1113194.9, 0))), "
        "(8, ST_AsWKB(ST_Point(0, 0)))"
    )
    connection.execute("COPY source TO ? (FORMAT PARQUET)", [str(path)])
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": str(path),
            "asset_key": "geoparquet",
            "asset_checksum": "b" * 64,
            "storage_crs": "http://www.opengis.net/def/crs/EPSG/0/3857",
            "feature_id_column": "objectid",
        }
    )

    result = provider.query(bbox=[9.5, -1, 10.5, 1], limit=10)

    assert result["numberMatched"] == 1
    assert result["features"][0]["id"] == "7"
    assert provider.get("7") == result["features"][0]
    with pytest.raises(ProviderItemNotFoundError):
        provider.get("not-a-number")


def test_provider_handles_crs_annotated_native_geometry(tmp_path: Path) -> None:
    path = tmp_path / "native_geometry.parquet"
    with duckdb.connect() as connection:
        connection.execute("LOAD spatial")
        connection.execute("CREATE TABLE source (objectid INTEGER, geometry GEOMETRY('EPSG:3857'))")
        connection.execute("INSERT INTO source VALUES (1, ST_Point(0, 0))")
        connection.execute("COPY source TO ? (FORMAT PARQUET)", [str(path)])
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": str(path),
            "asset_key": "geoparquet",
            "asset_checksum": "c" * 64,
            "storage_crs": "http://www.opengis.net/def/crs/EPSG/0/3857",
            "feature_id_column": "objectid",
        }
    )
    result = provider.query(bbox=[-1, -1, 1, 1])
    assert result["numberMatched"] == 1
    assert provider.get("1")["geometry"] == {"type": "Point", "coordinates": [0.0, 0.0]}


def test_queryables_use_catalog_dictionary_without_opening_data(tmp_path: Path) -> None:
    path = tmp_path / "physical.parquet"
    with duckdb.connect() as connection:
        connection.execute(
            "COPY (SELECT 'abc' AS source_ID, 7 AS OBJECTID) TO ? (FORMAT PARQUET)", [str(path)]
        )
    provider = DuckDBGeoParquetProvider(
        {
            "name": "app.provider.duckdb_provider.DuckDBGeoParquetProvider",
            "type": "feature",
            "data": str(path),
            "asset_key": "geoparquet",
            "asset_checksum": "a" * 64,
            "fields_json": '{"ID":{"type":"string"}}',
        }
    )
    assert provider.get_fields() == {"ID": {"type": "string"}}
