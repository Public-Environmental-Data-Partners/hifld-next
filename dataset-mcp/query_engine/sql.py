"""Compile approved SQL into request-local ClickHouse source bindings."""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlglot import ErrorLevel, exp, parse_one
from sqlglot.optimizer.scope import Scope, traverse_scope

from app.query.sql_policy import SqlPolicy, SqlPolicyError
from query_engine.results import ResultColumn
from query_worker.protocol import WorkerSourceSpec


@dataclass(frozen=True)
class GeometrySpec:
    name: str
    crs: str | None


def identifier(value: str) -> str:
    if "\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise SqlPolicyError("Unsupported control character or backslash in SQL identifier")
    return '"' + value.replace('"', '""') + '"'


def literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def source_url(source: WorkerSourceSpec, uri: str, seaweed_endpoint: str | None = None) -> str:
    parsed = urlsplit(uri)
    if parsed.query or parsed.fragment or parsed.username or "\x00" in uri:
        raise SqlPolicyError("Invalid catalog storage URI")
    if parsed.scheme in {"gs", "gcs"}:
        return f"https://storage.googleapis.com/{parsed.netloc}{parsed.path}"
    if parsed.scheme == "s3" and source.seaweedfs is not None:
        if parsed.netloc != source.seaweedfs.bucket:
            raise SqlPolicyError("Source bucket does not match configured storage")
        endpoint = seaweed_endpoint or (
            ("https" if source.seaweedfs.tls else "http") + "://" + source.seaweedfs.endpoint
        )
        return f"{endpoint.rstrip('/')}/{parsed.netloc}{parsed.path}"
    raise SqlPolicyError("Unsupported catalog storage URI")


def source_relation(
    source: WorkerSourceSpec, *, seaweed_endpoint: str | None = None, format_name: str = "Parquet"
) -> str:
    if format_name not in {"Parquet", "ParquetMetadata"}:
        raise ValueError("unsupported internal source format")
    if not source.object_uris:
        raise SqlPolicyError("Catalog source has no objects")
    selection = "_path" if format_name == "ParquetMetadata" else "*"
    parts = [
        f"SELECT {selection} FROM s3({literal(source_url(source, uri, seaweed_endpoint))}, "
        f"NOSIGN, {literal(format_name)})"
        for uri in source.object_uris
    ]
    return " UNION ALL ".join(parts)


def _typed_relation(
    source: WorkerSourceSpec,
    columns: tuple[ResultColumn, ...],
    geometry: tuple[GeometrySpec, ...],
    target_crs: str | None,
    seaweed_endpoint: str | None,
) -> str:
    """Expose physical scalar leaves to Parquet without changing the public schema.

    Inferred nested subcolumns behind a projection can lose statistics pushdown in
    ClickHouse. Explicit scalar scan columns retain it, even through user CTEs.
    Decode WKB once, after filtering, rather than native geometry -> WKB -> geometry.
    """
    fields = {field.name: field for field in geometry}
    names = {column.name for column in columns}
    structure: list[str] = []
    projection: list[str] = []
    for column in columns:
        name = identifier(column.name)
        field = fields.get(column.name)
        if field is not None:
            structure.append(f"{name} Nullable(String)")
            # Executable UDF arguments are non-nullable. Supply valid empty WKB
            # for evaluation, then restore NULL instead of inventing a geometry.
            value = f"ifNull({name}, unhex('010300000000000000'))"
            if target_crs is not None and field.crs != target_crs:
                if field.crs is None:
                    raise SqlPolicyError(f"Unknown CRS for geometry {field.name}")
                value = (
                    f"unhex(hifld_reproject_wkb(hex({value}), "
                    f"{literal(field.crs)}, {literal(target_crs)}))"
                )
            projection.append(f"if(isNull({name}), NULL, readWKB({value})) AS {name}")
            continue
        children: list[tuple[str, str]] = []
        if column.type.startswith("Tuple("):
            kind = exp.DataType.build(column.type, dialect="clickhouse")
            for child in kind.expressions:
                if not isinstance(child, exp.ColumnDef) or not isinstance(child.kind, exp.DataType):
                    break
                child_type = child.kind.sql(dialect="clickhouse")
                if not re.fullmatch(r"(?:Nullable\()?Float(?:32|64)\)?", child_type):
                    break
                children.append((child.name, child_type))
            else:
                if children and not any(f"{column.name}.{n}" in names for n, _ in children):
                    leaves = [identifier(f"{column.name}.{n}") for n, _ in children]
                    structure.extend(
                        f"{leaf} {t}" for leaf, (_, t) in zip(leaves, children, strict=True)
                    )
                    # Keep physical leaves visible through the binding: a filter
                    # on only the reconstructed tuple loses statistics pushdown.
                    projection.extend(leaves)
                    projection.append(
                        f"CAST(tuple({', '.join(leaves)}), {literal(column.type)}) AS {name}"
                    )
                    continue
        structure.append(f"{name} {column.type}")
        projection.append(name)
    return " UNION ALL ".join(
        f"SELECT {', '.join(projection)} FROM s3("
        f"{literal(source_url(source, uri, seaweed_endpoint))}, NOSIGN, 'Parquet', "
        f"{literal(', '.join(structure))})"
        for uri in source.object_uris
    )


_SPATIAL_FUNCTIONS = {
    "ST_INTERSECTS": "geometryIntersectCartesian",
    "ST_GEOMFROMTEXT": "readWKT",
}


def _spatial_function(node: exp.Expr) -> exp.Expr:
    if not isinstance(node, exp.Func):
        return node
    name = node.name.upper() if isinstance(node, exp.Anonymous) else node.sql_name().upper()
    if name in _SPATIAL_FUNCTIONS:
        return exp.Anonymous(this=_SPATIAL_FUNCTIONS[name], expressions=node.expressions)
    if name == "ST_ASHEXWKB" and len(node.expressions) == 1:
        return exp.Anonymous(
            this="hex", expressions=[exp.Anonymous(this="wkb", expressions=node.expressions)]
        )
    if name == "ST_GEOMFROMHEXWKB" and len(node.expressions) == 1:
        return exp.Anonymous(
            this="readWKB", expressions=[exp.Anonymous(this="unhex", expressions=node.expressions)]
        )
    if name in {"ST_ASWKB", "ST_GEOMFROMWKB"}:
        raise SqlPolicyError(
            "Binary WKB cannot be returned safely as JSON. Use ST_AsHexWKB and "
            "ST_GeomFromHexWKB instead, or select the geometry column directly."
        )
    if name == "ST_MAKEENVELOPE":
        if len(node.expressions) != 4:
            raise SqlPolicyError("ST_MakeEnvelope requires four coordinates")
        coords: list[float] = []
        for arg in node.expressions:
            try:
                coords.append(float(arg.sql()))
            except ValueError as error:
                raise SqlPolicyError(
                    "ST_MakeEnvelope requires constant numeric coordinates"
                ) from error
        west, south, east, north = coords
        if not all(math.isfinite(value) for value in coords) or west > east or south > north:
            raise SqlPolicyError("ST_MakeEnvelope bounds are invalid")
        wkt = (
            f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
        )
        return exp.Anonymous(this="readWKT", expressions=[exp.Literal.string(wkt)])
    if name.startswith("ST_"):
        raise SqlPolicyError(
            f"{name} is not supported by the ClickHouse query engine. "
            "Map sources are reprojected automatically; inspect_query_source reports native CRS."
        )
    return node


def compile_query(
    sql: str,
    sources: tuple[WorkerSourceSpec, ...],
    *,
    seaweed_endpoint: str | None = None,
    geometry: Mapping[str, tuple[GeometrySpec, ...]] | None = None,
    spatial: bool = False,
    working_crs: str | None = None,
    source_filters: Mapping[str, str] | None = None,
    schemas: Mapping[str, tuple[ResultColumn, ...]] | None = None,
) -> str:
    target_crs = working_crs or ("EPSG:4326" if spatial else None)
    if target_crs is not None and re.fullmatch(r"EPSG:[1-9][0-9]*|OGC:CRS84", target_crs) is None:
        raise SqlPolicyError("Working CRS must be an EPSG authority code or OGC:CRS84")
    validated = SqlPolicy.validate(sql, frozenset(source.alias for source in sources))
    statement = parse_one(validated.canonical_sql, read="duckdb")
    # Internal physical leaves must never leak through a user wildcard. Keep the
    # native binding for wildcard queries rather than rewrite join/star semantics.
    has_projection_star = any(
        item.is_star for select in statement.find_all(exp.Select) for item in select.expressions
    )
    for name in statement.find_all(exp.Identifier):
        identifier(name.name)
    bindings = {source.alias.casefold(): source for source in sources}
    for scope in traverse_scope(statement):
        for table, resolved in scope.selected_sources.values():
            if isinstance(resolved, Scope):
                continue
            source = bindings[resolved.name.casefold()]
            relation = source_relation(source, seaweed_endpoint=seaweed_endpoint)
            columns = None if has_projection_star else (schemas or {}).get(source.alias)
            if columns:
                relation = _typed_relation(
                    source,
                    columns,
                    (geometry or {}).get(source.alias, ()),
                    target_crs,
                    seaweed_endpoint,
                )
            native_filter = (source_filters or {}).get(source.alias)
            if native_filter:
                relation = f"SELECT * FROM ({relation}) WHERE {native_filter}"
            if target_crs is not None and not columns:
                replacements: list[str] = []
                for field in (geometry or {}).get(source.alias, ()):
                    if field.crs is None:
                        raise SqlPolicyError(
                            f"Unknown CRS for geometry {field.name}; cannot normalize map source"
                        )
                    if field.crs != target_crs:
                        column = identifier(field.name)
                        replacements.append(
                            "readWKB(unhex(hifld_reproject_wkb(hex(wkb("
                            f"{column})), {literal(field.crs)}, {literal(target_crs)}))) "
                            f"AS {column}"
                        )
                if replacements:
                    relation = f"SELECT * REPLACE ({', '.join(replacements)}) FROM ({relation})"
            subquery = exp.Subquery(this=parse_one(relation, read="clickhouse"))
            subquery.set(
                "alias",
                table.args.get("alias") or exp.TableAlias(this=exp.to_identifier(table.name)),
            )
            table.replace(subquery)
    for node in reversed(list(statement.walk())):
        replacement = _spatial_function(node)
        if replacement is not node:
            node.replace(replacement)
    return statement.sql(dialect="clickhouse", unsupported_level=ErrorLevel.RAISE)
