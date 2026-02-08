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


async def find_processed_files(
    storage_client: StorageClient,
    filename: str,
) -> Dict[str, List[str]]:
    """Find all processed files for a dataset using a storage client.

    Args:
        storage_client: Storage client instance
        filename: Dataset filename/slug
    """
    prefix = f"{filename}/"
    files_by_ext = await storage_client.find_files_by_extensions(
        prefix, [".parquet", ".zstd.parquet", ".pmtiles"]
    )

    # Convert to the expected format
    return {
        "geoparquet": files_by_ext.get("parquet", [])
        + files_by_ext.get("zstd.parquet", []),
        "pmtiles": files_by_ext.get("pmtiles", []),
    }


def extract_path_from_url(url: str, storage_client: StorageClient) -> Optional[str]:
    """Extract relative path from a storage URL using the storage client."""
    return storage_client.parse_url_to_path(url)


def group_parquet_files_by_pattern(
    parquet_urls: List[str], storage_client: StorageClient
) -> Dict[str, List[str]]:
    """
    Group parquet files by their base pattern (removing chunk suffixes).

    Returns a dict mapping base pattern to list of URLs.
    For example:
    - Single chunk: "path/file.parquet" -> ["path/file.parquet"]
    - Multi-chunk: "path/file-0.parquet", "path/file-1.parquet" -> "path/file-*.parquet" -> [both URLs]

    If both chunked and non-chunked files exist with the same base name, prefer the chunked version.
    """
    # Group files by base name (without chunk number)
    base_name_groups = {}  # Maps (dir, base_name) to list of URLs

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

        # Check for chunk pattern: filename-{number}.parquet
        # Match: filename-0.parquet, filename-1.zstd.parquet, etc.
        chunk_match = re.match(r"^(.+)-(\d+)\.(zstd\.)?parquet$", filename)
        if chunk_match:
            # This is a chunked file
            base_name = chunk_match.group(1)
            key = (dir_part, base_name, True)  # True indicates chunked
        else:
            # Non-chunked file
            base_name = filename.replace(".zstd.parquet", "").replace(".parquet", "")
            key = (dir_part, base_name, False)  # False indicates non-chunked

        if key not in base_name_groups:
            base_name_groups[key] = []
        base_name_groups[key].append(url)

    # Convert to pattern-based groups
    # If both chunked and non-chunked files exist with the same base name, prefer chunked
    groups = {}
    base_name_to_group = {}  # Track which base names we've processed

    for (dir_part, base_name, is_chunked), urls in base_name_groups.items():
        base_key = (dir_part, base_name)

        # If we already have a chunked version, skip non-chunked
        if (
            base_key in base_name_to_group
            and base_name_to_group[base_key][1]
            and not is_chunked
        ):
            continue

        # If we have a chunked version and this is non-chunked, skip
        if (
            base_key in base_name_to_group
            and not base_name_to_group[base_key][1]
            and is_chunked
        ):
            # Remove the non-chunked version and use chunked instead
            old_pattern, _ = base_name_to_group[base_key]
            if old_pattern in groups:
                del groups[old_pattern]

        if is_chunked and len(urls) > 1:
            # Multiple chunks - use glob pattern
            # Determine extension from first file
            first_path = extract_path_from_url(urls[0], storage_client)
            if first_path:
                first_filename = first_path.rsplit("/", 1)[-1]
                ext_match = re.match(r"^.+-\d+\.(zstd\.)?parquet$", first_filename)
                if ext_match:
                    ext = ext_match.group(1) or ""
                    pattern = (
                        f"{dir_part}/{base_name}-*.{ext}parquet"
                        if dir_part
                        else f"{base_name}-*.{ext}parquet"
                    )
                    groups[pattern] = urls
                    base_name_to_group[base_key] = (pattern, True)
                else:
                    # Fallback to first file path
                    groups[first_path] = urls
                    base_name_to_group[base_key] = (first_path, True)
            else:
                # Fallback
                path = extract_path_from_url(urls[0], storage_client)
                if path:
                    groups[path] = urls
                    base_name_to_group[base_key] = (path, True)
        else:
            # Single file (or single chunk) - use exact path
            path = extract_path_from_url(urls[0], storage_client)
            if path:
                groups[path] = urls
                base_name_to_group[base_key] = (path, is_chunked)

    return groups


def create_dataset_entry(
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
    # logical_files maps logical_file_name -> {sources_by_location: {...}, pmtiles_by_location: {...}}
    logical_files = {}

    # Process each storage location independently
    for storage_location_name, files_dict in storage_files_by_location.items():
        storage_client = storage_clients_by_location.get(storage_location_name)
        if not storage_client:
            continue

        parquet_urls = sorted(files_dict.get("geoparquet", []))
        pmtiles_urls = sorted(files_dict.get("pmtiles", []))

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
                    # Remove glob pattern and extension to get base name
                    # Handle both glob patterns (file-*.zstd.parquet) and single files (file.zstd.parquet)
                    if "*.zstd.parquet" in filename:
                        # Glob pattern: remove -*.zstd.parquet
                        base_name = filename.replace("-*.zstd.parquet", "").replace(
                            "*.zstd.parquet", ""
                        )
                    elif "*.parquet" in filename:
                        # Glob pattern: remove -*.parquet
                        base_name = filename.replace("-*.parquet", "").replace(
                            "*.parquet", ""
                        )
                    else:
                        # Single file: remove extension
                        base_name = filename.replace(".zstd.parquet", "").replace(
                            ".parquet", ""
                        )
                    logical_file_name = f"{path_parts[0]}/{base_name}"
                else:
                    # Same logic for files without directory
                    if "*.zstd.parquet" in pattern:
                        base_name = pattern.replace("-*.zstd.parquet", "").replace(
                            "*.zstd.parquet", ""
                        )
                    elif "*.parquet" in pattern:
                        base_name = pattern.replace("-*.parquet", "").replace(
                            "*.parquet", ""
                        )
                    else:
                        base_name = pattern.replace(".zstd.parquet", "").replace(
                            ".parquet", ""
                        )
                    logical_file_name = base_name

                # Initialize logical file if needed
                if logical_file_name not in logical_files:
                    logical_files[logical_file_name] = {
                        "sources_by_location": {},  # Maps storage_location_name -> list of sources
                        "pmtiles_by_location": {},  # Maps storage_location_name -> list of PMTiles URLs
                    }

                # Add GeoParquet sources for this storage location
                if (
                    storage_location_name
                    not in logical_files[logical_file_name]["sources_by_location"]
                ):
                    logical_files[logical_file_name]["sources_by_location"][
                        storage_location_name
                    ] = []

                # Create location (glob pattern if multiple files, otherwise exact path)
                if len(urls) > 1:
                    location = FileLocation(path=pattern)
                else:
                    path = extract_path_from_url(urls[0], storage_client)
                    if path:
                        location = FileLocation(path=path)
                    else:
                        continue

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

    # Create File entries from logical files
    files = []
    for logical_file_name, file_data in logical_files.items():

        # Extract file slug from logical file name
        # Use the actual file name from storage (don't simplify)
        path_parts = logical_file_name.rsplit("/", 1)
        if len(path_parts) == 2:
            file_slug = path_parts[1]
        else:
            file_slug = logical_file_name

        # Use inventory file info if available, but use file_slug for name to ensure uniqueness
        # when there are multiple logical files
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
            "file_metadata": None,
            "formats": [],
        }

        formats_dict = {}

        # GeoParquet format - combine sources from all storage locations
        all_geoparquet_sources = []
        for storage_location_name, sources in file_data["sources_by_location"].items():
            all_geoparquet_sources.extend(sources)

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
                            metadata = SpatialDatasetFileMetadata(
                                mime_type="application/x-protobuf"
                            )
                            pmtiles_sources.append(
                                {
                                    "storage_location_name": storage_location_name,
                                    "version": date.today().isoformat(),
                                    "source_type": "file",
                                    "location": location.model_dump(),
                                    "references_source_id": None,
                                    "source_metadata": metadata.model_dump(),
                                }
                            )

        if pmtiles_sources:
            formats_dict["pmtiles"] = {
                "format_type": "pmtiles",
                "sources": pmtiles_sources,
            }

        # GeoServer format - only if this file has sources in the specified storage location
        if geoserver_storage_location_name:
            # Check case-insensitively for storage location name
            has_geoserver_source = False
            geoserver_loc_upper = geoserver_storage_location_name.upper()
            for storage_loc_name in file_data["sources_by_location"].keys():
                if storage_loc_name.upper() == geoserver_loc_upper:
                    has_geoserver_source = True
                    break

            if has_geoserver_source:
                import_settings = inventory_entry.get("import", {})
                if import_settings.get("add_to_geoserver", True):
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

                    formats_dict["geoserver"] = {
                        "format_type": "geoserver",
                        "sources": [
                            {
                                "storage_location_name": "GeoServer",
                                "version": date.today().isoformat(),
                                "source_type": "geoserver",
                                "location": geoserver_location.model_dump(),
                                "references_source_id": None,
                                "source_metadata": None,
                            }
                        ],
                    }

        # Convert formats dict to array
        file_entry["formats"] = list(formats_dict.values())
        files.append(file_entry)

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
                        "file_metadata": None,
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
                    "file_metadata": None,
                    "formats": [],
                }
            )
    return {
        "slug": dataset_slug,
        "name": inventory_entry.get("name", dataset_slug),
        "description": inventory_entry.get("description", ""),
        "tags": inventory_entry.get("tags", {}),
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
        "--seaweedfs-url",
        type=str,
        default="http://localhost:8888",
        help="SeaweedFS filer URL (default: http://localhost:8888)",
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
                    "filer_url": args.seaweedfs_url,
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
                filer_url = bucket_config.get("filer_url", args.seaweedfs_url)
                storage_client = create_storage_client(
                    storage_type="seaweedfs",
                    bucket=bucket_name,
                    filer_url=filer_url,
                )
            else:
                continue

            # Store client for later use
            storage_clients[f"{storage_type}_{bucket_name}"] = storage_client

            # Find files using storage client (each location is independent)
            files = await find_processed_files(storage_client, slug)
            all_storage_files[f"{storage_type}_{bucket_name}"] = files

            # Debug: print what we found
            all_files = await storage_client.list_files(f"{slug}/")
            if all_files:
                print(f"    Found {len(all_files)} file(s) with prefix '{slug}/':")
                for f in all_files[:5]:  # Show first 5
                    print(f"      - {f}")
                if len(all_files) > 5:
                    print(f"      ... and {len(all_files) - 5} more")

            print(f"    → {len(files['geoparquet'])} GeoParquet file(s)")
            if files["pmtiles"]:
                print(f"    → {len(files['pmtiles'])} PMTiles file(s)")

            # Debug: show what we're looking for
            if len(files["geoparquet"]) == 0 and len(files["pmtiles"]) == 0:
                print(
                    f"    ⚠ No files found for '{slug}' in {storage_type}://{bucket_name}"
                )
                print(f"       Looking for: {slug}/ (parquet and pmtiles files)")

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

        entry = create_dataset_entry(
            slug,
            inventory_entry,
            storage_files_by_location,
            storage_clients_by_location,
            geoserver_storage_location_name,
        )
        dataset_entries.append(entry)

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

    print(f"Datasets: {len(dataset_entries)}")
    print(f"Total files: {total_files}")
    print(f"GeoParquet sources (GCS): {total_geoparquet_gcs}")
    print(f"GeoParquet sources (SeaweedFS): {total_geoparquet_seaweedfs}")
    print(f"PMTiles sources: {total_pmtiles}")
    print(f"GeoServer entries: {total_geoserver}")


if __name__ == "__main__":
    asyncio.run(main())
