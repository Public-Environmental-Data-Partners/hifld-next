#!/usr/bin/env python3
"""
Import datasets from inventory.csv into the database.

This script:
1. Seeds storage locations if needed
2. Creates/gets a default collection
3. For each dataset in inventory.csv:
   - Creates dataset record
   - Processes parquet file (creates GeoParquet and PMTiles)
   - Adds formats (geoparquet, pmtiles) to dataset
   - Adds sources (files) to formats
   - Optionally registers with GeoServer

Usage:
    python -m scripts.import_inventory [--dry-run] [--limit N] [--skip-geoserver]
"""

import argparse
import asyncio
import csv
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.db import get_db_session
from models.dataset import (
    Collection,
    StorageLocation,
    FileLocation,
    SpatialDatasetFileMetadata,
)
from services.datasets import DatasetService
from services.collections import CollectionService
from services.geoserver import GeoServerClient
from processing.processor import process_dataset as process_dataset_func
from storage.storage_client import create_storage_client
from models.dataset import Format

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("import-inventory")

# Default paths
DEFAULT_INVENTORY_PATH = Path(__file__) / "inventory.csv"


def clean_description(description: str) -> str:
    """Clean HTML and special characters from description."""
    if not description:
        return ""

    # Remove HTML tags
    description = re.sub(r"<[^>]+>", "", description)

    # Decode HTML entities
    import html

    description = html.unescape(description)

    # Clean up whitespace
    description = " ".join(description.split())

    return description.strip()


def get_or_create_collection(db: Session, name: str = "HIFLD") -> Collection:
    """Get or create the default collection."""
    collection_service = CollectionService(db)
    collection = collection_service.get_collection_by_name(name)

    if not collection:
        collection = collection_service.create_collection(
            name=name,
            description="HIFLD (Homeland Infrastructure Foundation-Level Data) datasets",
        )
        logger.info(f"Created collection '{name}' (ID: {collection.id})")
    else:
        logger.info(f"Using existing collection '{name}' (ID: {collection.id})")

    return collection


def get_storage_location(
    db: Session, name: str = "SeaweedFS Local"
) -> Optional[StorageLocation]:
    """Get a storage location by name."""
    statement = select(StorageLocation).where(StorageLocation.name == name)
    return db.exec(statement).first()


def ensure_formats_exist(db: Session) -> None:
    """Ensure format definitions exist in the database."""
    # Default format definitions
    DEFAULT_FORMATS = [
        {
            "format_type": "geoparquet",
            "name": "GeoParquet",
            "description": "GeoParquet format for GeoServer and analysis",
            "mime_type": "application/parquet",
        },
        {
            "format_type": "pmtiles",
            "name": "PMTiles",
            "description": "PMTiles format for tile serving",
            "mime_type": "application/x-protobuf",
        },
        {
            "format_type": "ogc_feature",
            "name": "OGC Features API",
            "description": "OGC Features API endpoint via GeoServer",
            "mime_type": "application/geo+json",
        },
    ]

    # Check if any formats exist
    statement = select(Format)
    existing = list(db.exec(statement).all())

    if not existing:
        logger.info("No formats found. Seeding formats...")
        for format_data in DEFAULT_FORMATS:
            # Check if format already exists
            check_stmt = select(Format).where(
                Format.format_type == format_data["format_type"]
            )
            existing_format = db.exec(check_stmt).first()

            if not existing_format:
                format_obj = Format(**format_data)
                db.add(format_obj)
                db.commit()
                db.refresh(format_obj)
                logger.info(
                    f"  ✓ Created format '{format_data['format_type']}' (ID: {format_obj.id})"
                )
        logger.info("Formats seeded successfully")
    else:
        logger.debug(f"Found {len(existing)} existing formats")


def parse_bounds(bounds_str: Optional[str]) -> Optional[List[float]]:
    """Parse bounds string to list of floats."""
    if not bounds_str:
        return None

    try:
        # Handle format: "[minx, miny, maxx, maxy]"
        bounds_str = bounds_str.strip("[]")
        values = [float(x.strip()) for x in bounds_str.split(",")]
        if len(values) == 4:
            return values
    except Exception:
        pass

    return None


async def import_dataset(
    db: Session,
    dataset: Dict[str, str],
    collection: Collection,
    storage_location: StorageLocation,
    storage: Any,
    add_to_geoserver: bool = True,
) -> Dict[str, Any]:
    """
    Import a single dataset: process it and create database entries.
    """
    name = dataset.get("name", "").strip()
    alias = dataset.get("alias", "").strip() or name
    description = clean_description(dataset.get("description", ""))
    dataset_type = dataset.get("type", "Point").strip()
    parquet_url = dataset.get("parquet_url", "").strip()

    dataset_service = DatasetService(db)

    # Check if dataset already exists - if so, delete it to allow reprocessing
    existing = dataset_service.get_dataset_by_name(name)
    if existing:
        logger.info(
            f"  → Dataset '{name}' already exists, deleting for reprocessing..."
        )
        dataset_service.delete_dataset(existing.id)
        logger.info(f"  → Deleted existing dataset '{name}' (ID: {existing.id})")

    # Step 1: Process the parquet file
    logger.info(f"  → Processing parquet from {parquet_url}...")
    process_result = await process_dataset_func(
        name=name,
        parquet_url=parquet_url,
        storage=storage,
    )

    if not process_result.get("success"):
        raise Exception(f"Processing failed: {process_result.get('error')}")

    # Step 2: Create dataset record
    logger.info("  → Creating dataset record...")
    dataset_obj = dataset_service.create_dataset(
        name=name,
        alias=alias,
        type=dataset_type,
        description=description,
        collection_id=collection.id,
    )

    # Step 3: Add formats and sources
    formats_created = []

    # Add GeoParquet format
    if process_result.get("geoparquet_url"):
        logger.info("  → Adding GeoParquet format...")
        geoparquet_format = dataset_service.add_dataset_format(
            dataset_id=dataset_obj.id,
            format_type="geoparquet",
            description="GeoParquet format for GeoServer and analysis",
        )
        formats_created.append(geoparquet_format)

        # Extract path from URL (e.g., "http://localhost:8888/buckets/hifld/datasets/name/name.parquet" -> "datasets/name/name.parquet")
        geoparquet_url = process_result["geoparquet_url"]
        if "/buckets/" in geoparquet_url:
            path = geoparquet_url.split("/buckets/")[1].split("/", 1)[1]
        else:
            # Fallback: try to extract path from URL
            path = (
                geoparquet_url.split(storage_location.config.base_url)[1].lstrip("/")
                if storage_location.config and storage_location.config.base_url
                else None
            )

        if path:
            # Add source for GeoParquet
            geoparquet_source_created = dataset_service.add_format_source(
                dataset_format_id=geoparquet_format.id,
                storage_location_id=storage_location.id,
                source_type="file",
                location=FileLocation(path=path).model_dump(),
                source_metadata=(
                    SpatialDatasetFileMetadata(
                        feature_count=process_result.get("feature_count"),
                        bounds=parse_bounds(process_result.get("bounds")),
                        mime_type="application/parquet",
                    ).model_dump()
                    if process_result.get("feature_count")
                    else None
                ),
            )

    # Add PMTiles format
    if process_result.get("pmtiles_url"):
        logger.info("  → Adding PMTiles format...")
        pmtiles_format = dataset_service.add_dataset_format(
            dataset_id=dataset_obj.id,
            format_type="pmtiles",
            description="PMTiles format for tile serving",
        )
        formats_created.append(pmtiles_format)

        # Extract path from URL
        pmtiles_url = process_result["pmtiles_url"]
        if "/buckets/" in pmtiles_url:
            path = pmtiles_url.split("/buckets/")[1].split("/", 1)[1]
        else:
            path = (
                pmtiles_url.split(storage_location.config.base_url)[1].lstrip("/")
                if storage_location.config and storage_location.config.base_url
                else None
            )

        if path:
            # Add source for PMTiles
            dataset_service.add_format_source(
                dataset_format_id=pmtiles_format.id,
                storage_location_id=storage_location.id,
                source_type="file",
                location=FileLocation(path=path).model_dump(),
                source_metadata=SpatialDatasetFileMetadata(
                    mime_type="application/x-protobuf",
                ).model_dump(),
            )

    # Step 4: Register with GeoServer if requested
    geoserver_success = False
    if add_to_geoserver and process_result.get("geoparquet_url"):
        logger.info("  → Registering with GeoServer...")
        try:
            if not geoparquet_source_created:
                logger.warning(
                    "  ⚠ No geoparquet source found for GeoServer registration"
                )
            else:
                # Get GeoServer storage location
                geoserver_storage = db.exec(
                    select(StorageLocation).where(
                        StorageLocation.backend_type == "geoserver"
                    )
                ).first()

                if not geoserver_storage:
                    logger.warning(
                        "  ⚠ GeoServer storage location not found. Run seed_storage.py first."
                    )
                else:
                    # Use the geoparquet URL directly from process result
                    geoparquet_url = process_result["geoparquet_url"]

                    # Use GeoServerClient directly to publish
                    geoserver_client = GeoServerClient()
                    workspace = os.getenv("GEOSERVER_WORKSPACE", "hifld")

                    # Generate version-specific store name
                    # Use the geoparquet's storage location and version for naming
                    store_name = geoserver_client.get_versioned_store_name(
                        name,
                        storage_location.id,  # Cloud storage location ID
                        geoparquet_source_created.version,
                    )
                    layer_name = store_name

                    logger.info(f"  → Creating GeoServer store: {store_name}")

                    # Create store
                    store_created = await geoserver_client.create_geoparquet_store(
                        workspace, store_name, geoparquet_url
                    )

                    if store_created:
                        # Publish layer
                        geoserver_success = await geoserver_client.publish_layer(
                            workspace, store_name, layer_name
                        )
                        if geoserver_success:
                            logger.info(
                                f"  ✓ GeoServer registration successful: {store_name}"
                            )

                            # Create GeoServer format if it doesn't exist for this dataset
                            logger.info("  → Creating GeoServer format entry...")
                            geoserver_format = dataset_service.add_dataset_format(
                                dataset_id=dataset_obj.id,
                                format_type="geoserver",
                                description="GeoServer OGC service endpoints (WFS, WMS, OGC API Features, GeoPackage export)",
                            )

                            # Create GeoServer source entry
                            # The version matches the geoparquet source version
                            geoserver_source = dataset_service.add_format_source(
                                dataset_format_id=geoserver_format.id,
                                storage_location_id=geoserver_storage.id,
                                source_type="service",
                                location={
                                    "workspace": workspace,
                                    "store_name": store_name,
                                    "layer_name": layer_name,
                                },
                                source_metadata={
                                    "source_geoparquet_id": geoparquet_source_created.id,
                                    "source_geoparquet_version": geoparquet_source_created.version,
                                    "source_storage_location_id": storage_location.id,
                                    "wfs_url": geoserver_client.get_wfs_url(
                                        workspace, layer_name
                                    ),
                                    "wms_url": geoserver_client.get_wms_url(
                                        workspace, layer_name
                                    ),
                                    "feature_api_url": geoserver_client.get_feature_api_url(
                                        workspace, layer_name
                                    ),
                                },
                            )
                            logger.info(
                                f"  ✓ Created GeoServer source (version {geoserver_source.version})"
                            )
                            formats_created.append(geoserver_format)
                        else:
                            logger.warning("  ⚠ GeoServer layer publishing failed")
                    else:
                        logger.warning("  ⚠ GeoServer store creation failed")
        except Exception as e:
            logger.warning(f"  ⚠ GeoServer registration error: {e}")

    return {
        "name": name,
        "dataset_id": dataset_obj.id,
        "geoparquet_url": process_result.get("geoparquet_url"),
        "pmtiles_url": process_result.get("pmtiles_url"),
        "feature_count": process_result.get("feature_count"),
        "geoserver_success": geoserver_success,
    }


async def import_datasets(
    db: Session,
    datasets: List[Dict[str, str]],
    collection: Collection,
    storage_location: StorageLocation,
    storage: Any,
    dry_run: bool = False,
    add_to_geoserver: bool = True,
) -> Dict[str, Any]:
    """Import datasets from inventory."""
    results = {
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "errors": [],
    }

    for i, dataset in enumerate(datasets):
        name = dataset.get("name", "").strip()
        alias = dataset.get("alias", "").strip()
        parquet_url = dataset.get("parquet_url", "").strip()

        if not name:
            logger.warning(f"[{i+1}/{len(datasets)}] Skipping dataset with empty name")
            results["skipped"] += 1
            continue

        if not parquet_url:
            logger.warning(f"[{i+1}/{len(datasets)}] Skipping {name}: no parquet URL")
            results["skipped"] += 1
            continue

        if dry_run:
            logger.info(
                f"[{i+1}/{len(datasets)}] [DRY RUN] Would process: {name} ({alias})"
            )
            logger.info(f"  Source: {parquet_url}")
            results["success"] += 1
            continue

        try:
            logger.info(f"[{i+1}/{len(datasets)}] Processing: {name} ({alias})")
            result = await import_dataset(
                db, dataset, collection, storage_location, storage, add_to_geoserver
            )

            if result.get("skipped"):
                results["skipped"] += 1
            else:
                results["success"] += 1
                logger.info(f"  ✓ Success: Dataset ID {result.get('dataset_id')}")

        except Exception as e:
            results["failed"] += 1
            error_msg = f"{name}: {str(e)}"
            results["errors"].append(error_msg)
            logger.error(f"  ✗ Failed: {error_msg}")

    return results


def load_inventory(inventory_path: Path) -> List[Dict[str, str]]:
    """Load datasets from inventory CSV file."""
    if not inventory_path.exists():
        raise FileNotFoundError(f"Inventory file not found: {inventory_path}")

    datasets = []
    with open(inventory_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            datasets.append(row)

    logger.info(f"Loaded {len(datasets)} datasets from inventory")
    return datasets


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Import datasets from inventory.csv into the database"
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        default=DEFAULT_INVENTORY_PATH,
        help=f"Path to inventory CSV file (default: {DEFAULT_INVENTORY_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be processed without making changes",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of datasets to process",
    )
    parser.add_argument(
        "--skip-geoserver",
        action="store_true",
        help="Skip GeoServer registration",
    )
    parser.add_argument(
        "--collection",
        type=str,
        default="HIFLD",
        help="Collection name to use (default: HIFLD)",
    )
    parser.add_argument(
        "--storage-location",
        type=str,
        default="SeaweedFS Local",
        help="Storage location name to use (default: SeaweedFS Local)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    try:
        # Load inventory
        datasets = load_inventory(args.inventory)

        # Apply limit if specified
        if args.limit:
            datasets = datasets[: args.limit]
            logger.info(f"Limited to first {args.limit} datasets")

        # Get database session
        db = get_db_session()
        try:
            # Ensure formats are seeded
            ensure_formats_exist(db)

            # Get or create collection
            collection = get_or_create_collection(db, name=args.collection)

            # Get storage location
            storage_location = get_storage_location(db, name=args.storage_location)
            if not storage_location:
                logger.error(f"Storage location '{args.storage_location}' not found")
                logger.error("Run seed script first: python -m scripts.seed_storage")
                sys.exit(1)

            logger.info(
                f"Using storage location: {storage_location.name} (ID: {storage_location.id})"
            )

            # Create storage client
            storage = create_storage_client()

            # Import datasets
            results = await import_datasets(
                db,
                datasets,
                collection,
                storage_location,
                storage,
                dry_run=args.dry_run,
                add_to_geoserver=not args.skip_geoserver,
            )

            # Print summary
            print("\n" + "=" * 50)
            print("IMPORT SUMMARY")
            print("=" * 50)
            print(f"  Success: {results['success']}")
            print(f"  Skipped: {results['skipped']}")
            print(f"  Failed:  {results['failed']}")

            if results["errors"]:
                print("\nErrors:")
                for error in results["errors"][:10]:
                    print(f"  - {error}")
                if len(results["errors"]) > 10:
                    print(f"  ... and {len(results['errors']) - 10} more errors")

            print("=" * 50)

            if results["failed"] > 0:
                sys.exit(1)
        finally:
            db.close()

    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Import failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
