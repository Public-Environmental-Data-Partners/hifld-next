"""Trusted spatial wrappers for bounded MVT rendering.

The SQL passed to this module has already passed the SQL policy and has had its
catalog aliases rewritten to request-unique worker views. This module owns no
views and never accepts an object path.
"""

from __future__ import annotations

import re
from time import monotonic
from typing import Protocol

import duckdb
from sqlglot import exp, parse_one
from sqlglot.errors import ParseError, TokenError

from query_worker.covering import GeometryCovering, quote_path
from query_worker.protocol import WorkerFailure, WorkerTile, WorkerTileQuery

MAX_TILE_BYTES = 1024 * 1024
MVT_EXTENT = 4_096
MVT_FEATURE_ID_COLUMN = "_mcp_feature_id"
MVT_FEATURE_HASH_COLUMN = "__hifld_feature_hash"
MVT_FEATURE_KEY_COLUMN = "__hifld_feature_key"
MVT_CENTROID_LNG_COLUMN = "__hifld_centroid_lng"
MVT_CENTROID_LAT_COLUMN = "__hifld_centroid_lat"
COVERING_COLUMN = "__hifld_covering"
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


def _bbox_bounds_predicate(bbox_identifier: str, envelope: str) -> str:
    quoted = _quote_identifier(bbox_identifier)
    # Keep the spike comparison and axis ordering. GeoParquet readers can use
    # this cheap struct predicate before the exact spatial predicate.
    fields = {
        name: (
            _quote_identifier(f"{COVERING_COLUMN}_{name}")
            if bbox_identifier == COVERING_COLUMN
            else f"{quoted}.{name}"
        )
        for name in ("xmin", "xmax", "ymin", "ymax")
    }
    return (
        f"{fields['xmax']} >= ST_XMin({envelope}) AND {fields['xmin']} <= ST_XMax({envelope})\n"
        f"      AND {fields['ymax']} >= ST_YMin({envelope}) "
        f"AND {fields['ymin']} <= ST_YMax({envelope})"
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
        COVERING_COLUMN,
        *(f"{COVERING_COLUMN}_{name}" for name in ("xmin", "ymin", "xmax", "ymax")),
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


def _valid_bbox_type(logical_type: str) -> bool:
    try:
        expression = parse_one(f"CAST(NULL AS {logical_type})", dialect="duckdb")
    except (ParseError, TokenError):
        return False
    data_type = expression.find(exp.DataType)
    if data_type is None or str(data_type.this) != "DType.STRUCT":
        return False
    numeric_types = {
        "BIGINT",
        "DECIMAL",
        "DOUBLE",
        "FLOAT",
        "HUGEINT",
        "INT",
        "SMALLINT",
        "TINYINT",
        "UBIGINT",
        "UHUGEINT",
        "UINT",
        "USMALLINT",
        "UTINYINT",
    }
    fields: dict[str, str] = {}
    for field in data_type.expressions:
        if not isinstance(field, exp.ColumnDef) or not isinstance(field.kind, exp.DataType):
            return False
        fields[field.name.casefold()] = str(field.kind.this).removeprefix("DType.")
    return all(fields.get(name) in numeric_types for name in ("xmin", "ymin", "xmax", "ymax"))


def bbox_retention_candidate(
    validated_query_sql: str, geometry_column: str, *, declared: bool = False
) -> tuple[exp.Select, exp.Table] | None:
    """Return a simple select and its sole base table when bbox carry-through is safe."""

    try:
        expression = parse_one(validated_query_sql, dialect="duckdb")
    except (ParseError, TokenError):
        return None
    if not isinstance(expression, exp.Select):
        return None
    if any(
        expression.args.get(key) is not None
        for key in ("with_", "distinct", "group", "having", "qualify", "limit", "offset")
    ):
        return None
    if expression.find(exp.AggFunc) is not None or expression.find(exp.Window) is not None:
        return None
    from_expression = expression.args.get("from_")
    if not isinstance(from_expression, exp.From) or not isinstance(from_expression.this, exp.Table):
        return None
    table = from_expression.this
    if table.catalog or table.db or expression.args.get("joins"):
        return None
    if len(list(expression.find_all(exp.Table))) != 1:
        return None
    if not declared and any(
        selected.alias_or_name.casefold() == "bbox" or selected.find(exp.Star) is not None
        for selected in expression.expressions
    ):
        return None
    expected_qualifier = table.alias_or_name.casefold()
    # Duplicate output names are renamed by DuckDB in projection order. A raw
    # geometry later in the list does not prove the selected output is unchanged.
    geometry_outputs = [
        selected
        for selected in expression.expressions
        if selected.alias_or_name.casefold() == geometry_column.casefold()
    ]
    if len(geometry_outputs) > 1 or any(
        not isinstance(selected, exp.Column) for selected in geometry_outputs
    ):
        return None
    raw_geometry = any(
        isinstance(selected, exp.Column)
        and selected.name.casefold() == geometry_column.casefold()
        and selected.alias_or_name.casefold() == geometry_column.casefold()
        and (not selected.table or selected.table.casefold() == expected_qualifier)
        for selected in expression.expressions
    )
    if declared:
        # Qualified p.* is a Column containing Star, not a top-level Star.
        stars = [
            star
            for selected in expression.expressions
            if (star := selected.find(exp.Star)) is not None
        ]
        if any(value is not None for star in stars for value in star.args.values()):
            return None
        if stars and geometry_outputs:
            return None
        if stars:
            raw_geometry = True
    if not raw_geometry:
        return None
    return expression, table


def retain_declared_covering(
    connection: TileConnection,
    sql: str,
    geometry: str,
    crs: str | None,
    coverings: dict[str, GeometryCovering | None],
) -> tuple[str, str | None]:
    candidate = bbox_retention_candidate(sql, geometry, declared=True)
    if candidate is None:
        return sql, None
    expression, table = candidate
    covering = coverings.get(table.name)
    if covering is None or covering.crs != crs:
        return sql, None
    if crs not in {"EPSG:4326", "EPSG:3857", "EPSG:4269"}:
        return sql, None
    # Validate every declared accessor against the actual bound source schema.
    qualifier = table.alias_or_name
    fields = [
        f"{quote_path(path, qualifier)} AS {COVERING_COLUMN}_{name}"
        for name, path in (
            ("xmin", covering.xmin),
            ("ymin", covering.ymin),
            ("xmax", covering.xmax),
            ("ymax", covering.ymax),
        )
    ]
    try:
        columns = _describe_columns(connection, sql)
        if any(name.casefold().startswith(COVERING_COLUMN) for name, _ in columns):
            return sql, None
        # Four scalar projections, not a reconstructed struct: DuckDB does not
        # simplify struct_extract(struct_pack(...)) into statistics predicates.
        check = expression.copy().select(
            *(parse_one(field, dialect="duckdb") for field in fields), append=True
        )
        checked_columns = _describe_columns(connection, check.sql(dialect="duckdb"))
    except duckdb.BinderException:
        return sql, None
    scalar_types = dict(checked_columns)
    synthetic_type = (
        "STRUCT("
        + ", ".join(
            f"{name} {scalar_types[f'{COVERING_COLUMN}_{name}']}"
            for name in ("xmin", "ymin", "xmax", "ymax")
        )
        + ")"
    )
    if not _valid_bbox_type(synthetic_type):
        return sql, None
    return check.sql(dialect="duckdb"), COVERING_COLUMN


# Adapted from ../geoparquet-duckdb-partitioning/server.py:_TILE_SQL_TEMPLATE.
# The tile/bounds/f CTEs and ST_TileEnvelope/ST_AsMVTGeom/ST_AsMVT structure
# intentionally remain recognizable for comparison with the measured spike.
_TILE_SQL_TEMPLATE = """
WITH
  tile AS (SELECT ST_TileEnvelope({z}, {x}, {y}) AS env),
  query_result AS (
    SELECT * FROM ({validated_query}) AS _mcp_result
  ),
  candidate_features AS (
    SELECT {candidate_properties}{candidate_separator}
           {geometry_column} AS source_geometry
    FROM query_result
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
    bbox_column: str | None = None,
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
    tile_envelope = f"ST_TileEnvelope({request.z}, {request.x}, {request.y})"
    envelope = f"ST_Transform({tile_envelope}, 'EPSG:3857', {crs}, always_xy := true)"
    # Inline constant expressions are required for Parquet statistics pushdown.
    # Joining a bounds CTE turns these into join conditions instead of scan filters.
    if request.result_crs in {"EPSG:4326", "EPSG:3857", "EPSG:4269"}:
        if bbox_column == COVERING_COLUMN or (
            bbox_column is not None
            and any(name == bbox_column and _valid_bbox_type(kind) for name, kind in columns)
        ):
            predicates.append(_bbox_bounds_predicate(bbox_column, envelope))
        predicates.append(f"ST_Intersects({geometry}, {envelope})")
    else:
        # Corner-transformed envelopes may under-cover other projections. Evaluate
        # the exact predicate in the rendering CRS without unsafe covering pruning.
        predicates.append(
            f"ST_Intersects(ST_Transform({geometry}, {crs}, 'EPSG:3857', "
            f"always_xy := true), {tile_envelope})"
        )
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
    *,
    source_coverings: dict[str, GeometryCovering | None] | None = None,
) -> WorkerTile | WorkerFailure:
    """Execute a bounded MVT query inside an already-prepared worker request."""

    started = monotonic()
    try:
        tile_query_sql, bbox_column = retain_declared_covering(
            connection,
            validated_query_sql,
            request.geometry_column,
            request.result_crs,
            source_coverings or {},
        )
        columns = _describe_columns(connection, tile_query_sql)
        sql = build_tile_sql(tile_query_sql, request, columns=columns, bbox_column=bbox_column)
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
