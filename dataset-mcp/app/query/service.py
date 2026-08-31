"""Application boundary between validated queries and the worker process pool."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import urlsplit

from app.errors import AppError, ErrorCode
from app.query.models import ColumnResult, PageResult, ResolvedSource
from app.query.sql_policy import ValidatedSql
from app.storage.models import (
    DuckDbSourceSpec,
    PublicGcsProfile,
    S3Profile,
    StorageSettings,
)
from query_worker.protocol import (
    WorkerCredentialProfile,
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerSourceSpec,
)


@dataclass(frozen=True, slots=True)
class ExecutionSource:
    resolved: ResolvedSource
    duckdb: DuckDbSourceSpec


class QueryExecutor(Protocol):
    async def execute(
        self,
        request: WorkerQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult: ...


def _duckdb_s3_endpoint(endpoint: str) -> str:
    """Return the authority DuckDB expects for its S3 ENDPOINT setting."""
    if endpoint.startswith(("http://", "https://")):
        return urlsplit(endpoint).netloc
    return endpoint.rstrip("/")


def worker_profiles_from_storage(
    settings: StorageSettings,
) -> tuple[WorkerCredentialProfile, ...]:
    """Copy server credentials into immutable spawn-time worker config."""
    profiles: list[WorkerCredentialProfile] = []
    for slug, profile in settings.profiles.items():
        if isinstance(profile, PublicGcsProfile):
            continue
        if isinstance(profile, S3Profile):
            profiles.append(
                WorkerCredentialProfile(
                    slug=slug,
                    type="s3",
                    bucket=profile.bucket,
                    prefix=profile.prefix,
                    region=profile.region,
                    access_key_id=profile.access_key_id.get_secret_value(),
                    secret_access_key=profile.secret_access_key.get_secret_value(),
                )
            )
            continue
        profiles.append(
            WorkerCredentialProfile(
                slug=slug,
                type="seaweedfs",
                bucket=profile.bucket,
                prefix=profile.prefix,
                endpoint=_duckdb_s3_endpoint(profile.endpoint),
                url_style="path" if profile.use_path_style else "vhost",
                tls=profile.tls,
                access_key_id=profile.access_key_id.get_secret_value(),
                secret_access_key=profile.secret_access_key.get_secret_value(),
            )
        )
    return tuple(profiles)


_FAILURE_CODES: dict[str, ErrorCode] = {
    "query_timeout": ErrorCode.QUERY_TIMEOUT,
    "query_memory_limit": ErrorCode.QUERY_MEMORY_LIMIT,
    "query_spill_limit": ErrorCode.QUERY_SPILL_LIMIT,
    "query_offset_limit": ErrorCode.QUERY_OFFSET_LIMIT,
    "query_execution_failed": ErrorCode.QUERY_EXECUTION_FAILED,
    "query_result_too_wide": ErrorCode.QUERY_RESULT_TOO_WIDE,
    "storage_unavailable": ErrorCode.STORAGE_UNAVAILABLE,
    "worker_failed": ErrorCode.WORKER_FAILED,
    "worker_protocol_invalid": ErrorCode.WORKER_PROTOCOL_INVALID,
    "worker_unavailable": ErrorCode.WORKER_UNAVAILABLE,
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
        profile_slug = (
            source.resolved.storage_location_slug if source.duckdb.secret is not None else None
        )
        return WorkerSourceSpec(
            alias=source.resolved.source.alias,
            object_uris=source.duckdb.object_uris,
            profile_slug=profile_slug,
        )

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
