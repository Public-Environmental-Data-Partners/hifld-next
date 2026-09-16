"""Native ClickHouse MVT encoding after query-local CRS normalization."""

import math
from time import monotonic
from typing import TYPE_CHECKING

from query_engine.client import ClickHouseError
from query_engine.results import ClickHouseResult, ResultColumn
from query_engine.sql import identifier, literal
from query_worker.protocol import WorkerBounds, WorkerBoundsQuery, WorkerTile, WorkerTileQuery

if TYPE_CHECKING:
    from query_engine.executor import ClickHouseExecutor


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise ValueError("Invalid XYZ tile coordinates")
    n = 2**z
    return (
        x / n * 360 - 180,
        math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))),
        (x + 1) / n * 360 - 180,
        math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))),
    )


def validate_tile_coordinates(z: int, x: int, y: int) -> bool:
    return 0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z


def geographic_geometry(column: str, working_crs: str) -> str:
    quoted = identifier(column)
    if working_crs in {"EPSG:4326", "OGC:CRS84"}:
        return quoted
    return (
        f"readWKB(unhex(hifld_reproject_wkb(hex(wkb({quoted})), "
        f"{literal(working_crs)}, 'EPSG:4326')))"
    )


def mvt_sql(
    sql: str,
    columns: list[ResultColumn],
    geometry: str,
    working_crs: str,
    z: int,
    x: int,
    y: int,
    cap: int,
) -> str:
    west, south, east, north = tile_bounds(z, x, y)
    region = literal(
        f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
    )
    props: list[str] = []
    types: list[str] = []
    for column in columns:
        if column.name == geometry or column.name.startswith("__hifld"):
            continue
        kind = column.type
        plain = kind.removeprefix("Nullable(").removesuffix(")")
        if plain == "String" or plain == "Bool" or plain.startswith(("Int", "UInt", "Float")):
            props.append(identifier(column.name))
            types.append(f"{identifier(column.name)} {kind}")
    feature_hash = f"cityHash64(wkb(__tile_geometry), tuple({', '.join(props)}))"
    props.append(f"toString({feature_hash})")
    types.append('"__hifld_feature_key" String')
    props.append(f"toUInt64({feature_hash} % 2147483647)")
    types.append('"_mcp_feature_id" UInt64')
    prop_tuple = f"CAST(tuple({', '.join(props)}) AS Tuple({', '.join(types)}))"
    geometry_expression = geographic_geometry(geometry, working_crs)
    return (
        f"SELECT count() AS feature_count, hex(MVTEncode('hifld', 4096, '_mcp_feature_id')("
        f"MVTEncodeGeom(__tile_geometry, {z}, {x}, {y}), {prop_tuple})) AS tile "
        f"FROM (SELECT *, {geometry_expression} AS __tile_geometry FROM ({sql}) "
        f"WHERE geometryIntersectCartesian(__tile_geometry, readWKT({region})) LIMIT {cap + 1}) "
        "FORMAT JSONCompact"
    )


async def execute_spatial(
    executor: "ClickHouseExecutor", request: WorkerBoundsQuery | WorkerTileQuery, timeout: float
) -> WorkerTile | WorkerBounds:
    started = monotonic()
    working_crs = request.result_crs or "EPSG:4326"
    sql, _ = await executor.compiled(request.canonical_sql, request, working_crs)
    schema = await executor.describe(sql, timeout)
    from query_engine.executor import is_geometry

    if not any(c.name == request.geometry_column and is_geometry(c.type) for c in schema.meta):
        raise ClickHouseError("map_not_supported", "Selected result column is not a geometry")
    if isinstance(request, WorkerTileQuery):
        result = ClickHouseResult.model_validate_json(
            await executor.client.query(
                mvt_sql(
                    sql,
                    schema.meta,
                    request.geometry_column,
                    working_crs,
                    request.z,
                    request.x,
                    request.y,
                    request.feature_cap,
                ),
                timeout_seconds=timeout,
                max_response_bytes=3 * 1024 * 1024,
            )
        )
        if len(result.data) != 1 or len(result.data[0]) != 2:
            raise ClickHouseError("query_failed", "Invalid tile encoder response")
        count, tile = result.data[0]
        if not isinstance(count, int) or not isinstance(tile, str):
            raise ClickHouseError("query_failed", "Invalid tile encoder response")
        if count > request.feature_cap:
            raise ClickHouseError(
                "map_not_supported", "Tile exceeds feature limit; zoom in or narrow the query"
            )
        content = bytes.fromhex(tile)
        if len(content) > 1024 * 1024:
            raise ClickHouseError(
                "map_not_supported", "Tile exceeds 1 MiB; zoom in or narrow the query"
            )
        return WorkerTile(content, (monotonic() - started) * 1000, result.statistics.bytes_read, 0)
    geom = geographic_geometry(request.geometry_column, working_crs)
    result = ClickHouseResult.model_validate_json(
        await executor.client.query(
            "SELECT min(b[1]), min(b[2]), max(b[3]), max(b[4]), count() "
            f"FROM (SELECT hifld_geometry_bounds(hex(wkb({geom}))) AS b FROM ({sql})) "
            "WHERE length(b)=4 FORMAT JSONCompact",
            timeout_seconds=timeout,
        )
    )
    if not result.data or len(result.data[0]) != 5 or result.data[0][4] == 0:
        return WorkerBounds(None)
    values = result.data[0][:4]
    if not all(isinstance(value, int | float) and math.isfinite(value) for value in values):
        raise ClickHouseError("map_not_supported", "Query bounds are not finite")
    west, south, east, north = (float(value) for value in values if isinstance(value, int | float))
    return WorkerBounds((west, south, east, north))
