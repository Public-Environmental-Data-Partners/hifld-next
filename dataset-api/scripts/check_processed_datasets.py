#!/usr/bin/env python3
"""
Check which datasets have already been processed in the destination bucket
and determine the offset needed to resume processing.

Usage:
    python check_processed_datasets.py --source gs://bucket --dest gs://dest-bucket
    python check_processed_datasets.py --source gs://bucket --dest seaweedfs://bucket --inventory auto
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.storage_client import create_storage_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("check-processed")


def parse_storage_url(url: str):
    """Parse a storage URL (gs://bucket/path or seaweedfs://bucket/path)."""
    if url.startswith("gs://"):
        parts = url[5:].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("gcs", bucket, path)
    elif url.startswith("seaweedfs://") or url.startswith("s3://"):
        parts = url.split("://", 1)[1].split("/", 1)
        bucket = parts[0]
        path = parts[1] if len(parts) > 1 else ""
        return ("seaweedfs", bucket, path)
    else:
        return ("gcs", url, "")


async def list_zip_files_in_folder(storage, folder_path: str):
    """List all zip files in a folder."""
    zip_files = []

    if hasattr(storage, "bucket_name"):
        # GCS
        from google.cloud import storage as gcs_storage

        client = gcs_storage.Client()
        bucket = client.bucket(storage.bucket_name)

        if not folder_path or folder_path == "/":
            prefix = ""
        else:
            prefix = folder_path.rstrip("/") + "/"
        blobs = bucket.list_blobs(prefix=prefix)

        for blob in blobs:
            if blob.name.endswith(".zip") and not blob.name.endswith("/"):
                zip_files.append(blob.name)
    else:
        # SeaweedFS - not implemented for listing
        logger.warning("Listing files in SeaweedFS folders not yet implemented")

    return zip_files


async def discover_nested_datasets(source_storage, source_path: str):
    """Discover nested datasets by listing zip files."""
    datasets_by_name = {}

    zip_files = await list_zip_files_in_folder(source_storage, source_path)

    for zip_path in zip_files:
        path_parts = zip_path.split("/")
        zip_filename = path_parts[-1].replace(".zip", "")

        # Remove format suffixes
        format_suffixes = [
            "-file_geodatabase",
            "-file-geodatabase",
            "-geopackage",
            "-shapefile",
            "-geojson",
        ]
        base_filename = zip_filename
        for suffix in format_suffixes:
            if base_filename.endswith(suffix):
                base_filename = base_filename[: -len(suffix)]
                break

        if base_filename not in datasets_by_name:
            datasets_by_name[base_filename] = {
                "filename": base_filename,
                "zip_path": zip_path,
            }

    return list(datasets_by_name.values())


async def check_dataset_processed(dest_storage, dataset_folder: str, base_filename: str):
    """
    Check if a dataset has been processed by looking for output files.
    Returns True if at least one parquet or pmtiles file exists.
    This matches the logic in check_dataset_exists() from process_gcs_datasets.py
    """
    dest_folder = f"{dataset_folder}/" if dataset_folder else ""

    # Check for parquet files (could be single or chunked)
    # Try single file first (no chunk number)
    parquet_path = f"{dest_folder}{base_filename}.zstd.parquet"
    if await dest_storage.file_exists(parquet_path):
        return True

    # Try first chunk file (chunked files use -0, -1, etc.)
    parquet_path_chunked = f"{dest_folder}{base_filename}-0.zstd.parquet"
    if await dest_storage.file_exists(parquet_path_chunked):
        return True

    # Check for pmtiles
    pmtiles_path = f"{dest_folder}{base_filename}.pmtiles"
    if await dest_storage.file_exists(pmtiles_path):
        return True

    # Also check for layer-specific files (for multi-layer datasets)
    # Check a few common layer name patterns
    # Note: This is a simplified check - we can't know all layer names without
    # processing the source file, but this should catch most cases
    common_layer_patterns = [
        f"{dest_folder}{base_filename}-",  # Any layer suffix
    ]
    
    # For datasets with known layer patterns, we could add more specific checks
    # But for now, if we find any file starting with base_filename, consider it processed
    # This is conservative - we'll mark it as processed if ANY output exists
    
    # Actually, let's be more conservative: only mark as processed if we find
    # the base filename files. Layer-specific files are harder to detect without
    # knowing the layer names, so we'll rely on the base filename check above.
    
    return False


async def main():
    parser = argparse.ArgumentParser(
        description="Check which datasets have been processed and determine resume offset"
    )
    parser.add_argument(
        "--source",
        type=str,
        default="gs://drp-hifld-copy-49775666365",
        help="Source storage URL",
    )
    parser.add_argument(
        "--dest",
        type=str,
        default="gs://drp-hifld-copy-formatted-49775666365",
        help="Destination storage URL",
    )
    parser.add_argument(
        "--inventory",
        type=str,
        default="auto",
        help="Inventory CSV path or 'auto' to discover datasets",
    )

    args = parser.parse_args()

    # Parse storage URLs
    source_type, source_bucket, source_path = parse_storage_url(args.source)
    dest_type, dest_bucket, dest_path = parse_storage_url(args.dest)

    # Create storage clients
    source_storage = create_storage_client(
        storage_type=source_type,
        bucket=source_bucket,
    )
    dest_storage = create_storage_client(
        storage_type=dest_type,
        bucket=dest_bucket,
    )

    # Discover datasets
    if args.inventory == "auto":
        logger.info(f"Discovering datasets in {args.source}")
        datasets = await discover_nested_datasets(source_storage, source_path)
    else:
        # Load from CSV
        import csv

        datasets = []
        with open(args.inventory, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                filename = row.get("filename", "").strip()
                if filename:
                    # Extract folder structure from gcs_zip_path if available
                    gcs_path = row.get("gcs_zip_path", "").strip()
                    if gcs_path:
                        _, _, path = parse_storage_url(gcs_path)
                        path_parts = path.split("/")
                        if len(path_parts) > 1:
                            dataset_folder = "/".join(path_parts[:-1])
                        else:
                            dataset_folder = ""
                    else:
                        dataset_folder = ""

                    datasets.append(
                        {
                            "filename": filename,
                            "dataset_folder": dataset_folder,
                        }
                    )

    logger.info(f"Found {len(datasets)} datasets to check")

    # Check each dataset
    processed_count = 0
    processed_datasets = []
    unprocessed_datasets = []

    for i, dataset in enumerate(datasets):
        filename = dataset.get("filename", "").strip()
        dataset_folder = dataset.get("dataset_folder", "").strip()

        # Extract base filename (remove any format suffixes that might be in the folder structure)
        base_filename = filename

        is_processed = await check_dataset_processed(
            dest_storage, dataset_folder, base_filename
        )

        if is_processed:
            processed_count += 1
            processed_datasets.append((i, filename, dataset_folder))
            logger.info(f"  [{i+1}/{len(datasets)}] ✓ {filename} - PROCESSED")
        else:
            unprocessed_datasets.append((i, filename, dataset_folder))
            logger.info(f"  [{i+1}/{len(datasets)}] ⊘ {filename} - NOT PROCESSED")

    # Print summary
    print("\n" + "=" * 80)
    print("PROCESSING STATUS SUMMARY")
    print("=" * 80)
    print(f"Total datasets: {len(datasets)}")
    print(f"Processed: {processed_count}")
    print(f"Unprocessed: {len(datasets) - processed_count}")

    if processed_count > 0:
        print(f"\n✓ Processed datasets (first 10):")
        for idx, name, folder in processed_datasets[:10]:
            folder_str = f" ({folder})" if folder else ""
            print(f"  [{idx}] {name}{folder_str}")
        if len(processed_datasets) > 10:
            print(f"  ... and {len(processed_datasets) - 10} more")

    if unprocessed_datasets:
        print(f"\n⊘ Unprocessed datasets (first 10):")
        for idx, name, folder in unprocessed_datasets[:10]:
            folder_str = f" ({folder})" if folder else ""
            print(f"  [{idx}] {name}{folder_str}")
        if len(unprocessed_datasets) > 10:
            print(f"  ... and {len(unprocessed_datasets) - 10} more")

    # Determine offset
    if processed_count == 0:
        offset = 0
        print(f"\n→ Resume with: --offset 0")
    elif processed_count == len(datasets):
        print(f"\n→ All datasets have been processed!")
    else:
        # Find the first unprocessed dataset
        first_unprocessed_idx = unprocessed_datasets[0][0]
        offset = first_unprocessed_idx
        print(f"\n→ Resume with: --offset {offset}")
        print(f"   This will skip {offset} processed datasets and start with:")
        print(f"   [{offset}] {unprocessed_datasets[0][1]}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    asyncio.run(main())

