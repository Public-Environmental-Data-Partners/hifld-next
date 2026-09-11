"""Inspect actual Parquet schema without reading feature rows."""

import json
import re

from pydantic import BaseModel, TypeAdapter

from app.catalog.models import QuerySourceRef
from app.tools.query import JSONValue, QueryService, ToolResult


class InspectedColumn(BaseModel):
    name: str
    type: str
    nullable: bool


_columns = TypeAdapter(list[InspectedColumn])
_json = TypeAdapter(dict[str, JSONValue])
_geometry_crs = re.compile(r"GEOMETRY\s*\(\s*'([^']+)'\s*\)", re.IGNORECASE)

QUERY_GUIDANCE = """
Before writing spatial SQL, call inspect_query_source for each input and consult
get_dataset_file.query_hints. Catalog statistics may predate generated Parquet
bbox or Hive fields. Use verified columns and CRS, never guessed names.

For large sources, restrict relevant Hive partitions and apply scalar bbox
overlap filters in the source CRS before exact spatial predicates and joins.
The pattern is xmin <= east AND xmax >= west AND ymin <= north AND ymax >= south;
use discovered field paths, quote identifiers, and a conservative query envelope
in the bbox CRS. Missing metadata does not justify inventing bbox fields.
Preserve string partition values including leading zeroes; select all partitions
intersecting the area. Camera bounds do not filter SQL.

Avoid ST_Transform(large_source.geometry, ...) in the initial WHERE predicate:
it can prevent cheap Parquet row-group pruning. Transform the small query region
or point set into the verified source CRS, using explicit axis order where needed,
then apply exact predicates to candidates. Unknown CRS is not EPSG:4326.
LIMIT and CTE names do not make a full-source spatial join cheap.

For multiple polygon matches, MAX on a categorical zone label is lexicographic,
not a risk ranking. Use a documented domain rule or return distinct categories;
do not independently aggregate related attributes into a fictitious matched row.
An unmatched LEFT JOIN is unknown coverage, not proof of safety. Prebuilt tiles
are for display, not exact exposure calculations.
"""


async def inspect_query_source(service: QueryService, source: QuerySourceRef) -> ToolResult:
    reference = _json.validate_python(source.model_dump(mode="json"))
    sql = f'SELECT * FROM "{source.alias}" LIMIT 0'
    service.validate_sql(sql, (source.alias,))
    result = await service.query([reference], sql, 1, None, None)
    columns = _columns.validate_python(result.get("columns"))
    geometry_fields: list[JSONValue] = []
    bbox_candidates: list[JSONValue] = []
    for column in columns:
        kind = column.type.upper()
        if kind == "GEOMETRY" or kind.startswith("GEOMETRY("):
            match = _geometry_crs.fullmatch(column.type)
            geometry_fields.append({"name": column.name, "crs": match.group(1) if match else None})
        if kind.startswith("STRUCT(") and all(
            re.search(
                rf'(?:\(|,)\s*"?{field}"?\s+(?:DOUBLE|FLOAT|REAL)\b', column.type, re.IGNORECASE
            )
            for field in ("xmin", "ymin", "xmax", "ymax")
        ):
            bbox_candidates.append(
                {field: [column.name, field] for field in ("xmin", "ymin", "xmax", "ymax")}
            )
    payload = _json.validate_python(
        {
            "source": reference,
            "schema_provenance": (
                "DuckDB SELECT * LIMIT 0 over the resolved Parquet source; no feature rows scanned"
            ),
            "columns": [column.model_dump() for column in columns],
            "geometry_fields": geometry_fields,
            "bbox_candidates": bbox_candidates,
            "guidance": [
                "Match get_dataset_file.query_hints partition fields against these actual columns "
                "before filtering. Preserve leading zeroes in partition values.",
                "BBox candidates are numeric struct fields, not proof of geometry association or "
                "CRS. Verify the source bbox convention before applying them; never substitute "
                "catalog extent bounds for per-row bbox fields.",
                "A null CRS is unknown: do not guess or silently assume EPSG:4326. "
                "Use authoritative source metadata to resolve it.",
                "Use partition filters and scalar bbox overlap predicates before exact spatial "
                "predicates. Transform the small query region or point set into the source CRS "
                "instead of wrapping every large-source geometry in ST_Transform in WHERE.",
            ],
        }
    )
    return ToolResult(
        text="Query source inspection:\n" + json.dumps(payload, separators=(",", ":")),
        structured_content=payload,
    )
