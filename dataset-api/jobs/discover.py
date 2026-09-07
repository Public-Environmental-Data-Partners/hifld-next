"""Job entrypoint for discovering datasets into the catalog database."""

import asyncio
import json
import logging
import os
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field

from sqlmodel import Session, select

from database.db import get_db_session
from models.dataset import Collection, StorageLocation
from schemas.types import APIDict, json_value, model_json_dict
from services.catalog_ingest import CatalogIngestResult, CatalogIngestService, CatalogPruneResult
from services.discovery import DiscoveredVersion, DiscoveryService
from storage.storage_client import StorageClient, create_storage_client_from_location


logger = logging.getLogger(__name__)


class DiscoverJobError(ValueError):
    """Configuration or setup error for the discovery job."""

    @classmethod
    def missing_env(cls, name: str) -> "DiscoverJobError":
        """Create an error for a missing environment variable."""
        return cls(f"{name} is required")

    @classmethod
    def prune_requires_empty_prefix(cls) -> "DiscoverJobError":
        """Create an error for invalid prune settings."""
        return cls("DISCOVER_PRUNE_STALE requires an empty DISCOVER_PREFIX")

    @classmethod
    def missing_collection(cls, slug: str) -> "DiscoverJobError":
        """Create an error for a missing collection."""
        return cls(f"Collection {slug!r} not found")

    @classmethod
    def missing_storage_location(cls, slug: str) -> "DiscoverJobError":
        """Create an error for a missing storage location."""
        return cls(f"Storage location {slug!r} not found")

    @classmethod
    def non_bucket_storage_location(cls, slug: str) -> "DiscoverJobError":
        """Create an error for a storage location that is not bucket-backed."""
        return cls(f"Storage location {slug!r} is not bucket-backed")


@dataclass(slots=True)
class DiscoverJobConfig:
    """Environment-driven configuration for the discovery job."""

    storage_location_slug: str
    collection_slug: str
    discover_prefix: str = ""
    discover_dry_run: bool = False
    discover_limit: int | None = None
    discover_prune_stale: bool = False


@dataclass(slots=True)
class DiscoveryJobStats:
    """Counters collected during one discovery job run."""

    discovered_versions: int = 0
    source_objects: int = 0
    metadata_records: int = 0
    metadata_object_paths: set[str] = field(default_factory=set)
    format_counts: Counter[str] = field(default_factory=Counter)
    format_source_object_counts: Counter[str] = field(default_factory=Counter)
    written_versions: int = 0
    discovered_source_keys: set[tuple[str, str, str, str]] = field(default_factory=set)

    def record_discovered_version(self, discovered_version: DiscoveredVersion) -> int:
        """Record counters for a discovered version and return its source object count."""
        source_object_count = len(discovered_version.object_paths)
        self.discovered_versions += 1
        self.source_objects += source_object_count
        self.format_counts[discovered_version.format_type] += 1
        self.format_source_object_counts[discovered_version.format_type] += source_object_count
        self.discovered_source_keys.add(
            (
                discovered_version.dataset_slug,
                discovered_version.file_slug,
                discovered_version.format_type,
                discovered_version.version,
            )
        )
        if discovered_version.metadata is not None:
            self.metadata_records += 1
        self.metadata_object_paths.update(discovered_version.metadata_object_paths)
        return source_object_count


@dataclass(slots=True)
class DiscoveryJobRuntime:
    """Identifiers shared by discovery job logging helpers."""

    config: DiscoverJobConfig
    collection_id: int
    storage_location_id: int


def parse_required_string(env_map: Mapping[str, str], name: str) -> str:
    """Read a required non-empty string from an environment mapping."""
    raw_value = env_map.get(name)
    if raw_value is None or not raw_value.strip():
        raise DiscoverJobError.missing_env(name)
    return raw_value.strip()


def parse_bool(raw_value: str | None) -> bool:
    """Parse common truthy environment variable values."""
    if raw_value is None:
        return False
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def load_config_from_env(env: Mapping[str, str] | None = None) -> DiscoverJobConfig:
    """Load discovery job settings from environment variables."""
    env_map = env if env is not None else os.environ

    discover_limit_raw = env_map.get("DISCOVER_LIMIT")
    discover_limit = int(discover_limit_raw) if discover_limit_raw else None

    return DiscoverJobConfig(
        storage_location_slug=parse_required_string(env_map, "DISCOVER_STORAGE_LOCATION_SLUG"),
        collection_slug=parse_required_string(env_map, "DISCOVER_COLLECTION_SLUG"),
        discover_prefix=env_map.get("DISCOVER_PREFIX", ""),
        discover_dry_run=parse_bool(env_map.get("DISCOVER_DRY_RUN")),
        discover_limit=discover_limit,
        discover_prune_stale=parse_bool(env_map.get("DISCOVER_PRUNE_STALE")),
    )


def build_discovered_version_payload(
    config: DiscoverJobConfig,
    discovered_version: DiscoveredVersion,
) -> APIDict:
    """Build the payload used for catalog ingest from a discovered version."""
    payload: APIDict = {
        "version": discovered_version.version,
        "location_path": discovered_version.location_path,
        "source_metadata": (
            model_json_dict(discovered_version.metadata) if discovered_version.metadata is not None else None
        ),
        "dry_run": config.discover_dry_run,
    }
    if discovered_version.dataset_description:
        payload["dataset_description"] = discovered_version.dataset_description
    if discovered_version.dataset_name:
        payload["dataset_name"] = discovered_version.dataset_name
    if discovered_version.dataset_tags:
        payload["dataset_tags"] = json_value(discovered_version.dataset_tags)
    if discovered_version.file_name:
        payload["file_name"] = discovered_version.file_name
    if discovered_version.file_description:
        payload["file_description"] = discovered_version.file_description
    return payload


def validate_prune_settings(config: DiscoverJobConfig) -> None:
    """Validate pruning settings before running discovery."""
    if config.discover_prune_stale and config.discover_prefix:
        raise DiscoverJobError.prune_requires_empty_prefix()


def get_required_collection(db: Session, slug: str) -> Collection:
    """Get a collection or raise a discovery job error."""
    collection = db.exec(select(Collection).where(Collection.slug == slug)).first()
    if not collection:
        raise DiscoverJobError.missing_collection(slug)
    return collection


def get_required_storage_location(db: Session, slug: str) -> StorageLocation:
    """Get a storage location or raise a discovery job error."""
    storage_location = db.exec(select(StorageLocation).where(StorageLocation.slug == slug)).first()
    if not storage_location:
        raise DiscoverJobError.missing_storage_location(slug)
    return storage_location


def get_required_storage_client(storage_location: StorageLocation, slug: str) -> StorageClient:
    """Create a bucket-backed storage client or raise a discovery job error."""
    storage_client = create_storage_client_from_location(storage_location)
    if storage_client is None:
        raise DiscoverJobError.non_bucket_storage_location(slug)
    return storage_client


def has_quality_metadata(discovered_version: DiscoveredVersion) -> bool:
    """Return whether the discovered version has populated quality metadata."""
    return discovered_version.metadata is not None and any(
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


def ingest_discovered_version(
    config: DiscoverJobConfig,
    ingest_service: CatalogIngestService,
    discovered_version: DiscoveredVersion,
    collection_id: int,
    storage_location_id: int,
) -> CatalogIngestResult:
    """Preview or upsert a discovered version."""
    if config.discover_dry_run:
        return ingest_service.preview_discovered_version(
            collection_id=collection_id,
            storage_location_id=storage_location_id,
            dataset_slug=discovered_version.dataset_slug,
            file_slug=discovered_version.file_slug,
            format_type=discovered_version.format_type,
            version=discovered_version.version,
        )

    return ingest_service.upsert_discovered_version(
        collection_id=collection_id,
        storage_location_id=storage_location_id,
        dataset_slug=discovered_version.dataset_slug,
        file_slug=discovered_version.file_slug,
        format_type=discovered_version.format_type,
        version=discovered_version.version,
        location_path=discovered_version.location_path,
        source_metadata=discovered_version.metadata,
        dataset_name=discovered_version.dataset_name,
        dataset_description=discovered_version.dataset_description,
        dataset_tags=discovered_version.dataset_tags,
        file_name=discovered_version.file_name,
        file_description=discovered_version.file_description,
    )


def log_discovery_success(
    runtime: DiscoveryJobRuntime,
    discovered_version: DiscoveredVersion,
    ingest_result: CatalogIngestResult,
    request_payload: APIDict,
    source_object_count: int,
) -> None:
    """Log one successful discovery event."""
    config = runtime.config
    logger.info(
        json.dumps(
            {
                "event": "dataset_discovery",
                "dry_run": config.discover_dry_run,
                "storage_location_slug": config.storage_location_slug,
                "storage_location_id": runtime.storage_location_id,
                "collection_slug": config.collection_slug,
                "collection_id": runtime.collection_id,
                "dataset_slug": discovered_version.dataset_slug,
                "file_slug": discovered_version.file_slug,
                "format_type": discovered_version.format_type,
                "version": discovered_version.version,
                "location_path": discovered_version.location_path,
                "request_payload": request_payload,
                "would_write": config.discover_dry_run,
                "object_paths": discovered_version.object_paths,
                "catalog_metadata_object_paths": discovered_version.catalog_metadata_object_paths,
                "dataset_name": discovered_version.dataset_name,
                "file_name": discovered_version.file_name,
                "has_catalog_description": bool(
                    discovered_version.dataset_description or discovered_version.file_description
                ),
                "has_catalog_tags": bool(discovered_version.dataset_tags),
                "source_object_count": source_object_count,
                "metadata_object_count": len(discovered_version.metadata_object_paths),
                "has_quality_metadata": has_quality_metadata(discovered_version),
                "has_data_dictionary": (
                    discovered_version.metadata is not None and bool(discovered_version.metadata.columns)
                ),
                "ok": True,
                "result": ingest_result.model_dump(),
            },
            sort_keys=True,
        )
    )


def log_prune_result(
    runtime: DiscoveryJobRuntime,
    prune_result: CatalogPruneResult,
) -> None:
    """Log stale source pruning results."""
    config = runtime.config
    logger.info(
        json.dumps(
            {
                "event": "dataset_discovery_prune",
                "dry_run": config.discover_dry_run,
                "storage_location_slug": config.storage_location_slug,
                "storage_location_id": runtime.storage_location_id,
                "collection_slug": config.collection_slug,
                "collection_id": runtime.collection_id,
                "would_delete": config.discover_dry_run,
                "result": prune_result.model_dump(),
            },
            sort_keys=True,
        )
    )


def log_discovery_failure(
    config: DiscoverJobConfig,
    storage_location_id: int | None,
    collection_id: int | None,
    error_message: str,
) -> None:
    """Log a failed discovery run."""
    logger.exception(
        json.dumps(
            {
                "event": "dataset_discovery",
                "storage_location_slug": config.storage_location_slug,
                "storage_location_id": storage_location_id,
                "collection_slug": config.collection_slug,
                "collection_id": collection_id,
                "ok": False,
                "error": error_message,
            },
            sort_keys=True,
        )
    )


def log_discovery_summary(
    config: DiscoverJobConfig,
    stats: DiscoveryJobStats,
    prune_result: CatalogPruneResult | None,
    has_failures: bool,
    runtime: DiscoveryJobRuntime | None = None,
) -> None:
    """Log the final discovery summary."""
    storage_location_id = runtime.storage_location_id if runtime is not None else None
    collection_id = runtime.collection_id if runtime is not None else None
    logger.info(
        json.dumps(
            {
                "event": "dataset_discovery_summary",
                "dry_run": config.discover_dry_run,
                "storage_location_slug": config.storage_location_slug,
                "storage_location_id": storage_location_id,
                "collection_slug": config.collection_slug,
                "collection_id": collection_id,
                "discovered_versions": stats.discovered_versions,
                "source_objects": stats.source_objects,
                "metadata_records": stats.metadata_records,
                "metadata_objects": len(stats.metadata_object_paths),
                "written_versions": stats.written_versions,
                "prune_stale": config.discover_prune_stale,
                "stale_sources": (len(prune_result.deleted_file_source_ids) if prune_result is not None else 0),
                "empty_formats": (len(prune_result.deleted_file_format_ids) if prune_result is not None else 0),
                "empty_files": (len(prune_result.deleted_file_ids) if prune_result is not None else 0),
                "empty_datasets": (len(prune_result.deleted_dataset_ids) if prune_result is not None else 0),
                "format_counts": dict(sorted(stats.format_counts.items())),
                "format_source_object_counts": dict(sorted(stats.format_source_object_counts.items())),
                "has_failures": has_failures,
            },
            sort_keys=True,
        )
    )


async def run_job(
    config: DiscoverJobConfig,
    db_session: Session | None = None,
) -> int:
    """Run dataset discovery and optionally upsert discovered catalog rows."""
    owns_session = db_session is None
    db = db_session or get_db_session()
    ingest_service = CatalogIngestService(db)

    has_failures = False
    stats = DiscoveryJobStats()
    prune_result: CatalogPruneResult | None = None
    storage_location_id: int | None = None
    collection_id: int | None = None
    runtime: DiscoveryJobRuntime | None = None

    try:
        validate_prune_settings(config)

        collection = get_required_collection(db, config.collection_slug)
        collection_id = collection.id

        storage_location = get_required_storage_location(db, config.storage_location_slug)
        storage_location_id = storage_location.id
        storage_client = get_required_storage_client(storage_location, config.storage_location_slug)
        discovery = DiscoveryService(storage_client=storage_client)
        runtime = DiscoveryJobRuntime(
            config=config,
            collection_id=collection_id,
            storage_location_id=storage_location_id,
        )

        async for discovered_version in discovery.scan(
            prefix=config.discover_prefix,
            limit=config.discover_limit,
        ):
            source_object_count = stats.record_discovered_version(discovered_version)
            request_payload = build_discovered_version_payload(config, discovered_version)
            ingest_result = ingest_discovered_version(
                config,
                ingest_service,
                discovered_version,
                collection_id,
                storage_location_id,
            )
            if not config.discover_dry_run:
                stats.written_versions += 1
            log_discovery_success(
                runtime,
                discovered_version,
                ingest_result,
                request_payload,
                source_object_count,
            )
        stats.discovered_source_keys.update(discovery.protected_source_keys)
        if config.discover_prune_stale and not has_failures:
            prune_result = ingest_service.prune_stale_discovered_sources(
                collection_id=collection_id,
                storage_location_id=storage_location_id,
                discovered_source_keys=stats.discovered_source_keys,
                dry_run=config.discover_dry_run,
            )
            log_prune_result(runtime, prune_result)
    except Exception as exc:
        error_message = str(exc)
        has_failures = True
        log_discovery_failure(config, storage_location_id, collection_id, error_message)
    finally:
        log_discovery_summary(config, stats, prune_result, has_failures, runtime)
        if owns_session:
            db.close()

    return 1 if has_failures else 0


def main() -> int:
    """Run the discovery job from the command line."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        config = load_config_from_env()
    except ValueError:
        logger.exception("Failed to load discovery job configuration")
        return 1

    return asyncio.run(run_job(config))


if __name__ == "__main__":
    raise SystemExit(main())
