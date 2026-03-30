#!/usr/bin/env python3
"""
Generate inventory CSV that maps HIFLD Open Inventory entries to GCS zip file locations.

This script:
1. Reads HIFLD_Open_Inventory_12112025.csv
2. For each entry, finds the best matching zip file in GCS bucket
3. Creates a joined inventory CSV with GCS paths

Priority for format selection:
1. GeoPackage (.gpkg)
2. GeoJSON (.geojson)
3. Shapefile (.shp)
4. File Geodatabase (.gdb)
"""
import csv
import sys
from pathlib import Path
from typing import Optional, Dict, List
import subprocess

# Format priority order
FORMAT_PRIORITY = [
    ("geopackage", ".gpkg"),
    ("geojson", ".geojson"),
    ("shapefile", ".shp"),
    ("file_geodatabase", ".gdb"),
]

# Format name mappings (CSV column -> GCS filename suffix)
FORMAT_MAPPINGS = {
    "geopackage": "geopackage",
    "geojson": "geojson",
    "shapefile": "shapefile",
    "file_geodatabase": "file_geodatabase",  # Uses underscore in GCS
}


def normalize_filename(filename: str) -> str:
    """Normalize filename for matching."""
    # Remove leading/trailing whitespace and dots
    return filename.strip().lstrip(".").rstrip("/")


def find_gcs_zip_file(
    bucket: str, filename: str, available_formats: Dict[str, bool]
) -> Optional[str]:
    """
    Find the best matching zip file in GCS for a given filename.

    Args:
        bucket: GCS bucket name
        filename: Dataset filename from CSV
        available_formats: Dict indicating which formats are available
                          (keys: 'geojson', 'geopackage', 'shapefile', 'file_geodatabase')

    Returns:
        GCS path to the best matching zip file, or None if not found
    """
    normalized_name = normalize_filename(filename)

    # Try formats in priority order
    for format_name, format_ext in FORMAT_PRIORITY:
        # Check if this format is available (CSV has a value in that column)
        if format_name not in available_formats:
            continue

        # Skip if format is not available (empty or 0)
        # CSV contains file sizes in KB, so any non-empty value means format exists
        format_value = available_formats.get(format_name, "")
        format_str = str(format_value).strip()
        if not format_str or format_str == "" or format_str == "0":
            continue

        # Construct potential GCS path
        # Pattern: gs://bucket/filename/filename/filename-format.zip
        format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
        potential_paths = [
            f"gs://{bucket}/{normalized_name}/{normalized_name}/{normalized_name}-{format_suffix}.zip",
            f"gs://{bucket}/{normalized_name}/{normalized_name}/{normalized_name}-{format_name}.zip",
        ]

        # Check if file exists (direct path)
        for gcs_path in potential_paths:
            try:
                result = subprocess.run(
                    ["gsutil", "ls", gcs_path],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode == 0 and gcs_path in result.stdout:
                    return gcs_path
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue

    # If direct path didn't work, try recursive search
    # Some files are nested under parent folders (e.g., nfhl/nfhl/filename/)
    return find_gcs_zip_file_recursive(bucket, normalized_name, available_formats)


def find_gcs_zip_file_recursive(
    bucket: str, filename: str, available_formats: Dict[str, bool]
) -> Optional[str]:
    """
    Recursively search for zip files when direct path doesn't work.

    Some datasets are nested under parent folders (e.g., nfhl/nfhl/filename/).
    Uses targeted searches of known parent folders and flexible pattern matching.
    """
    # Known parent folders that contain nested datasets
    known_parent_folders = [
        "nfhl",  # National Flood Hazard Layer
        "national-flood-hazard-layer--nfhl",
        "nhd",  # National Hydrography Dataset
    ]

    # Special handling for datasets with non-standard naming patterns
    special_patterns = get_special_naming_patterns(filename, available_formats)
    if special_patterns:
        for pattern in special_patterns:
            try:
                result = subprocess.run(
                    ["gsutil", "ls", pattern],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if result.returncode == 0:
                    lines = [
                        line.strip()
                        for line in result.stdout.split("\n")
                        if line.strip()
                    ]
                    # Return the first match
                    for line in lines:
                        if line.endswith(".zip") and is_valid_format_match(
                            line, filename, available_formats
                        ):
                            return line
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue

    # Try formats in priority order
    for format_name, format_ext in FORMAT_PRIORITY:
        # Check if this format is available
        if format_name not in available_formats:
            continue

        format_value = available_formats.get(format_name, "")
        format_str = str(format_value).strip()
        if not format_str or format_str == "" or format_str == "0":
            continue

        format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)

        # Try searching under known parent folders
        for parent in known_parent_folders:
            # Try patterns: parent/parent/filename/filename-format.zip
            # or parent/**/filename-format.zip
            potential_paths = [
                f"gs://{bucket}/{parent}/{parent}/{filename}/{filename}-{format_suffix}.zip",
                f"gs://{bucket}/{parent}/{filename}/{filename}-{format_suffix}.zip",
            ]

            for gcs_path in potential_paths:
                try:
                    result = subprocess.run(
                        ["gsutil", "ls", gcs_path],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    if result.returncode == 0 and gcs_path in result.stdout:
                        return gcs_path
                except (subprocess.TimeoutExpired, FileNotFoundError):
                    continue

        # If known parents don't work, try a targeted recursive search
        # Use wildcard pattern to find the file anywhere in the bucket
        try:
            # Pattern: **/filename/filename-format.zip or **/filename-format.zip
            # Also try variations with format in different positions
            search_patterns = [
                f"gs://{bucket}/**/{filename}/{filename}-{format_suffix}.zip",
                f"gs://{bucket}/**/{filename}-{format_suffix}.zip",
                f"gs://{bucket}/**/{filename}-{format_suffix}.gpkg.zip",  # Handle .gpkg.zip
                f"gs://{bucket}/**/*{filename}*{format_suffix}*.zip",  # Flexible matching
            ]

            for pattern in search_patterns:
                result = subprocess.run(
                    ["gsutil", "ls", pattern],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )

                if result.returncode == 0:
                    lines = [
                        line.strip()
                        for line in result.stdout.split("\n")
                        if line.strip()
                    ]
                    # Try to find the best match
                    for line in lines:
                        if line.endswith(".zip") and is_valid_format_match(
                            line, filename, available_formats
                        ):
                            return line
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    return None


def get_special_naming_patterns(
    filename: str, available_formats: Dict[str, bool]
) -> List[str]:
    """
    Get special search patterns for datasets with non-standard naming conventions.
    """
    bucket = "drp-hifld-copy-49775666365"
    patterns = []

    # Handle datasets with tl_2024_* prefix (Census/TIGER data)
    # Note: local-roads-2 and 2020-census-blocks-1 are excluded because they have
    # multiple state-specific files and would require special handling
    if filename in [
        "metropolitan-statistical-areas",
        "micropolitan-statistical-areas-3",
    ]:
        for format_name, format_ext in FORMAT_PRIORITY:
            if format_name not in available_formats:
                continue
            format_value = available_formats.get(format_name, "")
            if not str(format_value).strip() or str(format_value).strip() == "0":
                continue
            format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
            # These datasets use tl_2024_* prefix in filenames
            patterns.append(
                f"gs://{bucket}/{filename}/{filename}/**/*{format_suffix}.zip"
            )

    # Handle NFHL area datasets with format in middle of name
    if filename in [
        "national-flood-hazard-layer-area-nfhl-1-east",
        "national-flood-hazard-layer-area-nfhl-1-west",
    ]:
        for format_name, format_ext in FORMAT_PRIORITY:
            if format_name not in available_formats:
                continue
            format_value = available_formats.get(format_name, "")
            if not str(format_value).strip() or str(format_value).strip() == "0":
                continue
            format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
            # Pattern: national-flood-hazard-layer-nfhl-{format}-area-1-{east/west}.zip
            area = "east" if "east" in filename else "west"
            patterns.append(
                f"gs://{bucket}/nfhl/nfhl/{filename}/**/*{format_suffix}*area-1-{area}*.zip"
            )

    # Handle hydrolocation-reach-code-external-connection (missing "external-connection" in filename)
    if filename == "hydrolocation-reach-code-external-connection":
        for format_name, format_ext in FORMAT_PRIORITY:
            if format_name not in available_formats:
                continue
            format_value = available_formats.get(format_name, "")
            if not str(format_value).strip() or str(format_value).strip() == "0":
                continue
            format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
            # Files are named hydrolocation-reach-code-{format}.zip
            patterns.append(
                f"gs://{bucket}/nhd/nhd/{filename}/**/hydrolocation-reach-code-{format_suffix}.zip"
            )

    # Handle flowline and waterbody (have variations like flowline-large-scale-2)
    if filename in ["flowline", "waterbody"]:
        for format_name, format_ext in FORMAT_PRIORITY:
            if format_name not in available_formats:
                continue
            format_value = available_formats.get(format_name, "")
            if not str(format_value).strip() or str(format_value).strip() == "0":
                continue
            format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
            # Search for any file containing the base name and format
            patterns.append(
                f"gs://{bucket}/nhd/nhd/**/*{filename}*{format_suffix}*.zip"
            )

    # Handle water-lines-1 (has .gpkg.zip extension)
    if filename == "water-lines-1":
        for format_name, format_ext in FORMAT_PRIORITY:
            if format_name not in available_formats:
                continue
            format_value = available_formats.get(format_name, "")
            if not str(format_value).strip() or str(format_value).strip() == "0":
                continue
            format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
            # Try both .zip and .gpkg.zip
            patterns.append(
                f"gs://{bucket}/nfhl/nfhl/{filename}/**/*{format_suffix}*.zip"
            )

    return patterns


def is_valid_format_match(
    file_path: str, filename: str, available_formats: Dict[str, bool]
) -> bool:
    """
    Check if a file path is a valid match for the given filename and available formats.
    """
    file_lower = file_path.lower()
    filename_lower = filename.lower()

    # Check if filename appears in the path (or a reasonable variation)
    # Allow partial matches for variations like "flowline-large-scale-2"
    filename_parts = filename_lower.split("-")
    if len(filename_parts) > 0:
        # Check if at least the first significant part matches
        base_name = filename_parts[0]
        if base_name not in file_lower and filename_lower not in file_lower:
            return False

    # Check if any available format appears in the filename
    for format_name, format_ext in FORMAT_PRIORITY:
        if format_name not in available_formats:
            continue
        format_value = available_formats.get(format_name, "")
        if not str(format_value).strip() or str(format_value).strip() == "0":
            continue

        format_suffix = FORMAT_MAPPINGS.get(format_name, format_name)
        if format_suffix in file_lower:
            return True

    return False


def list_gcs_files_for_verification(
    bucket: str, filename: str, limit: int = 10
) -> List[str]:
    """List all files in GCS for a given filename (for debugging)."""
    normalized_name = normalize_filename(filename)
    prefix = f"gs://{bucket}/{normalized_name}/"

    try:
        result = subprocess.run(
            ["gsutil", "ls", "-r", prefix], capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            files = [line.strip() for line in result.stdout.split("\n") if line.strip()]
            return files[:limit]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return []


def generate_inventory(
    input_csv: Path,
    output_csv: Path,
    gcs_bucket: str,
    verify_first_n: int = 10,
    skip_verify: bool = False,
) -> None:
    """
    Generate joined inventory CSV.

    Args:
        input_csv: Path to HIFLD_Open_Inventory_12112025.csv
        output_csv: Path to output joined inventory CSV
        gcs_bucket: GCS bucket name (without gs:// prefix)
        verify_first_n: Number of entries to verify and print details for
    """
    print(f"Reading inventory from: {input_csv}")
    print(f"GCS Bucket: {gcs_bucket}")

    with open(input_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Found {len(rows)} entries in inventory\n")

    # Verify first N entries (if requested)
    verified_count = 0
    if verify_first_n > 0 and not skip_verify:
        print(f"Verifying first {verify_first_n} entries...\n")
        for i, row in enumerate(rows[:verify_first_n], 1):
            filename = row.get("filename", "").strip()
            title = row.get("title", "").strip()

            print(f"{i}. {filename}")
            print(f"   Title: {title[:60]}...")

            # Get available formats
            available_formats = {
                "geojson": row.get("geojson", ""),
                "geopackage": row.get("geopackage", ""),
                "shapefile": row.get("shapefile", ""),
                "file_geodatabase": row.get("file_geodatabase", ""),
            }

            # Find matching GCS file
            gcs_path = find_gcs_zip_file(gcs_bucket, filename, available_formats)

            if gcs_path:
                print(f"   ✓ Found: {gcs_path}")
                verified_count += 1
            else:
                print("   ✗ Not found")
                # List available files for debugging
                available_files = list_gcs_files_for_verification(
                    gcs_bucket, filename, limit=5
                )
                if available_files:
                    print("   Available files:")
                    for file in available_files:
                        print(f"     - {file}")

            print()

        print(f"Verified {verified_count}/{verify_first_n} entries\n")

        if verified_count < verify_first_n:
            print(f"Warning: Only {verified_count}/{verify_first_n} entries matched.")

        # Ask if user wants to generate full inventory
        if not skip_verify:
            response = input("Generate full inventory? (y/n): ").strip().lower()
            if response != "y":
                print("Stopped. Use --skip-verify to generate without verification.")
                return

    # Generate full inventory
    print("Generating full inventory...\n")

    output_rows = []
    matched_count = 0
    not_found_count = 0

    total_rows = len(rows)
    log_interval = max(1, total_rows // 50)  # Log every ~2% or at least every row

    for i, row in enumerate(rows, 1):
        filename = row.get("filename", "").strip()

        # Get available formats
        available_formats = {
            "geojson": row.get("geojson", ""),
            "geopackage": row.get("geopackage", ""),
            "shapefile": row.get("shapefile", ""),
            "file_geodatabase": row.get("file_geodatabase", ""),
        }

        # Find matching GCS file
        gcs_path = find_gcs_zip_file(gcs_bucket, filename, available_formats)

        # Create output row (keep all original columns, add GCS path)
        output_row = dict(row)
        output_row["gcs_zip_path"] = gcs_path if gcs_path else ""
        output_row["gcs_match_found"] = "Yes" if gcs_path else "No"

        output_rows.append(output_row)

        if gcs_path:
            matched_count += 1
            status = "✓"
        else:
            not_found_count += 1
            status = "✗"

        # Log progress
        if i % log_interval == 0 or i == total_rows:
            percent = (i / total_rows) * 100
            print(
                f"Progress: {i}/{total_rows} ({percent:.1f}%) - Matched: {matched_count}, Not found: {not_found_count} - {status} {filename[:50]}"
            )

    # Write output CSV
    if output_rows:
        fieldnames = list(output_rows[0].keys())

        with open(output_csv, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(output_rows)

        print(f"\n✓ Generated inventory: {output_csv}")
        print(f"  Total entries: {len(output_rows)}")
        print(f"  Matched: {matched_count}")
        print(f"  Not found: {not_found_count}")
    else:
        print("✗ No rows to write")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate inventory CSV with GCS zip file paths"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("HIFLD_Open_Inventory_12112025.csv"),
        help="Input CSV file (default: HIFLD_Open_Inventory_12112025.csv)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("inventory_gcs.csv"),
        help="Output CSV file (default: inventory_gcs.csv)",
    )
    parser.add_argument(
        "--bucket",
        type=str,
        default="drp-hifld-copy-49775666365",
        help="GCS bucket name (default: drp-hifld-copy-49775666365)",
    )
    parser.add_argument(
        "--verify",
        type=int,
        default=10,
        help="Number of entries to verify (default: 10)",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="Skip verification and generate inventory directly",
    )

    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    generate_inventory(
        args.input, args.output, args.bucket, args.verify, skip_verify=args.skip_verify
    )


if __name__ == "__main__":
    main()
