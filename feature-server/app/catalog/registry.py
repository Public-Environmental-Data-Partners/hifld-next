"""Atomic snapshot ownership with request reference counting."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock

from pygeoapi.api import API

from app.catalog.repository import CatalogRepository

type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]


@dataclass(slots=True)
class ApiSnapshot:
    generation: str
    repository: CatalogRepository
    api: API
    openapi: dict[str, JsonValue]
    references: int = 0
    retired: bool = False
    owned_path: bool = False


class SnapshotRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._current: ApiSnapshot | None = None

    @property
    def generation(self) -> str | None:
        with self._lock:
            return None if self._current is None else self._current.generation

    def replace(self, snapshot: ApiSnapshot) -> None:
        with self._lock:
            previous = self._current
            self._current = snapshot
            if previous is not None:
                previous.retired = True
                self._cleanup(previous)

    def close(self) -> None:
        """Retire the active snapshot and release its managed file when safe."""
        with self._lock:
            previous = self._current
            self._current = None
            if previous is not None:
                previous.retired = True
                self._cleanup(previous)

    @staticmethod
    def _cleanup(snapshot: ApiSnapshot) -> None:
        if snapshot.retired and snapshot.references == 0 and snapshot.owned_path:
            snapshot.repository.path.unlink(missing_ok=True)

    @contextmanager
    def acquire(self) -> Iterator[ApiSnapshot]:
        with self._lock:
            if self._current is None:
                raise RuntimeError("catalog snapshot is not ready")
            snapshot = self._current
            snapshot.references += 1
        try:
            yield snapshot
        finally:
            with self._lock:
                snapshot.references -= 1
                self._cleanup(snapshot)
