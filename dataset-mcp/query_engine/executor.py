"""Request-local query execution on the shared ClickHouse service."""

import asyncio
from datetime import UTC, datetime

import httpx
from pydantic import ValidationError

from app.query.serialization import RowTooLargeError, serialize_rows
from app.query.sql_policy import SqlPolicyError
from query_engine.client import ClickHouseClient, ClickHouseError
from query_engine.metadata import MetadataReader
from query_engine.results import ClickHouseResult, ResultColumn
from query_engine.sql import compile_query, identifier
from query_engine.tasks import gather_owned
from query_worker.protocol import (
    WorkerBoundsQuery,
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerTileQuery,
)

_GEOMETRIES = frozenset(
    {"Point", "LineString", "MultiLineString", "Ring", "Polygon", "MultiPolygon", "Geometry"}
)


def is_geometry(kind: str) -> bool:
    return kind.removeprefix("Nullable(").removesuffix(")") in _GEOMETRIES


def public_type(kind: str, crs: str | None = None) -> str:
    if is_geometry(kind):
        return f"GEOMETRY('{crs}')" if crs else "GEOMETRY"
    kind = kind[9:-1] if kind.startswith("Nullable(") else kind
    if kind.startswith(("UInt", "Int")):
        return "BIGINT"
    if kind.startswith(("Float", "Decimal")):
        return "DOUBLE"
    return {"String": "VARCHAR", "Bool": "BOOLEAN"}.get(kind, kind)


class ClickHouseExecutor:
    def __init__(self, client: ClickHouseClient, *, seaweed_endpoint: str | None = None) -> None:
        self.client = client
        self.metadata = MetadataReader(client, seaweed_endpoint=seaweed_endpoint)
        self.seaweed_endpoint = seaweed_endpoint

    async def start(self) -> None:
        await self.client.query("SELECT 1 FORMAT JSONCompact", timeout_seconds=5)

    async def close(self) -> None:
        await self.metadata.close()
        await self.client.close()

    async def execute(
        self,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        remaining = (request.deadline - datetime.now(UTC)).total_seconds()
        remaining = min(remaining, timeout_seconds) if timeout_seconds is not None else remaining
        if remaining <= 0:
            return WorkerFailure("query_timeout", "The query deadline has expired")
        try:
            async with asyncio.timeout(remaining):
                if isinstance(request, WorkerQuery):
                    return await self._page(request, remaining)
                from query_engine.tiles import execute_spatial

                return await execute_spatial(self, request, remaining)
        except (TimeoutError, httpx.TimeoutException):
            return WorkerFailure("query_timeout", "Query exceeded its time limit")
        except ClickHouseError as error:
            code = {
                "query_failed": "query_execution_failed",
                "query_schema": "query_execution_failed",
                "clickhouse_unavailable": "worker_unavailable",
                "response_too_large": "row_too_large",
            }.get(error.code, error.code)
            return WorkerFailure(code, error.message)
        except RowTooLargeError:
            return WorkerFailure("row_too_large", "A result row exceeds the response size limit")
        except (SqlPolicyError, ValidationError, ValueError) as error:
            return WorkerFailure(
                "query_execution_failed",
                str(error)
                if isinstance(error, SqlPolicyError)
                else "Query result or geometry metadata is invalid",
            )
        except httpx.HTTPError:
            return WorkerFailure("storage_unavailable", "Unable to read source geometry metadata")

    async def compiled(
        self,
        sql: str,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        working_crs: str | None,
    ) -> tuple[str, str | None]:
        declarations = await gather_owned(
            *(self.metadata.resolve(source) for source in request.sources)
        )
        geometry = {
            source.alias: fields
            for source, fields in zip(request.sources, declarations, strict=True)
        }
        crs_values = {field.crs for fields in declarations for field in fields}
        inferred = next(iter(crs_values)) if len(crs_values) == 1 else None
        schemas: dict[str, tuple[ResultColumn, ...]] = {}
        for source, fields in zip(request.sources, declarations, strict=True):
            if fields:
                schemas[source.alias] = await self.metadata.schema(source)
        filters: dict[str, str] = {}
        if isinstance(request, WorkerTileQuery) and len(request.sources) == 1:
            from query_engine.pruning import covering_filter
            from query_engine.tiles import tile_bounds

            predicate = covering_filter(
                sql,
                request.geometry_column,
                declarations[0],
                tile_bounds(request.z, request.x, request.y),
            )
            if predicate is not None:
                filters[request.sources[0].alias] = predicate
        return compile_query(
            sql,
            request.sources,
            seaweed_endpoint=self.seaweed_endpoint,
            geometry=geometry,
            working_crs=working_crs,
            source_filters=filters,
            schemas=schemas,
        ), working_crs or inferred

    async def describe(self, sql: str, timeout: float) -> ClickHouseResult:
        return ClickHouseResult.model_validate_json(
            await self.client.query(
                f"SELECT * FROM ({sql}) LIMIT 0 FORMAT JSONCompact", timeout_seconds=timeout
            )
        )

    async def _page(self, request: WorkerQuery, timeout: float) -> WorkerPage:
        sql, crs = await self.compiled(request.canonical_sql, request, request.working_crs)
        schema = await self.describe(sql, timeout)
        if len(schema.meta) > 200:
            raise ClickHouseError("query_result_too_wide", "Query exceeds the 200 column limit")
        if len({c.name for c in schema.meta}) != len(schema.meta):
            raise ClickHouseError(
                "query_schema", "Result columns must have unique names; use aliases"
            )
        selection = ", ".join(
            (
                f"length(wkb({identifier(c.name)})) AS {identifier(c.name)}"
                if request.materialize_geometry
                else f"1 AS {identifier(c.name)}"
            )
            if is_geometry(c.type)
            else identifier(c.name)
            for c in schema.meta
        )
        result = ClickHouseResult.model_validate_json(
            await self.client.query(
                f"SELECT {selection} FROM ({sql}) LIMIT {request.limit + 1} "
                f"OFFSET {request.offset} FORMAT JSONCompact",
                timeout_seconds=timeout,
                max_response_bytes=16 * 1024 * 1024,
            )
        )
        columns = tuple((c.name, public_type(c.type, crs)) for c in schema.meta)
        rows: list[tuple[object, ...]] = []
        for row in result.data:
            values: list[object] = []
            for column, value in zip(schema.meta, row, strict=True):
                values.append(
                    (
                        {"$type": "geometry", "byte_length": value}
                        if request.materialize_geometry
                        else {"$type": "geometry", "omitted": True}
                    )
                    if is_geometry(column.type) and isinstance(value, int)
                    else value
                )
            rows.append(tuple(values))
        serialized = serialize_rows(
            columns=columns,
            rows=rows,
            offset=request.offset,
            requested_limit=request.limit,
            deterministic_order=request.deterministic_order,
            max_cell_bytes=request.max_cell_bytes or 65536,
            max_result_bytes=request.max_result_bytes or 4 * 1024 * 1024,
        )
        return WorkerPage(
            tuple((name, kind, True) for name, kind in columns),
            serialized.rows,
            request.offset,
            serialized.returned,
            serialized.has_more,
            result.statistics.elapsed * 1000,
            result.statistics.bytes_read,
            0,
            serialized.next_offset,
            serialized.response_truncated,
            serialized.deterministic_order,
        )
