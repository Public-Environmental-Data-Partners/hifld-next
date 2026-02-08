#!/usr/bin/env python3
"""
Process datasets from storage (GCS or SeaweedFS) with chunked reading/writing to avoid memory issues.

This script:
1. Reads inventory_gcs.csv to find datasets (or discovers nested datasets)
2. Selects best format (preferring chunked-readable formats)
3. Downloads and unzips files from source storage
4. Processes each layer (for multi-layer formats like GeoPackage/File Geodatabase)
5. Converts to GeoParquet, File Geodatabase, and PMTiles using chunked methods
6. Uploads to destination storage (GCS or SeaweedFS)

Supports:
- Chunked reading for large files
- Chunked writing for all output formats
- Multi-layer processing
- Format detection for uncertain cases
- Nested dataset discovery (e.g., nfhl folder with multiple zip files)
- Flexible source/destination storage (GCS or SeaweedFS)
- Flags: --limit, --offset, --dry-run, --datasets
"""

import argparse
import asyncio
import csv
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import warnings
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import psutil

    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import fiona
import geopandas as gpd
import pandas as pd
from storage.storage_client import StorageClient, create_storage_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("process-gcs-datasets")

# Format priority for chunked reading (prefer formats that support chunked reading)
FORMAT_PRIORITY = [
    ("geopackage", ".gpkg"),  # Can read in chunks with pyogrio
    ("shapefile", ".shp"),  # Can read in chunks with fiona/pyogrio
    ("file_geodatabase", ".gdb"),  # Can read in chunks with pyogrio
    ("geojson", ".geojson"),  # Harder to chunk, but possible
]

# Formats that support chunked reading
CHUNKED_READABLE_FORMATS = ["geopackage", "shapefile", "file_geodatabase"]


def parse_storage_url(url: str) -> Tuple[str, str, str]:
    """
    Parse a storage URL (gs://bucket/path or seaweedfs://bucket/path).
    Returns (storage_type, bucket, path).
    """
    if url.startswith("gs://"):
        parts = url[5:].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("gcs", bucket, path)
    elif url.startswith("seaweedfs://") or url.startswith("s3://"):
        # SeaweedFS can use s3:// protocol
        parts = url.split("://", 1)[1].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("seaweedfs", bucket, path)
    else:
        # Assume it's just a bucket name (GCS)
        return ("gcs", url, "")


def load_inventory(inventory_path: Path) -> List[Dict[str, str]]:
    """Load inventory CSV."""
    datasets = []
    with open(inventory_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            datasets.append(row)
    return datasets


async def list_zip_files_in_folder(
    storage: StorageClient, folder_path: str
) -> List[Tuple[str, str]]:
    """
    List all zip files in a folder.
    Returns list of (filename, full_path) tuples.

    Note: This requires direct access to the storage backend.
    For GCS, we'll use the google.cloud.storage client directly.
    For SeaweedFS, we'll need to use the filer API.
    """
    zip_files = []

    # Check if this is a GCSStorageClient
    if hasattr(storage, "bucket_name"):
        # GCS - use direct client access
        from google.cloud import storage as gcs_storage

        client = gcs_storage.Client()
        bucket = client.bucket(storage.bucket_name)

        # List all blobs with the prefix
        # For GCS, empty prefix lists root-level files (paths don't start with /)
        if not folder_path or folder_path == "/":
            prefix = ""
        else:
            prefix = folder_path.rstrip("/") + "/"
        blobs = bucket.list_blobs(prefix=prefix)

        for blob in blobs:
            if blob.name.endswith(".zip") and not blob.name.endswith("/"):
                # Extract filename from path (keep full path for processing)
                zip_files.append((blob.name, blob.name))  # Will extract base name later
    else:
        # SeaweedFS - would need filer API listing
        # For now, return empty list (can be extended)
        logger.warning("Listing files in SeaweedFS folders not yet implemented")

    return zip_files


async def discover_nested_datasets(
    source_storage: StorageClient, source_path: str
) -> List[Dict[str, str]]:
    """
    Discover nested datasets (like nfhl) by listing zip files in folders.
    Groups files by dataset name (ignoring format suffix).
    Returns a list of dataset dictionaries, one per unique dataset.
    """
    # Group zip files by dataset name (without format suffix)
    datasets_by_name = {}

    # Check if source_path is a folder (ends with / or contains multiple zip files)
    zip_files = await list_zip_files_in_folder(source_storage, source_path)

    for zip_path, zip_path_full in zip_files:
        # Extract base filename from path (remove format suffix)
        # e.g., "nfhl/alluvial-fans/alluvial-fans-geojson.zip" -> "alluvial-fans"
        path_parts = zip_path.split("/")
        zip_filename = path_parts[-1].replace(".zip", "")

        # Remove format suffixes (try longest matches first)
        format_suffixes = [
            "-file_geodatabase",
            "-file-geodatabase",
            "-geopackage",
            "-shapefile",
            "-geojson",
        ]
        base_filename = zip_filename
        for suffix in format_suffixes:
            if base_filename.endswith(suffix):
                base_filename = base_filename[: -len(suffix)]
                break

        # Try to detect format from path
        format_name = "unknown"
        zip_path_lower = zip_path.lower()
        for fmt, _ in FORMAT_PRIORITY:
            if (
                f"-{fmt}.zip" in zip_path_lower
                or f"-{fmt.replace('_', '-')}.zip" in zip_path_lower
            ):
                format_name = fmt
                break
        if format_name == "unknown" and "-geojson.zip" in zip_path_lower:
            format_name = "geojson"

        # Construct full storage URL
        if hasattr(source_storage, "bucket_name"):
            storage_url = f"gs://{source_storage.bucket_name}/{zip_path}"
        else:
            # SeaweedFS
            storage_url = f"seaweedfs://{source_storage.bucket}/{zip_path}"

        # Group by dataset name (base_filename without format suffix)
        if base_filename not in datasets_by_name:
            datasets_by_name[base_filename] = {
                "filename": base_filename,
                "title": base_filename.replace("-", " ").title(),
                "gcs_zip_path": storage_url,  # Use first format found (will prefer better format later)
                "gcs_match_found": "Yes",
                format_name: "1",  # Mark format as available
            }
        else:
            # Add this format to the existing dataset
            datasets_by_name[base_filename][format_name] = "1"
            # Update gcs_zip_path if this is a better format (prefer chunked-readable)
            current_format = None
            for fmt, _ in FORMAT_PRIORITY:
                if datasets_by_name[base_filename].get(fmt) == "1":
                    current_format = fmt
                    break
            if current_format is None:
                # No preferred format yet, use this one
                datasets_by_name[base_filename]["gcs_zip_path"] = storage_url
            elif (
                format_name in CHUNKED_READABLE_FORMATS
                and current_format not in CHUNKED_READABLE_FORMATS
            ):
                # This format is better (chunked-readable), use it
                datasets_by_name[base_filename]["gcs_zip_path"] = storage_url

    return list(datasets_by_name.values())


def select_best_format(
    row: Dict[str, str], source_storage: StorageClient, source_path: str
) -> Optional[Tuple[str, str]]:
    """
    Select the best format for chunked reading.
    Returns (format_name, storage_path) or None if no suitable format found.

    Prioritizes formats that support chunked reading (geopackage, shapefile, file_geodatabase).
    """
    filename = row.get("filename", "").strip()
    if not filename:
        return None

    # Check if we have a direct path from inventory
    gcs_path = row.get("gcs_zip_path", "").strip()
    if gcs_path and row.get("gcs_match_found", "").strip() == "Yes":
        # Extract path from URL
        _, _, path = parse_storage_url(gcs_path)

        # Detect format from path
        path_lower = path.lower()
        for format_name, _ in FORMAT_PRIORITY:
            if (
                f"-{format_name}.zip" in path_lower
                or f"-{format_name.replace('_', '-')}.zip" in path_lower
            ):
                return (format_name, path)
        if "-geojson.zip" in path_lower:
            return ("geojson", path)

    # Get available formats from inventory
    available_formats = {
        "geopackage": row.get("geopackage", "").strip(),
        "shapefile": row.get("shapefile", "").strip(),
        "file_geodatabase": row.get("file_geodatabase", "").strip(),
        "geojson": row.get("geojson", "").strip(),
    }

    # Check formats in priority order (prefer chunked-readable)
    for format_name, _ in FORMAT_PRIORITY:
        format_value = available_formats.get(format_name, "")
        if format_value and format_value != "0":
            # Format is available, try to find it
            format_suffix = format_name.replace("_", "-")
            potential_paths = [
                f"{filename}/{filename}/{filename}-{format_suffix}.zip",
                f"{filename}/{filename}/{filename}-{format_name}.zip",
            ]

            # Also check nested patterns
            potential_paths.extend(
                [
                    f"nfhl/{filename}-{format_suffix}.zip",
                    f"nhd/{filename}-{format_suffix}.zip",
                ]
            )

            # Try to verify the path exists
            for path in potential_paths:
                # Check if file exists using storage client
                import asyncio

                try:
                    exists = asyncio.run(source_storage.file_exists(path))
                    if exists:
                        logger.info(
                            f"  Found preferred format '{format_name}' at: {path}"
                        )
                        return (format_name, path)
                except Exception:
                    continue

    return None


def detect_format_in_zip(zip_path: Path) -> Optional[Tuple[str, Path]]:
    """
    Unzip and detect format of files inside.
    Returns (format_type, path_to_file) or None.
    """
    extract_dir = zip_path.parent / f"{zip_path.stem}_extracted"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir()

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_dir)

    # Look for geospatial files (prioritize multi-layer formats)
    # First pass: look for .gdb directories
    for path in extract_dir.rglob("*"):
        if path.is_dir() and path.suffix.lower() == ".gdb":
            return ("file_geodatabase", path)

    # Second pass: look for other formats
    for path in extract_dir.rglob("*"):
        if path.is_file():
            ext = path.suffix.lower()
            if ext == ".gpkg":
                return ("geopackage", path)
            elif ext == ".shp":
                return ("shapefile", path)
            elif ext == ".geojson":
                return ("geojson", path)

    return None


async def unzip_from_storage(
    storage: StorageClient, remote_path: str, extract_dir: Path
) -> Optional[Tuple[str, Path]]:
    """
    Unzip directly from storage without downloading entire zip first.
    Extracts only the geospatial file we need.
    Also handles direct geospatial files (not zipped).
    Returns (format_type, path_to_file) or None.
    """
    import zipfile

    # Download file to temp location
    local_file = extract_dir / "temp_file"
    await storage.download_file(remote_path, local_file)

    # Check if it's a zip file or a direct geospatial file
    remote_path_lower = remote_path.lower()

    # Check if it's a direct geospatial file (not a zip)
    geospatial_extensions = [".geojson", ".gpkg", ".shp", ".gdb"]
    is_direct_file = any(
        remote_path_lower.endswith(ext) for ext in geospatial_extensions
    )

    if is_direct_file:
        # It's a direct geospatial file, not a zip
        # Determine format from extension
        if remote_path_lower.endswith(".geojson"):
            format_type = "geojson"
        elif remote_path_lower.endswith(".gpkg"):
            format_type = "geopackage"
        elif remote_path_lower.endswith(".shp"):
            format_type = "shapefile"
        elif remote_path_lower.endswith(".gdb"):
            format_type = "file_geodatabase"
        else:
            return None

        # For shapefiles, we might need to download related files (.shx, .dbf, etc.)
        # For now, just return the main file
        return (format_type, local_file)

    # It should be a zip file - try to open it
    try:
        with zipfile.ZipFile(local_file, "r") as zf:
            # List files in zip
            file_list = zf.namelist()

            # Look for geospatial files
            # Priority: .gdb (directory), .gpkg, .shp, .geojson

            # Check for .gdb directories - they might be listed with or without trailing slash
            # Also check for files inside .gdb directories
            gdb_dirs = []
            for f in file_list:
                # Check if it's a .gdb directory entry (with or without trailing slash)
                if f.endswith(".gdb/") or f.endswith(".gdb"):
                    # Check if it's actually a directory (not a file)
                    if f.endswith("/") or any(
                        other.startswith(f + "/") for other in file_list
                    ):
                        gdb_dirs.append(f.rstrip("/"))
                # Check if file is inside a .gdb directory
                elif "/.gdb/" in f or f.endswith("/.gdb/"):
                    # Extract the .gdb directory path
                    parts = f.split("/")
                    for i, part in enumerate(parts):
                        if part.endswith(".gdb"):
                            gdb_dir = "/".join(parts[: i + 1])
                            if gdb_dir not in gdb_dirs:
                                gdb_dirs.append(gdb_dir)

            if gdb_dirs:
                # Extract .gdb directory (use the first one found)
                gdb_dir = gdb_dirs[0]
                # Extract all files in the .gdb directory
                for member in zf.namelist():
                    if member.startswith(gdb_dir + "/") or member == gdb_dir:
                        zf.extract(member, extract_dir)
                # Find the extracted .gdb directory
                for path in extract_dir.rglob("*"):
                    if path.is_dir() and path.suffix.lower() == ".gdb":
                        return ("file_geodatabase", path)

                # If we didn't find it, try extracting everything and searching
                # (fallback for unusual zip structures)
                logger.debug(
                    f"  .gdb directory not found after selective extraction, trying full extraction..."
                )
                zf.extractall(extract_dir)
                for path in extract_dir.rglob("*"):
                    if path.is_dir() and path.suffix.lower() == ".gdb":
                        return ("file_geodatabase", path)

            # Look for other formats
            for ext in [".gpkg", ".shp", ".geojson"]:
                candidates = [f for f in file_list if f.lower().endswith(ext)]
                if candidates:
                    # Extract the first matching file
                    candidate = candidates[0]

                    if ext == ".shp":
                        # For shapefiles, extract all related files (.shp, .shx, .dbf, .prj, etc.)
                        base_name = candidate.rsplit(".", 1)[0]
                        shapefile_extensions = [
                            ".shp",
                            ".shx",
                            ".dbf",
                            ".prj",
                            ".cpg",
                            ".sbn",
                            ".sbx",
                        ]
                        for shape_ext in shapefile_extensions:
                            related_file = base_name + shape_ext
                            if related_file in file_list:
                                zf.extract(related_file, extract_dir)
                    else:
                        zf.extract(candidate, extract_dir)

                    extracted_path = extract_dir / candidate
                    if extracted_path.exists():
                        format_type = {
                            ".gpkg": "geopackage",
                            ".shp": "shapefile",
                            ".geojson": "geojson",
                        }[ext]
                        return (format_type, extracted_path)
    except zipfile.BadZipFile:
        # Not a zip file - might be a direct geospatial file
        logger.debug(
            f"  File is not a zip file, checking if it's a direct geospatial file..."
        )
        # Check if the downloaded file is a geospatial file
        file_ext = local_file.suffix.lower()
        if file_ext in [".geojson", ".gpkg", ".shp"]:
            format_type = {
                ".geojson": "geojson",
                ".gpkg": "geopackage",
                ".shp": "shapefile",
            }[file_ext]
            return (format_type, local_file)
        # For .gdb, it's a directory, so we can't handle it as a direct file
        return None

    return None


def list_layers_in_file(
    file_path: Path, format_type: str
) -> List[Tuple[str, Optional[str]]]:
    """
    List all layers in a multi-layer file.
    Returns list of (layer_name, geometry_type) tuples.
    """
    import pyogrio

    if format_type in ["geopackage", "file_geodatabase"]:
        layers = pyogrio.list_layers(file_path)
        return [
            (name, geom_type) for name, geom_type in layers if geom_type is not None
        ]
    else:
        # Single-layer formats
        return [("default", None)]


def get_memory_usage_mb() -> float:
    """Get current process memory usage in MB."""
    if not PSUTIL_AVAILABLE:
        return 0.0
    try:
        process = psutil.Process(os.getpid())
        return process.memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0


def get_system_memory_info() -> Dict[str, float]:
    """Get system memory information in MB."""
    if not PSUTIL_AVAILABLE:
        return {"available": 0.0, "total": 0.0, "percent": 0.0}
    try:
        mem = psutil.virtual_memory()
        return {
            "available": mem.available / (1024 * 1024),
            "total": mem.total / (1024 * 1024),
            "percent": mem.percent,
        }
    except Exception:
        return {"available": 0.0, "total": 0.0, "percent": 0.0}


def log_memory_usage(context: str = ""):
    """Log current memory usage."""
    if not PSUTIL_AVAILABLE:
        logger.warning("  psutil not available - cannot monitor memory usage")
        return

    process_mb = get_memory_usage_mb()
    system_mem = get_system_memory_info()

    msg = f"  Memory: {process_mb:.1f} MB (process)"
    if system_mem["total"] > 0:
        msg += f", {system_mem['available']:.1f} MB available ({system_mem['percent']:.1f}% used)"
    if context:
        msg = f"{context} - {msg}"
    logger.info(msg)


def _get_fiona_driver(format_type: str) -> str:
    """Get Fiona driver name for format type."""
    driver_map = {
        "shapefile": "ESRI Shapefile",
        "geojson": "GeoJSON",
        "geopackage": "GPKG",
        "file_geodatabase": "OpenFileGDB",  # Use OpenFileGDB for read-only access
    }
    return driver_map.get(format_type)


async def process_layer_chunked(
    file_path: Path,
    format_type: str,
    layer_name: Optional[str],
    layer_filename: str,
    dest_folder: str,
    dest_storage: StorageClient,
    work_dir: Path,
    chunk_size: int = 50000,  # Deprecated: no longer used, kept for compatibility
    geoparquet_chunk_size_mb: int = 100,  # Target ~100MB per chunk
) -> Dict[str, Any]:
    """
    Process a layer using fiona.open() for true streaming/chunked reading.

    Reads features one at a time using fiona, accumulates them in batches,
    and writes GeoParquet chunks and FlatGeobuf files incrementally.
    This avoids loading the entire file into memory.

    Chunks are written when they approach the target size (geoparquet_chunk_size_mb).
    The function estimates bytes per feature from the first row, then adjusts
    the chunk size dynamically to target the desired file size.

    Returns dict with geoparquet_urls, pmtiles_url, feature_count, or error.
    """
    mem_before = get_memory_usage_mb()
    logger.info(
        f"    Reading with fiona (streaming, target size: {geoparquet_chunk_size_mb}MB)"
    )

    try:
        # Determine fiona driver and open parameters
        driver = _get_fiona_driver(format_type)
        if not driver:
            raise ValueError(f"Unsupported format for streaming: {format_type}")

        # Open file with fiona for streaming
        open_kwargs = {"driver": driver}
        if layer_name and format_type in ["geopackage", "file_geodatabase"]:
            open_kwargs["layer"] = layer_name

        geoparquet_dir = work_dir / "geoparquet"
        geoparquet_dir.mkdir(exist_ok=True)
        pmtiles_dir = work_dir / "pmtiles"
        pmtiles_dir.mkdir(exist_ok=True)

        geoparquet_files = []
        fgb_files = []
        feature_count = 0
        null_geometry_count = 0  # Track NULL geometries filtered for FGB
        chunk_features = []
        chunk_num = 0
        bytes_per_feature = None  # Will be estimated from first feature
        current_chunk_size = None  # Will be calculated after estimation
        features_processed = 0  # Track total features processed for ID generation

        # Get CRS from file and estimate bytes per feature from first row
        with fiona.open(str(file_path), **open_kwargs) as src:
            crs = src.crs if src.crs else "EPSG:4326"

            # Estimate bytes per feature from first feature
            try:
                first_feature = next(src)
                # Convert single feature to GeoDataFrame to estimate size
                gdf_sample = gpd.GeoDataFrame.from_features([first_feature], crs=crs)

                # Ensure 'id' column exists (same logic as main processing)
                if "id" not in gdf_sample.columns:
                    id_candidates = [
                        "OBJECTID",
                        "FID",
                        "fid",
                        "GlobalID",
                        "gid",
                        "ogc_fid",
                    ]
                    id_col = None
                    for candidate in id_candidates:
                        if candidate in gdf_sample.columns:
                            id_col = candidate
                            break
                    if id_col:
                        gdf_sample["id"] = gdf_sample[id_col]
                    else:
                        gdf_sample["id"] = [1]

                # Move 'id' to front
                cols = ["id"] + [c for c in gdf_sample.columns if c != "id"]
                gdf_sample = gdf_sample[cols]

                # Write to temp file to measure actual parquet size
                temp_estimate_path = geoparquet_dir / "_temp_estimate.parquet"
                gdf_sample.to_parquet(
                    temp_estimate_path, compression="zstd", schema_version="1.0.0"
                )
                file_size_bytes = temp_estimate_path.stat().st_size
                temp_estimate_path.unlink()  # Delete temp file

                # Calculate bytes per feature and initial chunk size
                bytes_per_feature = file_size_bytes / len(gdf_sample)
                target_bytes = geoparquet_chunk_size_mb * 1024 * 1024
                current_chunk_size = int(target_bytes / bytes_per_feature)

                logger.info(
                    f"    Estimated {bytes_per_feature:.0f} bytes/feature from first row, "
                    f"chunk size: ~{current_chunk_size:,} features for ~{geoparquet_chunk_size_mb}MB chunks"
                )

                # Add first feature to chunk_features to process it
                chunk_features.append(first_feature)
                feature_count = 1

                # Clean up sample GeoDataFrame
                del gdf_sample

            except StopIteration:
                # Empty file
                logger.warning("    File is empty, no features to process")
                return {
                    "geoparquet_urls": [],
                    "pmtiles_url": None,
                    "feature_count": 0,
                }

            # Process remaining features in chunks
            for feature in src:
                chunk_features.append(feature)
                feature_count += 1

                # Estimate if we should write this chunk
                # We always have bytes_per_feature now (estimated from first row)
                should_write = False
                if len(chunk_features) >= current_chunk_size:
                    should_write = True
                else:
                    # Estimate size of current chunk
                    estimated_size_mb = (
                        len(chunk_features) * bytes_per_feature / (1024 * 1024)
                    )
                    if estimated_size_mb >= geoparquet_chunk_size_mb * 0.8:
                        # Write when we're at 80% of target to avoid going over
                        should_write = True

                # When chunk is full or reaches target size, process it
                if should_write:
                    # Convert chunk to GeoDataFrame
                    gdf_chunk = gpd.GeoDataFrame.from_features(chunk_features, crs=crs)

                    # Always use chunk number (we'll handle single-file case at upload time)
                    geoparquet_path = (
                        geoparquet_dir / f"{layer_filename}-{chunk_num}.parquet"
                    )

                    # Preserve original CRS for GeoParquet (GeoParquet supports any CRS)
                    # If CRS is None, leave it as None (GeoParquet can handle that)

                    # Ensure 'id' column exists
                    if "id" not in gdf_chunk.columns:
                        id_candidates = [
                            "OBJECTID",
                            "FID",
                            "fid",
                            "GlobalID",
                            "gid",
                            "ogc_fid",
                        ]
                        id_col = None
                        for candidate in id_candidates:
                            if candidate in gdf_chunk.columns:
                                id_col = candidate
                                break
                        if id_col:
                            gdf_chunk["id"] = gdf_chunk[id_col]
                        else:
                            gdf_chunk["id"] = range(
                                features_processed + 1,
                                features_processed + len(gdf_chunk) + 1,
                            )

                    # Move 'id' to front
                    cols = ["id"] + [c for c in gdf_chunk.columns if c != "id"]
                    gdf_chunk = gdf_chunk[cols]

                    # Write GeoParquet chunk
                    gdf_chunk.to_parquet(
                        geoparquet_path, compression="zstd", schema_version="1.0.0"
                    )
                    geoparquet_files.append(geoparquet_path)

                    # Calculate actual file size and update bytes per feature estimate
                    file_size_bytes = geoparquet_path.stat().st_size
                    # Update estimate based on this chunk (running average)
                    chunk_bytes_per_feature = file_size_bytes / len(gdf_chunk)
                    bytes_per_feature = (
                        bytes_per_feature + chunk_bytes_per_feature
                    ) / 2
                    # Recalculate optimal chunk size
                    target_bytes = geoparquet_chunk_size_mb * 1024 * 1024
                    current_chunk_size = int(target_bytes / bytes_per_feature)

                    # Write FlatGeobuf chunk for PMTiles
                    # Filter out NULL and empty geometries (FlatGeobuf requires valid, non-empty geometries for spatial index)
                    # Use ~is_empty & notna() to filter both NULL and empty geometries
                    with warnings.catch_warnings():
                        warnings.filterwarnings(
                            "ignore", "GeoSeries.notna", UserWarning
                        )
                        gdf_valid = gdf_chunk[
                            ~gdf_chunk.geometry.is_empty & gdf_chunk.geometry.notna()
                        ].copy()
                    null_count = len(gdf_chunk) - len(gdf_valid)
                    null_geometry_count += null_count
                    if len(gdf_valid) > 0:
                        # Reproject to EPSG:4326 for PMTiles (tippecanoe requires WGS84)
                        if gdf_valid.crs is None:
                            gdf_valid = gdf_valid.set_crs("EPSG:4326")
                        elif gdf_valid.crs.to_epsg() != 4326:
                            gdf_valid = gdf_valid.to_crs("EPSG:4326")

                        fgb_path = (
                            pmtiles_dir / f"{layer_filename}-chunk-{chunk_num}.fgb"
                        )
                        gdf_valid.to_file(
                            fgb_path, driver="FlatGeobuf", engine="pyogrio"
                        )
                        fgb_files.append(fgb_path)
                        if null_count > 0:
                            logger.debug(
                                f"    Filtered {null_count} NULL/empty geometries "
                                f"from chunk {chunk_num} for FGB"
                            )

                    features_processed += len(gdf_chunk)
                    # Explicitly delete large objects to free memory
                    del gdf_chunk
                    if len(gdf_valid) > 0:
                        del gdf_valid
                    chunk_features = []
                    chunk_num += 1

            # Process remaining features
            if chunk_features:
                gdf_chunk = gpd.GeoDataFrame.from_features(chunk_features, crs=crs)

                # Always use chunk number (we'll handle single-file case at upload time)
                geoparquet_path = (
                    geoparquet_dir / f"{layer_filename}-{chunk_num}.parquet"
                )

                # Preserve original CRS for GeoParquet (GeoParquet supports any CRS)
                # If CRS is None, leave it as None (GeoParquet can handle that)

                # Ensure 'id' column exists
                if "id" not in gdf_chunk.columns:
                    id_candidates = [
                        "OBJECTID",
                        "FID",
                        "fid",
                        "GlobalID",
                        "gid",
                        "ogc_fid",
                    ]
                    id_col = None
                    for candidate in id_candidates:
                        if candidate in gdf_chunk.columns:
                            id_col = candidate
                            break
                    if id_col:
                        gdf_chunk["id"] = gdf_chunk[id_col]
                    else:
                        gdf_chunk["id"] = range(
                            features_processed + 1,
                            features_processed + len(gdf_chunk) + 1,
                        )

                # Move 'id' to front
                cols = ["id"] + [c for c in gdf_chunk.columns if c != "id"]
                gdf_chunk = gdf_chunk[cols]

                # Write GeoParquet chunk
                gdf_chunk.to_parquet(
                    geoparquet_path, compression="zstd", schema_version="1.0.0"
                )
                geoparquet_files.append(geoparquet_path)

                # Write FlatGeobuf chunk for PMTiles
                # Filter out NULL and empty geometries (FlatGeobuf requires valid, non-empty geometries for spatial index)
                # Use ~is_empty & notna() to filter both NULL and empty geometries
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
                    gdf_valid = gdf_chunk[
                        ~gdf_chunk.geometry.is_empty & gdf_chunk.geometry.notna()
                    ].copy()
                null_count = len(gdf_chunk) - len(gdf_valid)
                null_geometry_count += null_count
                if len(gdf_valid) > 0:
                    # Reproject to EPSG:4326 for PMTiles (tippecanoe requires WGS84)
                    if gdf_valid.crs is None:
                        gdf_valid = gdf_valid.set_crs("EPSG:4326")
                    elif gdf_valid.crs.to_epsg() != 4326:
                        gdf_valid = gdf_valid.to_crs("EPSG:4326")

                    fgb_path = pmtiles_dir / f"{layer_filename}-chunk-{chunk_num}.fgb"
                    gdf_valid.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
                    fgb_files.append(fgb_path)
                    if null_count > 0:
                        logger.debug(
                            f"    Filtered {null_count} NULL/empty geometries "
                            f"from final chunk for FGB"
                        )

        mem_after = get_memory_usage_mb()
        mem_used = mem_after - mem_before
        logger.info(
            f"    Processed {feature_count} features in {len(geoparquet_files)} chunk(s) "
            f"(memory: {mem_used:.1f} MB)"
        )
        if null_geometry_count > 0:
            logger.info(
                f"    Filtered {null_geometry_count} NULL/empty geometries from FGB/PMTiles "
                f"({null_geometry_count / feature_count * 100:.1f}% of features)"
            )

        # Upload GeoParquet files
        geoparquet_urls = []
        for i, gp_file in enumerate(geoparquet_files):
            if len(geoparquet_files) == 1:
                # Single file - use base name without chunk number
                remote_path = f"{dest_folder}{layer_filename}.zstd.parquet"
            else:
                # Multiple chunks - use chunk number (starting from 0)
                remote_path = f"{dest_folder}{layer_filename}-{i}.zstd.parquet"

            await dest_storage.upload_file(gp_file, remote_path)
            url = dest_storage.get_public_url(remote_path)
            geoparquet_urls.append(url)
            logger.info(f"    Uploaded GeoParquet: {remote_path}")

        # Create PMTiles from FlatGeobuf files
        pmtiles_path = pmtiles_dir / f"{layer_filename}.pmtiles"
        pmtiles_url = None

        if fgb_files:
            # Use tippecanoe's -l option to combine all FGB chunks into a single layer
            # This avoids memory-intensive merging operations
            logger.info(
                f"    Creating PMTiles from {len(fgb_files)} FGB chunk(s) "
                f"({feature_count - null_geometry_count:,} valid geometries)"
            )
            try:
                if len(fgb_files) == 1:
                    # Single file - no need for layer name
                    cmd = [
                        "tippecanoe",
                        "-zg",
                        "--drop-densest-as-needed",
                        "--extend-zooms-if-still-dropping",
                        "--force",
                        "--maximum-zoom=14",
                        "-o",
                        str(pmtiles_path),
                        str(fgb_files[0]),
                    ]
                else:
                    # Multiple files - use -l to combine into single layer
                    cmd = [
                        "tippecanoe",
                        "-zg",
                        "--drop-densest-as-needed",
                        "--extend-zooms-if-still-dropping",
                        "--force",
                        "--maximum-zoom=14",
                        "-l",
                        layer_filename,  # Use layer filename as the layer name
                        "-o",
                        str(pmtiles_path),
                    ] + [str(f) for f in fgb_files]

                logger.info(
                    f"    Running tippecanoe with {len(fgb_files)} file(s) "
                    f"{'into single layer' if len(fgb_files) > 1 else ''}"
                )
                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode == 0:
                    remote_path = f"{dest_folder}{layer_filename}.pmtiles"
                    await dest_storage.upload_file(pmtiles_path, remote_path)
                    pmtiles_url = dest_storage.get_public_url(remote_path)
                    logger.info(f"    Uploaded PMTiles: {remote_path}")
                else:
                    logger.warning(f"    tippecanoe failed: {result.stderr}")
            except FileNotFoundError:
                logger.warning("    tippecanoe not found, skipping PMTiles creation")
            except Exception as e:
                logger.warning(f"    PMTiles creation failed: {e}")

        return {
            "geoparquet_urls": geoparquet_urls,
            "pmtiles_url": pmtiles_url,
            "feature_count": feature_count,
        }

    except Exception as e:
        import traceback

        logger.error(f"    Error in chunked processing: {e}")
        logger.debug(f"    Full traceback: {traceback.format_exc()}")
        return {"error": str(e)}


def read_chunked(
    file_path: Path,
    format_type: str,
    layer_name: Optional[str] = None,
    chunk_size: int = 10000,
) -> gpd.GeoDataFrame:
    """
    Read geospatial file in chunks (fallback for formats not supported by fiona streaming).

    This is a fallback that loads the entire file. For formats that support it,
    use process_layer_chunked() instead for true streaming.
    """
    mem_before = get_memory_usage_mb()
    logger.debug(f"    Memory before read: {mem_before:.1f} MB")

    try:
        if format_type == "geopackage":
            if layer_name:
                gdf = gpd.read_file(file_path, layer=layer_name, engine="pyogrio")
            else:
                gdf = gpd.read_file(file_path, engine="pyogrio")
        elif format_type == "shapefile":
            gdf = gpd.read_file(file_path, engine="pyogrio")
        elif format_type == "file_geodatabase":
            if layer_name:
                gdf = gpd.read_file(file_path, layer=layer_name, engine="pyogrio")
            else:
                gdf = gpd.read_file(file_path, engine="pyogrio")
        elif format_type == "geojson":
            gdf = gpd.read_file(file_path, engine="pyogrio")
        else:
            raise ValueError(f"Unsupported format: {format_type}")

        mem_after = get_memory_usage_mb()
        mem_used = mem_after - mem_before
        logger.info(
            f"    Memory used for read: {mem_used:.1f} MB (total: {mem_after:.1f} MB)"
        )

        # Warn if memory usage is very high
        if mem_used > 6000:  # > 6GB
            logger.warning(
                f"    ⚠️  High memory usage: {mem_used:.1f} MB. "
                f"Dataset may be too large for available memory."
            )

        return gdf
    except MemoryError:
        mem_after = get_memory_usage_mb()
        logger.error(
            f"    ❌ Out of memory! Memory before: {mem_before:.1f} MB, "
            f"after: {mem_after:.1f} MB"
        )
        raise


def write_geoparquet_chunked(
    gdf: gpd.GeoDataFrame, output_path: Path, chunk_size_mb: int = 100
) -> List[Path]:
    """
    Write GeoDataFrame to GeoParquet with zstd compression, splitting into multiple files if needed.
    Returns list of output file paths.
    """
    # Estimate size (rough approximation)
    estimated_mb = len(gdf) * 0.001  # Rough estimate: 1KB per feature

    if estimated_mb <= chunk_size_mb:
        # Single file
        gdf.to_parquet(output_path, compression="zstd", schema_version="1.0.0")
        return [output_path]

    # Multiple chunks
    num_chunks = max(2, int(estimated_mb / chunk_size_mb) + 1)
    paths = []
    for i in range(num_chunks):
        start_idx = i * len(gdf) // num_chunks
        end_idx = (i + 1) * len(gdf) // num_chunks if i < num_chunks - 1 else len(gdf)
        chunk = gdf.iloc[start_idx:end_idx]

        # Always use chunk number suffix (starting from 0 for consistency)
        chunk_path = output_path.parent / f"{output_path.stem}-{i}.parquet"

        chunk.to_parquet(chunk_path, compression="zstd", schema_version="1.0.0")
        paths.append(chunk_path)

    return paths


def write_pmtiles_chunked(
    gdf: gpd.GeoDataFrame, output_path: Path, max_zoom: int = 14
) -> Optional[Path]:
    """
    Write PMTiles from GeoDataFrame, using chunked FlatGeobuf intermediate files.
    Returns output path if successful, None otherwise.

    Uses tippecanoe's -l option to combine multiple FGB chunks into a single layer,
    avoiding memory-intensive merging operations.
    """
    # Filter out NULL and empty geometries (FlatGeobuf requires valid, non-empty geometries for spatial index)
    # Use ~is_empty & notna() to filter both NULL and empty geometries
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", "GeoSeries.notna", UserWarning)
        gdf_valid = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()

    if len(gdf_valid) == 0:
        logger.warning("No valid geometries to write")
        return None

    # Ensure CRS is WGS84
    if gdf_valid.crs is None:
        gdf_valid = gdf_valid.set_crs("EPSG:4326")
    elif gdf_valid.crs.to_epsg() != 4326:
        gdf_valid = gdf_valid.to_crs("EPSG:4326")

    # For large datasets, split into chunks
    chunk_size = 100000  # Features per chunk
    num_chunks = max(1, (len(gdf_valid) + chunk_size - 1) // chunk_size)

    fgb_files = []
    temp_dir = output_path.parent

    if num_chunks == 1:
        # Single chunk: write directly
        fgb_path = temp_dir / f"{output_path.stem}.fgb"
        gdf_valid.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
        fgb_files.append(fgb_path)
    else:
        # Multiple chunks - write individual chunks first
        for i in range(num_chunks):
            start_idx = i * chunk_size
            end_idx = min((i + 1) * chunk_size, len(gdf_valid))
            chunk = gdf_valid.iloc[start_idx:end_idx]

            fgb_path = temp_dir / f"{output_path.stem}-chunk-{i}.fgb"
            chunk.to_file(fgb_path, driver="FlatGeobuf", engine="pyogrio")
            fgb_files.append(fgb_path)

    # Create PMTiles using tippecanoe
    # Use -l option to combine multiple FGB files into a single layer
    # No timeout - let it run as long as needed for large datasets
    try:
        if len(fgb_files) == 1:
            # Single file - no need for layer name
            cmd = [
                "tippecanoe",
                "-zg",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--force",
                f"--maximum-zoom={max_zoom}",
                "-o",
                str(output_path),
                str(fgb_files[0]),
            ]
        else:
            # Multiple files - use -l to combine into single layer
            cmd = [
                "tippecanoe",
                "-zg",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--force",
                f"--maximum-zoom={max_zoom}",
                "-l",
                output_path.stem,  # Use output filename stem as the layer name
                "-o",
                str(output_path),
            ] + [str(f) for f in fgb_files]

        logger.info(
            f"  Running tippecanoe with {len(fgb_files)} file(s) "
            f"{'into single layer' if len(fgb_files) > 1 else ''} (no timeout)"
        )
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            logger.info(f"Created PMTiles: {output_path}")
            return output_path
        else:
            logger.warning(f"tippecanoe failed: {result.stderr}")
            return None
    except FileNotFoundError:
        logger.warning("tippecanoe not found, skipping PMTiles creation")
        return None
    except Exception as e:
        logger.warning(f"PMTiles creation failed: {e}")
        return None


async def check_dataset_exists(
    dest_storage: StorageClient,
    dataset_folder: str,
    base_filename: str,
    layers: List[Tuple[str, str]],
) -> bool:
    """
    Check if a dataset has already been processed by checking for expected output files.
    Returns True if at least one expected output file exists.
    """
    dest_folder = f"{dataset_folder}/" if dataset_folder else ""

    # Check for at least one layer's parquet or pmtiles
    for layer_name, _ in layers:
        if layer_name == "default":
            layer_filename = base_filename
        else:
            layer_filename = f"{base_filename}-{layer_name}"

        # Check for parquet (could be single file or chunked)
        # Try single file first (no chunk number)
        parquet_path = f"{dest_folder}{layer_filename}.zstd.parquet"
        if await dest_storage.file_exists(parquet_path):
            return True
        # Try first chunk file (chunked files use -0, -1, etc.)
        parquet_path_chunked = f"{dest_folder}{layer_filename}-0.zstd.parquet"
        if await dest_storage.file_exists(parquet_path_chunked):
            return True

        # Check for pmtiles
        pmtiles_path = f"{dest_folder}{layer_filename}.pmtiles"
        if await dest_storage.file_exists(pmtiles_path):
            return True

    return False


async def process_dataset(
    row: Dict[str, str],
    source_storage: StorageClient,
    dest_storage: StorageClient,
    dry_run: bool = False,
    skip_existing: bool = False,
) -> Dict[str, Any]:
    """
    Process a single dataset: download, unzip, convert, upload.
    """
    filename = row.get("filename", "").strip()
    title = row.get("title", "").strip()

    logger.info(f"Processing: {filename} - {title}")

    # Select best format (skip storage access in dry-run)
    if dry_run:
        # In dry-run, just use the path from inventory
        storage_path = row.get("gcs_zip_path", "").strip()
        if storage_path and row.get("gcs_match_found", "").strip() == "Yes":
            # Try to detect format from path
            path_lower = storage_path.lower()
            format_name = "unknown"
            for fmt, _ in FORMAT_PRIORITY:
                if (
                    f"-{fmt}.zip" in path_lower
                    or f"-{fmt.replace('_', '-')}.zip" in path_lower
                ):
                    format_name = fmt
                    break
            if format_name == "unknown" and "-geojson.zip" in path_lower:
                format_name = "geojson"

            logger.info(f"  [DRY RUN] Would process {filename}")
            logger.info(f"    Format: {format_name}")
            logger.info(f"    Source: {storage_path}")
            logger.info(f"    Would create: GeoParquet and PMTiles for each layer")
        else:
            logger.info(f"  [DRY RUN] Would process {filename} (no storage path found)")
        return {"success": True, "dry_run": True, "filename": filename}

    # Get source path from row
    source_path = row.get("gcs_zip_path", "").strip()
    if not source_path:
        return {"success": False, "error": "No source path found", "filename": filename}

        # Extract path from URL if needed
    _, _, zip_path = parse_storage_url(source_path)

    # Extract folder structure from source path (for preserving nesting)
    # e.g., "nfhl/alluvial-fans/alluvial-fans-geojson.zip" -> "nfhl/alluvial-fans/"
    # e.g., "119th-congressional-districts/119th-congressional-districts-geopackage.zip" -> "119th-congressional-districts/"
    path_parts = zip_path.split("/")
    if len(path_parts) > 1:
        # Get folder path (everything except the filename)
        dataset_folder = "/".join(path_parts[:-1])
    else:
        # Just filename, no folder
        dataset_folder = ""

    # Extract base filename (without format suffix)
    zip_filename = path_parts[-1] if path_parts else ""
    # Remove format suffix and .zip extension
    base_filename = zip_filename.replace(".zip", "")

    # Remove format suffixes (try longest matches first to avoid partial matches)
    format_suffixes = [
        "-file_geodatabase",
        "-file-geodatabase",
        "-geopackage",
        "-shapefile",
        "-geojson",
    ]
    for suffix in format_suffixes:
        if base_filename.endswith(suffix):
            base_filename = base_filename[: -len(suffix)]
            break

    # Try to verify the path exists, and if not, try alternative paths
    path_exists = await source_storage.file_exists(zip_path)
    if not path_exists:
        # Try alternative paths (remove duplicate folder names)
        # e.g., filename/filename/filename.zip -> filename/filename.zip
        if len(path_parts) >= 2 and path_parts[0] == path_parts[1]:
            # Remove duplicate folder
            alt_path = "/".join(path_parts[1:])
            if await source_storage.file_exists(alt_path):
                logger.info(f"  Using alternative path: {alt_path}")
                zip_path = alt_path
                # Recalculate folder structure and base filename from new path
                alt_parts = alt_path.split("/")
                if len(alt_parts) > 1:
                    dataset_folder = "/".join(alt_parts[:-1])
                else:
                    dataset_folder = ""
                # Recalculate base_filename
                zip_filename = alt_parts[-1].replace(".zip", "")
                base_filename = zip_filename
                for suffix in format_suffixes:
                    if base_filename.endswith(suffix):
                        base_filename = base_filename[: -len(suffix)]
                        break
            else:
                # Try just filename-format.zip in root
                filename_part = path_parts[-1] if path_parts else ""
                if filename_part:
                    alt_path = filename_part
                    if await source_storage.file_exists(alt_path):
                        logger.info(f"  Using alternative path: {alt_path}")
                        zip_path = alt_path
                        dataset_folder = ""
                        # Recalculate base_filename
                        zip_filename = alt_path.replace(".zip", "")
                        base_filename = zip_filename
                        for suffix in format_suffixes:
                            if base_filename.endswith(suffix):
                                base_filename = base_filename[: -len(suffix)]
                                break

    with tempfile.TemporaryDirectory() as temp_dir:
        work_dir = Path(temp_dir)

        # Unzip and detect format
        extract_dir = work_dir / "extracted"
        extract_dir.mkdir()

        # Try to unzip and detect format
        unzip_result = await unzip_from_storage(source_storage, zip_path, extract_dir)

        # Handle None return value (no format detected)
        if unzip_result is None:
            logger.info(
                f"  Could not detect format, trying detect_format_in_zip as fallback..."
            )
            local_file = work_dir / f"{filename}_file"
            await source_storage.download_file(zip_path, local_file)

            # Try detect_format_in_zip (expects a zip file)
            try:
                format_type, data_file = detect_format_in_zip(local_file)
            except Exception as e:
                logger.debug(f"  detect_format_in_zip failed: {e}")
                # Check if it's a direct geospatial file
                file_ext = local_file.suffix.lower()
                if file_ext in [".geojson", ".gpkg", ".shp"]:
                    format_type = {
                        ".geojson": "geojson",
                        ".gpkg": "geopackage",
                        ".shp": "shapefile",
                    }[file_ext]
                    data_file = local_file
                    logger.info(f"  Detected direct {format_type} file (not zipped)")
                else:
                    format_type, data_file = None, None
        else:
            format_type, data_file = unzip_result

        if not format_type:
            return {
                "success": False,
                "error": "Could not detect format (not a zip file or recognized geospatial format)",
                "filename": filename,
            }

        logger.info(f"  Detected format: {format_type}, file: {data_file}")

        # List layers
        try:
            layers = list_layers_in_file(data_file, format_type)
            logger.info(f"  Found {len(layers)} layer(s)")
        except Exception as e:
            logger.error(f"  Error listing layers: {e}")
            return {
                "success": False,
                "error": f"Failed to list layers: {str(e)}",
                "filename": filename,
            }

        # Check if dataset already exists (skip if requested)
        if skip_existing:
            try:
                exists = await check_dataset_exists(
                    dest_storage, dataset_folder, base_filename, layers
                )
                if exists:
                    logger.info(f"  Dataset already exists, skipping...")
                    return {
                        "success": True,
                        "skipped": True,
                        "filename": filename,
                        "reason": "Output files already exist",
                    }
            except Exception as e:
                logger.warning(
                    f"  Error checking if dataset exists: {e}, continuing..."
                )

        results = []
        for layer_name, geom_type in layers:
            # Use layer name in filename (or base_filename if default layer)
            if layer_name == "default":
                layer_filename = base_filename
            else:
                layer_filename = f"{base_filename}-{layer_name}"

            logger.info(f"  Processing layer: {layer_name}")
            log_memory_usage(f"Before processing {layer_name}")

            # Build destination path preserving folder structure
            if dataset_folder:
                dest_folder = f"{dataset_folder}/"
            else:
                dest_folder = ""

            # Process layer using streaming/chunked reading
            try:
                # Suppress datetime parsing warnings - they're non-fatal
                with warnings.catch_warnings():
                    warnings.filterwarnings(
                        "ignore", category=UserWarning, message=".*parsing datetimes.*"
                    )
                    warnings.filterwarnings(
                        "ignore",
                        category=UserWarning,
                        message=".*Out of bounds nanosecond timestamp.*",
                    )

                    # Try streaming first (for supported formats)
                    if format_type in [
                        "shapefile",
                        "geojson",
                        "geopackage",
                        "file_geodatabase",
                    ]:
                        try:
                            result = await process_layer_chunked(
                                data_file,
                                format_type,
                                layer_name if layer_name != "default" else None,
                                layer_filename,
                                dest_folder,
                                dest_storage,
                                work_dir,
                            )

                            if "error" in result:
                                raise Exception(result["error"])

                            log_memory_usage(f"After processing {layer_name}")
                            results.append(
                                {
                                    "layer": layer_name,
                                    "geoparquet_urls": result["geoparquet_urls"],
                                    "pmtiles_url": result["pmtiles_url"],
                                    "feature_count": result["feature_count"],
                                }
                            )
                            continue
                        except Exception as e:
                            logger.warning(
                                f"    Streaming failed ({e}), falling back to full read..."
                            )

                            # Check file size before attempting full read
                            # If file is too large (>5GB), skip fallback to prevent OOM
                            try:
                                file_size_mb = data_file.stat().st_size / (1024 * 1024)
                                if file_size_mb > 5000:  # 5GB threshold
                                    logger.error(
                                        f"    ⚠️  File too large ({file_size_mb:.1f} MB) for full read. "
                                        f"Streaming failed, skipping to prevent OOM. "
                                        f"Error: {e}"
                                    )
                                    results.append(
                                        {
                                            "layer": layer_name,
                                            "error": f"Streaming failed and file too large ({file_size_mb:.1f} MB) for fallback read: {str(e)}",
                                        }
                                    )
                                    continue
                            except Exception as size_check_error:
                                logger.warning(
                                    f"    Could not check file size: {size_check_error}, attempting fallback anyway..."
                                )

                    # Fallback: read entire file (for unsupported formats or if streaming fails)
                    # Only reached if file size check passed or size check failed
                    logger.warning(
                        f"    ⚠️  Loading entire file into memory (fallback mode). "
                        f"This may use significant memory."
                    )
                    gdf = read_chunked(
                        data_file,
                        format_type,
                        layer_name if layer_name != "default" else None,
                    )
                    logger.info(f"    Loaded {len(gdf)} features")
                    log_memory_usage(f"After reading {layer_name}")

                    # Preserve original CRS for GeoParquet (GeoParquet supports any CRS)
                    # If CRS is None, leave it as None (GeoParquet can handle that)
                    # Note: Reprojection to EPSG:4326 will happen in write_pmtiles_chunked for PMTiles

                    # Ensure 'id' column exists
                    if "id" not in gdf.columns:
                        id_candidates = [
                            "OBJECTID",
                            "FID",
                            "fid",
                            "GlobalID",
                            "gid",
                            "ogc_fid",
                        ]
                        id_col = None
                        for candidate in id_candidates:
                            if candidate in gdf.columns:
                                id_col = candidate
                                break
                        if id_col:
                            gdf["id"] = gdf[id_col]
                        else:
                            gdf["id"] = range(1, len(gdf) + 1)

                    # Move 'id' to front
                    cols = ["id"] + [c for c in gdf.columns if c != "id"]
                    gdf = gdf[cols]

                    # Write GeoParquet (chunked)
                    geoparquet_dir = work_dir / "geoparquet"
                    geoparquet_dir.mkdir(exist_ok=True)
                    geoparquet_path = geoparquet_dir / f"{layer_filename}.parquet"
                    geoparquet_files = write_geoparquet_chunked(gdf, geoparquet_path)

                    # Upload GeoParquet files
                    geoparquet_urls = []
                    for gp_file in geoparquet_files:
                        # Determine if this is a single file or a chunked file
                        # Single file: gp_file == geoparquet_path (no chunk number)
                        # Chunked file: gp_file has format {layer_filename}-{chunk_num}.parquet
                        if gp_file == geoparquet_path:
                            # Single file (not chunked)
                            remote_path = f"{dest_folder}{layer_filename}.zstd.parquet"
                        else:
                            # Chunked file - extract chunk number from filename
                            # Format: {layer_filename}-{chunk_num}.parquet
                            chunk_num = gp_file.stem.split("-")[-1]
                            remote_path = f"{dest_folder}{layer_filename}-{chunk_num}.zstd.parquet"

                        await dest_storage.upload_file(gp_file, remote_path)
                        url = dest_storage.get_public_url(remote_path)
                        geoparquet_urls.append(url)
                        logger.info(f"    Uploaded GeoParquet: {remote_path}")

                    # Write PMTiles (chunked)
                    pmtiles_dir = work_dir / "pmtiles"
                    pmtiles_dir.mkdir(exist_ok=True)
                    pmtiles_path = pmtiles_dir / f"{layer_filename}.pmtiles"
                    pmtiles_result = write_pmtiles_chunked(gdf, pmtiles_path)

                    pmtiles_url = None
                    if pmtiles_result:
                        remote_path = f"{dest_folder}{layer_filename}.pmtiles"
                        await dest_storage.upload_file(pmtiles_path, remote_path)
                        pmtiles_url = dest_storage.get_public_url(remote_path)
                        logger.info(f"    Uploaded PMTiles: {remote_path}")

                    results.append(
                        {
                            "layer": layer_name,
                            "geoparquet_urls": geoparquet_urls,
                            "pmtiles_url": pmtiles_url,
                            "feature_count": len(gdf),
                        }
                    )

            except Exception as e:
                import traceback

                logger.error(f"    Error processing layer {layer_name}: {e}")
                logger.debug(f"    Full traceback: {traceback.format_exc()}")
                results.append(
                    {
                        "layer": layer_name,
                        "error": str(e),
                    }
                )
                # Continue processing other layers - don't let one layer failure stop the dataset

        return {
            "success": True,
            "filename": filename,
            "format": format_type,
            "layers": results,
        }


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Process datasets from storage with chunked reading/writing"
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        default=Path(__file__).parent / "inventory_gcs.csv",
        help="Path to inventory CSV file (or 'auto' to discover nested datasets)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="gs://drp-hifld-copy-49775666365",
        help="Source storage URL (gs://bucket or seaweedfs://bucket/path)",
    )
    parser.add_argument(
        "--dest",
        type=str,
        default="seaweedfs://drp-hifld-copy-formatted",
        help="Destination storage URL (gs://bucket or seaweedfs://bucket/path)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of datasets to process",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Skip first N datasets",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without making changes",
    )
    parser.add_argument(
        "--datasets",
        type=str,
        nargs="+",
        help="List of specific dataset filenames or paths to process (can be gs:// paths)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip datasets that already have output files in destination storage",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Parse source and destination storage
    source_type, source_bucket, source_path = parse_storage_url(args.source)
    dest_type, dest_bucket, dest_path = parse_storage_url(args.dest)

    # Create storage clients
    source_storage = create_storage_client(
        storage_type=source_type,
        bucket=source_bucket,
    )
    dest_storage = create_storage_client(
        storage_type=dest_type,
        bucket=dest_bucket,
    )

    # Load or discover datasets
    if args.inventory == Path("auto") or str(args.inventory) == "auto":
        # Discover nested datasets
        logger.info(f"Discovering nested datasets in {args.source}")
        datasets = await discover_nested_datasets(source_storage, source_path)
        logger.info(f"Discovered {len(datasets)} datasets")
    else:
        # Load from inventory CSV
        datasets = load_inventory(args.inventory)
        logger.info(f"Loaded {len(datasets)} datasets from inventory")

    # Filter by dataset list if provided
    if args.datasets:
        # Handle both filenames and full paths
        dataset_paths = set()
        dataset_names = set()
        for ds in args.datasets:
            if ds.startswith("gs://") or ds.startswith("seaweedfs://"):
                # Full path - extract filename
                _, _, path = parse_storage_url(ds)
                filename = Path(path).stem
                # Remove format suffix
                for fmt, _ in FORMAT_PRIORITY:
                    if filename.endswith(f"-{fmt}") or filename.endswith(
                        f"-{fmt.replace('_', '-')}"
                    ):
                        filename = filename[: -(len(fmt) + 1)]
                        break
                dataset_names.add(filename)
                dataset_paths.add(path)
            else:
                dataset_names.add(ds)

        # Filter datasets
        filtered = []
        for d in datasets:
            filename = d.get("filename", "").strip()
            storage_path = d.get("gcs_zip_path", "").strip()
            _, _, path = (
                parse_storage_url(storage_path) if storage_path else ("", "", "")
            )

            if filename in dataset_names or path in dataset_paths:
                filtered.append(d)

        datasets = filtered
        logger.info(f"Filtered to {len(datasets)} specified datasets")

    # Apply offset
    if args.offset:
        datasets = datasets[args.offset :]
        logger.info(f"Skipped first {args.offset} datasets")

    # Apply limit
    if args.limit:
        datasets = datasets[: args.limit]
        logger.info(f"Limited to {args.limit} datasets")

    logger.info(f"Will process {len(datasets)} datasets")
    if args.skip_existing:
        logger.info("  (Will skip datasets that already have output files)")

    # Process datasets
    results = {
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "errors": [],
        "datasets": [],  # Track per-dataset results
    }

    for i, dataset in enumerate(datasets, 1):
        filename = dataset.get("filename", "").strip()
        title = dataset.get("title", "").strip()
        logger.info(f"\n[{i}/{len(datasets)}] Processing: {filename}")

        dataset_result = {
            "filename": filename,
            "title": title,
            "status": "unknown",
            "error": None,
            "layers": [],
            "formats": {
                "geoparquet": False,
                "pmtiles": False,
            },
        }

        try:
            result = await process_dataset(
                dataset,
                source_storage,
                dest_storage,
                dry_run=args.dry_run,
                skip_existing=args.skip_existing,
            )

            if result.get("success"):
                if result.get("skipped"):
                    results["skipped"] += 1
                    dataset_result["status"] = "skipped"
                    dataset_result["error"] = result.get("reason", "Already exists")
                    logger.info(
                        f"  ⊘ Skipped: {result.get('reason', 'Already exists')}"
                    )
                else:
                    results["success"] += 1
                    dataset_result["status"] = "success"
                    if not args.dry_run:
                        # Track format creation status
                        layers = result.get("layers", [])
                        logger.info(f"  ✓ Success: {len(layers)} layer(s) processed")

                        # Check which formats were created
                        for layer in layers:
                            layer_name = layer.get("layer", "unknown")
                            layer_info = {
                                "name": layer_name,
                                "error": layer.get("error"),
                                "formats": {
                                    "geoparquet": bool(layer.get("geoparquet_urls")),
                                    "pmtiles": bool(layer.get("pmtiles_url")),
                                },
                            }
                            dataset_result["layers"].append(layer_info)

                            # Update dataset-level format status
                            if layer_info["formats"]["geoparquet"]:
                                dataset_result["formats"]["geoparquet"] = True
                            if layer_info["formats"]["pmtiles"]:
                                dataset_result["formats"]["pmtiles"] = True
            else:
                results["failed"] += 1
                dataset_result["status"] = "failed"
                error_msg = result.get("error", "Unknown error")
                dataset_result["error"] = error_msg
                results["errors"].append(f"{filename}: {error_msg}")
                logger.error(f"  ✗ Failed: {error_msg}")

        except Exception as e:
            results["failed"] += 1
            dataset_result["status"] = "failed"
            error_msg = str(e)
            dataset_result["error"] = error_msg
            results["errors"].append(f"{filename}: {error_msg}")
            logger.exception(f"  ✗ Error: {error_msg}")

        results["datasets"].append(dataset_result)

        # Print progress summary after each dataset
        processed_count = results["success"] + results["skipped"]
        remaining_count = len(datasets) - i
        skipped_count = results["skipped"]
        failed_count = results["failed"]

        # Calculate offset for resume (initial offset + number of datasets processed so far)
        resume_offset = args.offset + i

        logger.info(
            f"\n  📊 Progress: {processed_count} processed ({results['success']} success, {skipped_count} skipped, {failed_count} failed), "
            f"{remaining_count} remaining"
        )
        logger.info(f"  → Resume with: --offset {resume_offset}")

    # Print summary
    print("\n" + "=" * 80)
    print("PROCESSING SUMMARY")
    print("=" * 80)
    print(f"  Success: {results['success']}")
    if results.get("skipped", 0) > 0:
        print(f"  Skipped: {results['skipped']}")
    print(f"  Failed:  {results['failed']}")

    # Print failed datasets with reasons
    failed_datasets = [d for d in results["datasets"] if d["status"] == "failed"]
    if failed_datasets:
        print("\n" + "-" * 80)
        print("FAILED DATASETS:")
        print("-" * 80)
        for ds in failed_datasets:
            print(f"\n  Dataset: {ds['filename']}")
            if ds.get("title"):
                print(f"    Title: {ds['title']}")
            print(f"    Error: {ds.get('error', 'Unknown error')}")

    # Print datasets with missing formats
    datasets_with_missing_formats = []
    for ds in results["datasets"]:
        if ds["status"] == "success" and ds.get("layers"):
            missing = []
            if not ds["formats"]["geoparquet"]:
                missing.append("GeoParquet")
            if not ds["formats"]["pmtiles"]:
                missing.append("PMTiles")

            if missing:
                datasets_with_missing_formats.append(
                    {"dataset": ds, "missing": missing}
                )

    if datasets_with_missing_formats:
        print("\n" + "-" * 80)
        print("DATASETS WITH MISSING FORMATS:")
        print("-" * 80)
        for item in datasets_with_missing_formats:
            ds = item["dataset"]
            print(f"\n  Dataset: {ds['filename']}")
            if ds.get("title"):
                print(f"    Title: {ds['title']}")
            print(f"    Missing formats: {', '.join(item['missing'])}")

            # Show layer-level details
            for layer in ds.get("layers", []):
                if layer.get("error"):
                    print(f"      Layer '{layer['name']}': ERROR - {layer['error']}")
                else:
                    layer_missing = []
                    if not layer["formats"]["geoparquet"]:
                        layer_missing.append("GeoParquet")
                    if not layer["formats"]["pmtiles"]:
                        layer_missing.append("PMTiles")
                    if layer_missing:
                        print(
                            f"      Layer '{layer['name']}': Missing {', '.join(layer_missing)}"
                        )

    # Print all errors if any
    if results["errors"]:
        print("\n" + "-" * 80)
        print("ALL ERRORS:")
        print("-" * 80)
        for error in results["errors"]:
            print(f"  - {error}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(1)
    except Exception as e:
        import traceback

        print(f"\n\n❌ FATAL ERROR: {e}")
        print("\nFull traceback:")
        traceback.print_exc()
        sys.exit(1)
