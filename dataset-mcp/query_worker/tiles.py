"""Trusted spatial wrappers for bounded MVT and GeoJSON rendering.

The SQL passed to this module has already passed the SQL policy and has had its
catalog aliases rewritten to request-unique worker views. This module owns no
views and never accepts an object path.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from time import monotonic
from typing import Protocol

from pydantic import RootModel

from app.query.models import JsonValue
from query_worker.protocol import WorkerFailure, WorkerTile, WorkerTileQuery

MAX_TILE_BYTES = 1024 * 1024
MAX_MAP_BYTES = 4 * 1024 * 1024
MAX_MAP_FEATURES = 2_000
MVT_EXTENT = 4_096

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_CRS = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SCALAR_TYPES = (
    "BIGINT",
    "BOOLEAN",
    "DATE",
    "DECIMAL",
    "DOUBLE",
    "ENUM",
    "FLOAT",
    "HUGEINT",
    "INTEGER",
    "INTERVAL",
    "SMALLINT",
    "TIME",
    "TIMESTAMP",
    "TINYINT",
    "UBIGINT",
    "UHUGEINT",
    "UINTEGER",
    "USMALLINT",
    "UTINYINT",
    "UUID",
    "VARCHAR",
)

type TileCell = None | bool | int | float | str | bytes | bytearray | memoryview
type TileRow = tuple[TileCell, ...]


class QueryRows(Protocol):
    def fetchall(self) -> list[TileRow]: ...


class TileConnection(Protocol):
    def execute(self, query: str) -> QueryRows: ...


@dataclass(frozen=True, slots=True)
class MapFeature:
    geometry: JsonValue
    properties: dict[str, JsonValue]

    def as_json(self) -> dict[str, JsonValue]:
        return {
            "type": "Feature",
            "geometry": self.geometry,
            "properties": self.properties,
        }


@dataclass(frozen=True, slots=True)
class MapFeatureCollection:
    features: tuple[MapFeature, ...]

    def as_json(self) -> dict[str, JsonValue]:
        return {
            "type": "FeatureCollection",
            "features": [feature.as_json() for feature in self.features],
        }


class _JsonValueDocument(RootModel[JsonValue]):
    pass


class _JsonPropertiesDocument(RootModel[dict[str, JsonValue]]):
    pass


def validate_tile_coordinates(z: int, x: int, y: int) -> bool:
    """Return whether a Web Mercator tile coordinate is in the supported range."""

    # Adapted from ../geoparquet-duckdb-partitioning/server.py:tile.
    return 0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z


def _quote_identifier(identifier: str) -> str:
    if _IDENTIFIER.fullmatch(identifier) is None:
        raise ValueError("invalid SQL identifier")
    return f'"{identifier}"'


def _validated_crs(crs: str | None) -> str:
    if crs is None:
        raise ValueError("a result CRS is required for map rendering")
    if _CRS.fullmatch(crs) is None:
        raise ValueError("invalid result CRS")
    return crs


def _quote_literal(value: str) -> str:
    """Quote a value only after it has passed its narrow allowlist."""

    return f"'{value}'"


def _bbox_predicate(
    bbox_identifier: str, bbox: tuple[float, float, float, float]
) -> tuple[str, tuple[float, float, float, float]]:
    """Build a bound GeoParquet 1.1 bbox-overlap predicate."""

    # Adapted from ../geoparquet-duckdb-partitioning/
    # duckdb_parquet_provider.py:DuckDBParquetProvider._bbox_predicate.
    xmin, ymin, xmax, ymax = (float(value) for value in bbox)
    if not all(math.isfinite(value) for value in (xmin, ymin, xmax, ymax)):
        raise ValueError("bbox values must be finite")
    if xmin > xmax or ymin > ymax:
        raise ValueError("bbox minimums must not exceed maximums")
    quoted = _quote_identifier(bbox_identifier)
    sql = f"{quoted}.xmax >= ? AND {quoted}.xmin <= ? AND {quoted}.ymax >= ? AND {quoted}.ymin <= ?"
    return sql, (xmin, xmax, ymin, ymax)


def _bbox_bounds_predicate(bbox_identifier: str) -> str:
    quoted = _quote_identifier(bbox_identifier)
    # Keep the spike comparison and axis ordering. GeoParquet readers can use
    # this cheap struct predicate before the exact spatial predicate.
    return (
        f"{quoted}.xmax >= b.xmin AND {quoted}.xmin <= b.xmax\n"
        f"      AND {quoted}.ymax >= b.ymin AND {quoted}.ymin <= b.ymax"
    )


def _is_scalar(logical_type: str) -> bool:
    normalized = logical_type.upper().strip()
    return normalized.startswith(_SCALAR_TYPES)


def _properties(columns: tuple[tuple[str, str], ...], geometry_column: str) -> tuple[str, ...]:
    return tuple(
        name
        for name, logical_type in columns
        if name not in {geometry_column, "bbox"} and _is_scalar(logical_type)
    )


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
  f AS (
    SELECT {mvt_properties}{mvt_separator}
           ST_AsMVTGeom(
             ST_Transform(source_geometry, {result_crs}, 'EPSG:3857', always_xy := true),
             ST_Extent((SELECT env FROM tile))
           ) AS geom
    FROM limited_features
  )
SELECT ST_AsMVT(f, 'hifld', 4096, 'geom'),
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
        raise ValueError("geometry column is not present in the query result")

    properties = _properties(columns, request.geometry_column)
    selected_properties = ", ".join(_quote_identifier(name) for name in properties)
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
        candidate_properties=selected_properties,
        candidate_separator="," if selected_properties else "",
        geometry_column=geometry,
        viewport_predicate=viewport_predicate,
        candidate_limit=request.feature_cap + 1,
        feature_cap=request.feature_cap,
        mvt_properties=selected_properties,
        mvt_separator="," if selected_properties else "",
    )


def _bbox_values(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    _predicate, values = _bbox_predicate("bbox", bbox)
    xmin, xmax, ymin, ymax = values
    return xmin, ymin, xmax, ymax


def _number(value: float) -> str:
    return format(value, ".17g")


def _json_properties_expression(properties: tuple[str, ...]) -> str:
    if not properties:
        return "json_object()"
    pairs: list[str] = []
    for name in properties:
        quoted = _quote_identifier(name)
        pairs.extend((_quote_literal(name), quoted))
    return f"json_object({', '.join(pairs)})"


def build_geojson_sql(
    validated_query_sql: str,
    *,
    geometry_column: str,
    result_crs: str | None,
    bbox: tuple[float, float, float, float],
    zoom: int,
    feature_cap: int,
    columns: tuple[tuple[str, str], ...],
) -> str:
    """Wrap a query with the tile-equivalent bbox and exact viewport filter."""

    if not 0 <= zoom <= 24:
        raise ValueError("zoom must be between 0 and 24")
    if not 1 <= feature_cap <= MAX_MAP_FEATURES:
        raise ValueError("map feature cap must be between 1 and 2,000")
    crs = _quote_literal(_validated_crs(result_crs))
    geometry = _quote_identifier(geometry_column)
    names = {name for name, _logical_type in columns}
    if geometry_column not in names:
        raise ValueError("geometry column is not present in the query result")
    xmin, ymin, xmax, ymax = _bbox_values(bbox)
    properties = _properties(columns, geometry_column)
    predicates: list[str] = []
    if _has_bbox(columns):
        predicates.append(_bbox_bounds_predicate("bbox"))
    predicates.append(f"ST_Intersects({geometry}, b.env)")
    viewport_predicate = "\n      AND ".join(predicates)
    # One pixel in Web Mercator at this zoom. Simplification follows clipping,
    # so it cannot cause an outside feature to enter the response.
    tolerance = 156543.03392804097 / 2**zoom

    return f"""
WITH
  viewport AS (
    SELECT ST_Transform(
      ST_MakeEnvelope({_number(xmin)}, {_number(ymin)}, {_number(xmax)}, {_number(ymax)}),
      'EPSG:4326', {crs}, always_xy := true
    ) AS env
  ),
  bounds AS (
    SELECT env, ST_XMin(env) xmin, ST_YMin(env) ymin, ST_XMax(env) xmax, ST_YMax(env) ymax
    FROM viewport
  ),
  query_result AS (
    SELECT * FROM ({validated_query_sql}) AS _mcp_result
  ),
  candidate_features AS (
    SELECT {_json_properties_expression(properties)} AS properties,
           ST_Intersection({geometry}, b.env) AS clipped_geometry
    FROM query_result, bounds b
    WHERE {viewport_predicate}
    LIMIT {feature_cap + 1}
  )
SELECT ST_AsGeoJSON(
         ST_Transform(
           ST_SimplifyPreserveTopology(
             ST_Transform(clipped_geometry, {crs}, 'EPSG:3857', always_xy := true),
             {_number(tolerance)}
           ),
           'EPSG:3857', 'EPSG:4326', always_xy := true
         )
       ) AS geometry,
       CAST(properties AS VARCHAR) AS properties
FROM candidate_features
WHERE NOT ST_IsEmpty(clipped_geometry);
"""


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
    except ValueError:
        code = "geometry_crs_required" if request.result_crs is None else "map_not_supported"
        message = (
            "A result CRS is required for map rendering."
            if code == "geometry_crs_required"
            else "The query result cannot be rendered as a map."
        )
        return _safe_failure(code, message)
    except Exception:
        return _safe_failure("map_not_supported", "The query result cannot be rendered as a map.")


def execute_map_features(
    connection: TileConnection,
    validated_query_sql: str,
    *,
    geometry_column: str,
    result_crs: str | None,
    bbox: tuple[float, float, float, float],
    zoom: int,
    feature_cap: int,
    max_result_bytes: int = MAX_MAP_BYTES,
) -> MapFeatureCollection | WorkerFailure:
    """Execute the bounded GeoJSON fallback against prepared worker views."""

    try:
        columns = _describe_columns(connection, validated_query_sql)
        sql = build_geojson_sql(
            validated_query_sql,
            geometry_column=geometry_column,
            result_crs=result_crs,
            bbox=bbox,
            zoom=zoom,
            feature_cap=feature_cap,
            columns=columns,
        )
        rows = connection.execute(sql).fetchall()
        if len(rows) > feature_cap:
            return _safe_failure("tile_too_dense", "Map features exceed the feature or byte limit.")
        features: list[MapFeature] = []
        size = len(b'{"type":"FeatureCollection","features":[]}')
        for row in rows:
            if len(row) < 2 or not isinstance(row[0], str) or not isinstance(row[1], str):
                raise ValueError("GeoJSON encoder returned an invalid value")
            geometry = _JsonValueDocument.model_validate_json(row[0]).root
            properties = _JsonPropertiesDocument.model_validate_json(row[1]).root
            feature = MapFeature(geometry=geometry, properties=properties)
            size += len(json.dumps(feature.as_json(), separators=(",", ":")).encode("utf-8"))
            if size > max_result_bytes:
                return _safe_failure(
                    "tile_too_dense", "Map features exceed the feature or byte limit."
                )
            features.append(feature)
        return MapFeatureCollection(features=tuple(features))
    except ValueError:
        code = "geometry_crs_required" if result_crs is None else "map_not_supported"
        message = (
            "A result CRS is required for map rendering."
            if code == "geometry_crs_required"
            else "The query result cannot be rendered as a map."
        )
        return _safe_failure(code, message)
    except Exception:
        return _safe_failure("map_not_supported", "The query result cannot be rendered as a map.")
