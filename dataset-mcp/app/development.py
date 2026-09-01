"""Safe local defaults for the auto-discovered FastAPI development app."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Mapping
from pathlib import Path

from app.config import Settings
from query_worker.protocol import WorkerSeaweedCredentials

_LOCAL_QUERY_TOKEN_SECRET = "dataset-mcp-local-development-token-only"
_LOCAL_SEAWEED_ACCESS_KEY = "access"
_LOCAL_SEAWEED_SECRET_KEY = "secret"


def development_settings(
    environment: Mapping[str, str] = os.environ,
    *,
    runtime_directory: Path | None = None,
) -> Settings:
    """Build local settings without weakening the production settings contract."""
    runtime_root = runtime_directory or Path(tempfile.gettempdir()) / "dataset-mcp"
    values: dict[str, str] = {
        "catalog_base_url": environment.get(
            "DATASET_MCP_CATALOG_BASE_URL", "http://127.0.0.1:8000"
        ),
        "query_token_secret": environment.get(
            "DATASET_MCP_QUERY_TOKEN_SECRET", _LOCAL_QUERY_TOKEN_SECRET
        ),
        "public_origin": environment.get("DATASET_MCP_PUBLIC_ORIGIN", "http://127.0.0.1:8001"),
        "duckdb_temp_directory": str(runtime_root / "spill"),
        "duckdb_extension_directory": str(runtime_root / "extensions"),
    }
    return Settings.model_validate(values)


def local_seaweedfs_credentials() -> WorkerSeaweedCredentials:
    """Return credentials fixed by the repository's local SeaweedFS compose setup."""
    return WorkerSeaweedCredentials(
        access_key_id=_LOCAL_SEAWEED_ACCESS_KEY,
        secret_access_key=_LOCAL_SEAWEED_SECRET_KEY,
    )
