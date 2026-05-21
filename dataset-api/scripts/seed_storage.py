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
    config: dict


def validate_storage_location_config(location_data: StorageLocationConfig) -> None:
    """Validate a storage location config before writing it to the database."""
    for field_name in ("slug", "name", "backend_type", "config"):
        if field_name not in location_data:
            raise ValueError(f"{field_name} is required for storage location config")


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


def config_to_dict(config: object) -> dict:
    """Convert a config value to a plain dict."""
    if hasattr(config, "model_dump"):
        return config.model_dump(exclude_none=True)
    if isinstance(config, dict):
        return {key: value for key, value in config.items() if value is not None}
    return {}


def seed_storage_locations(
    db: Session, locations: list[StorageLocationConfig], dry_run: bool = False
) -> dict[str, int]:
    """Seed storage locations into the database (upsert mode - updates existing)."""
    results = {"created": 0, "updated": 0, "unchanged": 0}

    for location_data in locations:
        validate_storage_location_config(location_data)

        # Check if location already exists
        statement = select(StorageLocation).where(
            StorageLocation.slug == location_data["slug"]
        )
        existing = db.exec(statement).first()

        if existing:
            # Upsert: update existing location if config has changed
            needs_update = False
            new_config_dict = config_to_dict(location_data.get("config", {}))
            existing_config = config_to_dict(existing.config)
            target_config = new_config_dict.copy() if new_config_dict else existing_config.copy()

            # Check if we need to migrate type from "s3" to explicit type
            if existing_config:
                existing_type = existing_config.get("type", "s3")
                
                # If existing has type="s3" or missing type, try to detect and update
                if existing_type == "s3" or not existing_type:
                    # First try to use the new config's type if provided
                    if new_config_dict.get("type") in ("gcs", "seaweedfs"):
                        existing_config["type"] = new_config_dict["type"]
                        target_config["type"] = new_config_dict["type"]
                        needs_update = True
                        print(
                            f"  → Updating '{location_data['name']}' type from '{existing_type}' to '{new_config_dict['type']}'"
                        )
                    else:
                        # Try to detect from base_url
                        detected_type = detect_storage_type_from_config(existing_config)
                        if detected_type != "s3" and detected_type != existing_type:
                            existing_config["type"] = detected_type
                            target_config["type"] = detected_type
                            needs_update = True
                            print(
                                f"  → Detected and updating '{location_data['name']}' type from '{existing_type}' to '{detected_type}' (from base_url)"
                            )
                
            # Update other fields if they differ
            if existing.backend_type != location_data.get("backend_type"):
                needs_update = True

            if existing.name != location_data.get("name"):
                needs_update = True
            
            if existing.description != location_data.get("description"):
                needs_update = True
            
            if target_config and existing_config != target_config:
                needs_update = True
            
            if needs_update:
                if not dry_run:
                    existing.backend_type = location_data["backend_type"]
                    existing.name = location_data["name"]
                    existing.description = location_data.get("description")
                    if target_config:
                        existing.config = target_config
                    db.add(existing)
                    db.commit()
                    db.refresh(existing)
                print(
                    f"  ✓ Would update storage location '{location_data['name']}' (ID: {existing.id})"
                    if dry_run
                    else f"  ✓ Updated storage location '{location_data['name']}' (ID: {existing.id})"
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
        if not dry_run:
            db.add(storage_location)
            db.commit()
            db.refresh(storage_location)

        print(
            f"  ✓ Would create storage location '{location_data['name']}'"
            if dry_run
            else f"  ✓ Created storage location '{location_data['name']}' (ID: {storage_location.id})"
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
