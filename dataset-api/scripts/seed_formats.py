#!/usr/bin/env python3
"""
Seed script to initialize format definitions in the database.

This creates default format types (e.g., geoparquet, pmtiles, ogc_feature) that
can be used across all datasets.

Usage:
    python -m scripts.seed_formats
    # or
    uv run python -m scripts.seed_formats
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.db import get_db_session
from models.dataset import Format
from sqlmodel import Session, select

# Default format definitions
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
        "format_type": "geoserver",
        "name": "GeoServer",
        "description": "GeoServer service providing multiple OGC-compliant interfaces (WFS, WMS, OGC API Features, GeoPackage export)",
        "mime_type": None,  # Multiple formats available depending on request
    },
]


def seed_formats(db: Session) -> dict[str, int]:
    """Seed format definitions into the database."""
    results = {"created": 0, "existing": 0}

    for format_data in DEFAULT_FORMATS:
        # Check if format already exists
        statement = select(Format).where(
            Format.format_type == format_data["format_type"]
        )
        existing = db.exec(statement).first()

        if existing:
            print(
                f"  ✓ Format '{format_data['format_type']}' already exists (ID: {existing.id})"
            )
            results["existing"] += 1
            continue

        # Create new format
        format_obj = Format(**format_data)
        db.add(format_obj)
        db.commit()
        db.refresh(format_obj)

        print(
            f"  ✓ Created format '{format_data['format_type']}' (ID: {format_obj.id})"
        )
        results["created"] += 1

    return results


def main():
    """Main entry point."""
    print("Seeding format definitions...")

    db = get_db_session()
    try:
        results = seed_formats(db)

        print("\nSummary:")
        print(f"  Created: {results['created']}")
        print(f"  Existing: {results['existing']}")
        print(f"  Total: {results['created'] + results['existing']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
