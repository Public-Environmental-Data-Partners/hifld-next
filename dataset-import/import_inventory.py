#!/usr/bin/env python3
"""
Import datasets from inventory.csv into the HIFLD Catalog.

This script:
1. Reads the inventory CSV
2. Calls the upload-processor to download and process each dataset
3. Calls the webapp API to create catalog entries and register with GeoServer

Usage:
    python import_inventory.py [--dry-run] [--limit N]

Examples:
    # Process all datasets
    python import_inventory.py

    # Preview what would be processed (dry run)
    python import_inventory.py --dry-run

    # Process first 5 datasets only
    python import_inventory.py --limit 5
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

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("import-inventory")

# Default paths and URLs
DEFAULT_INVENTORY_PATH = Path(__file__).parent / "inventory.csv"
PROCESSOR_URL = os.getenv("PROCESSOR_URL", "http://localhost:8000")
CATALOG_URL = os.getenv("CATALOG_URL", "http://localhost:3000")


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


def clean_description(description: str) -> str:
    """Clean HTML and special characters from description."""
    if not description:
        return ""

    # Remove HTML tags
    clean = re.sub(r"<[^>]+>", "", description)

    # Replace HTML entities
    clean = clean.replace("&nbsp;", " ")
    clean = clean.replace("&amp;", "&")
    clean = clean.replace("&lt;", "<")
    clean = clean.replace("&gt;", ">")
    clean = clean.replace("&quot;", '"')

    # Normalize whitespace
    clean = " ".join(clean.split())

    return clean.strip()


async def check_processor_health() -> bool:
    """Check if the upload processor is running."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{PROCESSOR_URL}/health")
            return response.status_code == 200
    except Exception:
        return False


async def check_catalog_health() -> bool:
    """Check if the webapp catalog API is running."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{CATALOG_URL}/api/datasets")
            return response.status_code == 200
    except Exception:
        return False


async def get_existing_datasets() -> set:
    """Get names of existing datasets from the catalog."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{CATALOG_URL}/api/datasets")
            if response.status_code == 200:
                datasets = response.json()
                return {d["name"] for d in datasets}
    except Exception as e:
        logger.warning(f"Could not fetch existing datasets: {e}")
    return set()


async def process_parquet(name: str, parquet_url: str) -> Dict[str, Any]:
    """
    Call the upload processor to process a parquet file.
    
    Returns processed data with URLs and metadata.
    """
    async with httpx.AsyncClient(timeout=600) as client:
        response = await client.post(
            f"{PROCESSOR_URL}/process",
            json={
                "name": name,
                "parquet_url": parquet_url,
            },
        )
        response.raise_for_status()
        return response.json()


async def create_catalog_entry(
    name: str,
    alias: str,
    description: str,
    dataset_type: str,
    source_parquet_url: str,
    source_tilejson_url: Optional[str],
    pmtiles_url: Optional[str],
    geoparquet_url: Optional[str],
    feature_count: Optional[int],
    bounds: Optional[str],
    add_to_geoserver: bool = True,
) -> Dict[str, Any]:
    """
    Create a dataset entry in the catalog via the webapp API.
    """
    payload = {
        "name": name,
        "alias": alias,
        "description": description,
        "type": dataset_type,
        "sourceParquetUrl": source_parquet_url,
        "status": "ready" if geoparquet_url else "pending",
        "addToGeoServer": add_to_geoserver,
    }
    
    if source_tilejson_url:
        payload["sourceTilejsonUrl"] = source_tilejson_url
    if pmtiles_url:
        payload["pmtilesUrl"] = pmtiles_url
    if geoparquet_url:
        payload["geoparquetUrl"] = geoparquet_url
    if feature_count:
        payload["featureCount"] = feature_count
    if bounds:
        payload["bounds"] = bounds
    
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{CATALOG_URL}/api/datasets",
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def import_dataset(
    dataset: Dict[str, str],
    add_to_geoserver: bool = True,
) -> Dict[str, Any]:
    """
    Import a single dataset: process it and create catalog entry.
    """
    name = dataset.get("name", "").strip()
    alias = dataset.get("alias", "").strip() or name
    description = clean_description(dataset.get("description", ""))
    dataset_type = dataset.get("type", "Point").strip()
    parquet_url = dataset.get("parquet_url", "").strip()
    tilejson_url = dataset.get("tilejson_url", "").strip() or None
    
    # Step 1: Process the parquet file
    logger.info(f"  → Processing parquet...")
    process_result = await process_parquet(name, parquet_url)
    
    if not process_result.get("success"):
        raise Exception(f"Processing failed: {process_result.get('error')}")
    
    # Step 2: Create catalog entry
    logger.info(f"  → Creating catalog entry...")
    catalog_result = await create_catalog_entry(
        name=name,
        alias=alias,
        description=description,
        dataset_type=dataset_type,
        source_parquet_url=parquet_url,
        source_tilejson_url=tilejson_url,
        pmtiles_url=process_result.get("pmtiles_url"),
        geoparquet_url=process_result.get("geoparquet_url"),
        feature_count=process_result.get("feature_count"),
        bounds=process_result.get("bounds"),
        add_to_geoserver=add_to_geoserver,
    )
    
    return {
        "name": name,
        "dataset_id": catalog_result.get("dataset", {}).get("id"),
        "pmtiles_url": process_result.get("pmtiles_url"),
        "geoparquet_url": process_result.get("geoparquet_url"),
        "feature_url": catalog_result.get("dataset", {}).get("featureUrl"),
        "feature_count": process_result.get("feature_count"),
    }


async def import_datasets(
    datasets: List[Dict[str, str]],
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

    # Get existing datasets to avoid duplicates
    existing_names = await get_existing_datasets()
    logger.info(f"Found {len(existing_names)} existing datasets in catalog")

    for i, dataset in enumerate(datasets):
        name = dataset.get("name", "").strip()
        alias = dataset.get("alias", "").strip()
        parquet_url = dataset.get("parquet_url", "").strip()

        if not name:
            logger.warning(f"Skipping dataset with empty name")
            results["skipped"] += 1
            continue

        if not parquet_url:
            logger.warning(f"Skipping {name}: no parquet URL")
            results["skipped"] += 1
            continue

        if name in existing_names:
            logger.debug(f"Skipping {name}: already exists")
            results["skipped"] += 1
            continue

        if dry_run:
            logger.info(f"[DRY RUN] Would process: {name} ({alias})")
            logger.info(f"  Source: {parquet_url}")
            results["success"] += 1
            continue

        try:
            logger.info(f"[{i+1}/{len(datasets)}] Importing: {name}")
            result = await import_dataset(dataset, add_to_geoserver=add_to_geoserver)
            
            logger.info(f"  ✓ Success! ID: {result.get('dataset_id')}, {result.get('feature_count')} features")
            if result.get("pmtiles_url"):
                logger.info(f"    PMTiles: {result.get('pmtiles_url')}")
            if result.get("geoparquet_url"):
                logger.info(f"    GeoParquet: {result.get('geoparquet_url')}")
            if result.get("feature_url"):
                logger.info(f"    Features: {result.get('feature_url')}")
            
            results["success"] += 1
                
        except Exception as e:
            error_msg = f"{name}: {e}"
            logger.error(f"  ✗ Failed: {e}")
            results["failed"] += 1
            results["errors"].append(error_msg)

    return results


async def main():
    parser = argparse.ArgumentParser(
        description="Import datasets from inventory.csv into the HIFLD Catalog"
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
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Check services are running
    if not args.dry_run:
        logger.info("Checking services...")
        
        if not await check_processor_health():
            logger.error(f"Upload processor not available at {PROCESSOR_URL}")
            logger.error("Start it with: cd upload-processor && uv run uvicorn main:app --port 8000")
            sys.exit(1)
        logger.info(f"  ✓ Processor: {PROCESSOR_URL}")
        
        if not await check_catalog_health():
            logger.error(f"Catalog API not available at {CATALOG_URL}")
            logger.error("Start it with: cd webapp && npm run dev")
            sys.exit(1)
        logger.info(f"  ✓ Catalog: {CATALOG_URL}")

    try:
        # Load inventory
        datasets = load_inventory(args.inventory)

        # Apply limit if specified
        if args.limit:
            datasets = datasets[: args.limit]
            logger.info(f"Limited to first {args.limit} datasets")

        # Import datasets
        results = await import_datasets(
            datasets,
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

    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)
    except Exception as e:
        logger.exception(f"Import failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
