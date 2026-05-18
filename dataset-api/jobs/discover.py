"""Cloud Run Job entrypoint for discovering datasets into the catalog database."""

import asyncio
import json
import logging
import os
from collections import Counter
from dataclasses import dataclass
from typing import Mapping

from sqlmodel import Session

from database.db import get_db_session
from services.catalog_ingest import CatalogIngestService
from services.datasets import DatasetService
from services.discovery import DiscoveryService
from storage.storage_client import create_storage_client_from_location

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class DiscoverJobConfig:
    storage_location_ids: list[int]
    discover_prefix: str = ""
    discover_dry_run: bool = False
    discover_limit: int | None = None


def parse_storage_location_ids(raw_value: str) -> list[int]:
    values = [part.strip() for part in raw_value.split(",") if part.strip()]
    if not values:
        raise ValueError("STORAGE_LOCATION_IDS must contain at least one ID")
    try:
        return [int(value) for value in values]
    except ValueError as exc:
        raise ValueError("STORAGE_LOCATION_IDS must be a comma-separated list of integers") from exc


def parse_bool(raw_value: str | None) -> bool:
    if raw_value is None:
        return False
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def load_config_from_env(env: Mapping[str, str] | None = None) -> DiscoverJobConfig:
    env_map = env or os.environ

    storage_location_ids_raw = env_map.get("STORAGE_LOCATION_IDS")
    if not storage_location_ids_raw:
        raise ValueError("STORAGE_LOCATION_IDS is required")

    discover_limit_raw = env_map.get("DISCOVER_LIMIT")
    discover_limit = int(discover_limit_raw) if discover_limit_raw else None

    return DiscoverJobConfig(
        storage_location_ids=parse_storage_location_ids(storage_location_ids_raw),
        discover_prefix=env_map.get("DISCOVER_PREFIX", ""),
        discover_dry_run=parse_bool(env_map.get("DISCOVER_DRY_RUN")),
        discover_limit=discover_limit,
    )


def build_discovered_version_payload(
    config: DiscoverJobConfig,
    discovered_version,
) -> dict[str, object]:
    payload = {
        "version": discovered_version.version,
        "location_path": discovered_version.location_path,
        "source_metadata": (
            discovered_version.metadata.model_dump()
            if discovered_version.metadata is not None
            else None
        ),
        "dry_run": config.discover_dry_run,
    }
    if discovered_version.dataset_description:
        payload["dataset_description"] = discovered_version.dataset_description
    return payload


async def run_job(
    config: DiscoverJobConfig,
    db_session: Session | None = None,
) -> int:
    owns_session = db_session is None
    db = db_session or get_db_session()
    dataset_service = DatasetService(db)
    ingest_service = CatalogIngestService(db)

    has_failures = False
    discovered_versions_count = 0
    source_objects_count = 0
    metadata_records_count = 0
    metadata_object_paths: set[str] = set()
    format_counts: Counter[str] = Counter()
    format_source_object_counts: Counter[str] = Counter()
    written_versions_count = 0

    try:
        for storage_location_id in config.storage_location_ids:
            try:
                storage_location = dataset_service.get_storage_location(
                    storage_location_id
                )
                if not storage_location:
                    raise ValueError(
                        f"Storage location {storage_location_id} not found"
                    )
                storage_client = create_storage_client_from_location(storage_location)
                if storage_client is None:
                    raise ValueError(
                        f"Storage location {storage_location_id} is not bucket-backed"
                    )
                discovery = DiscoveryService(storage_client=storage_client)

                async for discovered_version in discovery.scan(
                    prefix=config.discover_prefix,
                    limit=config.discover_limit,
                ):
                    discovered_versions_count += 1
                    source_object_count = len(discovered_version.object_paths)
                    source_objects_count += source_object_count
                    format_counts[discovered_version.format_type] += 1
                    format_source_object_counts[
                        discovered_version.format_type
                    ] += source_object_count
                    if discovered_version.metadata is not None:
                        metadata_records_count += 1
                    metadata_object_paths.update(discovered_version.metadata_object_paths)
                    request_payload = build_discovered_version_payload(
                        config, discovered_version
                    )

                    if config.discover_dry_run:
                        ingest_result = ingest_service.preview_discovered_version(
                            storage_location_id=storage_location_id,
                            dataset_slug=discovered_version.dataset_slug,
                            file_slug=discovered_version.file_slug,
                            format_type=discovered_version.format_type,
                            version=discovered_version.version,
                        )
                    else:
                        ingest_result = ingest_service.upsert_discovered_version(
                            storage_location_id=storage_location_id,
                            dataset_slug=discovered_version.dataset_slug,
                            file_slug=discovered_version.file_slug,
                            format_type=discovered_version.format_type,
                            version=discovered_version.version,
                            location_path=discovered_version.location_path,
                            source_metadata=discovered_version.metadata,
                            dataset_description=discovered_version.dataset_description,
                        )
                        written_versions_count += 1

                    logger.info(
                        json.dumps(
                            {
                                "event": "dataset_discovery",
                                "dry_run": config.discover_dry_run,
                                "storage_location_id": storage_location_id,
                                "dataset_slug": discovered_version.dataset_slug,
                                "file_slug": discovered_version.file_slug,
                                "format_type": discovered_version.format_type,
                                "version": discovered_version.version,
                                "location_path": discovered_version.location_path,
                                "request_payload": request_payload,
                                "would_write": config.discover_dry_run,
                                "object_paths": discovered_version.object_paths,
                                "source_object_count": source_object_count,
                                "metadata_object_count": len(
                                    discovered_version.metadata_object_paths
                                ),
                                "has_quality_metadata": (
                                    discovered_version.metadata is not None
                                    and any(
                                        value is not None
                                        for value in [
                                            discovered_version.metadata.feature_count,
                                            discovered_version.metadata.bounds,
                                            discovered_version.metadata.geometry_type,
                                            discovered_version.metadata.invalid_geometry_count,
                                            discovered_version.metadata.quality_check_passed,
                                            discovered_version.metadata.columns_hash,
                                        ]
                                    )
                                ),
                                "has_data_dictionary": (
                                    discovered_version.metadata is not None
                                    and bool(discovered_version.metadata.columns)
                                ),
                                "ok": True,
                                "result": ingest_result.model_dump(),
                            },
                            sort_keys=True,
                        )
                    )
            except Exception as exc:
                has_failures = True
                logger.error(
                    json.dumps(
                        {
                            "event": "dataset_discovery",
                            "storage_location_id": storage_location_id,
                            "ok": False,
                            "error": str(exc),
                        },
                        sort_keys=True,
                    )
                )
    finally:
        logger.info(
            json.dumps(
                {
                    "event": "dataset_discovery_summary",
                    "dry_run": config.discover_dry_run,
                    "discovered_versions": discovered_versions_count,
                    "source_objects": source_objects_count,
                    "metadata_records": metadata_records_count,
                    "metadata_objects": len(metadata_object_paths),
                    "written_versions": written_versions_count,
                    "format_counts": dict(sorted(format_counts.items())),
                    "format_source_object_counts": dict(
                        sorted(format_source_object_counts.items())
                    ),
                    "has_failures": has_failures,
                },
                sort_keys=True,
            )
        )
        if owns_session:
            db.close()

    return 1 if has_failures else 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        config = load_config_from_env()
    except ValueError as exc:
        logger.error(str(exc))
        return 1

    return asyncio.run(run_job(config))


if __name__ == "__main__":
    raise SystemExit(main())
