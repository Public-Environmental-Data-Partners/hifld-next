#!/usr/bin/env python3
"""
Generate datasets JSONL from inventory and storage locations.

This script:
1. Loads inventory JSONL (with AI-generated tags)
2. Checks storage buckets (GCS and/or SeaweedFS) for processed files
3. Combines inventory metadata with storage file locations
4. Generates final datasets.jsonl for import

Usage:
    python scripts/generate_jsonl_from_storage.py \
        --inventory inventory.jsonl \
        --bucket gcs://drp-hifld-copy-49775666365 \
        --bucket seaweedfs://hifld \
        --output datasets.jsonl
"""

import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.storage_client import StorageClient, create_storage_client
from models.dataset import (
    FileLocation,
    GeoServerLocation,
    SpatialDatasetFileMetadata,
)
from datetime import date

logger = logging.getLogger(__name__)


def dataset_has_sources(dataset_entry: Dict) -> bool:
    """Return True if at least one format source exists in the dataset entry."""
    for file_entry in dataset_entry.get("files", []):
        for fmt in file_entry.get("formats", []):
            if fmt.get("sources"):
                return True
    return False


async def find_processed_files(
    storage_client: StorageClient,
    filename: str,
) -> Dict[str, List[str]]:
    """Find all processed files for a dataset using a storage client.

    Args:
        storage_client: Storage client instance
        filename: Dataset filename/slug
    """
    # New layout: <dataset>/<zip-stem>/<format>/<files>
    # Support nested subfolders: <dataset>/<subfolder>/<format>/...
    # Also support nested parent folders: <parent>/<dataset>/<subfolder>/<format>/...
    # Examples:
    #   - flowline: nhd/flowline/flowline_ak/.../parquet/...
    #   - icis-wastewater-treatment-plants-sic-codes: icis-wastewater-treatment-plants-sic-codes/.../parquet/...
    # Important: match only when dataset slug is an exact path segment.
    # This prevents over-matching sibling datasets like "flowline-large-scale-2"
    # when the requested dataset is "flowline".

    geoparquet_paths = set()
    pmtiles_paths = set()
    geopackage_paths = set()
    shapefile_paths = set()
    geojson_paths = set()
    file_geodatabase_paths = set()

    # Strategy: Try fast list_files first, then fall back to glob patterns for nested structures
    # This is much faster for GCS since list_files uses the native API
    try:
        all_files = await storage_client.list_files(f"{filename}/")
        logger.debug(f"list_files found {len(all_files)} files under '{filename}/'")

        # Filter files by extension and add to appropriate sets
        # Only include files that are actually under this dataset (not siblings with similar names)
        for path in all_files:
            # Ensure the path starts with the dataset name (to avoid false matches)
            # e.g., "flowline-large-scale-2" shouldn't match when looking for "flowline"
            if not path.startswith(filename):
                continue

            if path.endswith((".parquet", ".zstd.parquet")):
                geoparquet_paths.add(path)
            elif path.endswith(".pmtiles"):
                pmtiles_paths.add(path)
            elif path.endswith(".gpkg"):
                geopackage_paths.add(path)
            elif path.endswith(".shp"):
                shapefile_paths.add(path)
            elif path.endswith(".geojson"):
                geojson_paths.add(path)
            elif path.endswith(".gdb"):
                file_geodatabase_paths.add(path)

        logger.debug(
            f"Filtered to: {len(geoparquet_paths)} parquet, {len(pmtiles_paths)} pmtiles, "
            f"{len(geopackage_paths)} gpkg, {len(shapefile_paths)} shp, "
            f"{len(geojson_paths)} geojson, {len(file_geodatabase_paths)} gdb"
        )

        # If we found files, we're done (fast path)
        total_found = (
            len(geoparquet_paths)
            + len(pmtiles_paths)
            + len(geopackage_paths)
            + len(shapefile_paths)
            + len(geojson_paths)
            + len(file_geodatabase_paths)
        )
        if total_found > 0:
            logger.debug(
                "Found %d files via list_files, skipping glob patterns", total_found
            )
        else:
            # No files found with direct prefix, try nested patterns
            logger.debug(
                "No files found with direct prefix, trying nested glob patterns"
            )
            raise ValueError("No files found, try nested patterns")

    except Exception as e:
        # Fallback to glob patterns for nested structures (e.g., parent/dataset/...)
        logger.debug(
            f"list_files approach failed or found nothing: {e}, trying glob patterns"
        )

        # Use optimized patterns: direct patterns use find() (fast), nested patterns use glob() (slower but necessary)
        all_format_patterns = [
            # Direct patterns (will use find() - fast)
            f"{filename}/**/*.zstd.parquet",
            f"{filename}/**/*.parquet",
            f"{filename}/**/*.pmtiles",
            f"{filename}/**/*.gpkg",
            f"{filename}/**/*.shp",
            f"{filename}/**/*.geojson",
            f"{filename}/**/*.gdb",
            # Nested patterns (will use glob() - slower, only if needed)
            f"**/{filename}/**/*.zstd.parquet",
            f"**/{filename}/**/*.parquet",
            f"**/{filename}/**/*.pmtiles",
            f"**/{filename}/**/*.gpkg",
            f"**/{filename}/**/*.shp",
            f"**/{filename}/**/*.geojson",
            f"**/{filename}/**/*.gdb",
        ]

        async def expand_pattern(pattern: str) -> list[str]:
            """Expand a glob pattern and return matching paths."""
            try:
                matches = await storage_client.expand_glob_pattern(pattern)
                return matches
            except Exception as e:
                logger.debug(f"Pattern '{pattern}' failed: {e}")
                return []

        # Get all matching files in parallel
        all_results = await asyncio.gather(
            *[expand_pattern(pattern) for pattern in all_format_patterns],
            return_exceptions=True,
        )

        # Collect all unique paths and filter by extension
        all_matching_paths = set()
        for result in all_results:
            if isinstance(result, Exception):
                continue
            all_matching_paths.update(result)

        logger.debug(
            f"Found {len(all_matching_paths)} total files via glob patterns for '{filename}'"
        )

        # Filter files by extension into appropriate sets
        for path in all_matching_paths:
            if path.endswith((".parquet", ".zstd.parquet")):
                geoparquet_paths.add(path)
            elif path.endswith(".pmtiles"):
                pmtiles_paths.add(path)
            elif path.endswith(".gpkg"):
                geopackage_paths.add(path)
            elif path.endswith(".shp"):
                shapefile_paths.add(path)
            elif path.endswith(".geojson"):
                geojson_paths.add(path)
            elif path.endswith(".gdb"):
                file_geodatabase_paths.add(path)

    return {
        "geoparquet": sorted(
            [storage_client.get_public_url(path) for path in geoparquet_paths]
        ),
        "pmtiles": sorted(
            [storage_client.get_public_url(path) for path in pmtiles_paths]
        ),
        "geopackage": sorted(
            [storage_client.get_public_url(path) for path in geopackage_paths]
        ),
        "shapefile": sorted(
            [storage_client.get_public_url(path) for path in shapefile_paths]
        ),
        "geojson": sorted(
            [storage_client.get_public_url(path) for path in geojson_paths]
        ),
        "file_geodatabase": sorted(
            [storage_client.get_public_url(path) for path in file_geodatabase_paths]
        ),
    }


def extract_path_from_url(url: str, storage_client: StorageClient) -> Optional[str]:
    """Extract relative path from a storage URL using the storage client."""
    return storage_client.parse_url_to_path(url)


def group_parquet_files_by_pattern(
    parquet_urls: List[str], storage_client: StorageClient
) -> Dict[str, List[str]]:
    """
    Group chunked parquet files by base pattern.
    Assumes chunked parquet naming: <base>-N.zstd.parquet
    """
    groups = {}

    for url in parquet_urls:
        path = extract_path_from_url(url, storage_client)
        if not path:
            continue

        path_parts = path.rsplit("/", 1)
        if len(path_parts) == 2:
            dir_part = path_parts[0]
            filename = path_parts[1]
        else:
            dir_part = ""
            filename = path

        chunk_match = re.match(r"^(.+)-(\d+)\.(zstd\.)?parquet$", filename)
        if chunk_match:
            base_name = chunk_match.group(1)
            ext = chunk_match.group(3) or ""
            pattern = (
                f"{dir_part}/{base_name}-*.{ext}parquet"
                if dir_part
                else f"{base_name}-*.{ext}parquet"
            )
        else:
            # Keep non-chunk parquet files as valid sources as well.
            # This supports datasets that only have a single parquet file.
            pattern = f"{dir_part}/{filename}" if dir_part else filename
        if pattern not in groups:
            groups[pattern] = []
        groups[pattern].append(url)

    return groups


def _parse_bounds(raw_bounds: object) -> Optional[List[float]]:
    """Parse bounds from list/tuple or string representation."""
    if raw_bounds is None:
        return None
    if isinstance(raw_bounds, (list, tuple)) and len(raw_bounds) == 4:
        try:
            return [float(v) for v in raw_bounds]
        except Exception:
            return None
    if isinstance(raw_bounds, str):
        text = raw_bounds.strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]
        try:
            values = [float(v.strip()) for v in text.split(",")]
            if len(values) == 4:
                return values
        except Exception:
            return None
    return None


def _build_metadata_from_inventory(
    inventory_entry: Dict,
    inventory_file: Optional[Dict] = None,
    *,
    size_bytes: Optional[int] = None,
    mime_type: Optional[str] = None,
) -> Optional[Dict]:
    """Build source/file metadata from inventory fields plus computed size/mime data."""
    tags = inventory_entry.get("tags", {}) or {}
    file_meta = (inventory_file or {}).get("file_metadata", {}) or {}
    geometry_type = (
        (inventory_file or {}).get("geometry_type")
        or file_meta.get("geometry_type")
        or tags.get("geometry_type")
    )
    feature_count = (inventory_file or {}).get("feature_count") or file_meta.get(
        "feature_count"
    )
    bounds = _parse_bounds(
        (inventory_file or {}).get("bounds") or file_meta.get("bounds")
    )

    metadata = SpatialDatasetFileMetadata(
        size_bytes=size_bytes,
        mime_type=mime_type,
        feature_count=feature_count,
        bounds=bounds,
        geometry_type=geometry_type,
    )
    if (
        metadata.size_bytes is None
        and metadata.mime_type is None
        and metadata.feature_count is None
        and metadata.bounds is None
        and metadata.geometry_type is None
    ):
        return None
    return metadata.model_dump()


async def create_dataset_entry(
    dataset_slug: str,
    inventory_entry: Dict,
    storage_files_by_location: Dict[str, Dict[str, List[str]]],
    storage_clients_by_location: Dict[str, Optional[StorageClient]],
    geoserver_storage_location_name: Optional[str] = None,
) -> Dict:
    """
    Create a dataset entry matching the database schema exactly.

    Args:
        dataset_slug: Dataset slug
        inventory_entry: Inventory entry with metadata
        storage_files_by_location: Dict mapping storage location name to files dict
            (e.g., {"GCS bucket-name": {"geoparquet": [...], "pmtiles": [...]}})
        storage_clients_by_location: Dict mapping storage location name to storage client
        geoserver_storage_location_name: Optional storage location name to use for GeoServer

    Structure:
    - Dataset fields (slug, name, description, tags, collection_slug)
    - files: array of File objects
      - Each file has formats: array of format objects
        - Each format has sources: array of FileSource objects
          - Each source references storage_location_name
    """
    # Get inventory file structure
    inventory_files = inventory_entry.get("files", [])

    # Build logical files from all storage locations independently
    # logical_files maps logical_file_name -> {sources_by_location: {...}, pmtiles_by_location: {...}, format_by_location: {...}}
    logical_files = {}

    # Process each storage location independently
    for storage_location_name, files_dict in storage_files_by_location.items():
        storage_client = storage_clients_by_location.get(storage_location_name)
        if not storage_client:
            continue

        parquet_urls = sorted(files_dict.get("geoparquet", []))
        pmtiles_urls = sorted(files_dict.get("pmtiles", []))
        geopackage_urls = sorted(files_dict.get("geopackage", []))
        shapefile_urls = sorted(files_dict.get("shapefile", []))
        geojson_urls = sorted(files_dict.get("geojson", []))
        file_geodatabase_urls = sorted(files_dict.get("file_geodatabase", []))

        # Group parquet files by logical file pattern
        if parquet_urls:
            parquet_groups = group_parquet_files_by_pattern(
                parquet_urls, storage_client
            )

            for pattern, urls in parquet_groups.items():
                # Extract logical file name from pattern
                path_parts = pattern.rsplit("/", 1)
                if len(path_parts) == 2:
                    filename = path_parts[1]
                    # New layout always uses chunk globs (file-*.zstd.parquet)
                    base_name = filename.replace("-*.zstd.parquet", "").replace(
                        "-*.parquet", ""
                    )
                    logical_file_name = f"{path_parts[0]}/{base_name}"
                else:
                    base_name = pattern.replace("-*.zstd.parquet", "").replace(
                        "-*.parquet", ""
                    )
                    logical_file_name = base_name

                # Initialize logical file if needed
                if logical_file_name not in logical_files:
                    logical_files[logical_file_name] = {
                        "sources_by_location": {},  # Maps storage_location_name -> list of sources
                        "pmtiles_by_location": {},  # Maps storage_location_name -> list of PMTiles URLs
                        "geopackage_by_location": {},  # Maps storage_location_name -> list of GeoPackage URLs
                        "shapefile_by_location": {},  # Maps storage_location_name -> list of Shapefile URLs
                        "geojson_by_location": {},  # Maps storage_location_name -> list of GeoJSON URLs
                        "file_geodatabase_by_location": {},  # Maps storage_location_name -> list of File Geodatabase URLs
                    }

                # Add GeoParquet sources for this storage location
                if (
                    storage_location_name
                    not in logical_files[logical_file_name]["sources_by_location"]
                ):
                    logical_files[logical_file_name]["sources_by_location"][
                        storage_location_name
                    ] = []

                # New layout assumes chunked parquet, so we always store glob pattern.
                location = FileLocation(path=pattern)

                logical_files[logical_file_name]["sources_by_location"][
                    storage_location_name
                ].append(
                    {
                        "storage_location_name": storage_location_name,
                        "version": date.today().isoformat(),
                        "source_type": "file",
                        "location": location.model_dump(),
                        "references_source_id": None,
                        "source_metadata": None,
                    }
                )

        # Store PMTiles URLs by location for later matching
        # We'll match them to logical files based on filename after all storage locations are processed
        if pmtiles_urls:
            # Store PMTiles temporarily - we'll match them to logical files later
            for pmtiles_url in pmtiles_urls:
                path = extract_path_from_url(pmtiles_url, storage_client)
                if path:
                    # Extract the base filename (without extension) to match to logical files
                    path_parts = path.rsplit("/", 1)
                    if len(path_parts) == 2:
                        pmtiles_base = path_parts[1].replace(".pmtiles", "")
                        # Try to find matching logical file
                        # PMTiles filename should match the logical file slug
                        matching_logical_file = None
                        for logical_file_name in logical_files.keys():
                            logical_file_slug = (
                                logical_file_name.rsplit("/", 1)[-1]
                                if "/" in logical_file_name
                                else logical_file_name
                            )
                            if pmtiles_base == logical_file_slug:
                                matching_logical_file = logical_file_name
                                break

                        # If no matching logical file found, create one from the PMTiles path
                        if not matching_logical_file:
                            # Create logical file name from PMTiles path
                            dir_part = path_parts[0]
                            matching_logical_file = f"{dir_part}/{pmtiles_base}"
                            if matching_logical_file not in logical_files:
                                logical_files[matching_logical_file] = {
                                    "sources_by_location": {},
                                    "pmtiles_by_location": {},
                                }

                        # Store PMTiles URL for this logical file
                        if (
                            storage_location_name
                            not in logical_files[matching_logical_file][
                                "pmtiles_by_location"
                            ]
                        ):
                            logical_files[matching_logical_file]["pmtiles_by_location"][
                                storage_location_name
                            ] = []
                        logical_files[matching_logical_file]["pmtiles_by_location"][
                            storage_location_name
                        ].append(pmtiles_url)

        # Helper function to match format URLs to logical files
        def match_format_urls_to_logical_files(
            format_urls: List[str],
            format_ext: str,
            format_key: str,
            mime_type: str,
        ):
            """Match format URLs to logical files based on directory structure and filename."""
            for format_url in format_urls:
                path = extract_path_from_url(format_url, storage_client)
                if path:
                    path_parts = path.rsplit("/", 1)
                    if len(path_parts) == 2:
                        dir_part = path_parts[0]
                        format_filename = path_parts[1]
                        format_base = format_filename.replace(format_ext, "")

                        # Extract the parent directory structure
                        # Example: "12nm-territorial-sea/12nm-territorial-sea-shapefile/geopackage/file.gpkg"
                        # -> base_dir = "12nm-territorial-sea/12nm-territorial-sea-shapefile"
                        # -> format_folder = "geopackage"
                        dir_components = [c for c in dir_part.split("/") if c]

                        # Remove the format folder (last component) to get the base directory
                        if len(dir_components) >= 1:
                            # The last component is the format folder, remove it
                            base_dir_components = dir_components[:-1]
                            base_dir = (
                                "/".join(base_dir_components)
                                if base_dir_components
                                else ""
                            )
                            dataset_subfolder = (
                                base_dir_components[-1] if base_dir_components else ""
                            )
                        else:
                            base_dir = ""
                            dataset_subfolder = ""

                        # Try to find matching logical file by directory structure
                        matching_logical_file = None
                        for logical_file_name in logical_files.keys():
                            logical_file_slug = (
                                logical_file_name.rsplit("/", 1)[-1]
                                if "/" in logical_file_name
                                else logical_file_name
                            )
                            logical_dir = (
                                "/".join(logical_file_name.split("/")[:-1])
                                if "/" in logical_file_name
                                else ""
                            )

                            # Match if:
                            # 1. The base directory matches the logical file directory, OR
                            # 2. The format base name matches the logical file slug, OR
                            # 3. The dataset subfolder matches the logical file slug, OR
                            # 4. The base directory is contained in the logical file name (for nested structures), OR
                            # 5. The logical directory is contained in the base directory (reverse check)
                            # 6. Both share the same parent directory structure (most important for matching)
                            if (
                                base_dir == logical_dir
                                or format_base == logical_file_slug
                                or dataset_subfolder == logical_file_slug
                                or (base_dir and base_dir in logical_file_name)
                                or (logical_dir and logical_dir in base_dir)
                                or (
                                    base_dir
                                    and logical_dir
                                    and
                                    # Check if they share the same parent path components
                                    set(base_dir.split("/"))
                                    & set(logical_dir.split("/"))
                                    and len(
                                        set(base_dir.split("/"))
                                        & set(logical_dir.split("/"))
                                    )
                                    >= 2
                                )
                            ):
                                matching_logical_file = logical_file_name
                                break

                        # If no matching logical file found, create one from the format path
                        if not matching_logical_file:
                            # Use the base directory + dataset subfolder (which is the common parent folder)
                            # This ensures format files in the same dataset subfolder are grouped together
                            if base_dir and dataset_subfolder:
                                matching_logical_file = (
                                    f"{base_dir}/{dataset_subfolder}"
                                )
                            elif base_dir:
                                # Fallback: use format base name if dataset subfolder not available
                                matching_logical_file = f"{base_dir}/{format_base}"
                            else:
                                matching_logical_file = f"{dir_part}/{format_base}"

                            if matching_logical_file not in logical_files:
                                logical_files[matching_logical_file] = {
                                    "sources_by_location": {},
                                    "pmtiles_by_location": {},
                                    "geopackage_by_location": {},
                                    "shapefile_by_location": {},
                                    "geojson_by_location": {},
                                    "file_geodatabase_by_location": {},
                                }

                        # Store format URL for this logical file
                        if (
                            storage_location_name
                            not in logical_files[matching_logical_file][format_key]
                        ):
                            logical_files[matching_logical_file][format_key][
                                storage_location_name
                            ] = []
                        logical_files[matching_logical_file][format_key][
                            storage_location_name
                        ].append(format_url)

        # Match new formats to logical files
        match_format_urls_to_logical_files(
            geopackage_urls,
            ".gpkg",
            "geopackage_by_location",
            "application/geopackage+sqlite3",
        )
        match_format_urls_to_logical_files(
            shapefile_urls, ".shp", "shapefile_by_location", "application/zip"
        )
        match_format_urls_to_logical_files(
            geojson_urls, ".geojson", "geojson_by_location", "application/geo+json"
        )
        match_format_urls_to_logical_files(
            file_geodatabase_urls,
            ".gdb",
            "file_geodatabase_by_location",
            "application/x-esri-shape",
        )

    # Create File entries from logical files
    files = []
    for logical_file_name, file_data in logical_files.items():

        # Extract file slug from logical file name
        # Default to the actual file name from storage.
        path_parts = logical_file_name.rsplit("/", 1)
        if len(path_parts) == 2:
            file_slug = path_parts[1]
        else:
            file_slug = logical_file_name

        # For datasets that resolve to multiple logical files under nested folders
        # (e.g. nhd/flowline/flowline_ak/... and nhd/flowline/flowline_conus/...),
        # prefer the folder immediately below dataset_slug as the file slug.
        # This maps a single Dataset ("flowline") to multiple File entries
        # ("flowline_ak", "flowline_conus"), matching the DB model semantics.
        if len(logical_files) > 1:
            logical_parts = [p for p in logical_file_name.split("/") if p]
            if dataset_slug in logical_parts:
                dataset_idx = logical_parts.index(dataset_slug)
                if dataset_idx + 1 < len(logical_parts):
                    nested_candidate = logical_parts[dataset_idx + 1]
                    if nested_candidate not in (
                        "parquet",
                        "pmtiles",
                        "geopackage",
                        "shapefile",
                        "geojson",
                        "file_geodatabase",
                    ):
                        file_slug = nested_candidate
            else:
                # Fallback for paths where the dataset appears as a prefix segment
                # instead of a dedicated folder segment (e.g. "flowline_ak/...").
                for part in logical_parts:
                    if part.startswith(f"{dataset_slug}_") or part.startswith(
                        f"{dataset_slug}-"
                    ):
                        file_slug = part
                        break

        # Use inventory file info if available, but use file_slug for name to ensure uniqueness
        # when there are multiple logical files
        inv_file: Optional[Dict] = None
        if inventory_files and len(inventory_files) == 1 and len(logical_files) == 1:
            # Only use inventory name if there's exactly one logical file
            inv_file = inventory_files[0]
            file_name = inv_file.get("name", file_slug)
            layer_name = inv_file.get("layer_name")
            source_file_path = inv_file.get("source_file_path")
        else:
            # Use file_slug as name when there are multiple logical files to ensure uniqueness
            file_name = file_slug
            layer_name = None
            source_file_path = None

        file_entry = {
            "name": file_name,
            "slug": file_slug,
            "description": None,
            "layer_name": layer_name,
            "source_file_path": source_file_path,
            "file_metadata": _build_metadata_from_inventory(inventory_entry, inv_file),
            "formats": [],
        }

        formats_dict = {}

        # GeoParquet format - combine sources from all storage locations
        all_geoparquet_sources = []
        for storage_location_name, sources in file_data["sources_by_location"].items():
            all_geoparquet_sources.extend(sources)

        for source in all_geoparquet_sources:
            source_storage_location = source.get("storage_location_name")
            storage_client = (
                storage_clients_by_location.get(source_storage_location)
                if source_storage_location
                else None
            )
            location = source.get("location", {}) or {}
            source_path = (
                location.get("path")
                if isinstance(location, dict)
                else getattr(location, "path", None)
            )
            size_bytes: Optional[int] = None
            if storage_client and source_path:
                if "*" in source_path:
                    size_bytes = await storage_client.calculate_total_size_for_glob(
                        source_path
                    )
                else:
                    size_bytes = await storage_client.get_file_size(source_path)
            source["source_metadata"] = _build_metadata_from_inventory(
                inventory_entry,
                inv_file,
                size_bytes=size_bytes,
                mime_type="application/x-parquet",
            )

        if all_geoparquet_sources:
            formats_dict["geoparquet"] = {
                "format_type": "geoparquet",
                "sources": all_geoparquet_sources,
            }

        # PMTiles format - match PMTiles to this logical file from all storage locations
        logical_file_base = file_slug
        pmtiles_sources = []

        for storage_location_name, pmtiles_urls in file_data[
            "pmtiles_by_location"
        ].items():
            storage_client = storage_clients_by_location.get(storage_location_name)
            if not storage_client:
                continue

            for pmtiles_url in pmtiles_urls:
                path = extract_path_from_url(pmtiles_url, storage_client)
                if path:
                    path_parts = path.rsplit("/", 1)
                    if len(path_parts) == 2:
                        pmtiles_filename = path_parts[1].replace(".pmtiles", "")
                        if pmtiles_filename == logical_file_base:
                            location = FileLocation(path=path)
                            size_bytes = await storage_client.get_file_size(path)
                            metadata = _build_metadata_from_inventory(
                                inventory_entry,
                                inv_file,
                                size_bytes=size_bytes,
                                mime_type="application/x-protobuf",
                            )
                            pmtiles_sources.append(
                                {
                                    "storage_location_name": storage_location_name,
                                    "version": date.today().isoformat(),
                                    "source_type": "file",
                                    "location": location.model_dump(),
                                    "references_source_id": None,
                                    "source_metadata": metadata,
                                }
                            )

        if pmtiles_sources:
            formats_dict["pmtiles"] = {
                "format_type": "pmtiles",
                "sources": pmtiles_sources,
            }

        # Helper function to create format sources from URLs
        async def create_format_sources(
            format_urls_by_location: Dict[str, List[str]],
            format_type: str,
            mime_type: str,
        ) -> List[Dict]:
            """Create format sources from URLs by location.

            This function processes format URLs that were already matched to this logical file
            in the match_format_urls_to_logical_files function above. So we just need to
            create the source entries for all URLs in the format_urls_by_location dict.

            For shapefiles, groups files by folder and creates a glob pattern (e.g., folder/*.shp)
            instead of individual sources, similar to how parquet files work.
            """
            format_sources = []
            for storage_location_name, format_urls in format_urls_by_location.items():
                storage_client = storage_clients_by_location.get(storage_location_name)
                if not storage_client:
                    continue

                # For shapefiles, always use glob patterns to capture all components
                # Shapefiles consist of multiple files (.shp, .shx, .dbf, .prj, etc.) in the same folder
                if format_type == "shapefile":
                    # Group shapefile URLs by folder
                    folders = {}
                    for format_url in format_urls:
                        path = extract_path_from_url(format_url, storage_client)
                        if path:
                            # Extract folder path (remove filename)
                            path_parts = path.rsplit("/", 1)
                            if len(path_parts) == 2:
                                folder_path = path_parts[0] + "/"
                                filename = path_parts[1]
                            else:
                                folder_path = ""
                                filename = path

                            if folder_path not in folders:
                                folders[folder_path] = []
                            folders[folder_path].append((path, filename))

                    # Create one source per folder with glob pattern
                    # Always use glob pattern for shapefiles to capture all components
                    for folder_path, files in folders.items():
                        # Use * to match all shapefile components (.shp, .shx, .dbf, .prj, etc.)
                        glob_path = f"{folder_path}*" if folder_path else "*"
                        location = FileLocation(path=glob_path)

                        # Calculate total size from all files found
                        total_size = 0
                        for file_path, _ in files:
                            size_bytes = await storage_client.get_file_size(file_path)
                            total_size += size_bytes

                        metadata = _build_metadata_from_inventory(
                            inventory_entry,
                            inv_file,
                            size_bytes=total_size if total_size > 0 else None,
                            mime_type=mime_type,
                        )
                        format_sources.append(
                            {
                                "storage_location_name": storage_location_name,
                                "version": date.today().isoformat(),
                                "source_type": "file",
                                "location": location.model_dump(),
                                "references_source_id": None,
                                "source_metadata": metadata,
                            }
                        )
                else:
                    # For other formats or single shapefile, create individual sources
                    for format_url in format_urls:
                        path = extract_path_from_url(format_url, storage_client)
                        if path:
                            # All URLs in format_urls_by_location are already matched to this logical file,
                            # so we can create sources for all of them
                            location = FileLocation(path=path)
                            size_bytes = await storage_client.get_file_size(path)
                            metadata = _build_metadata_from_inventory(
                                inventory_entry,
                                inv_file,
                                size_bytes=size_bytes,
                                mime_type=mime_type,
                            )
                            format_sources.append(
                                {
                                    "storage_location_name": storage_location_name,
                                    "version": date.today().isoformat(),
                                    "source_type": "file",
                                    "location": location.model_dump(),
                                    "references_source_id": None,
                                    "source_metadata": metadata,
                                }
                            )
            return format_sources

        # GeoPackage format
        geopackage_sources = await create_format_sources(
            file_data.get("geopackage_by_location", {}),
            "geopackage",
            "application/geopackage+sqlite3",
        )
        if geopackage_sources:
            formats_dict["geopackage"] = {
                "format_type": "geopackage",
                "sources": geopackage_sources,
            }

        # Shapefile format
        shapefile_sources = await create_format_sources(
            file_data.get("shapefile_by_location", {}),
            "shapefile",
            "application/zip",
        )
        if shapefile_sources:
            formats_dict["shapefile"] = {
                "format_type": "shapefile",
                "sources": shapefile_sources,
            }

        # GeoJSON format
        geojson_sources = await create_format_sources(
            file_data.get("geojson_by_location", {}),
            "geojson",
            "application/geo+json",
        )
        if geojson_sources:
            formats_dict["geojson"] = {
                "format_type": "geojson",
                "sources": geojson_sources,
            }

        # File Geodatabase format
        file_geodatabase_sources = await create_format_sources(
            file_data.get("file_geodatabase_by_location", {}),
            "file_geodatabase",
            "application/x-esri-shape",
        )
        if file_geodatabase_sources:
            formats_dict["file_geodatabase"] = {
                "format_type": "file_geodatabase",
                "sources": file_geodatabase_sources,
            }

        # GeoServer format - add for all matching files so OGC Features endpoint is always available.
        # For large datasets, disable download-style exports (GeoJSON/GeoPackage/Shapefile)
        # and keep only OGC Features.
        if geoserver_storage_location_name:
            # Check case-insensitively for storage location name
            has_geoserver_source = False
            geoserver_storage_location = None
            geoserver_loc_upper = geoserver_storage_location_name.upper()
            for storage_loc_name in file_data["sources_by_location"].keys():
                if storage_loc_name.upper() == geoserver_loc_upper:
                    has_geoserver_source = True
                    geoserver_storage_location = storage_loc_name
                    break

            if has_geoserver_source:
                import_settings = inventory_entry.get("import", {})
                if import_settings.get("add_to_geoserver", True):
                    # Calculate total size of GeoParquet files for this logical file.
                    # Reuse source metadata to avoid extra storage scans where possible.
                    total_size_bytes = 0
                    geoparquet_sources = file_data["sources_by_location"].get(
                        geoserver_storage_location, []
                    )
                    for source in geoparquet_sources:
                        source_metadata = source.get("source_metadata") or {}
                        source_size_bytes = (
                            source_metadata.get("size_bytes")
                            if isinstance(source_metadata, dict)
                            else None
                        )
                        if isinstance(source_size_bytes, int):
                            total_size_bytes += source_size_bytes

                    geoserver_workspace = (
                        import_settings.get("geoserver_workspace") or "hifld"
                    )
                    geoserver_store_name = (
                        import_settings.get("geoserver_store_name")
                        or f"{dataset_slug}-{file_slug}-store"
                    )
                    geoserver_layer_name = (
                        import_settings.get("geoserver_layer_name")
                        or f"{dataset_slug}-{file_slug}"
                    )

                    geoserver_location = GeoServerLocation(
                        workspace=geoserver_workspace,
                        store_name=geoserver_store_name,
                        layer_name=geoserver_layer_name,
                    )
                    geoserver_metadata = SpatialDatasetFileMetadata(
                        size_bytes=total_size_bytes,
                    )

                    formats_dict["geoserver"] = {
                        "format_type": "geoserver",
                        "sources": [
                            {
                                "storage_location_name": "GeoServer",
                                "version": date.today().isoformat(),
                                "source_type": "geoserver",
                                "location": geoserver_location.model_dump(),
                                "references_source_id": None,
                                "source_metadata": geoserver_metadata.model_dump(),
                            }
                        ],
                    }

        # Convert formats dict to array
        file_entry["formats"] = list(formats_dict.values())
        files.append(file_entry)

    # Merge duplicate file slugs that can occur when the same logical file is
    # discovered via multiple path patterns (legacy + new layouts).
    if files:
        merged_files: Dict[str, Dict] = {}
        for file_entry in files:
            slug = file_entry["slug"]
            existing = merged_files.get(slug)
            if not existing:
                merged_files[slug] = file_entry
                continue

            existing_formats = {
                fmt["format_type"]: fmt for fmt in existing.get("formats", [])
            }
            for fmt in file_entry.get("formats", []):
                fmt_type = fmt["format_type"]
                if fmt_type not in existing_formats:
                    existing_formats[fmt_type] = fmt
                    continue

                # Merge sources by value to avoid duplicates.
                existing_sources = existing_formats[fmt_type].get("sources", [])
                existing_keys = {
                    json.dumps(src, sort_keys=True, default=str)
                    for src in existing_sources
                }
                for src in fmt.get("sources", []):
                    src_key = json.dumps(src, sort_keys=True, default=str)
                    if src_key not in existing_keys:
                        existing_sources.append(src)
                        existing_keys.add(src_key)
                existing_formats[fmt_type]["sources"] = existing_sources

            existing["formats"] = list(existing_formats.values())

        files = list(merged_files.values())

    # If no parquet files found, create a basic file entry
    if not files:
        if inventory_files:
            for inv_file in inventory_files:
                file_slug = inv_file.get("slug", inv_file.get("name", dataset_slug))
                files.append(
                    {
                        "name": inv_file.get("name", file_slug),
                        "slug": file_slug,
                        "description": None,
                        "layer_name": inv_file.get("layer_name"),
                        "source_file_path": inv_file.get("source_file_path"),
                        "file_metadata": _build_metadata_from_inventory(
                            inventory_entry, inv_file
                        ),
                        "formats": [],
                    }
                )
        else:
            files.append(
                {
                    "name": dataset_slug,
                    "slug": dataset_slug,
                    "description": None,
                    "layer_name": None,
                    "source_file_path": None,
                    "file_metadata": _build_metadata_from_inventory(inventory_entry),
                    "formats": [],
                }
            )

    # Filter tags to exclude category_confidence and category_reasoning
    raw_tags = inventory_entry.get("tags", {})
    filtered_tags = {
        k: v
        for k, v in raw_tags.items()
        if k not in ("category_confidence", "category_reasoning")
    }

    return {
        "slug": dataset_slug,
        "name": inventory_entry.get("name", dataset_slug),
        "description": inventory_entry.get("description", ""),
        "tags": filtered_tags,
        "collection_slug": "hifld",
        "files": files,
    }


async def main():
    parser = argparse.ArgumentParser(
        description="Generate datasets JSONL from inventory and storage locations"
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        required=True,
        help="Input inventory JSONL file path",
    )
    parser.add_argument(
        "--bucket",
        type=str,
        action="append",
        required=True,
        help="Storage bucket (can specify multiple times). Format: gcs://bucket-name or seaweedfs://bucket-name",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "datasets.jsonl",
        help="Output datasets JSONL file path",
    )
    parser.add_argument(
        "--datasets",
        type=str,
        nargs="+",
        help="Specific dataset slugs to process (default: all in inventory)",
    )
    parser.add_argument(
        "--geoserver-storage-location",
        type=str,
        default=None,
        help="Storage location name to use for GeoServer entries (e.g., 'SeaweedFS drp-hifld-copy-formatted' or 'GCS drp-hifld-copy-formatted-49775666365'). If not specified, no GeoServer entries will be created.",
    )

    args = parser.parse_args()

    # Load inventory JSONL
    if not args.inventory.exists():
        print(f"Error: Inventory file not found: {args.inventory}")
        sys.exit(1)

    print(f"Loading inventory from {args.inventory}...")
    inventory_datasets = {}
    with open(args.inventory, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                dataset = json.loads(line)
                inventory_datasets[dataset["slug"]] = dataset

    print(f"Loaded {len(inventory_datasets)} datasets from inventory")

    # Parse bucket configurations
    bucket_configs = []
    for bucket_spec in args.bucket:
        if bucket_spec.startswith("gcs://"):
            bucket_name = bucket_spec[6:]
            bucket_configs.append({"type": "gcs", "bucket": bucket_name})
        elif bucket_spec.startswith("seaweedfs://"):
            bucket_name = bucket_spec[len("seaweedfs://") :]
            bucket_configs.append(
                {
                    "type": "seaweedfs",
                    "bucket": bucket_name,
                }
            )
        else:
            # Default to GCS if no prefix
            bucket_configs.append({"type": "gcs", "bucket": bucket_spec})

    print(f"Checking {len(bucket_configs)} storage location(s)...")

    # Determine which datasets to process
    datasets_to_process = args.datasets or list(inventory_datasets.keys())
    print(f"\nProcessing {len(datasets_to_process)} datasets...")

    dataset_entries = []

    for i, slug in enumerate(datasets_to_process, 1):
        if slug not in inventory_datasets:
            print(
                f"\n[{i}/{len(datasets_to_process)}] {slug} - NOT FOUND in inventory, skipping"
            )
            continue

        inventory_entry = inventory_datasets[slug]
        print(f"\n[{i}/{len(datasets_to_process)}] {slug}")

        # Find files in each storage location independently
        all_storage_files = {}
        storage_clients = {}  # Store clients for path extraction
        for bucket_config in bucket_configs:
            storage_type = bucket_config["type"]
            bucket_name = bucket_config["bucket"]
            print(f"  Checking {storage_type}://{bucket_name}...")

            # Create storage client
            if storage_type == "gcs":
                storage_client = create_storage_client(
                    storage_type="gcs", bucket=bucket_name
                )
            elif storage_type == "seaweedfs":
                storage_client = create_storage_client(
                    storage_type="seaweedfs",
                    bucket=bucket_name,
                )
            else:
                continue

            # Store client for later use
            storage_clients[f"{storage_type}_{bucket_name}"] = storage_client

            # Find files using storage client (each location is independent)
            files = await find_processed_files(storage_client, slug)
            all_storage_files[f"{storage_type}_{bucket_name}"] = files

            print(f"    → {len(files['geoparquet'])} GeoParquet file(s)")
            if files["pmtiles"]:
                print(f"    → {len(files['pmtiles'])} PMTiles file(s)")
            if files["geopackage"]:
                print(f"    → {len(files['geopackage'])} GeoPackage file(s)")
            if files["shapefile"]:
                print(f"    → {len(files['shapefile'])} Shapefile file(s)")
            if files["geojson"]:
                print(f"    → {len(files['geojson'])} GeoJSON file(s)")
            if files["file_geodatabase"]:
                print(
                    f"    → {len(files['file_geodatabase'])} File Geodatabase file(s)"
                )

            # Debug: show what we're looking for
            if (
                len(files["geoparquet"]) == 0
                and len(files["pmtiles"]) == 0
                and len(files["geopackage"]) == 0
                and len(files["shapefile"]) == 0
                and len(files["geojson"]) == 0
                and len(files["file_geodatabase"]) == 0
            ):
                print(
                    f"    ⚠ No files found for '{slug}' in {storage_type}://{bucket_name}"
                )
                print("       Looking for recursive paths matching patterns like:")
                print(f"         - {slug}/**/parquet/*.zstd.parquet")
                print(f"         - **/{slug}/**/parquet/*.zstd.parquet")
                print(f"         - **/{slug}/**/*.zstd.parquet")
            elif len(files["geoparquet"]) > 0:
                # Show first few paths found for debugging
                print("       Found GeoParquet files (showing first 3):")
                for path in list(files["geoparquet"])[:3]:
                    print(f"         - {path}")

        # Determine GeoServer storage location name from flag
        geoserver_storage_location_name = None
        if args.geoserver_storage_location:
            # Try to match the flag to one of the configured storage locations
            for bucket_config in bucket_configs:
                storage_type = bucket_config["type"]
                bucket_name = bucket_config["bucket"]
                # Check if the flag matches this storage location
                if (
                    args.geoserver_storage_location.startswith(storage_type.upper())
                    or args.geoserver_storage_location.startswith(storage_type.lower())
                    or args.geoserver_storage_location
                    == f"{storage_type}_{bucket_name}"
                    or args.geoserver_storage_location
                    == f"{storage_type} {bucket_name}"
                ):
                    # Construct storage location name (format: "GCS BucketName" or "SeaweedFS BucketName")
                    if storage_type == "gcs":
                        geoserver_storage_location_name = f"GCS {bucket_name}"
                    elif storage_type == "seaweedfs":
                        geoserver_storage_location_name = f"SeaweedFS {bucket_name}"
                    else:
                        geoserver_storage_location_name = (
                            f"{storage_type.upper()} {bucket_name}"
                        )
                    break

            # If no match found, use the flag as-is (might be a full storage location name)
            if not geoserver_storage_location_name:
                geoserver_storage_location_name = args.geoserver_storage_location

        # Create dataset entry by combining inventory metadata with storage locations
        # Pass all storage files and clients as a dict keyed by storage location name
        storage_files_by_location = {}
        storage_clients_by_location = {}
        for bucket_config in bucket_configs:
            storage_type = bucket_config["type"]
            bucket_name = bucket_config["bucket"]
            location_key = f"{storage_type}_{bucket_name}"
            # Match the format used in seed_storage.py: "GCS bucket-name" or "SeaweedFS bucket-name"
            if storage_type == "gcs":
                storage_location_name = f"GCS {bucket_name}"
            elif storage_type == "seaweedfs":
                storage_location_name = f"SeaweedFS {bucket_name}"
            else:
                storage_location_name = f"{storage_type.upper()} {bucket_name}"

            if location_key in all_storage_files:
                storage_files_by_location[storage_location_name] = all_storage_files[
                    location_key
                ]
                storage_clients_by_location[storage_location_name] = (
                    storage_clients.get(location_key)
                )

        entry = await create_dataset_entry(
            slug,
            inventory_entry,
            storage_files_by_location,
            storage_clients_by_location,
            geoserver_storage_location_name,
        )
        if dataset_has_sources(entry):
            dataset_entries.append(entry)
        else:
            print("  Skipping dataset with no sources")

    # Write JSONL file
    print(f"\nWriting {len(dataset_entries)} datasets to {args.output}...")
    with open(args.output, "w", encoding="utf-8") as f:
        for entry in dataset_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"✓ Generated {args.output}")

    # Print summary statistics
    print("\n=== Summary ===")
    total_files = sum(len(entry["files"]) for entry in dataset_entries)

    # Count formats
    total_geoparquet_gcs = 0
    total_geoparquet_seaweedfs = 0
    total_geoserver = 0
    total_pmtiles = 0
    total_geopackage = 0
    total_shapefile = 0
    total_geojson = 0
    total_file_geodatabase = 0

    for entry in dataset_entries:
        for file in entry["files"]:
            for fmt in file.get("formats", []):
                if fmt["format_type"] == "geoparquet":
                    for src in fmt.get("sources", []):
                        loc_name_upper = src["storage_location_name"].upper()
                        if "GCS" in loc_name_upper:
                            total_geoparquet_gcs += 1
                        elif "SEAWEEDFS" in loc_name_upper:
                            total_geoparquet_seaweedfs += 1
                elif fmt["format_type"] == "geoserver":
                    # Count each GeoServer source (one per chunk)
                    total_geoserver += len(fmt.get("sources", []))
                elif fmt["format_type"] == "pmtiles":
                    total_pmtiles += 1
                elif fmt["format_type"] == "geopackage":
                    total_geopackage += len(fmt.get("sources", []))
                elif fmt["format_type"] == "shapefile":
                    total_shapefile += len(fmt.get("sources", []))
                elif fmt["format_type"] == "geojson":
                    total_geojson += len(fmt.get("sources", []))
                elif fmt["format_type"] == "file_geodatabase":
                    total_file_geodatabase += len(fmt.get("sources", []))

    print(f"Datasets: {len(dataset_entries)}")
    print(f"Total files: {total_files}")
    print(f"GeoParquet sources (GCS): {total_geoparquet_gcs}")
    print(f"GeoParquet sources (SeaweedFS): {total_geoparquet_seaweedfs}")
    print(f"PMTiles sources: {total_pmtiles}")
    print(f"GeoPackage sources: {total_geopackage}")
    print(f"Shapefile sources: {total_shapefile}")
    print(f"GeoJSON sources: {total_geojson}")
    print(f"File Geodatabase sources: {total_file_geodatabase}")
    print(f"GeoServer entries: {total_geoserver}")


if __name__ == "__main__":
    asyncio.run(main())
