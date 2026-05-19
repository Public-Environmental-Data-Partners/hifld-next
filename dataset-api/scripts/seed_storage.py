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

    slug: str
    name: str
    backend_type: BackendType
    description: str
    config: dict  # Will be BucketStorageLocationConfig or GeoServerStorageLocationConfig dict


# Default storage locations (fallback if no config provided)
DEFAULT_STORAGE_LOCATIONS = [
    {
        "slug": "gcs-drp-hifld-copy-formatted-49775666365",
        "name": "GCS drp-hifld-copy-formatted-49775666365",
        "backend_type": "s3",  # backend_type is still "s3" for bucket storage
        "description": "Google Cloud Storage bucket for formatted HIFLD datasets",
        "config": BucketStorageLocationConfig(
            type="gcs",  # Explicit GCS type
            base_url="https://storage.googleapis.com",
            bucket=os.getenv("GCS_BUCKET", "drp-hifld-copy-formatted-49775666365"),
        ).model_dump(),
    },
    {
        "slug": "seaweedfs-drp-hifld-copy-formatted",
        "name": "SeaweedFS drp-hifld-copy-formatted",
        "backend_type": "s3",  # backend_type is still "s3" for bucket storage
        "description": "SeaweedFS bucket for formatted HIFLD datasets (S3-compatible)",
        "config": BucketStorageLocationConfig(
            type="seaweedfs",  # Explicit SeaweedFS type
            base_url=os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
            bucket=os.getenv("SEAWEEDFS_BUCKET", "drp-hifld-copy-formatted"),
        ).model_dump(),
    },
    {
        "slug": "geoserver",
        "name": "GeoServer",
        "backend_type": "geoserver",
        "description": "GeoServer instance for spatial data services",
        "config": GeoServerStorageLocationConfig(
            base_url=os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver"),
            workspace=os.getenv("GEOSERVER_WORKSPACE", "hifld"),
        ).model_dump(),
    },
]


def detect_storage_type_from_config(config: dict) -> str:
    """Detect storage type from config base_url if type is 's3' or missing.
    
    Returns: 'gcs', 'seaweedfs', or 's3' (if unable to determine)
    """
    if not config:
        return "s3"
    
    # If type is already explicitly set and not 's3', use it
    config_type = config.get("type")
    if config_type and config_type != "s3":
        return config_type
    
    # Try to determine from base_url
    base_url = config.get("base_url", "")
    if "storage.googleapis.com" in base_url:
        return "gcs"
    elif "localhost" in base_url or "127.0.0.1" in base_url:
        return "seaweedfs"
    
    # Default to s3 if we can't determine
    return "s3"


def seed_storage_locations(
    db: Session, locations: list[StorageLocationConfig]
) -> dict[str, int]:
    """Seed storage locations into the database (upsert mode - updates existing)."""
    results = {"created": 0, "updated": 0, "unchanged": 0}

    for location_data in locations:
        # Check if location already exists
        statement = select(StorageLocation).where(
            StorageLocation.slug == location_data["slug"]
        )
        existing = db.exec(statement).first()

        if existing:
            # Upsert: update existing location if config has changed
            needs_update = False
            new_config = location_data.get("config", {})
            
            # Convert new config to dict if it's a Pydantic model
            if hasattr(new_config, "model_dump"):
                new_config_dict = new_config.model_dump()
            else:
                new_config_dict = new_config if new_config else {}
            
            # Check if we need to migrate type from "s3" to explicit type
            if isinstance(existing.config, dict):
                existing_config = existing.config.copy()  # Work with a copy
                existing_type = existing_config.get("type", "s3")
                
                # If existing has type="s3" or missing type, try to detect and update
                if existing_type == "s3" or not existing_type:
                    # First try to use the new config's type if provided
                    if new_config_dict.get("type") in ("gcs", "seaweedfs"):
                        existing_config["type"] = new_config_dict["type"]
                        needs_update = True
                        print(
                            f"  → Updating '{location_data['name']}' type from '{existing_type}' to '{new_config_dict['type']}'"
                        )
                    else:
                        # Try to detect from base_url
                        detected_type = detect_storage_type_from_config(existing_config)
                        if detected_type != "s3" and detected_type != existing_type:
                            existing_config["type"] = detected_type
                            needs_update = True
                            print(
                                f"  → Detected and updating '{location_data['name']}' type from '{existing_type}' to '{detected_type}' (from base_url)"
                            )
                
                # Update the existing config dict
                if needs_update:
                    existing.config = existing_config
            
            # Update other fields if they differ
            if existing.backend_type != location_data.get("backend_type"):
                existing.backend_type = location_data["backend_type"]
                needs_update = True

            if existing.name != location_data.get("name"):
                existing.name = location_data["name"]
                needs_update = True
            
            if existing.description != location_data.get("description"):
                existing.description = location_data.get("description")
                needs_update = True
            
            # Update config if it's different (only if we haven't already updated it above)
            if new_config_dict and not needs_update:
                # Compare configs (convert existing to dict for comparison)
                existing_config_dict = existing.config
                if isinstance(existing_config_dict, dict):
                    # Check if configs are different (excluding type if we just updated it)
                    # Create comparison dicts
                    existing_compare = {k: v for k, v in existing_config_dict.items() if k != "type"}
                    new_compare = {k: v for k, v in new_config_dict.items() if k != "type"}
                    
                    if existing_compare != new_compare:
                        # Merge: keep detected type if we set it, otherwise use new config
                        if "type" in existing_config_dict and existing_config_dict["type"] in ("gcs", "seaweedfs"):
                            new_config_dict["type"] = existing_config_dict["type"]
                        existing.config = new_config_dict
                        needs_update = True
                else:
                    # Existing config is not a dict, update it
                    existing.config = new_config_dict
                    needs_update = True
            
            if needs_update:
                db.add(existing)
                db.commit()
                db.refresh(existing)
                print(
                    f"  ✓ Updated storage location '{location_data['name']}' (ID: {existing.id})"
                )
                results["updated"] += 1
            else:
                print(
                    f"  ✓ Storage location '{location_data['name']}' already exists and is up to date (ID: {existing.id})"
                )
                results["unchanged"] += 1
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
        print(f"  Updated: {results['updated']}")
        print(f"  Unchanged: {results['unchanged']}")
        print(f"  Total: {results['created'] + results['updated'] + results['unchanged']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
