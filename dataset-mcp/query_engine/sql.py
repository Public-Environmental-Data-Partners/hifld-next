"""Compile approved SQL into request-local ClickHouse source bindings."""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlglot import ErrorLevel, exp, parse_one
from sqlglot.optimizer.scope import Scope, traverse_scope

from app.query.sql_policy import SqlPolicy, SqlPolicyError
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
) -> str:
    target_crs = working_crs or ("EPSG:4326" if spatial else None)
    if target_crs is not None and re.fullmatch(r"EPSG:[1-9][0-9]*|OGC:CRS84", target_crs) is None:
        raise SqlPolicyError("Working CRS must be an EPSG authority code or OGC:CRS84")
    validated = SqlPolicy.validate(sql, frozenset(source.alias for source in sources))
    statement = parse_one(validated.canonical_sql, read="duckdb")
    for name in statement.find_all(exp.Identifier):
        identifier(name.name)
    bindings = {source.alias.casefold(): source for source in sources}
    for scope in traverse_scope(statement):
        for table, resolved in scope.selected_sources.values():
            if isinstance(resolved, Scope):
                continue
            source = bindings[resolved.name.casefold()]
            relation = source_relation(source, seaweed_endpoint=seaweed_endpoint)
            native_filter = (source_filters or {}).get(source.alias)
            if native_filter:
                relation = f"SELECT * FROM ({relation}) WHERE {native_filter}"
            if target_crs is not None:
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
