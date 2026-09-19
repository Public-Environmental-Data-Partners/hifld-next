from __future__ import annotations

import asyncio
import hashlib
import sqlite3
from pathlib import Path

import httpx

from app.catalog.fetcher import CatalogFetcher, RefreshResult


def _catalog(path: Path, generation: str = "generation-1") -> bytes:
    connection = sqlite3.connect(path)
    connection.executescript(
        f"""
        PRAGMA application_id=1212761676;
        PRAGMA user_version=1;
        CREATE TABLE catalog_metadata (
            singleton INTEGER,
            schema_version INTEGER,
            catalog_generation TEXT
        );
        INSERT INTO catalog_metadata VALUES (1, 1, '{generation}');
        """
    )
    connection.close()
    return path.read_bytes()


def _response(content: bytes, etag: str = '"revision-1"', checksum: str | None = None):
    return httpx.Response(
        200,
        content=content,
        headers={
            "etag": etag,
            "x-amz-meta-sha256": checksum or hashlib.sha256(content).hexdigest(),
            "content-length": str(len(content)),
        },
    )


def test_304_reports_unchanged_after_successful_activation(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.headers.get("if-none-match") == '"revision-1"':
            return httpx.Response(304)
        return _response(content)

    activated: list[Path] = []
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.ACTIVATED
        assert await fetcher.refresh() is RefreshResult.UNCHANGED
        await client.aclose()

    asyncio.run(exercise())
    assert len(activated) == 1
    assert activated[0].exists()
    assert requests[0].headers.get("if-none-match") is None
    assert requests[1].headers["if-none-match"] == '"revision-1"'


def test_invalid_checksum_keeps_candidate_inactive_and_cleans_it(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: _response(content, checksum="0" * 64))
    )
    activated: list[Path] = []
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.FAILED
        await client.aclose()

    asyncio.run(exercise())
    assert activated == []
    assert list(tmp_path.glob("catalog-candidate-*.sqlite")) == []


def test_failed_candidate_with_unchanged_etag_is_retried(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")
    request_headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_headers.append(request.headers.get("if-none-match"))
        return _response(content)

    attempts = 0

    def activate(path: Path) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("candidate build failed")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activate, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.FAILED
        assert await fetcher.refresh() is RefreshResult.ACTIVATED
        await client.aclose()

    asyncio.run(exercise())
    assert attempts == 2
    assert request_headers == [None, None]


def test_concurrent_refreshes_activate_one_copy(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")
    requests = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        if request.headers.get("if-none-match") == '"revision-1"':
            return httpx.Response(304)
        return _response(content)

    activated: list[Path] = []
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> list[RefreshResult]:
        results = await asyncio.gather(fetcher.refresh(), fetcher.refresh())
        await client.aclose()
        return results

    assert asyncio.run(exercise()) == [RefreshResult.ACTIVATED, RefreshResult.UNCHANGED]
    assert requests == 2
    assert len(activated) == 1


def test_google_checksum_header_is_accepted(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=content,
            headers={
                "etag": '"revision-1"',
                "x-goog-meta-sha256": hashlib.sha256(content).hexdigest(),
                "content-length": str(len(content)),
            },
        )

    activated: list[Path] = []
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.ACTIVATED
        await client.aclose()

    asyncio.run(exercise())
    assert len(activated) == 1


def test_changed_etag_cannot_reuse_active_generation(tmp_path: Path) -> None:
    content = _catalog(tmp_path / "source.sqlite")
    etags = iter(['"revision-1"', '"revision-2"'])
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: _response(content, next(etags)))
    )
    activated: list[Path] = []
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.ACTIVATED
        assert await fetcher.refresh() is RefreshResult.FAILED
        await client.aclose()

    asyncio.run(exercise())
    assert len(activated) == 1
    assert list(tmp_path.glob("catalog-candidate-*.sqlite")) == activated


def test_invalid_sqlite_never_reaches_activation(tmp_path: Path) -> None:
    content = b"not a SQLite database"
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: _response(content)))
    activated: list[Path] = []
    fetcher = CatalogFetcher(
        "https://catalog.test/catalog.sqlite", tmp_path, activated.append, client=client
    )

    async def exercise() -> None:
        assert await fetcher.refresh() is RefreshResult.FAILED
        await client.aclose()

    asyncio.run(exercise())
    assert activated == []
    assert list(tmp_path.glob("catalog-candidate-*.sqlite")) == []
