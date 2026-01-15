"""
HIFLD Dataset API

FastAPI service for reading geospatial datasets:
- Read-only dataset and collection endpoints
- GeoServer integration
- Dataset creation/processing via scripts/import_inventory.py
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from database.db import init_db
from api import collections as collections_router
from api import datasets as datasets_router
from api import datasets_global as datasets_global_router
from api import geoserver as geoserver_router

# Processing router removed - use scripts/import_inventory.py for dataset processing

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dataset-api")


class TimeoutMiddleware(BaseHTTPMiddleware):
    """Middleware to add request timeout protection."""
    
    def __init__(self, app, timeout: float = 60.0):
        super().__init__(app)
        self.timeout = timeout
    
    async def dispatch(self, request: Request, call_next):
        import asyncio
        
        try:
            # Create a timeout task
            response = await asyncio.wait_for(
                call_next(request),
                timeout=self.timeout
            )
            return response
        except asyncio.TimeoutError:
            logger.error(f"Request timeout after {self.timeout}s: {request.url}")
            return JSONResponse(
                status_code=504,
                content={"detail": f"Request timeout after {self.timeout} seconds"}
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    from config import config

    # Log database URL (mask password for security)
    db_url = config.DATABASE_URL
    if "@" in db_url:
        # Mask password in URL for logging
        masked_url = (
            db_url.split("@")[0].split(":")[0]
            + ":***@"
            + "@".join(db_url.split("@")[1:])
        )
        logger.info(f"Connecting to database: {masked_url}")
    else:
        logger.info(f"Connecting to database: {db_url}")

    # Run Alembic migrations
    alembic_cfg = Config(str(Path(__file__).parent / "alembic.ini"))
    try:
        command.upgrade(alembic_cfg, "head")
        logger.info("Database migrations completed")
    except Exception as e:
        logger.error(f"Failed to run migrations: {e}")
        raise

    # Initialize database (creates tables if they don't exist)
    init_db()
    logger.info("Database initialized")
    
    yield
    
    # Shutdown (if needed)
    logger.info("Shutting down")


app = FastAPI(
    title="HIFLD Dataset API",
    description="Read-only API for geospatial datasets. Use scripts/import_inventory.py for dataset creation and processing.",
    version="1.0.0",
    lifespan=lifespan,
)

# Request timeout middleware (must be first to catch all requests)
app.add_middleware(TimeoutMiddleware, timeout=60.0)

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
app.include_router(
    datasets_global_router.router
)  # GET only, global endpoints (backwards compatibility)
app.include_router(geoserver_router.router)  # GeoServer proxy endpoints
# Processing router removed - use scripts/import_inventory.py for dataset processing


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
