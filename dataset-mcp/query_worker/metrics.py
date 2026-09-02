"""Typed, best-effort DuckDB profiling for worker-owned connections."""

from __future__ import annotations

import json
import tempfile
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import duckdb

_initialized_connections: set[int] = set()


@dataclass(frozen=True, slots=True)
class QueryMetrics:
    label: str | None
    bytes_read: int | None
    latency_ms: float | None
    wall_ms: float
    error_code: str | None


@dataclass(slots=True)
class MutableQueryMetrics:
    label: str | None
    bytes_read: int | None = None
    latency_ms: float | None = None
    wall_ms: float = 0.0
    error_code: str | None = None

    def snapshot(self) -> QueryMetrics:
        return QueryMetrics(
            label=self.label,
            bytes_read=self.bytes_read,
            latency_ms=self.latency_ms,
            wall_ms=self.wall_ms,
            error_code=self.error_code,
        )


def _profile_path(temp_directory: Path) -> Path:
    temp_directory.mkdir(parents=True, exist_ok=True)
    file = tempfile.NamedTemporaryFile(
        prefix="duckdb-profile-", suffix=".json", dir=temp_directory, delete=False
    )
    file.close()
    return Path(file.name)


def _set_profile_output(connection: duckdb.DuckDBPyConnection, path: Path) -> None:
    escaped_path = str(path).replace("'", "''")
    connection.execute(f"PRAGMA profile_output='{escaped_path}'")


def _unlink(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


# Adapted from ../geoparquet-duckdb-partitioning/metrics.py:init_connection.
# Preserve the setting order and fetchall warm-up used by DuckDB 1.5.x.
def init_connection(
    connection: duckdb.DuckDBPyConnection,
    *,
    temp_directory: Path,
    enabled: bool,
) -> None:
    if not enabled or id(connection) in _initialized_connections:
        return
    connection.execute(
        "PRAGMA custom_profiling_settings='"
        '{"TOTAL_BYTES_READ":"true","LATENCY":"true",'
        '"OPERATOR_ROWS_SCANNED":"true"}'
        "'"
    )
    connection.execute("PRAGMA enable_profiling='json'")
    warmup_path = _profile_path(temp_directory)
    try:
        _set_profile_output(connection, warmup_path)
        connection.execute("SELECT 1").fetchall()
    finally:
        _unlink(warmup_path)
    _initialized_connections.add(id(connection))


def _profile_number(profile: object, key: str) -> int | float | None:
    if not isinstance(profile, dict):
        return None
    values = cast(dict[object, object], profile)
    value = values.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


# Adapted from ../geoparquet-duckdb-partitioning/metrics.py:measure.
# It retains per-query profile files and fetchall-based flushing while exposing
# only typed metrics and stable failure codes.
@contextmanager
def measure(
    connection: duckdb.DuckDBPyConnection,
    *,
    label: str | None,
    temp_directory: Path,
    enabled: bool,
) -> Generator[MutableQueryMetrics]:
    metrics = MutableQueryMetrics(label=label)
    if not enabled:
        start = time.monotonic()
        try:
            yield metrics
        finally:
            metrics.wall_ms = round((time.monotonic() - start) * 1000, 2)
        return

    init_connection(connection, temp_directory=temp_directory, enabled=True)
    profile_path = _profile_path(temp_directory)
    _set_profile_output(connection, profile_path)
    start = time.monotonic()
    try:
        yield metrics
    finally:
        metrics.wall_ms = round((time.monotonic() - start) * 1000, 2)
        try:
            raw_profile = profile_path.read_text()
            if not raw_profile:
                metrics.error_code = "empty_profile"
            else:
                profile: object = json.loads(raw_profile)
                bytes_read = _profile_number(profile, "total_bytes_read")
                latency = _profile_number(profile, "latency")
                if isinstance(bytes_read, int):
                    metrics.bytes_read = bytes_read
                elif isinstance(bytes_read, float):
                    metrics.bytes_read = int(bytes_read)
                if latency is not None:
                    metrics.latency_ms = round(float(latency) * 1000, 2)
        except (OSError, UnicodeError):
            metrics.error_code = "profile_unreadable"
        except (json.JSONDecodeError, ValueError, TypeError):
            metrics.error_code = "profile_invalid"
        finally:
            _unlink(profile_path)
