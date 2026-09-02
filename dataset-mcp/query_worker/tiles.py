"""Trusted spatial wrappers for bounded MVT rendering.

The SQL passed to this module has already passed the SQL policy and has had its
catalog aliases rewritten to request-unique worker views. This module owns no
views and never accepts an object path.
"""

from __future__ import annotations

import re
from time import monotonic
from typing import Protocol

from query_worker.protocol import WorkerFailure, WorkerTile, WorkerTileQuery

MAX_TILE_BYTES = 1024 * 1024
MVT_EXTENT = 4_096
MVT_FEATURE_ID_COLUMN = "_mcp_feature_id"
MVT_FEATURE_HASH_COLUMN = "__hifld_feature_hash"
MVT_FEATURE_KEY_COLUMN = "__hifld_feature_key"
MVT_CENTROID_LNG_COLUMN = "__hifld_centroid_lng"
MVT_CENTROID_LAT_COLUMN = "__hifld_centroid_lat"
MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807
# DuckDB's current spatial extension validates ST_AsMVT feature IDs as int32
# even when the source column is BIGINT.
MAX_MVT_FEATURE_ID = 2_147_483_647

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_CRS = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
type TileCell = None | bool | int | float | str | bytes | bytearray | memoryview
type TileRow = tuple[TileCell, ...]


class QueryRows(Protocol):
    def fetchall(self) -> list[TileRow]: ...


class TileConnection(Protocol):
    def execute(self, query: str) -> QueryRows: ...


class TileConfigurationError(ValueError):
    """The trusted query result cannot satisfy the tile configuration."""


def validate_tile_coordinates(z: int, x: int, y: int) -> bool:
    """Return whether a Web Mercator tile coordinate is in the supported range."""

    # Adapted from ../geoparquet-duckdb-partitioning/server.py:tile.
    return 0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z


def _quote_identifier(identifier: str) -> str:
    if _IDENTIFIER.fullmatch(identifier) is None:
        raise TileConfigurationError("invalid SQL identifier")
    return f'"{identifier}"'


def _validated_crs(crs: str | None) -> str:
    if crs is None:
        raise TileConfigurationError("a result CRS is required for map rendering")
    if _CRS.fullmatch(crs) is None:
        raise TileConfigurationError("invalid result CRS")
    return crs


def _quote_literal(value: str) -> str:
    """Quote a value only after it has passed its narrow allowlist."""

    return f"'{value}'"


def _bbox_bounds_predicate(bbox_identifier: str) -> str:
    quoted = _quote_identifier(bbox_identifier)
    # Keep the spike comparison and axis ordering. GeoParquet readers can use
    # this cheap struct predicate before the exact spatial predicate.
    return (
        f"{quoted}.xmax >= b.xmin AND {quoted}.xmin <= b.xmax\n"
        f"      AND {quoted}.ymax >= b.ymin AND {quoted}.ymin <= b.ymax"
    )


def _mvt_property_type(logical_type: str) -> str | None:
    normalized = logical_type.upper().strip()
    if normalized.startswith("BOOLEAN"):
        return "BOOLEAN"
    if normalized.startswith("FLOAT"):
        return "FLOAT"
    if normalized.startswith("DOUBLE"):
        return "DOUBLE"
    if normalized.startswith("DECIMAL"):
        return "DOUBLE"
    if normalized.startswith(("TINYINT", "SMALLINT", "INTEGER")):
        return "INTEGER"
    if normalized.startswith(("UTINYINT", "USMALLINT", "UINTEGER", "BIGINT")):
        return "BIGINT"
    if normalized.startswith(
        (
            "UBIGINT",
            "HUGEINT",
            "UHUGEINT",
            "VARCHAR",
            "ENUM",
            "UUID",
            "DATE",
            "TIME",
            "TIMESTAMP",
            "INTERVAL",
        )
    ):
        return "VARCHAR"
    return None


def _properties(
    columns: tuple[tuple[str, str], ...], geometry_column: str
) -> tuple[tuple[str, str], ...]:
    internal_columns = {
        geometry_column,
        "bbox",
        MVT_FEATURE_ID_COLUMN,
        MVT_FEATURE_HASH_COLUMN,
        MVT_FEATURE_KEY_COLUMN,
        MVT_CENTROID_LNG_COLUMN,
        MVT_CENTROID_LAT_COLUMN,
    }
    properties: list[tuple[str, str]] = []
    for name, logical_type in columns:
        mvt_type = _mvt_property_type(logical_type)
        if name not in internal_columns and mvt_type is not None:
            properties.append((name, mvt_type))
    return tuple(properties)


def _has_bbox(columns: tuple[tuple[str, str], ...]) -> bool:
    return any(
        name == "bbox" and logical_type.upper().startswith("STRUCT")
        for name, logical_type in columns
    )


# Adapted from ../geoparquet-duckdb-partitioning/server.py:_TILE_SQL_TEMPLATE.
# The tile/bounds/f CTEs and ST_TileEnvelope/ST_AsMVTGeom/ST_AsMVT structure
# intentionally remain recognizable for comparison with the measured spike.
_TILE_SQL_TEMPLATE = """
WITH
  tile AS (SELECT ST_TileEnvelope({z}, {x}, {y}) AS env),
  bounds AS (
    SELECT e AS env, ST_XMin(e) xmin, ST_YMin(e) ymin, ST_XMax(e) xmax, ST_YMax(e) ymax
    FROM (SELECT ST_Transform(env, 'EPSG:3857', {result_crs}, always_xy := true) e
          FROM tile)
  ),
  query_result AS (
    SELECT * FROM ({validated_query}) AS _mcp_result
  ),
  candidate_features AS (
    SELECT {candidate_properties}{candidate_separator}
           {geometry_column} AS source_geometry
    FROM query_result, bounds b
    WHERE {viewport_predicate}
    LIMIT {candidate_limit}
  ),
  limited_features AS (
    SELECT * FROM candidate_features LIMIT {feature_cap}
  ),
  identified_features AS (
    SELECT *,
           hash(source_geometry{hash_separator}{hash_properties}) AS {feature_hash_column},
           ST_X(ST_Transform(ST_Centroid(source_geometry), {result_crs}, 'EPSG:4326',
                             always_xy := true)) AS {centroid_lng_column},
           ST_Y(ST_Transform(ST_Centroid(source_geometry), {result_crs}, 'EPSG:4326',
                             always_xy := true)) AS {centroid_lat_column}
    FROM limited_features
  ),
  f AS (
    SELECT {mvt_properties}{mvt_separator}
           CAST((({feature_hash_column} & {max_signed_bigint})
                 % {max_mvt_feature_id}) AS BIGINT) AS {feature_id_column},
           CAST({feature_hash_column} AS VARCHAR) AS {feature_key_column},
           {centroid_lng_column},
           {centroid_lat_column},
           ST_AsMVTGeom(
             ST_Transform(source_geometry, {result_crs}, 'EPSG:3857', always_xy := true),
             ST_Extent((SELECT env FROM tile))
           ) AS geom
    FROM identified_features
  )
SELECT ST_AsMVT(f, 'hifld', 4096, 'geom', {feature_id_literal}),
       (SELECT COUNT(*) FROM candidate_features)
FROM f WHERE geom IS NOT NULL;
"""


def build_tile_sql(
    validated_query_sql: str,
    request: WorkerTileQuery,
    *,
    columns: tuple[tuple[str, str], ...],
) -> str:
    """Wrap one validated query as an envelope-constrained MVT relation."""

    if not validate_tile_coordinates(request.z, request.x, request.y):
        raise ValueError("invalid tile coordinates")
    if not 1 <= request.feature_cap <= 20_000:
        raise ValueError("tile feature cap must be between 1 and 20,000")
    geometry = _quote_identifier(request.geometry_column)
    crs = _quote_literal(_validated_crs(request.result_crs))
    names = {name for name, _logical_type in columns}
    if request.geometry_column not in names:
        raise TileConfigurationError("geometry column is not present in the query result")

    properties = _properties(columns, request.geometry_column)
    candidate_properties = ", ".join(
        f"CAST({_quote_identifier(name)} AS {mvt_type}) AS {_quote_identifier(name)}"
        for name, mvt_type in properties
    )
    selected_properties = ", ".join(_quote_identifier(name) for name, _ in properties)
    hash_properties = ", ".join(_quote_identifier(name) for name, _ in properties)
    hash_separator = ", " if hash_properties else ""
    predicates: list[str] = []
    if _has_bbox(columns):
        predicates.append(_bbox_bounds_predicate("bbox"))
    predicates.append(f"ST_Intersects({geometry}, b.env)")
    viewport_predicate = "\n      AND ".join(predicates)

    return _TILE_SQL_TEMPLATE.format(
        z=request.z,
        x=request.x,
        y=request.y,
        result_crs=crs,
        validated_query=validated_query_sql,
        candidate_properties=candidate_properties,
        candidate_separator="," if candidate_properties else "",
        geometry_column=geometry,
        viewport_predicate=viewport_predicate,
        candidate_limit=request.feature_cap + 1,
        feature_cap=request.feature_cap,
        mvt_properties=selected_properties,
        mvt_separator="," if selected_properties else "",
        hash_properties=hash_properties,
        hash_separator=hash_separator,
        max_signed_bigint=MAX_SIGNED_BIGINT,
        max_mvt_feature_id=MAX_MVT_FEATURE_ID,
        feature_id_column=_quote_identifier(MVT_FEATURE_ID_COLUMN),
        feature_id_literal=_quote_literal(MVT_FEATURE_ID_COLUMN),
        feature_hash_column=_quote_identifier(MVT_FEATURE_HASH_COLUMN),
        feature_key_column=_quote_identifier(MVT_FEATURE_KEY_COLUMN),
        centroid_lng_column=_quote_identifier(MVT_CENTROID_LNG_COLUMN),
        centroid_lat_column=_quote_identifier(MVT_CENTROID_LAT_COLUMN),
    )


def _describe_columns(
    connection: TileConnection, validated_query_sql: str
) -> tuple[tuple[str, str], ...]:
    rows = connection.execute(
        f"DESCRIBE SELECT * FROM ({validated_query_sql}) AS _mcp_describe"
    ).fetchall()
    columns: list[tuple[str, str]] = []
    for row in rows:
        if len(row) < 2 or not isinstance(row[0], str) or not isinstance(row[1], str):
            raise ValueError("query result schema is unavailable")
        columns.append((row[0], row[1]))
    return tuple(columns)


def _safe_failure(code: str, message: str) -> WorkerFailure:
    return WorkerFailure(code=code, message=message)


def execute_tile(
    connection: TileConnection,
    validated_query_sql: str,
    request: WorkerTileQuery,
) -> WorkerTile | WorkerFailure:
    """Execute a bounded MVT query inside an already-prepared worker request."""

    started = monotonic()
    try:
        columns = _describe_columns(connection, validated_query_sql)
        sql = build_tile_sql(validated_query_sql, request, columns=columns)
    except TileConfigurationError:
        code = "geometry_crs_required" if request.result_crs is None else "map_not_supported"
        message = (
            "A result CRS is required for map rendering."
            if code == "geometry_crs_required"
            else "The query result cannot be rendered as a map."
        )
        return _safe_failure(code, message)

    rows = connection.execute(sql).fetchall()
    row = rows[0] if rows else ()
    raw_mvt = row[0] if row else None
    raw_count = row[1] if len(row) > 1 else 0
    if not isinstance(raw_count, int):
        raise ValueError("tile feature count is unavailable")
    if raw_mvt is None:
        content = b""
    elif isinstance(raw_mvt, bytes):
        content = raw_mvt
    elif isinstance(raw_mvt, (bytearray, memoryview)):
        content = bytes(raw_mvt)
    else:
        raise ValueError("tile encoder returned an invalid value")
    if raw_count > request.feature_cap or len(content) > MAX_TILE_BYTES:
        return _safe_failure("tile_too_dense", "Tile exceeds the feature or byte limit.")
    return WorkerTile(
        content=content,
        elapsed_ms=(monotonic() - started) * 1_000,
        bytes_read=0,
        files_read=0,
    )
