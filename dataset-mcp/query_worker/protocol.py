from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import datetime
from typing import Literal

from app.query.models import EncodedRow


@dataclass(frozen=True, slots=True)
class WorkerSeaweedSource:
    """Non-secret local SeaweedFS configuration from the catalog."""

    bucket: str
    endpoint: str
    tls: bool = False
    url_style: Literal["path"] = "path"


@dataclass(frozen=True, slots=True)
class WorkerSeaweedCredentials:
    """Spawn-time local credentials; never included in per-query IPC."""

    access_key_id: str = dataclass_field(repr=False)
    secret_access_key: str = dataclass_field(repr=False)


@dataclass(frozen=True, slots=True)
class WorkerSourceSpec:
    alias: str
    object_uris: tuple[str, ...]
    seaweedfs: WorkerSeaweedSource | None = None


@dataclass(frozen=True, slots=True)
class WorkerRuntimeConfig:
    threads: int
    memory_limit: str
    temp_directory: str
    extension_directory: str | None = None
    seaweedfs_credentials: WorkerSeaweedCredentials | None = None
    install_extensions: bool = False
    load_extensions: bool = True
    metrics_enabled: bool = False
    max_columns: int = 200
    max_result_bytes: int = 4 * 1024 * 1024
    max_cell_bytes: int = 64 * 1024
    max_temp_directory_size: str = "1GiB"


@dataclass(frozen=True, slots=True)
class WorkerQuery:
    canonical_sql: str
    sources: tuple[WorkerSourceSpec, ...]
    limit: int
    offset: int
    deadline: datetime
    deterministic_order: bool = False
    max_result_bytes: int | None = None
    max_cell_bytes: int | None = None


@dataclass(frozen=True, slots=True)
class WorkerTileQuery:
    canonical_sql: str
    sources: tuple[WorkerSourceSpec, ...]
    z: int
    x: int
    y: int
    geometry_column: str
    result_crs: str | None
    feature_cap: int
    deadline: datetime


@dataclass(frozen=True, slots=True)
class WorkerPage:
    columns: tuple[tuple[str, str, bool], ...]
    rows: tuple[EncodedRow, ...]
    offset: int
    returned_count: int
    has_more: bool
    elapsed_ms: float
    bytes_read: int
    files_read: int
    next_offset: int | None = None
    response_truncated: bool = False
    deterministic_order: bool = False


@dataclass(frozen=True, slots=True)
class WorkerTile:
    content: bytes
    elapsed_ms: float
    bytes_read: int
    files_read: int


@dataclass(frozen=True, slots=True)
class WorkerFailure:
    code: str
    message: str


WorkerResult = WorkerPage | WorkerTile | WorkerFailure
