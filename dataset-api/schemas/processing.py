"""Pydantic schemas for dataset processing."""

from pydantic import BaseModel


class ProcessRequest(BaseModel):
    """Request to process a parquet dataset."""

    name: str  # Dataset identifier (used for file naming)
    parquet_url: str  # URL to source parquet file (GCS public bucket or HTTP)


class ProcessResponse(BaseModel):
    """Result of processing a dataset."""

    success: bool
    name: str
    pmtiles_url: str | None = None
    geoparquet_url: str | None = None
    feature_count: int | None = None
    bounds: str | None = None  # WKT or GeoJSON bbox
    geometry_type: str | None = None
    error: str | None = None
