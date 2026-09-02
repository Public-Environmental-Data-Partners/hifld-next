"""Trusted query-result bounds calculation for lazy map framing."""

from __future__ import annotations

import math
import re
from typing import Protocol

from query_worker.protocol import WorkerBounds, WorkerBoundsQuery, WorkerFailure

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_CRS = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class QueryRows(Protocol):
    def fetchall(self) -> list[tuple[object, ...]]: ...


class BoundsConnection(Protocol):
    def execute(self, query: str) -> QueryRows: ...


class BoundsConfigurationError(ValueError):
    """The trusted query result cannot satisfy its bounds configuration."""


def _quote_identifier(identifier: str) -> str:
    if _IDENTIFIER.fullmatch(identifier) is None:
        raise BoundsConfigurationError("invalid SQL identifier")
    return f'"{identifier}"'


def _quote_crs(crs: str) -> str:
    if _CRS.fullmatch(crs) is None:
        raise BoundsConfigurationError("invalid result CRS")
    return f"'{crs}'"


def build_bounds_sql(validated_query_sql: str, request: WorkerBoundsQuery) -> str:
    geometry = _quote_identifier(request.geometry_column)
    result_crs = _quote_crs(request.result_crs)
    return f"""
WITH query_result AS (
  SELECT * FROM ({validated_query_sql}) AS _mcp_result
), result_extent AS (
  SELECT ST_Extent_Agg(
           ST_Transform({geometry}, {result_crs}, 'EPSG:4326', always_xy := true)
         ) AS extent
  FROM query_result
  WHERE {geometry} IS NOT NULL
)
SELECT ST_XMin(extent), ST_YMin(extent), ST_XMax(extent), ST_YMax(extent)
FROM result_extent
"""


def execute_bounds(
    connection: BoundsConnection,
    validated_query_sql: str,
    request: WorkerBoundsQuery,
) -> WorkerBounds | WorkerFailure:
    try:
        sql = build_bounds_sql(validated_query_sql, request)
    except BoundsConfigurationError:
        return WorkerFailure("map_not_supported", "The query result cannot be framed on a map.")
    rows = connection.execute(sql).fetchall()
    row = rows[0] if rows else ()
    if len(row) != 4 or all(value is None for value in row):
        return WorkerBounds(bounds=None)
    numeric_bounds: list[float] = []
    for value in row:
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("query result bounds are unavailable")
        numeric_bounds.append(float(value))
    min_x, min_y, max_x, max_y = numeric_bounds
    if min_x > max_x or min_y > max_y:
        raise ValueError("query result bounds are invalid")
    return WorkerBounds(bounds=(min_x, min_y, max_x, max_y))
