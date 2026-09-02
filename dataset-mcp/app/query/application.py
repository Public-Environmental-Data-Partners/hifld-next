"""Stateless application service joining MCP query tools to worker execution."""

from __future__ import annotations

import hmac
import re
import secrets
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Protocol

from pydantic import RootModel, ValidationError

from app.catalog.client import CatalogClientError
from app.catalog.models import QuerySourceRef
from app.errors import AppError, ErrorCode
from app.query.models import JsonValue, PageResult, QueryTokenPayload, ResolvedSource
from app.query.service import ExecutionSource, QueryService, worker_source
from app.query.sql_policy import SqlPolicy, SqlPolicyError, ValidatedSql
from app.query.token_codec import QueryTokenCodec, QueryTokenError
from app.storage.resolver import StorageResolutionError, StorageResolver
from query_worker.protocol import (
    WorkerBoundsQuery,
    WorkerFailure,
    WorkerQuery,
    WorkerResult,
    WorkerSourceSpec,
    WorkerTile,
    WorkerTileQuery,
)

type JSONMapping = Mapping[str, JsonValue]

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_GEOMETRY_CRS = re.compile(r"^GEOMETRY\s*\(\s*'(?P<crs>EPSG:[1-9][0-9]*)'\s*\)$", re.IGNORECASE)


class _JsonMapping(RootModel[dict[str, JsonValue]]):
    pass


_SOURCE_CHANGED_CODES = frozenset(
    {"source_not_found", "source_identity_mismatch", "source_not_queryable"}
)
_SOURCE_NOT_GEOPARQUET_CODES = frozenset({"source_not_queryable"})
_CATALOG_ERROR_CODES: dict[str, ErrorCode] = {
    "catalog_not_found": ErrorCode.CATALOG_NOT_FOUND,
    "source_not_found": ErrorCode.CATALOG_NOT_FOUND,
    "catalog_unavailable": ErrorCode.CATALOG_UNAVAILABLE,
    "catalog_contract_invalid": ErrorCode.CATALOG_CONTRACT_INVALID,
    "schema_version_not_found": ErrorCode.SCHEMA_VERSION_NOT_FOUND,
}


class SourceResolver(Protocol):
    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource: ...


class WorkerExecutor(Protocol):
    async def execute(
        self,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult: ...


class QueryApplicationService:
    """Re-resolve trusted sources for every page, tile, and map request."""

    def __init__(
        self,
        *,
        source_resolver: SourceResolver,
        storage_resolver: StorageResolver,
        query_service: QueryService,
        worker_executor: WorkerExecutor,
        token_codec: QueryTokenCodec,
        token_ttl_seconds: int,
        tile_timeout_seconds: float,
        public_origin: str | None,
    ) -> None:
        if not 60 <= token_ttl_seconds <= 7_200:
            raise ValueError("token TTL must be between 60 and 7,200 seconds")
        self._source_resolver = source_resolver
        self._storage_resolver = storage_resolver
        self._query_service = query_service
        self._worker_executor = worker_executor
        self._token_codec = token_codec
        self._token_ttl_seconds = token_ttl_seconds
        self._tile_timeout_seconds = tile_timeout_seconds
        self._public_origin = public_origin.rstrip("/") if public_origin is not None else None

    def validate_sql(self, sql: str, aliases: Sequence[str]) -> None:
        try:
            SqlPolicy.validate(sql, frozenset(aliases))
        except SqlPolicyError as error:
            raise AppError(ErrorCode.SQL_REJECTED, str(error)) from error

    def validate_token(self, token: str) -> JSONMapping:
        payload = self._decode_token(token)
        return _JsonMapping.model_validate(
            {
                "token_version": payload.token_version,
                "expires_at": payload.expires_at.isoformat(),
            }
        ).root

    def validate_query_identity(self, token: str, query_id: str) -> None:
        """Ensure a signed token may only be used with its bound path identity."""
        payload = self._decode_token(token)
        if not hmac.compare_digest(payload.query_id, query_id):
            raise AppError(
                ErrorCode.QUERY_TOKEN_INVALID,
                "The query token is invalid or expired",
            )

    async def _execution_sources(
        self,
        refs: Sequence[QuerySourceRef],
        *,
        token_revalidation: bool = False,
    ) -> tuple[ExecutionSource, ...]:
        results: list[ExecutionSource] = []
        for ref in refs:
            try:
                resolved = await self._source_resolver.resolve(ref)
                duckdb_source = self._storage_resolver.resolve(resolved)
            except CatalogClientError as error:
                if token_revalidation and error.code in _SOURCE_CHANGED_CODES:
                    code = ErrorCode.SOURCE_CHANGED
                    message = "A query source changed after the token was issued"
                elif not token_revalidation and error.code in _SOURCE_NOT_GEOPARQUET_CODES:
                    code = ErrorCode.SOURCE_NOT_GEOPARQUET
                    message = "The selected source is not queryable GeoParquet"
                else:
                    code = _CATALOG_ERROR_CODES.get(error.code, ErrorCode.INTERNAL_ERROR)
                    message = (
                        "The catalog request could not be completed"
                        if code is ErrorCode.CATALOG_UNAVAILABLE
                        else "The catalog response did not match its contract"
                        if code is ErrorCode.CATALOG_CONTRACT_INVALID
                        else "The catalog request failed unexpectedly"
                        if code is ErrorCode.INTERNAL_ERROR
                        else "The selected catalog source was not found"
                    )
                raise AppError(code, message) from error
            except StorageResolutionError as error:
                raise AppError(
                    ErrorCode.STORAGE_UNAVAILABLE,
                    "The source storage profile is unavailable",
                ) from error
            results.append(ExecutionSource(resolved=resolved, duckdb=duckdb_source))
        return tuple(results)

    @staticmethod
    def _parse_source(source: JSONMapping) -> QuerySourceRef:
        try:
            return QuerySourceRef.model_validate(source)
        except ValidationError as error:
            raise ValueError("source must be a valid QuerySourceRef") from error

    @staticmethod
    def _validated_sql(sql: str, refs: Sequence[QuerySourceRef]) -> ValidatedSql:
        try:
            return SqlPolicy.validate(sql, frozenset(ref.alias for ref in refs))
        except SqlPolicyError as error:
            raise AppError(ErrorCode.SQL_REJECTED, str(error)) from error

    def _decode_token(self, token: str) -> QueryTokenPayload:
        try:
            return self._token_codec.decode(token)
        except QueryTokenError as error:
            code = (
                ErrorCode.QUERY_TOKEN_EXPIRED
                if "expired" in str(error).casefold()
                else ErrorCode.QUERY_TOKEN_INVALID
            )
            raise AppError(code, "The query token is invalid or expired") from error

    def _encode_token(
        self,
        validated: ValidatedSql,
        refs: Sequence[QuerySourceRef],
        *,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> tuple[str, str]:
        issued_at = datetime.now(tz=UTC).replace(microsecond=0)
        query_id = secrets.token_urlsafe(18)
        payload = QueryTokenPayload(
            canonical_sql=validated.canonical_sql,
            sources=tuple(refs),
            geometry_column=geometry_column,
            result_crs=result_crs,
            query_id=query_id,
            issued_at=issued_at,
            expires_at=issued_at + timedelta(seconds=self._token_ttl_seconds),
        )
        try:
            return self._token_codec.encode(payload), query_id
        except QueryTokenError as error:
            raise AppError(
                ErrorCode.QUERY_TOKEN_TOO_LARGE, "The query token is too large"
            ) from error

    def _page_payload(
        self,
        page: PageResult,
        *,
        limit: int,
        query_token: str | None = None,
        query_id: str | None = None,
        sources: Sequence[ExecutionSource] = (),
        geometry_column: str | None = None,
        result_crs: str | None = None,
    ) -> JSONMapping:
        parsed = page
        payload = _JsonMapping.model_validate(
            {
                "columns": [
                    {
                        "name": column.name,
                        "type": column.logical_type,
                        "nullable": column.nullable,
                    }
                    for column in parsed.columns
                ],
                "rows": parsed.rows,
                "offset": parsed.offset,
                "limit": limit,
                "returned_count": parsed.returned_count,
                "has_more": parsed.has_more,
                "warnings": list(parsed.warnings),
                "elapsed_ms": parsed.elapsed_ms,
                "bytes_read": parsed.bytes_read,
                "files_read": parsed.files_read,
                "response_truncated": parsed.response_truncated,
                "deterministic_order": parsed.deterministic_order,
            }
        ).root
        if parsed.next_offset is not None:
            payload["next_offset"] = parsed.next_offset
        if query_token is not None:
            payload["query_token"] = query_token
        if query_id is not None:
            payload["query_id"] = query_id
        map_configuration = self._map_configuration(
            sources,
            geometry_column=geometry_column,
            result_crs=result_crs,
            query_id=query_id,
        )
        if map_configuration is not None:
            payload["map_configuration"] = map_configuration
        return _JsonMapping.model_validate(payload).root

    @staticmethod
    def _resolve_map_columns(
        page: PageResult,
        sources: Sequence[ExecutionSource],
        *,
        geometry_column: str | None,
        result_crs: str | None,
        infer_source_crs: bool,
    ) -> tuple[str | None, str | None]:
        geometry_columns = tuple(
            column for column in page.columns if column.logical_type.upper().startswith("GEOMETRY")
        )
        if geometry_column is not None:
            matching = next(
                (column for column in geometry_columns if column.name == geometry_column),
                None,
            )
            if matching is None:
                raise AppError(
                    ErrorCode.MAP_NOT_SUPPORTED,
                    "The named geometry column is not a GEOMETRY result column",
                )
            resolved_geometry = geometry_column
        elif len(geometry_columns) == 1:
            matching = geometry_columns[0]
            resolved_geometry = matching.name
        else:
            matching = None
            resolved_geometry = None

        resolved_crs = result_crs
        if resolved_crs is None and matching is not None:
            declared_crs = _GEOMETRY_CRS.fullmatch(matching.logical_type)
            if declared_crs is not None:
                resolved_crs = declared_crs.group("crs").upper()
        if infer_source_crs and resolved_geometry is not None and resolved_crs is None:
            source_crs = {
                source.resolved.crs for source in sources if source.resolved.crs is not None
            }
            if len(source_crs) == 1:
                resolved_crs = next(iter(source_crs))
        return resolved_geometry, resolved_crs

    def _map_configuration(
        self,
        sources: Sequence[ExecutionSource],
        *,
        geometry_column: str | None,
        result_crs: str | None,
        query_id: str | None,
    ) -> dict[str, JsonValue] | None:
        if (
            self._public_origin is None
            or geometry_column is None
            or result_crs is None
            or query_id is None
        ):
            return None
        configuration: dict[str, JsonValue] = {
            "tile_url": (
                f"{self._public_origin}/api/queries/{query_id}/tiles/{{z}}/{{x}}/{{y}}.mvt"
            ),
            "worker_url": f"{self._public_origin}/assets/maplibre-gl-worker.mjs",
            "source_layer": "hifld",
            "geometry_column": geometry_column,
            "result_crs": result_crs,
        }
        bounds = [source.resolved.bbox for source in sources]
        if (
            bounds
            and all(bound is not None for bound in bounds)
            and all(source.resolved.crs == "EPSG:4326" for source in sources)
        ):
            concrete_bounds = [bound for bound in bounds if bound is not None]
            configuration["initial_bounds"] = [
                min(bound[0] for bound in concrete_bounds),
                min(bound[1] for bound in concrete_bounds),
                max(bound[2] for bound in concrete_bounds),
                max(bound[3] for bound in concrete_bounds),
            ]
        return configuration

    async def read_rows(
        self, source: JSONMapping, columns: Sequence[str], limit: int, offset: int
    ) -> JSONMapping:
        ref = self._parse_source(source)
        if any(_IDENTIFIER.fullmatch(column) is None for column in columns):
            raise ValueError("columns must contain valid identifiers")
        projection = ", ".join(f'"{column}"' for column in columns) if columns else "*"
        validated = self._validated_sql(f'SELECT {projection} FROM "{ref.alias}"', (ref,))
        sources = await self._execution_sources((ref,))
        page = await self._query_service.execute_page(
            validated_sql=validated,
            sources=sources,
            limit=limit,
            offset=offset,
        )
        resolved_geometry, resolved_crs = self._resolve_map_columns(
            page,
            sources,
            geometry_column=None,
            result_crs=None,
            infer_source_crs=True,
        )
        token, query_id = self._encode_token(
            validated,
            (ref,),
            geometry_column=resolved_geometry,
            result_crs=resolved_crs,
        )
        return self._page_payload(
            page,
            limit=limit,
            query_token=token,
            query_id=query_id,
            sources=sources,
            geometry_column=resolved_geometry,
            result_crs=resolved_crs,
        )

    async def query(
        self,
        sources: Sequence[JSONMapping],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> JSONMapping:
        refs = tuple(self._parse_source(source) for source in sources)
        if len({ref.alias.casefold() for ref in refs}) != len(refs):
            raise ValueError("source aliases must be unique")
        validated = self._validated_sql(sql, refs)
        execution_sources = await self._execution_sources(refs)
        page = await self._query_service.execute_page(
            validated_sql=validated,
            sources=execution_sources,
            limit=limit,
            offset=0,
        )
        resolved_geometry, resolved_crs = self._resolve_map_columns(
            page,
            execution_sources,
            geometry_column=geometry_column,
            result_crs=result_crs,
            infer_source_crs=False,
        )
        token, query_id = self._encode_token(
            validated,
            refs,
            geometry_column=resolved_geometry,
            result_crs=resolved_crs,
        )
        return self._page_payload(
            page,
            limit=limit,
            query_token=token,
            query_id=query_id,
            sources=execution_sources,
            geometry_column=resolved_geometry,
            result_crs=resolved_crs,
        )

    async def page(self, token: str, offset: int, limit: int) -> JSONMapping:
        payload = self._decode_token(token)
        validated = self._validated_sql(payload.canonical_sql, payload.sources)
        sources = await self._execution_sources(payload.sources, token_revalidation=True)
        page = await self._query_service.execute_page(
            validated_sql=validated,
            sources=sources,
            limit=limit,
            offset=offset,
        )
        return self._page_payload(
            page,
            limit=limit,
            query_token=token,
            query_id=payload.query_id,
        )

    async def map_configuration(self, token: str) -> JSONMapping:
        public_origin = self._public_origin
        if public_origin is None:
            raise AppError(
                ErrorCode.MAP_NOT_SUPPORTED,
                "Map rendering is not configured for this server",
            )
        payload = self._decode_token(token)
        if payload.geometry_column is None:
            raise AppError(
                ErrorCode.GEOMETRY_AMBIGUOUS,
                "The query does not have one selected geometry column",
            )
        if payload.result_crs is None:
            raise AppError(
                ErrorCode.GEOMETRY_CRS_REQUIRED,
                "The query geometry coordinate reference system is required",
            )
        sources = await self._execution_sources(payload.sources, token_revalidation=True)
        configuration = self._map_configuration(
            sources,
            geometry_column=payload.geometry_column,
            result_crs=payload.result_crs,
            query_id=payload.query_id,
        )
        if configuration is None:
            raise AppError(
                ErrorCode.MAP_NOT_SUPPORTED,
                "Map rendering is not configured for this server",
            )
        # MCP Apps run in sandboxed iframes whose Origin is commonly `null`.
        # Use the capability-token tile route, which intentionally permits
        # cross-origin reads, instead of the webapp-only REST route.
        configuration["tile_url"] = (
            f"{public_origin}/tiles/{payload.query_id}/{{z}}/{{x}}/{{y}}.mvt"
        )
        return _JsonMapping.model_validate(
            {
                "query_token": token,
                "query_id": payload.query_id,
                "map_configuration": configuration,
            }
        ).root

    async def bounds(self, token: str) -> JSONMapping:
        payload = self._decode_token(token)
        if payload.geometry_column is None:
            raise AppError(
                ErrorCode.GEOMETRY_AMBIGUOUS,
                "The query does not have one selected geometry column",
            )
        if payload.result_crs is None:
            raise AppError(
                ErrorCode.GEOMETRY_CRS_REQUIRED,
                "The query geometry coordinate reference system is required",
            )
        validated = self._validated_sql(payload.canonical_sql, payload.sources)
        sources = await self._execution_sources(payload.sources, token_revalidation=True)
        bounds = await self._query_service.execute_bounds(
            validated_sql=validated,
            sources=sources,
            geometry_column=payload.geometry_column,
            result_crs=payload.result_crs,
        )
        return _JsonMapping.model_validate({"bounds": list(bounds)}).root

    @staticmethod
    def _worker_sources(sources: Sequence[ExecutionSource]) -> tuple[WorkerSourceSpec, ...]:
        return tuple(worker_source(source) for source in sources)

    async def render_tile(
        self,
        token: str,
        z: int,
        x: int,
        y: int,
        *,
        timeout_seconds: float,
    ) -> WorkerTile | WorkerFailure:
        payload = self._decode_token(token)
        if payload.geometry_column is None:
            raise AppError(
                ErrorCode.GEOMETRY_AMBIGUOUS,
                "A geometry column is required for map rendering",
            )
        sources = await self._execution_sources(payload.sources, token_revalidation=True)
        request = WorkerTileQuery(
            canonical_sql=payload.canonical_sql,
            sources=self._worker_sources(sources),
            z=z,
            x=x,
            y=y,
            geometry_column=payload.geometry_column,
            result_crs=payload.result_crs,
            feature_cap=20_000,
            deadline=datetime.now(tz=UTC) + timedelta(seconds=timeout_seconds),
        )
        result = await self._worker_executor.execute(request, timeout_seconds=timeout_seconds)
        if isinstance(result, (WorkerTile, WorkerFailure)):
            return result
        return WorkerFailure(
            "worker_protocol_invalid", "The query worker returned an unexpected result"
        )
