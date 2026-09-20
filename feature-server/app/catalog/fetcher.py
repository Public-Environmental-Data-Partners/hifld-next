"""Conditional, failure-safe refresh of the published SQLite catalog."""

from __future__ import annotations

import asyncio
import hashlib
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import httpx
from pydantic import TypeAdapter, ValidationError

from app.catalog.repository import CatalogRepository


class RefreshResult(Enum):
    ACTIVATED = "activated"
    UNCHANGED = "unchanged"
    FAILED = "failed"


@dataclass(frozen=True)
class _ReleasePointer:
    generation: str
    catalog_key: str
    sha256: str
    size_bytes: int


_json_object: TypeAdapter[dict[str, object]] = TypeAdapter(dict[str, object])


class CatalogFetcher:
    """Fetch one configured catalog URL and activate only validated candidates."""

    def __init__(
        self,
        url: str,
        temp_directory: Path,
        activate: Callable[[Path], None],
        *,
        client: httpx.AsyncClient | None = None,
        pointer_url: str | None = None,
    ) -> None:
        self._url = url
        self._pointer_url = pointer_url
        self._catalog_url = url
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

    @property
    def catalog_url(self) -> str:
        return self._catalog_url

    async def refresh(self) -> RefreshResult:
        """Attempt one refresh without disturbing the last good activation."""
        async with self._refresh_lock:
            headers = {"Accept-Encoding": "identity"}
            if self._active_etag is not None:
                headers["If-None-Match"] = self._active_etag

            candidate: Path | None = None
            activated = False
            try:
                pointer: _ReleasePointer | None = None
                catalog_url = self._url
                if self._pointer_url is not None:
                    pointer_response = await self._client.get(self._pointer_url, headers=headers)
                    if pointer_response.status_code == 304 and self._active_etag is not None:
                        self._last_error = None
                        return RefreshResult.UNCHANGED
                    pointer_response.raise_for_status()
                    pointer = _parse_release_pointer(pointer_response.content)
                    catalog_url = _pointer_catalog_url(self._pointer_url, pointer)
                    response = await self._client.get(
                        catalog_url, headers={"Accept-Encoding": "identity"}
                    )
                    etag = pointer_response.headers.get("etag") or pointer.generation
                    expected_checksum = pointer.sha256
                    expected_length = str(pointer.size_bytes)
                else:
                    response = await self._client.get(self._url, headers=headers)
                    etag = response.headers.get("etag")
                    expected_checksum = response.headers.get(
                        "x-amz-meta-sha256"
                    ) or response.headers.get("x-goog-meta-sha256")
                    expected_length = response.headers.get("content-length")
                if response.status_code == 304 and self._active_etag is not None:
                    self._last_error = None
                    return RefreshResult.UNCHANGED
                response.raise_for_status()

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
                if pointer is not None and repository.generation != pointer.generation:
                    raise ValueError("catalog generation does not match release pointer")
                if (
                    self._active_generation is not None
                    and repository.generation == self._active_generation
                    and etag != self._active_etag
                ):
                    raise ValueError("catalog revision reused the active generation")

                previous_catalog_url = self._catalog_url
                self._catalog_url = catalog_url
                try:
                    await asyncio.to_thread(self._activate, candidate)
                except BaseException:
                    self._catalog_url = previous_catalog_url
                    raise
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


def _parse_release_pointer(value: bytes) -> _ReleasePointer:
    try:
        decoded = _json_object.validate_json(value, strict=True)
    except ValidationError as error:
        raise ValueError("release pointer is not valid JSON") from error
    if decoded.get("protocol_version") != 1:
        raise ValueError("release pointer has an unsupported protocol")
    generation = decoded.get("generation")
    catalog_key = decoded.get("catalog_key")
    sha256 = decoded.get("sha256")
    size_bytes = decoded.get("size_bytes")
    if not (
        isinstance(generation, str)
        and isinstance(catalog_key, str)
        and isinstance(sha256, str)
        and isinstance(size_bytes, int)
    ):
        raise ValueError("release pointer fields are invalid")
    UUID(generation)
    release_prefix = f"releases/{generation}/"
    if catalog_key != f"{release_prefix}_catalog/catalog.sqlite":
        raise ValueError("release pointer catalog escapes selected release")
    if (
        len(sha256) != 64
        or any(character not in "0123456789abcdef" for character in sha256)
        or size_bytes <= 0
    ):
        raise ValueError("release pointer checksum or size is invalid")
    return _ReleasePointer(generation, catalog_key, sha256, size_bytes)


def _pointer_catalog_url(pointer_url: str, pointer: _ReleasePointer) -> str:
    parsed = urlsplit(pointer_url)
    suffix = "/_catalog/current.json"
    if not parsed.path.endswith(suffix):
        raise ValueError("release pointer URL must end with /_catalog/current.json")
    root = parsed.path[: -len(suffix) + 1]
    return urlunsplit((parsed.scheme, parsed.netloc, f"{root}{pointer.catalog_key}", "", ""))
