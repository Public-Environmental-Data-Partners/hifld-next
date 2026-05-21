#!/usr/bin/env python3
"""
Seed script to initialize format definitions in the database.

This creates default format types (e.g., geoparquet, pmtiles, ogc_feature) that
can be used across all datasets.

Usage:
    python -m scripts.seed_formats [--config PATH]
    # or
    uv run python -m scripts.seed_formats --config gs://bucket/config/formats.json
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from typing import TypedDict, Optional, get_args
from database.db import get_db_session
from models.dataset import Format, FormatType
from scripts.config_loader import load_json_config
from sqlmodel import Session, select


class FormatConfig(TypedDict):
    """Type definition for format configuration."""

    format_type: FormatType
    name: str
    description: str
    mime_type: Optional[str]


ALLOWED_FORMAT_TYPES = set(get_args(FormatType))


def validate_format_config(format_data: FormatConfig) -> None:
    """Validate a format config before writing it to the database."""
    format_type = format_data.get("format_type")
    if format_type not in ALLOWED_FORMAT_TYPES:
        raise ValueError(
            f"format_type must be one of {sorted(ALLOWED_FORMAT_TYPES)}, got: {format_type}"
        )
    for field_name in ("name", "description"):
        if field_name not in format_data:
            raise ValueError(f"{field_name} is required for format {format_type}")


# Default format definitions (fallback if no config provided)
DEFAULT_FORMATS = [
    {
        "format_type": "geoparquet",
        "name": "GeoParquet",
        "description": "GeoParquet format for efficient spatial data storage and analysis",
        "mime_type": "application/parquet",
    },
    {
        "format_type": "pmtiles",
        "name": "PMTiles",
        "description": "PMTiles format for tile serving and web mapping",
        "mime_type": "application/x-protobuf",
    },
    {
        "format_type": "geopackage",
        "name": "GeoPackage",
        "description": "GeoPackage file format for portable spatial datasets",
        "mime_type": "application/geopackage+sqlite3",
    },
    {
        "format_type": "shapefile",
        "name": "Shapefile",
        "description": "ESRI Shapefile dataset packaged as a multi-file vector format",
        "mime_type": "application/zip",
    },
    {
        "format_type": "geojson",
        "name": "GeoJSON",
        "description": "GeoJSON feature collection format for web-friendly spatial data",
        "mime_type": "application/geo+json",
    },
    {
        "format_type": "file_geodatabase",
        "name": "File Geodatabase",
        "description": "Esri File Geodatabase dataset format",
        "mime_type": "application/octet-stream",
    },
]


def seed_formats(
    db: Session, formats: list[FormatConfig], dry_run: bool = False
) -> dict[str, int]:
    """Seed format definitions into the database."""
    results = {"created": 0, "updated": 0, "unchanged": 0}

    for format_data in formats:
        validate_format_config(format_data)

        # Check if format already exists
        statement = select(Format).where(
            Format.format_type == format_data["format_type"]
        )
        existing = db.exec(statement).first()

        if existing:
            needs_update = (
                existing.name != format_data["name"]
                or existing.description != format_data.get("description")
                or existing.mime_type != format_data.get("mime_type")
            )
            if needs_update:
                if not dry_run:
                    existing.name = format_data["name"]
                    existing.description = format_data.get("description")
                    existing.mime_type = format_data.get("mime_type")
                    db.add(existing)
                    db.commit()
                    db.refresh(existing)
                print(
                    f"  ✓ Would update format '{format_data['format_type']}' (ID: {existing.id})"
                    if dry_run
                    else f"  ✓ Updated format '{format_data['format_type']}' (ID: {existing.id})"
                )
                results["updated"] += 1
            else:
                print(
                    f"  ✓ Format '{format_data['format_type']}' already exists and is up to date (ID: {existing.id})"
                )
                results["unchanged"] += 1
            continue

        # Create new format
        format_obj = Format(**format_data)
        if not dry_run:
            db.add(format_obj)
            db.commit()
            db.refresh(format_obj)

        print(
            f"  ✓ Would create format '{format_data['format_type']}'"
            if dry_run
            else f"  ✓ Created format '{format_data['format_type']}' (ID: {format_obj.id})"
        )
        results["created"] += 1

    return results


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Seed format definitions")
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to JSON config file (local or gs:// URL). Defaults to formats.local.json in script directory.",
    )
    args = parser.parse_args()

    # Determine config path
    if args.config:
        config_path = args.config
    else:
        # Default to local config file
        default_config = Path(__file__).parent / "formats.local.json"
        if default_config.exists():
            config_path = str(default_config)
        else:
            print(
                "No config file provided and formats.local.json not found. Using defaults."
            )
            formats = DEFAULT_FORMATS
            config_path = None

    if config_path:
        print(f"Loading formats from: {config_path}")
        formats = load_json_config(config_path)
    else:
        formats = DEFAULT_FORMATS

    print("Seeding format definitions...")

    db = get_db_session()
    try:
        results = seed_formats(db, formats)

        print("\nSummary:")
        print(f"  Created: {results['created']}")
        print(f"  Updated: {results['updated']}")
        print(f"  Unchanged: {results['unchanged']}")
        print(f"  Total: {results['created'] + results['updated'] + results['unchanged']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
