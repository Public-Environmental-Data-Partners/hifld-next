"""Dependency-injected HTTP and app-tool adapters for spatial query results."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from fastapi import APIRouter, Header, Response
from starlette.responses import JSONResponse

from app.errors import AppError, ErrorCode
from app.query.models import JsonValue
from query_worker.protocol import WorkerFailure, WorkerTile
from query_worker.tiles import (
    MAX_MAP_BYTES,
    MAX_MAP_FEATURES,
    MapFeatureCollection,
    validate_tile_coordinates,
)

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

    async def render_map_features(
        self,
        token: str,
        bbox: tuple[float, float, float, float],
        zoom: int,
        feature_cap: int,
        *,
        max_result_bytes: int,
    ) -> MapFeatureCollection | WorkerFailure: ...


@dataclass(frozen=True, slots=True)
class MapToolResult:
    text: str
    structured_content: dict[str, JsonValue]
    visibility: tuple[str, ...] = ("app",)
    resource_uri: str = "ui://hifld/dataset-explorer.html"


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


def _failure_code(code: str) -> ErrorCode:
    try:
        return ErrorCode(code)
    except ValueError:
        return ErrorCode.MAP_NOT_SUPPORTED


async def get_map_features(
    service: TileService,
    query_token: str,
    bbox: tuple[float, float, float, float],
    zoom: int,
    *,
    feature_cap: int = MAX_MAP_FEATURES,
) -> MapToolResult:
    """Return the app-only, bounded GeoJSON compatibility response."""

    if not query_token.strip():
        raise AppError(ErrorCode.QUERY_TOKEN_INVALID, "A valid query token is required.")
    if not 0 <= zoom <= 24:
        raise ValueError("zoom must be between 0 and 24")
    if not 1 <= feature_cap <= MAX_MAP_FEATURES:
        raise ValueError("feature cap must be between 1 and 2,000")
    result = await service.render_map_features(
        query_token,
        bbox,
        zoom,
        feature_cap,
        max_result_bytes=MAX_MAP_BYTES,
    )
    if isinstance(result, WorkerFailure):
        raise AppError(_failure_code(result.code), result.message)
    payload = result.as_json()
    if len(json.dumps(payload, separators=(",", ":")).encode("utf-8")) > MAX_MAP_BYTES:
        raise AppError(
            ErrorCode.TILE_TOO_DENSE,
            "Map features exceed the feature or byte limit.",
        )
    return MapToolResult(
        text=f"GeoJSON map features: {len(result.features)} returned",
        structured_content=payload,
    )
