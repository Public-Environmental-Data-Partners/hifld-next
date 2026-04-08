#!/usr/bin/env python3
"""Copy a small real dataset slice from GCS into local SeaweedFS for testing."""

import argparse
import asyncio
import logging
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.storage_client import GCSStorageClient, SeaweedFSFilerClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("seed-seaweedfs-from-gcs")

KNOWN_FORMATS = {
    "geoparquet",
    "pmtiles",
    "geoserver",
    "geopackage",
    "shapefile",
    "geojson",
    "file_geodatabase",
}


def build_copy_plan(dataset_slug: str, files: list[str]) -> tuple[list[str], list[str]]:
    metadata_files: list[str] = []
    first_data_file_by_group: dict[tuple[str, str, str], str] = {}
    versions: set[str] = set()

    for path in sorted(files):
        parts = [part for part in path.split("/") if part]
        if len(parts) < 5:
            continue
        root_dataset_slug, file_slug, version, section = parts[:4]
        if root_dataset_slug != dataset_slug:
            continue

        versions.add(version)
        if section == "metadata":
            metadata_files.append(path)
            continue
        if section not in KNOWN_FORMATS:
            continue

        key = (file_slug, version, section)
        first_data_file_by_group.setdefault(key, path)

    if len(versions) < 2:
        raise ValueError(
            f"Expected at least two versions under {dataset_slug}/, found {sorted(versions)}"
        )

    return metadata_files, sorted(first_data_file_by_group.values())


async def copy_dataset_slice(
    dataset_slug: str,
    gcs_bucket: str,
    seaweed_bucket: str,
    seaweed_filer_url: str,
    seaweed_s3_url: str,
) -> dict[str, object]:
    gcs_client = GCSStorageClient(bucket=gcs_bucket)
    seaweed_client = SeaweedFSFilerClient(
        filer_url=seaweed_filer_url,
        s3_url=seaweed_s3_url,
        bucket=seaweed_bucket,
    )

    files = await gcs_client.list_files(f"{dataset_slug}/")
    metadata_files, data_files = build_copy_plan(dataset_slug, files)
    copy_paths = sorted(set(metadata_files + data_files))

    versions: dict[str, list[str]] = defaultdict(list)
    for path in copy_paths:
        parts = path.split("/")
        if len(parts) >= 3:
            versions[parts[2]].append(path)

    logger.info("Discovered versions for %s: %s", dataset_slug, sorted(versions))
    logger.info(
        "Copying %d metadata files and %d data files into SeaweedFS bucket %s",
        len(metadata_files),
        len(data_files),
        seaweed_bucket,
    )

    copied = 0
    with tempfile.TemporaryDirectory(prefix="seed_seaweedfs_") as tmpdir:
        tmpdir_path = Path(tmpdir)
        for remote_path in copy_paths:
            local_path = tmpdir_path / Path(remote_path).name
            await gcs_client.download_file(remote_path, local_path)
            await seaweed_client.upload_file(local_path, remote_path)
            copied += 1
            logger.info("Copied %s", remote_path)

    return {
        "dataset_slug": dataset_slug,
        "gcs_bucket": gcs_bucket,
        "seaweed_bucket": seaweed_bucket,
        "versions": sorted(versions),
        "metadata_files": len(metadata_files),
        "data_files": len(data_files),
        "copied": copied,
    }


def main() -> None:
    load_dotenv(override=True)

    parser = argparse.ArgumentParser(
        description="Copy a dataset slice from GCS into local SeaweedFS"
    )
    parser.add_argument("--dataset-slug", required=True)
    parser.add_argument("--gcs-bucket", default="hifld-next-datasets-prod")
    parser.add_argument(
        "--seaweed-bucket",
        default="drp-hifld-copy-formatted",
    )
    parser.add_argument("--seaweed-filer-url", default="http://localhost:8888")
    parser.add_argument("--seaweed-s3-url", default="http://localhost:8333")
    args = parser.parse_args()

    result = asyncio.run(
        copy_dataset_slice(
            dataset_slug=args.dataset_slug,
            gcs_bucket=args.gcs_bucket,
            seaweed_bucket=args.seaweed_bucket,
            seaweed_filer_url=args.seaweed_filer_url,
            seaweed_s3_url=args.seaweed_s3_url,
        )
    )
    logger.info("Copy summary: %s", result)


if __name__ == "__main__":
    main()
