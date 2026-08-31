"""Dependency-injected HTTP and app-tool adapters for spatial query results."""

from __future__ import annotations

from typing import Protocol

from fastapi import APIRouter, Header, Response
from starlette.responses import JSONResponse

from app.errors import AppError, ErrorCode
from query_worker.protocol import WorkerFailure, WorkerTile
from query_worker.tiles import validate_tile_coordinates

QUERY_TOKEN_HEADER = "X-HIFLD-Query-Token"
MVT_MEDIA_TYPE = "application/vnd.mapbox-vector-tile"
DEFAULT_TILE_TIMEOUT_SECONDS = 10.0


class TileService(Protocol):
    """Revalidates the token/sources and dispatches bounded worker requests."""

    async def render_tile(
        self,
        token: str,
        z: int,
        x: int,
        y: int,
        *,
        timeout_seconds: float,
    ) -> WorkerTile | WorkerFailure: ...


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": QUERY_TOKEN_HEADER,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Vary": QUERY_TOKEN_HEADER,
    }


def _response_headers() -> dict[str, str]:
    return {**_cors_headers(), "Cache-Control": "public, max-age=3600"}


def _error_status(code: str) -> int:
    if code in {ErrorCode.QUERY_TOKEN_INVALID, ErrorCode.QUERY_TOKEN_EXPIRED}:
        return 400
    if code == ErrorCode.QUERY_TIMEOUT:
        return 504
    if code in {
        ErrorCode.GEOMETRY_AMBIGUOUS,
        ErrorCode.GEOMETRY_CRS_REQUIRED,
        ErrorCode.MAP_NOT_SUPPORTED,
        ErrorCode.TILE_TOO_DENSE,
    }:
        return 422
    return 503


def _error_response(code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=_error_status(code),
        content={"code": code, "message": message},
        headers=_cors_headers(),
    )


def _app_error_response(error: AppError) -> JSONResponse:
    return _error_response(error.code.value, error.message)


def create_tile_router(
    service: TileService,
    *,
    timeout_seconds: float = DEFAULT_TILE_TIMEOUT_SECONDS,
) -> APIRouter:
    """Create the stateless tile router around a token-revalidating service."""

    if timeout_seconds <= 0 or timeout_seconds > DEFAULT_TILE_TIMEOUT_SECONDS:
        raise ValueError("tile timeout must be greater than zero and at most 10 seconds")
    router = APIRouter()

    async def tile_preflight(z: int, x: int, y: int) -> Response:
        del z, x, y
        return Response(status_code=204, headers=_cors_headers())

    async def tile(
        z: int,
        x: int,
        y: int,
        query_token: str | None = Header(default=None, alias=QUERY_TOKEN_HEADER),
    ) -> Response:
        # Coordinate validation, MVT MIME, and empty 204 behavior are adapted
        # from ../geoparquet-duckdb-partitioning/server.py:tile.
        if not validate_tile_coordinates(z, x, y):
            return Response(status_code=404, headers=_cors_headers())
        if query_token is None or not query_token.strip():
            return _error_response(
                ErrorCode.QUERY_TOKEN_INVALID.value, "A valid query token is required."
            )
        try:
            result = await service.render_tile(
                query_token, z, x, y, timeout_seconds=timeout_seconds
            )
        except AppError as error:
            return _app_error_response(error)
        except TimeoutError:
            return _error_response(
                ErrorCode.QUERY_TIMEOUT.value, "The tile query exceeded its time limit."
            )
        if isinstance(result, WorkerFailure):
            return _error_response(result.code, result.message)
        if not result.content:
            return Response(status_code=204, headers=_response_headers())
        return Response(
            content=result.content,
            media_type=MVT_MEDIA_TYPE,
            headers=_response_headers(),
        )

    router.add_api_route("/tiles/{z}/{x}/{y}.mvt", tile_preflight, methods=["OPTIONS"])
    router.add_api_route("/tiles/{z}/{x}/{y}.mvt", tile, methods=["GET"])
    return router
