"""HTTP transport adapters for stateless signed query resources."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from time import perf_counter
from typing import Protocol

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

from app.errors import AppError, ErrorCode
from app.http.tiles import (
    DEFAULT_TILE_TIMEOUT_SECONDS,
    MVT_MEDIA_TYPE,
    QUERY_TOKEN_HEADER,
)
from app.observability import QueryObservability
from app.query.models import JsonValue
from query_worker.protocol import WorkerFailure, WorkerTile
from query_worker.tiles import validate_tile_coordinates


class _RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuerySourceHttpRequest(_RequestModel):
    alias: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    collection_id: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    file_id: int = Field(gt=0)
    file_source_id: int = Field(gt=0)


class QueryHttpRequest(_RequestModel):
    sources: list[QuerySourceHttpRequest] = Field(min_length=1, max_length=8)
    sql: str = Field(min_length=1)
    limit: int = Field(default=100, ge=1, le=1_000)
    geometry_column: str | None = None
    result_crs: str | None = None


class QueryPageHttpRequest(_RequestModel):
    offset: int = Field(ge=0)
    page_size: int = Field(default=100, ge=1, le=1_000)


class QueryHttpService(Protocol):
    async def query(
        self,
        sources: Sequence[Mapping[str, JsonValue]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> Mapping[str, JsonValue]: ...

    def validate_query_identity(self, token: str, query_id: str) -> None: ...

    async def page(self, token: str, offset: int, limit: int) -> Mapping[str, JsonValue]: ...

    async def render_tile(
        self,
        token: str,
        z: int,
        x: int,
        y: int,
        *,
        timeout_seconds: float,
    ) -> WorkerTile | WorkerFailure: ...


def _source_payload(source: QuerySourceHttpRequest) -> dict[str, JsonValue]:
    return {
        "alias": source.alias,
        "collection_id": source.collection_id,
        "dataset_id": source.dataset_id,
        "file_id": source.file_id,
        "file_source_id": source.file_source_id,
    }


def _public_payload(payload: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    """Defend the HTTP boundary against accidental storage-resolution output."""
    return {key: value for key, value in payload.items() if key != "resolved_sources"}


def _error_status(code: ErrorCode | str) -> int:
    if code in {
        ErrorCode.QUERY_TOKEN_INVALID,
        ErrorCode.QUERY_TOKEN_EXPIRED,
        ErrorCode.SQL_REJECTED,
        "invalid_request",
    }:
        return 400
    if code == ErrorCode.QUERY_TIMEOUT:
        return 504
    if code in {
        ErrorCode.GEOMETRY_AMBIGUOUS,
        ErrorCode.GEOMETRY_CRS_REQUIRED,
        ErrorCode.MAP_NOT_SUPPORTED,
        ErrorCode.QUERY_RESULT_TOO_WIDE,
        ErrorCode.ROW_TOO_LARGE,
        ErrorCode.TILE_TOO_DENSE,
    }:
        return 422
    return 503


def _error_response(
    code: ErrorCode | str, message: str, headers: Mapping[str, str]
) -> JSONResponse:
    value = code.value if isinstance(code, ErrorCode) else code
    return JSONResponse(
        status_code=_error_status(code),
        content={"code": value, "message": message},
        headers=headers,
    )


def _required_query_token(query_token: str | None) -> str:
    if query_token is None or not query_token.strip():
        raise AppError(ErrorCode.QUERY_TOKEN_INVALID, "A valid query token is required.")
    return query_token


def _tile_cors_headers(origin: str | None, webapp_origins: frozenset[str]) -> dict[str, str]:
    headers = {"Vary": f"Origin, {QUERY_TOKEN_HEADER}"}
    if origin in webapp_origins:
        headers.update(
            {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Headers": QUERY_TOKEN_HEADER,
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            }
        )
    return headers


def create_query_router(
    service: QueryHttpService,
    *,
    webapp_origins: tuple[str, ...] = (),
    tile_timeout_seconds: float = DEFAULT_TILE_TIMEOUT_SECONDS,
    observability: QueryObservability | None = None,
) -> APIRouter:
    """Adapt query application methods to stable REST resources without SQL logic."""
    if tile_timeout_seconds <= 0 or tile_timeout_seconds > DEFAULT_TILE_TIMEOUT_SECONDS:
        raise ValueError("tile timeout must be greater than zero and at most 10 seconds")
    router = APIRouter()
    allowed_origins = frozenset(webapp_origins)

    def record_transport(started_at: float) -> None:
        if observability is not None:
            observability.record_transport(
                transport="webapp_http",
                duration_ms=(perf_counter() - started_at) * 1_000,
            )

    async def create_query(request: QueryHttpRequest) -> JSONResponse:
        started_at = perf_counter()
        try:
            result = await service.query(
                tuple(_source_payload(source) for source in request.sources),
                request.sql,
                request.limit,
                request.geometry_column,
                request.result_crs,
            )
        except AppError as error:
            return _error_response(error.code, error.message, {})
        except ValueError:
            return _error_response("invalid_request", "request validation failed", {})
        finally:
            record_transport(started_at)
        return JSONResponse(content=_public_payload(result))

    async def query_page(
        query_id: str,
        request: QueryPageHttpRequest,
        query_token: str | None = Header(default=None, alias=QUERY_TOKEN_HEADER),
    ) -> JSONResponse:
        started_at = perf_counter()
        try:
            token = _required_query_token(query_token)
            service.validate_query_identity(token, query_id)
            result = await service.page(token, request.offset, request.page_size)
        except AppError as error:
            return _error_response(error.code, error.message, {})
        except ValueError:
            return _error_response("invalid_request", "request validation failed", {})
        finally:
            record_transport(started_at)
        return JSONResponse(content=_public_payload(result))

    async def query_tile_preflight(
        request: Request,
        query_id: str,
        z: int,
        x: int,
        y: int,
    ) -> Response:
        del query_id, z, x, y
        return Response(
            status_code=204,
            headers=_tile_cors_headers(request.headers.get("origin"), allowed_origins),
        )

    async def query_tile(
        request: Request,
        query_id: str,
        z: int,
        x: int,
        y: int,
        query_token: str | None = Header(default=None, alias=QUERY_TOKEN_HEADER),
    ) -> Response:
        headers = _tile_cors_headers(request.headers.get("origin"), allowed_origins)
        started_at = perf_counter()
        try:
            if not validate_tile_coordinates(z, x, y):
                return Response(status_code=404, headers=headers)
            token = _required_query_token(query_token)
            service.validate_query_identity(token, query_id)
            result = await service.render_tile(token, z, x, y, timeout_seconds=tile_timeout_seconds)
        except AppError as error:
            return _error_response(error.code, error.message, headers)
        except ValueError:
            return _error_response("invalid_request", "request validation failed", headers)
        except TimeoutError:
            return _error_response(
                ErrorCode.QUERY_TIMEOUT,
                "The tile query exceeded its time limit.",
                headers,
            )
        finally:
            record_transport(started_at)
        if isinstance(result, WorkerFailure):
            return _error_response(result.code, result.message, headers)
        if not result.content:
            return Response(status_code=204, headers=headers)
        return Response(content=result.content, media_type=MVT_MEDIA_TYPE, headers=headers)

    router.add_api_route("/api/queries", create_query, methods=["POST"])
    router.add_api_route("/api/queries/{query_id}/pages", query_page, methods=["POST"])
    router.add_api_route(
        "/api/queries/{query_id}/tiles/{z}/{x}/{y}.mvt",
        query_tile_preflight,
        methods=["OPTIONS"],
    )
    router.add_api_route(
        "/api/queries/{query_id}/tiles/{z}/{x}/{y}.mvt", query_tile, methods=["GET"]
    )
    return router
