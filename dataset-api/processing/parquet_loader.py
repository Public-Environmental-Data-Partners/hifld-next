"""Functions for loading parquet files from various sources."""

import logging

import geopandas as gpd

logger = logging.getLogger(__name__)


def load_parquet(url: str) -> gpd.GeoDataFrame:
    """
    Load a parquet file directly using geopandas.

    GeoPandas/PyArrow can read directly from:
    - gs:// URLs (Google Cloud Storage) - uses anonymous access for public buckets
    - s3:// URLs (AWS S3)
    - http:// and https:// URLs
    - Local file paths
    """
    logger.info(f"Loading parquet from: {url}")

    if url.startswith("gs://"):
        # Use pyarrow filesystem for GCS
        from pyarrow import fs

        # Parse gs://bucket/path
        parts = url[5:].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""

        # Create anonymous GCS filesystem
        gcs = fs.GcsFileSystem(anonymous=True)

        # Use geopandas with the filesystem - it handles geometry detection automatically
        gdf = gpd.read_parquet(f"{bucket}/{path}", filesystem=gcs)
        logger.info(f"Loaded {len(gdf)} features from GCS")
        return gdf
    else:
        # For other URLs (http, https, s3, local), geopandas handles them directly
        gdf = gpd.read_parquet(url)
        logger.info(f"Loaded {len(gdf)} features")
        return gdf
