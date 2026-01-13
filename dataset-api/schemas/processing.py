"""Pydantic schemas for dataset processing."""

from typing import Optional
from pydantic import BaseModel


class ProcessRequest(BaseModel):
    """Request to process a parquet dataset."""

    name: str  # Dataset identifier (used for file naming)
    parquet_url: str  # URL to source parquet file (GCS public bucket or HTTP)


class ProcessResponse(BaseModel):
    """Result of processing a dataset."""

    success: bool
    name: str
    pmtiles_url: Optional[str] = None
    geoparquet_url: Optional[str] = None
    feature_count: Optional[int] = None
    bounds: Optional[str] = None  # WKT or GeoJSON bbox
    geometry_type: Optional[str] = None
    error: Optional[str] = None






