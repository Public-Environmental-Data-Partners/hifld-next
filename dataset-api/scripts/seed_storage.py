#!/usr/bin/env python3
"""
Seed script to initialize storage locations in the database.

This creates default storage locations (e.g., SeaweedFS, GCS) that can be used
for storing dataset files.

Usage:
    python -m scripts.seed_storage
    # or
    uv run python -m scripts.seed_storage
"""

import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.db import get_db_session
from models.dataset import StorageLocation, BucketStorageLocationConfig
from sqlmodel import Session, select

# Default storage locations
DEFAULT_STORAGE_LOCATIONS = [
    {
        "name": "SeaweedFS Local",
        "backend_type": "seaweedfs",
        "description": "Local SeaweedFS instance for development",
        "config": BucketStorageLocationConfig(
            base_url=os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
            bucket=os.getenv("S3_BUCKET", "hifld"),
        ).model_dump(),
    },
    {
        "name": "GeoServer Local",
        "backend_type": "geoserver",
        "description": "Local GeoServer instance for spatial data services",
        "config": {
            "base_url": os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver"),
            "workspace": os.getenv("GEOSERVER_WORKSPACE", "hifld"),
        },
    },
    # {
    #     "name": "GCS Production",
    #     "backend_type": "gcs",
    #     "description": "Google Cloud Storage production bucket",
    #     "config": BucketStorageLocationConfig(
    #         base_url=os.getenv("GCS_BASE_URL", "https://storage.googleapis.com"),
    #         bucket=os.getenv("GCS_BUCKET", "hifld-production"),
    #     ).model_dump(),
    # },
]


def seed_storage_locations(db: Session) -> dict[str, int]:
    """Seed storage locations into the database."""
    results = {"created": 0, "existing": 0}

    for location_data in DEFAULT_STORAGE_LOCATIONS:
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
    print("Seeding storage locations...")

    db = get_db_session()
    try:
        results = seed_storage_locations(db)

        print("\nSummary:")
        print(f"  Created: {results['created']}")
        print(f"  Existing: {results['existing']}")
        print(f"  Total: {results['created'] + results['existing']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
