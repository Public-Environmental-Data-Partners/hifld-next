"""
HIFLD Dataset API

FastAPI service for reading geospatial datasets:
- Read-only dataset and collection endpoints
- GeoServer integration
- Dataset creation/processing via scripts/import_inventory.py
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import init_db
from api import collections as collections_router
from api import datasets as datasets_router
from api import datasets_global as datasets_global_router
from api import geoserver as geoserver_router

# Processing router removed - use scripts/import_inventory.py for dataset processing

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dataset-api")

app = FastAPI(
    title="HIFLD Dataset API",
    description="Read-only API for geospatial datasets. Use scripts/import_inventory.py for dataset creation and processing.",
    version="1.0.0",
)

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


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    init_db()
    logger.info("Database initialized")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
