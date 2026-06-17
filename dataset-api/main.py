"""HIFLD Next Dataset API.

FastAPI service for reading geospatial datasets:
- Read-only dataset and collection endpoints
- Dataset ingestion via scripts/import_datasets.py
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.types import ASGIApp

from alembic import command as alembic_command
from api import collections as collections_router
from api import datasets as datasets_router
from config import config
from database.db import init_db


# Processing router removed - use scripts/import_datasets.py for dataset ingestion

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("dataset-api")

ALEMBIC_INI_PATH = Path(__file__).parent / "alembic.ini"

# SQLAlchemy logging is controlled in database/db.py via ENABLE_DB_DEBUG


class TimeoutMiddleware(BaseHTTPMiddleware):
    """Middleware to add request timeout protection.

    Applies different timeouts based on the request path:
    - Download endpoints (download-zip, export) get 280 seconds (just under Cloud Run's 300s limit)
    - All other endpoints get 60 seconds
    """

    def __init__(self, app: ASGIApp, timeout: float = 60.0, long_timeout: float = 280.0) -> None:
        """Initialize timeout middleware."""
        super().__init__(app)
        self.timeout = timeout
        self.long_timeout = long_timeout
        # Paths that need longer timeouts
        self.long_timeout_paths = ["/download-zip", "/export/"]

    def _get_timeout(self, request: Request) -> float:
        """Determine the appropriate timeout for this request."""
        path = str(request.url.path)
        # Check if this is a long-running operation
        for long_path in self.long_timeout_paths:
            if long_path in path:
                logger.debug(f"Using long timeout ({self.long_timeout}s) for {path}")
                return self.long_timeout
        return self.timeout

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """Apply a timeout to request handling."""
        timeout = self._get_timeout(request)
        try:
            # Create a timeout task
            response = await asyncio.wait_for(call_next(request), timeout=timeout)
        except TimeoutError:
            logger.exception(f"Request timeout after {timeout}s: {request.url}")
            return JSONResponse(status_code=504, content={"detail": f"Request timeout after {timeout} seconds"})
        else:
            return response


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    # Log database URL (mask password for security)
    db_url = config.DATABASE_URL
    if "@" in db_url:
        # Mask password in URL for logging
        masked_url = db_url.split("@")[0].split(":")[0] + ":***@" + "@".join(db_url.split("@")[1:])
        logger.info(f"Connecting to database: {masked_url}")
    else:
        logger.info(f"Connecting to database: {db_url}")

    run_startup_database_setup()

    yield

    # Shutdown (if needed)
    logger.info("Shutting down")


def run_startup_database_setup() -> None:
    """Run the supported startup database initialization flow.

    The API intentionally follows the service-startup migration pattern used by
    tools like Dagster: report the current revision, apply Alembic migrations,
    report the resulting revision, then create any missing SQLModel tables.
    """
    alembic_cfg = AlembicConfig(str(ALEMBIC_INI_PATH))
    try:
        logger.info("Current database revision before startup migrations:")
        alembic_command.current(alembic_cfg)
        alembic_command.upgrade(alembic_cfg, "head")
        logger.info("Current database revision after startup migrations:")
        alembic_command.current(alembic_cfg)
        logger.info("Database migrations completed")
    except Exception:
        logger.exception("Failed to run migrations")
        raise

    try:
        init_db()
        logger.info("Database initialized")
    except Exception:
        logger.exception("Failed to initialize database tables")
        raise


app = FastAPI(
    title="HIFLD Next Dataset API",
    description="Read-only API for geospatial datasets. Use scripts/import_datasets.py for dataset ingestion.",
    version="1.0.0",
    lifespan=lifespan,
)

# Request timeout middleware (must be first to catch all requests)
# Default timeout: 60s for most endpoints
# Long timeout: 280s for download/export endpoints (just under Cloud Run's 300s limit)
app.add_middleware(TimeoutMiddleware, timeout=60.0, long_timeout=280.0)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers (read-only endpoints)
app.include_router(collections_router.router)  # GET only
app.include_router(datasets_router.router)  # GET only, nested under collections
# Processing router removed - use scripts/import_datasets.py for dataset ingestion


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
