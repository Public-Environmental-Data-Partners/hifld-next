"""Core dataset processing functions."""

import logging
import tempfile
from pathlib import Path
from typing import cast

import geopandas as gpd

from processing.parquet_loader import load_parquet
from processing.pmtiles_creator import create_pmtiles
from schemas.types import JSONValue
from storage.storage_client import StorageClient


logger = logging.getLogger(__name__)


async def process_dataset(  # noqa: C901, PLR0912, PLR0915
    name: str,
    parquet_url: str,
    storage: StorageClient,
) -> dict[str, JSONValue]:
    """Process a parquet dataset.

    Steps:
    1. Load parquet directly from URL (gs://, s3://, http://)
    2. Validate and normalize data
    3. Create optimized GeoParquet
    4. Create PMTiles for visualization (if tippecanoe available)
    5. Upload processed files to storage
    6. Return URLs and metadata

    Returns:
        Dict with keys: success, name, pmtiles_url, geoparquet_url,
        feature_count, bounds, geometry_type, error
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            working_dir = Path(temp_dir)

            # 1. Load parquet directly from URL
            logger.info(f"Processing {name}: loading from {parquet_url}...")
            gdf = cast(gpd.GeoDataFrame, load_parquet(parquet_url))
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
            logger.info(f"Processing {name}: creating GeoParquet...")
            data_dir = working_dir / "data"
            data_dir.mkdir()

            geoparquet_path = data_dir / f"{name}.parquet"
            # Write GeoParquet with proper metadata
            #
            # IMPORTANT LIMITATION: GeoServer GeoParquet plugin has a trade-off:
            # - write_covering_bbox=True: Adds bbox STRUCT column for better WFS spatial queries
            #   BUT breaks GeoPackage export (can't map bbox STRUCT type)
            # - write_covering_bbox=False (current): GeoPackage export works
            #   BUT may have reduced WFS/spatial query performance
            #
            # Current choice: Prioritize GeoPackage export compatibility
            # If WFS performance becomes an issue, consider:
            #   1. Using a different GeoParquet plugin version
            #   2. Creating separate stores (one for WFS, one for exports)
            #   3. Post-processing to remove bbox column for export-only layers
            gdf.to_parquet(
                geoparquet_path,
                compression="snappy",
                index=False,
                schema_version="1.0.0",  # Use stable GeoParquet 1.0 spec
            )

            # 4. Create PMTiles (if tippecanoe available)
            logger.info(f"Processing {name}: creating PMTiles...")
            pmtiles_path = None

            # Filter valid geometries for tiles
            gdf_valid = cast(gpd.GeoDataFrame, gdf[~gdf.geometry.isna()].copy())

            if len(gdf_valid) > 0:
                tiles_dir = working_dir / "tiles"
                tiles_dir.mkdir()

                # Save as FlatGeobuf for tippecanoe
                fgb_path = tiles_dir / f"{name}.fgb"
                gdf_valid.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")

                pmtiles_path = tiles_dir / f"{name}.pmtiles"
                if not create_pmtiles(fgb_path, pmtiles_path):
                    pmtiles_path = None

            # 5. Upload to storage
            logger.info(f"Processing {name}: uploading...")

            geoparquet_url = await storage.upload_file(
                geoparquet_path,
                f"datasets/{name}/{name}.parquet",
            )

            pmtiles_url = None
            if pmtiles_path and pmtiles_path.exists():
                pmtiles_url = await storage.upload_file(
                    pmtiles_path,
                    f"tiles/{name}.pmtiles",
                )

            logger.info(f"Processing {name}: complete!")

            return {
                "success": True,
                "name": name,
                "pmtiles_url": pmtiles_url,
                "geoparquet_url": geoparquet_url,
                "feature_count": feature_count,
                "bounds": bounds,
                "geometry_type": geometry_type,
            }

    except Exception as e:
        error = str(e)
        logger.exception(f"Processing {name} failed")
        return {
            "success": False,
            "name": name,
            "error": error,
        }
