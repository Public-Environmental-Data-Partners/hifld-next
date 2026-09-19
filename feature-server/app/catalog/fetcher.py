"""Conditional, failure-safe refresh of the published SQLite catalog."""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from collections.abc import Callable
from enum import Enum
from pathlib import Path

import httpx

from app.catalog.repository import CatalogRepository


class RefreshResult(Enum):
    ACTIVATED = "activated"
    UNCHANGED = "unchanged"
    FAILED = "failed"


class CatalogFetcher:
    """Fetch one configured catalog URL and activate only validated candidates."""

    def __init__(
        self,
        url: str,
        temp_directory: Path,
        activate: Callable[[Path], None],
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._url = url
        self._temp_directory = temp_directory
        self._activate = activate
        self._client = client or httpx.AsyncClient(follow_redirects=False)
        self._owns_client = client is None
        self._active_etag: str | None = None
        self._active_generation: str | None = None
        self._last_error: Exception | None = None
        self._refresh_lock = asyncio.Lock()

    @property
    def last_error(self) -> Exception | None:
        return self._last_error

    @property
    def active_etag(self) -> str | None:
        return self._active_etag

    @property
    def active_generation(self) -> str | None:
        return self._active_generation

    async def refresh(self) -> RefreshResult:
        """Attempt one refresh without disturbing the last good activation."""
        async with self._refresh_lock:
            headers = {"Accept-Encoding": "identity"}
            if self._active_etag is not None:
                headers["If-None-Match"] = self._active_etag

            candidate: Path | None = None
            activated = False
            try:
                response = await self._client.get(self._url, headers=headers)
                if response.status_code == 304 and self._active_etag is not None:
                    self._last_error = None
                    return RefreshResult.UNCHANGED
                response.raise_for_status()

                etag = response.headers.get("etag")
                expected_checksum = response.headers.get(
                    "x-amz-meta-sha256"
                ) or response.headers.get("x-goog-meta-sha256")
                expected_length = response.headers.get("content-length")
                if etag is None or expected_checksum is None or expected_length is None:
                    raise ValueError("catalog response is missing revision metadata")

                content = response.content
                try:
                    content_length = int(expected_length)
                except ValueError as error:
                    raise ValueError("catalog response has invalid content length") from error
                if content_length != len(content):
                    raise ValueError("catalog response content length does not match")
                if hashlib.sha256(content).hexdigest() != expected_checksum.lower():
                    raise ValueError("catalog response checksum does not match")

                self._temp_directory.mkdir(parents=True, exist_ok=True)
                descriptor, candidate_name = tempfile.mkstemp(
                    prefix="catalog-candidate-", suffix=".sqlite", dir=self._temp_directory
                )
                candidate = Path(candidate_name)
                with os.fdopen(descriptor, "wb") as target:
                    target.write(content)

                repository = await asyncio.to_thread(CatalogRepository.open, candidate)
                if (
                    self._active_generation is not None
                    and repository.generation == self._active_generation
                    and etag != self._active_etag
                ):
                    raise ValueError("catalog revision reused the active generation")

                await asyncio.to_thread(self._activate, candidate)
                activated = True
                self._active_etag = etag
                self._active_generation = repository.generation
                self._last_error = None
                return RefreshResult.ACTIVATED
            except Exception as error:
                self._last_error = error
                return RefreshResult.FAILED
            finally:
                if candidate is not None and not activated:
                    candidate.unlink(missing_ok=True)

    async def run(self, poll_interval_seconds: float, stop_event: asyncio.Event) -> None:
        """Refresh until stopped, with a bounded wait between attempts."""
        if poll_interval_seconds <= 0:
            raise ValueError("poll interval must be positive")
        while not stop_event.is_set():
            await self.refresh()
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
            except TimeoutError:
                pass

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()
