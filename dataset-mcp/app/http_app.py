"""ASGI assembly for MCP, tile, static asset, and health endpoints."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp, Receive, Scope, Send

from app.http.tiles import TileService, create_tile_router
from app.mcp_server import AppDependencies, UIResourceConfig, create_mcp_server

type LifecycleAction = Callable[[], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class HttpDependencies:
    tools: AppDependencies
    startup: tuple[LifecycleAction, ...] = ()
    shutdown: tuple[LifecycleAction, ...] = ()
    tile_service: TileService | None = None
    tile_timeout_seconds: float = 10.0


class ConcurrencyLimiter:
    """One process-wide bound shared by MCP, tile, and asset traffic."""

    def __init__(self, app: ASGIApp, maximum: int) -> None:
        self._app = app
        self._semaphore = asyncio.Semaphore(maximum)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            async with self._semaphore:
                await self._app(scope, receive, send)
            return
        await self._app(scope, receive, send)


class AssetHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/assets/"):
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        return response


class LazyProductionApplication:
    """Delay environment parsing until ASGI startup while remaining import-safe."""

    def __init__(self) -> None:
        self._application: ASGIApp | None = None
        self._lock = asyncio.Lock()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self._application is None:
            async with self._lock:
                if self._application is None:
                    from app.production import create_production_app

                    self._application = create_production_app()
        await self._application(scope, receive, send)


def create_http_app(
    dependencies: AppDependencies | HttpDependencies,
    *,
    ui_html: str | None = None,
    resource_config: UIResourceConfig | None = None,
    assets_directory: Path | None = None,
    max_concurrency: int = 8,
) -> FastAPI:
    """Create a single lifespan for stateless MCP and sibling HTTP routes."""
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be at least one")
    if isinstance(dependencies, HttpDependencies):
        http_dependencies = dependencies
    else:
        http_dependencies = HttpDependencies(tools=dependencies)
    mcp = create_mcp_server(
        http_dependencies.tools, ui_html=ui_html, resource_config=resource_config
    )
    # FastMCP v3 applies the stateless setting on the ASGI factory, not FastMCP().
    mcp_asgi = mcp.http_app("/", stateless_http=True)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
        async with mcp_asgi.lifespan(mcp_asgi):
            try:
                for startup in http_dependencies.startup:
                    await startup()
                yield
            finally:
                for shutdown in reversed(http_dependencies.shutdown):
                    await shutdown()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(ConcurrencyLimiter, maximum=max_concurrency)
    app.add_middleware(AssetHeadersMiddleware)

    async def invalid_request(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_request", "message": "request validation failed"}},
        )

    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.add_exception_handler(ValueError, invalid_request)
    app.add_api_route("/healthz", healthz, methods=["GET"])
    if http_dependencies.tile_service is None:

        async def missing_tile(z: int, x: int, y: int) -> Response:
            del z, x, y
            return Response(status_code=404)

        app.add_api_route("/tiles/{z}/{x}/{y}.mvt", missing_tile, methods=["GET"])
    else:
        app.include_router(
            create_tile_router(
                http_dependencies.tile_service,
                timeout_seconds=http_dependencies.tile_timeout_seconds,
            )
        )

    static_root = assets_directory or Path(__file__).parent.parent / "ui" / "dist"
    if not static_root.is_dir():
        raise FileNotFoundError(f"built UI assets directory does not exist: {static_root}")
    app.mount("/assets", StaticFiles(directory=static_root), name="assets")

    app.mount("/mcp", mcp_asgi, name="mcp")
    return app


app: ASGIApp = LazyProductionApplication()
