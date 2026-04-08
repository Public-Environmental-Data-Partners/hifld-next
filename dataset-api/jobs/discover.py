"""Cloud Run Job entrypoint for triggering dataset discovery via the dataset API."""

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Mapping

import httpx

from models.dataset import StorageLocation
from services.discovery import DiscoveryService
from storage.storage_client import create_storage_client_from_location

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class DiscoverJobConfig:
    dataset_api_url: str
    dataset_api_key: str
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

    dataset_api_url = env_map.get("DATASET_API_URL")
    if not dataset_api_url:
        raise ValueError("DATASET_API_URL is required")

    dataset_api_key = env_map.get("DATASET_API_KEY")
    if not dataset_api_key:
        raise ValueError("DATASET_API_KEY is required")

    storage_location_ids_raw = env_map.get("STORAGE_LOCATION_IDS")
    if not storage_location_ids_raw:
        raise ValueError("STORAGE_LOCATION_IDS is required")

    discover_limit_raw = env_map.get("DISCOVER_LIMIT")
    discover_limit = int(discover_limit_raw) if discover_limit_raw else None

    return DiscoverJobConfig(
        dataset_api_url=dataset_api_url.rstrip("/"),
        dataset_api_key=dataset_api_key,
        storage_location_ids=parse_storage_location_ids(storage_location_ids_raw),
        discover_prefix=env_map.get("DISCOVER_PREFIX", ""),
        discover_dry_run=parse_bool(env_map.get("DISCOVER_DRY_RUN")),
        discover_limit=discover_limit,
    )


def build_headers(config: DiscoverJobConfig) -> dict[str, str]:
    return {"X-API-Key": config.dataset_api_key}


async def fetch_storage_location(
    storage_location_id: int,
    config: DiscoverJobConfig,
    client: httpx.AsyncClient,
) -> StorageLocation:
    response = await client.get(
        f"/api/admin/storage-locations/{storage_location_id}",
        headers=build_headers(config),
    )
    response.raise_for_status()
    return StorageLocation(**response.json())


def build_create_version_payload(
    config: DiscoverJobConfig,
    discovered_version,
) -> dict[str, object]:
    return {
        "version": discovered_version.version,
        "location_path": discovered_version.location_path,
        "source_metadata": (
            discovered_version.metadata.model_dump()
            if discovered_version.metadata is not None
            else None
        ),
        "dry_run": config.discover_dry_run,
    }


async def run_job(
    config: DiscoverJobConfig,
    client: httpx.AsyncClient | None = None,
) -> int:
    owns_client = client is None
    http_client = client or httpx.AsyncClient(
        base_url=config.dataset_api_url,
        timeout=httpx.Timeout(300.0),
    )

    has_failures = False

    try:
        for storage_location_id in config.storage_location_ids:
            try:
                storage_location = await fetch_storage_location(
                    storage_location_id,
                    config,
                    http_client,
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
                    response = await http_client.post(
                        (
                            f"/api/admin/storage-locations/{storage_location_id}"
                            f"/datasets/{discovered_version.dataset_slug}"
                            f"/files/{discovered_version.file_slug}"
                            f"/formats/{discovered_version.format_type}"
                            "/versions"
                        ),
                        headers=build_headers(config),
                        json=build_create_version_payload(config, discovered_version),
                    )
                    try:
                        response_body: object = response.json()
                    except ValueError:
                        response_body = response.text

                    logger.info(
                        json.dumps(
                            {
                                "event": "dataset_discovery",
                                "storage_location_id": storage_location_id,
                                "dataset_slug": discovered_version.dataset_slug,
                                "file_slug": discovered_version.file_slug,
                                "format_type": discovered_version.format_type,
                                "version": discovered_version.version,
                                "status_code": response.status_code,
                                "ok": response.is_success,
                                "response": response_body,
                            },
                            sort_keys=True,
                        )
                    )
                    if not response.is_success:
                        has_failures = True
            except httpx.HTTPError as exc:
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
        if owns_client:
            await http_client.aclose()

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
