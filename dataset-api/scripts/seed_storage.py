#!/usr/bin/env python3
"""
Seed script to initialize storage locations in the database.

This creates default storage locations (e.g., SeaweedFS, GCS) that can be used
for storing dataset files.

Usage:
    python -m scripts.seed_storage [--config PATH]
    # or
    uv run python -m scripts.seed_storage --config gs://bucket/config/storage.json
"""

import argparse
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from typing import TypedDict
from database.db import get_db_session
from models.dataset import (
    StorageLocation,
    BucketStorageLocationConfig,
    GeoServerStorageLocationConfig,
    BackendType,
)
from scripts.config_loader import load_json_config
from sqlmodel import Session, select


class StorageLocationConfig(TypedDict):
    """Type definition for storage location configuration."""

    name: str
    backend_type: BackendType
    description: str
    config: dict  # Will be BucketStorageLocationConfig or GeoServerStorageLocationConfig dict


# Default storage locations (fallback if no config provided)
DEFAULT_STORAGE_LOCATIONS = [
    {
        "name": "SeaweedFS Local",
        "backend_type": "s3",
        "description": "Local SeaweedFS instance for development (S3-compatible)",
        "config": BucketStorageLocationConfig(
            base_url=os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
            bucket=os.getenv("S3_BUCKET", "hifld"),
        ).model_dump(),
    },
    {
        "name": "GeoServer Local",
        "backend_type": "geoserver",
        "description": "Local GeoServer instance for spatial data services",
        "config": GeoServerStorageLocationConfig(
            base_url=os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver"),
            workspace=os.getenv("GEOSERVER_WORKSPACE", "hifld"),
        ).model_dump(),
    },
]


def seed_storage_locations(
    db: Session, locations: list[StorageLocationConfig]
) -> dict[str, int]:
    """Seed storage locations into the database."""
    results = {"created": 0, "existing": 0}

    for location_data in locations:
        # Check if location already exists
        statement = select(StorageLocation).where(
            StorageLocation.name == location_data["name"]
        )
        existing = db.exec(statement).first()

        if existing:
            print(
                f"  ✓ Storage location '{location_data['name']}' already exists (ID: {existing.id})"
            )
            results["existing"] += 1
            continue

        # Create new storage location
        storage_location = StorageLocation(**location_data)
        db.add(storage_location)
        db.commit()
        db.refresh(storage_location)

        print(
            f"  ✓ Created storage location '{location_data['name']}' (ID: {storage_location.id})"
        )
        results["created"] += 1

    return results


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Seed storage locations")
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to JSON config file (local or gs:// URL). Defaults to storage.local.json in script directory.",
    )
    args = parser.parse_args()

    # Determine config path
    if args.config:
        config_path = args.config
    else:
        # Default to local config file
        default_config = Path(__file__).parent / "storage.local.json"
        if default_config.exists():
            config_path = str(default_config)
        else:
            print(
                "No config file provided and storage.local.json not found. Using defaults."
            )
            locations = DEFAULT_STORAGE_LOCATIONS
            config_path = None

    if config_path:
        print(f"Loading storage locations from: {config_path}")
        locations = load_json_config(config_path)
    else:
        locations = DEFAULT_STORAGE_LOCATIONS

    print("Seeding storage locations...")

    db = get_db_session()
    try:
        results = seed_storage_locations(db, locations)

        print("\nSummary:")
        print(f"  Created: {results['created']}")
        print(f"  Existing: {results['existing']}")
        print(f"  Total: {results['created'] + results['existing']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
