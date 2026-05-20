"""Job entrypoint for syncing catalog configuration into the database."""

import json
import logging
import os
from dataclasses import dataclass
from typing import Mapping

from sqlmodel import Session

from database.db import get_db_session
from scripts.config_loader import load_json_config
from scripts.seed_formats import seed_formats
from scripts.seed_storage import seed_storage_locations

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ConfigSyncJobConfig:
    format_config_uri: str
    storage_config_uri: str
    dry_run: bool = False


def parse_required_string(env_map: Mapping[str, str], name: str) -> str:
    raw_value = env_map.get(name)
    if raw_value is None or not raw_value.strip():
        raise ValueError(f"{name} is required")
    return raw_value.strip()


def parse_bool(raw_value: str | None) -> bool:
    if raw_value is None:
        return False
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def load_config_from_env(env: Mapping[str, str] | None = None) -> ConfigSyncJobConfig:
    env_map = env if env is not None else os.environ
    return ConfigSyncJobConfig(
        format_config_uri=parse_required_string(env_map, "FORMAT_CONFIG_URI"),
        storage_config_uri=parse_required_string(env_map, "STORAGE_CONFIG_URI"),
        dry_run=parse_bool(env_map.get("CONFIG_SYNC_DRY_RUN")),
    )


def run_job(
    config: ConfigSyncJobConfig,
    db_session: Session | None = None,
) -> int:
    owns_session = db_session is None
    db = db_session or get_db_session()
    has_failures = False
    format_results: dict[str, int] | None = None
    storage_results: dict[str, int] | None = None

    try:
        formats = load_json_config(config.format_config_uri)
        storage_locations = load_json_config(config.storage_config_uri)

        format_results = seed_formats(db, formats, dry_run=config.dry_run)
        storage_results = seed_storage_locations(
            db, storage_locations, dry_run=config.dry_run
        )

        logger.info(
            json.dumps(
                {
                    "event": "catalog_config_sync",
                    "dry_run": config.dry_run,
                    "format_config_uri": config.format_config_uri,
                    "storage_config_uri": config.storage_config_uri,
                    "ok": True,
                    "format_results": format_results,
                    "storage_results": storage_results,
                },
                sort_keys=True,
            )
        )
    except Exception as exc:
        has_failures = True
        if not config.dry_run:
            db.rollback()
        logger.error(
            json.dumps(
                {
                    "event": "catalog_config_sync",
                    "dry_run": config.dry_run,
                    "format_config_uri": config.format_config_uri,
                    "storage_config_uri": config.storage_config_uri,
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
                    "event": "catalog_config_sync_summary",
                    "dry_run": config.dry_run,
                    "format_config_uri": config.format_config_uri,
                    "storage_config_uri": config.storage_config_uri,
                    "format_results": format_results,
                    "storage_results": storage_results,
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

    return run_job(config)


if __name__ == "__main__":
    raise SystemExit(main())
