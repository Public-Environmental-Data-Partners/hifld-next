"""Application boundary between validated queries and the worker process pool."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from app.errors import AppError, ErrorCode
from app.query.models import ColumnResult, PageResult, ResolvedSource
from app.query.sql_policy import ValidatedSql
from app.storage.models import DuckDbSourceSpec
from query_worker.protocol import (
    WorkerBounds,
    WorkerBoundsQuery,
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerSeaweedSource,
    WorkerSourceSpec,
)


@dataclass(frozen=True, slots=True)
class ExecutionSource:
    resolved: ResolvedSource
    duckdb: DuckDbSourceSpec


def worker_source(source: ExecutionSource) -> WorkerSourceSpec:
    """Shape trusted resolved storage into a non-secret worker request."""
    seaweedfs = source.duckdb.seaweedfs
    return WorkerSourceSpec(
        alias=source.resolved.source.alias,
        object_uris=source.duckdb.object_uris,
        seaweedfs=(
            WorkerSeaweedSource(
                bucket=seaweedfs.bucket,
                endpoint=seaweedfs.endpoint,
                tls=seaweedfs.tls,
                url_style=seaweedfs.url_style,
            )
            if seaweedfs is not None
            else None
        ),
    )


class QueryExecutor(Protocol):
    async def execute(
        self,
        request: WorkerQuery | WorkerBoundsQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult: ...


_FAILURE_CODES: dict[str, ErrorCode] = {
    "query_timeout": ErrorCode.QUERY_TIMEOUT,
    "query_memory_limit": ErrorCode.QUERY_MEMORY_LIMIT,
    "query_spill_limit": ErrorCode.QUERY_SPILL_LIMIT,
    "query_offset_limit": ErrorCode.QUERY_OFFSET_LIMIT,
    "query_execution_failed": ErrorCode.QUERY_EXECUTION_FAILED,
    "query_result_too_wide": ErrorCode.QUERY_RESULT_TOO_WIDE,
    "row_too_large": ErrorCode.ROW_TOO_LARGE,
    "storage_unavailable": ErrorCode.STORAGE_UNAVAILABLE,
    "worker_failed": ErrorCode.WORKER_FAILED,
    "worker_protocol_invalid": ErrorCode.WORKER_PROTOCOL_INVALID,
    "worker_unavailable": ErrorCode.WORKER_UNAVAILABLE,
    "map_not_supported": ErrorCode.MAP_NOT_SUPPORTED,
}


class QueryService:
    def __init__(
        self,
        executor: QueryExecutor,
        *,
        max_limit: int = 1_000,
        max_offset: int = 50_000,
        timeout_seconds: float = 30.0,
        max_result_bytes: int = 4 * 1024 * 1024,
        max_cell_bytes: int = 64 * 1024,
    ) -> None:
        if max_limit < 1:
            raise ValueError("max_limit must be positive")
        if max_offset < 0:
            raise ValueError("max_offset must not be negative")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._executor = executor
        self._max_limit = max_limit
        self._max_offset = max_offset
        self._timeout_seconds = timeout_seconds
        self._max_result_bytes = max_result_bytes
        self._max_cell_bytes = max_cell_bytes

    @staticmethod
    def _worker_source(source: ExecutionSource) -> WorkerSourceSpec:
        return worker_source(source)

    @staticmethod
    def _raise_failure(failure: WorkerFailure) -> None:
        code = _FAILURE_CODES.get(failure.code)
        if code is None:
            raise AppError(
                code=ErrorCode.INTERNAL_ERROR,
                message="The query worker returned an unknown failure",
            )
        message = failure.message
        raise AppError(code=code, message=message)

    async def execute_page(
        self,
        *,
        validated_sql: ValidatedSql,
        sources: tuple[ExecutionSource, ...],
        limit: int,
        offset: int,
    ) -> PageResult:
        if not 1 <= limit <= self._max_limit:
            raise ValueError(f"limit must be between 1 and {self._max_limit}")
        if not 0 <= offset <= self._max_offset:
            raise AppError(
                code=ErrorCode.QUERY_OFFSET_LIMIT,
                message=f"Query offset must not exceed {self._max_offset}",
            )

        request = WorkerQuery(
            canonical_sql=validated_sql.canonical_sql,
            sources=tuple(self._worker_source(source) for source in sources),
            limit=limit,
            offset=offset,
            deadline=datetime.now(tz=UTC) + timedelta(seconds=self._timeout_seconds),
            deterministic_order=validated_sql.deterministic_order,
            max_result_bytes=self._max_result_bytes,
            max_cell_bytes=self._max_cell_bytes,
        )
        response = await self._executor.execute(request, timeout_seconds=self._timeout_seconds)
        if isinstance(response, WorkerFailure):
            self._raise_failure(response)
        if not isinstance(response, WorkerPage):
            raise AppError(
                code=ErrorCode.WORKER_PROTOCOL_INVALID,
                message="The query worker returned an unexpected result",
            )

        warnings: list[str] = []
        if not response.deterministic_order:
            warnings.append("result_order_is_not_deterministic")
        if response.response_truncated:
            warnings.append("response_size_limit_reached")
        return PageResult(
            columns=[
                ColumnResult(name=name, logical_type=logical_type, nullable=nullable)
                for name, logical_type, nullable in response.columns
            ],
            rows=list(response.rows),
            offset=response.offset,
            returned_count=response.returned_count,
            has_more=response.has_more,
            next_offset=response.next_offset,
            warnings=tuple(warnings),
            elapsed_ms=response.elapsed_ms,
            bytes_read=response.bytes_read,
            files_read=response.files_read,
            response_truncated=response.response_truncated,
            deterministic_order=response.deterministic_order,
        )

    async def execute_bounds(
        self,
        *,
        validated_sql: ValidatedSql,
        sources: tuple[ExecutionSource, ...],
        geometry_column: str,
        result_crs: str,
    ) -> tuple[float, float, float, float]:
        request = WorkerBoundsQuery(
            canonical_sql=validated_sql.canonical_sql,
            sources=tuple(self._worker_source(source) for source in sources),
            geometry_column=geometry_column,
            result_crs=result_crs,
            deadline=datetime.now(tz=UTC) + timedelta(seconds=self._timeout_seconds),
        )
        response = await self._executor.execute(request, timeout_seconds=self._timeout_seconds)
        if isinstance(response, WorkerFailure):
            self._raise_failure(response)
        if not isinstance(response, WorkerBounds):
            raise AppError(
                code=ErrorCode.WORKER_PROTOCOL_INVALID,
                message="The query worker returned an unexpected result",
            )
        if response.bounds is None:
            raise AppError(
                code=ErrorCode.MAP_NOT_SUPPORTED,
                message="The query result has no geometry bounds",
            )
        return response.bounds
