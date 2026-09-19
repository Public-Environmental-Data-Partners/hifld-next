"""Conservative native-covering pruning for direct single-source tile queries."""

import math

from pyproj import Transformer, network
from sqlglot import exp, parse_one

from query_engine.metadata import GeometryMetadata
from query_engine.sql import identifier

# Public pyproj API is re-exported without a matching typing export declaration.
network.set_network_enabled(False)  # pyright: ignore[reportPrivateImportUsage]


def covering_filter(
    sql: str,
    geometry_column: str,
    fields: tuple[GeometryMetadata, ...],
    bounds: tuple[float, float, float, float],
) -> str | None:
    statement = parse_one(sql, read="duckdb")
    if (
        len(list(statement.find_all(exp.Select))) != 1
        or len(list(statement.find_all(exp.Table))) != 1
    ):
        return None
    if (
        not isinstance(statement, exp.Select)
        or any(
            statement.args.get(key) is not None
            for key in (
                "joins",
                "group",
                "having",
                "qualify",
                "limit",
                "offset",
                "distinct",
                "with_",
            )
        )
        or statement.find(exp.AggFunc, exp.Window) is not None
    ):
        return None
    source = statement.args.get("from_")
    if not isinstance(source, exp.From) or not isinstance(source.this, exp.Table):
        return None
    selected_name: str | None = None
    for projection in statement.expressions:
        expression = projection.this if isinstance(projection, exp.Alias) else projection
        if isinstance(expression, exp.Star):
            selected_name = geometry_column
        elif isinstance(expression, exp.Column) and projection.alias_or_name == geometry_column:
            selected_name = expression.name
    field = next((field for field in fields if field.name == selected_name), None)
    if field is None or field.crs is None or field.covering is None:
        return None
    try:
        transformer = Transformer.from_crs("EPSG:4326", field.crs, always_xy=True)
        west, south, east, north = transformer.transform_bounds(*bounds, densify_pts=21)
    except Exception:
        # Skipping an optimization is safe; guessing a covering is not.
        return None
    if not all(math.isfinite(v) for v in (west, south, east, north)) or east < west:
        return None
    paths = field.covering

    def path(parts: tuple[str, ...]) -> str:
        return ".".join(identifier(part) for part in parts)

    return (
        f"{path(paths.xmin)} <= {east!r} AND {path(paths.xmax)} >= {west!r} AND "
        f"{path(paths.ymin)} <= {north!r} AND {path(paths.ymax)} >= {south!r}"
    )
