"""
HIFLD Upload Processor

A simple FastAPI service for processing geospatial datasets.
Downloads parquet files, creates GeoParquet and PMTiles, uploads to storage.
"""

import logging
import tempfile
from pathlib import Path
from typing import Optional

import geopandas as gpd
from fastapi import FastAPI
from pydantic import BaseModel

from storage_client import create_storage_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upload-processor")

app = FastAPI(
    title="HIFLD Upload Processor",
    description="Process geospatial datasets: download, convert, and upload",
    version="1.0.0",
)


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
        # Use pyarrow with anonymous credentials for public GCS buckets
        import pyarrow.parquet as pq
        from pyarrow import fs
        import pandas as pd
        from shapely import wkb

        # Parse gs://bucket/path
        parts = url[5:].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""

        # Create anonymous GCS filesystem
        gcs = fs.GcsFileSystem(anonymous=True)

        # Read parquet to pandas DataFrame
        table = pq.read_table(f"{bucket}/{path}", filesystem=gcs)
        df = table.to_pandas()

        # Find geometry column (usually 'geometry' or 'geom')
        geom_col = None
        for col in ["geometry", "geom", "the_geom", "shape"]:
            if col in df.columns:
                geom_col = col
                break

        if geom_col is None:
            # Look for WKB binary columns
            for col in df.columns:
                if df[col].dtype == "object" and len(df) > 0:
                    sample = df[col].iloc[0]
                    if isinstance(sample, bytes):
                        geom_col = col
                        break

        if geom_col is not None:
            # Convert WKB to shapely geometries
            df["geometry"] = df[geom_col].apply(
                lambda x: wkb.loads(x) if isinstance(x, bytes) else x
            )
            if geom_col != "geometry":
                df = df.drop(columns=[geom_col])
            gdf = gpd.GeoDataFrame(df, geometry="geometry", crs="EPSG:4326")
        else:
            # No geometry found, create empty geometry
            logger.warning("No geometry column found, creating empty geometries")
            gdf = gpd.GeoDataFrame(
                df,
                geometry=gpd.points_from_xy([0] * len(df), [0] * len(df)),
                crs="EPSG:4326",
            )

        logger.info(f"Loaded {len(gdf)} features from GCS")
        return gdf
    else:
        gdf = gpd.read_parquet(url)
        logger.info(f"Loaded {len(gdf)} features")
        return gdf


def create_pmtiles(input_path: Path, output_path: Path, max_zoom: int = 14) -> bool:
    """
    Create PMTiles from a GeoDataFrame saved as FlatGeobuf.

    Uses tippecanoe if available, otherwise skips PMTiles creation.
    """
    import subprocess

    try:
        result = subprocess.run(
            [
                "tippecanoe",
                "-o",
                str(output_path),
                "-zg",  # Auto-detect zoom levels
                f"--maximum-zoom={max_zoom}",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--force",
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode == 0:
            logger.info(f"Created PMTiles: {output_path}")
            return True
        else:
            logger.warning(f"tippecanoe failed: {result.stderr}")
            return False

    except FileNotFoundError:
        logger.warning("tippecanoe not found, skipping PMTiles creation")
        return False
    except Exception as e:
        logger.warning(f"PMTiles creation failed: {e}")
        return False


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.post("/process", response_model=ProcessResponse)
async def process_dataset(request: ProcessRequest):
    """
    Process a parquet dataset.

    Steps:
    1. Load parquet directly from URL (gs://, s3://, http://)
    2. Validate and normalize data
    3. Create optimized GeoParquet
    4. Create PMTiles for visualization (if tippecanoe available)
    5. Upload processed files to storage (SeaweedFS)
    6. Return URLs and metadata
    """
    storage = create_storage_client()

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            working_dir = Path(temp_dir)

            # 1. Load parquet directly from URL
            logger.info(
                f"Processing {request.name}: loading from {request.parquet_url}..."
            )
            gdf = load_parquet(request.parquet_url)
            feature_count = len(gdf)

            # Get geometry info
            geometry_type = None
            bounds = None
            if "geometry" in gdf.columns and not gdf.geometry.isna().all():
                geom_types = gdf.geometry.geom_type.dropna().unique()
                geometry_type = geom_types[0] if len(geom_types) == 1 else "Mixed"

                # Get bounds as string
                try:
                    b = gdf.total_bounds  # [minx, miny, maxx, maxy]
                    bounds = f"[{b[0]:.6f}, {b[1]:.6f}, {b[2]:.6f}, {b[3]:.6f}]"
                except Exception:
                    pass

            # Ensure CRS is WGS84
            if gdf.crs is None:
                gdf = gdf.set_crs("EPSG:4326")
            elif gdf.crs != "EPSG:4326":
                gdf = gdf.to_crs("EPSG:4326")

            # Ensure 'id' column exists (required by GeoServer's GeoParquet plugin)
            if "id" not in gdf.columns:
                # Try to use an existing ID-like column
                id_candidates = ["OBJECTID", "FID", "fid", "GlobalID", "gid", "ogc_fid"]
                id_col = None
                for candidate in id_candidates:
                    if candidate in gdf.columns:
                        id_col = candidate
                        break

                if id_col:
                    gdf["id"] = gdf[id_col]
                    logger.info(f"Using '{id_col}' as 'id' column")
                else:
                    gdf["id"] = range(1, len(gdf) + 1)
                    logger.info("Created sequential 'id' column")

            # Move 'id' column to the front
            cols = ["id"] + [c for c in gdf.columns if c != "id"]
            gdf = gdf[cols]

            # 3. Create optimized GeoParquet
            logger.info(f"Processing {request.name}: creating GeoParquet...")
            data_dir = working_dir / "data"
            data_dir.mkdir()

            geoparquet_path = data_dir / f"{request.name}.parquet"
            gdf.to_parquet(
                geoparquet_path,
                compression="snappy",
                index=False,
            )

            # 4. Create PMTiles (if tippecanoe available)
            logger.info(f"Processing {request.name}: creating PMTiles...")
            pmtiles_path = None

            # Filter valid geometries for tiles
            gdf_valid = gdf[~gdf.geometry.isna()].copy()

            if len(gdf_valid) > 0:
                tiles_dir = working_dir / "tiles"
                tiles_dir.mkdir()

                # Save as FlatGeobuf for tippecanoe
                fgb_path = tiles_dir / f"{request.name}.fgb"
                gdf_valid.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")

                pmtiles_path = tiles_dir / f"{request.name}.pmtiles"
                if not create_pmtiles(fgb_path, pmtiles_path):
                    pmtiles_path = None

            # 5. Upload to storage
            logger.info(f"Processing {request.name}: uploading...")

            geoparquet_url = await storage.upload_file(
                geoparquet_path,
                f"datasets/{request.name}/{request.name}.parquet",
            )

            pmtiles_url = None
            if pmtiles_path and pmtiles_path.exists():
                pmtiles_url = await storage.upload_file(
                    pmtiles_path,
                    f"tiles/{request.name}.pmtiles",
                )

            logger.info(f"Processing {request.name}: complete!")

            return ProcessResponse(
                success=True,
                name=request.name,
                pmtiles_url=pmtiles_url,
                geoparquet_url=geoparquet_url,
                feature_count=feature_count,
                bounds=bounds,
                geometry_type=geometry_type,
            )

    except Exception as e:
        error = str(e)
        logger.exception(f"Processing {request.name} failed")
        return ProcessResponse(success=False, name=request.name, error=error)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
