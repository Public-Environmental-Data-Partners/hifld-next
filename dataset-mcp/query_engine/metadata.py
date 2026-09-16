"""Read bounded GeoParquet footers; leave object discovery to ClickHouse."""

import asyncio
import fnmatch
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from urllib.parse import urlsplit

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import BaseModel, Field, ValidationError

from query_engine.client import ClickHouseClient, ClickHouseError
from query_engine.results import ClickHouseResult, ResultColumn
from query_engine.sql import GeometrySpec, source_relation, source_url
from query_worker.protocol import WorkerSourceSpec


class Covering(BaseModel):
    xmin: tuple[str, ...]
    ymin: tuple[str, ...]
    xmax: tuple[str, ...]
    ymax: tuple[str, ...]


class _Covering(BaseModel):
    bbox: Covering


class _Authority(BaseModel):
    authority: str
    code: str | int


class _Crs(BaseModel):
    id: _Authority | None = None


class _Column(BaseModel):
    encoding: str
    crs: _Crs | None = Field(
        default_factory=lambda: _Crs(id=_Authority(authority="OGC", code="CRS84"))
    )
    covering: _Covering | None = None


class _Geo(BaseModel):
    columns: dict[str, _Column]


@dataclass(frozen=True)
class GeometryMetadata(GeometrySpec):
    covering: Covering | None = None


def parse_geo(value: str | bytes) -> tuple[GeometryMetadata, ...]:
    try:
        geo = _Geo.model_validate_json(value)
    except ValidationError as error:
        raise ClickHouseError(
            "map_not_supported", "Invalid GeoParquet geometry metadata"
        ) from error
    result: list[GeometryMetadata] = []
    for name, field in geo.columns.items():
        if field.encoding != "WKB":
            raise ClickHouseError(
                "map_not_supported", "Only WKB GeoParquet geometry encoding is supported"
            )
        crs = field.crs.id if field.crs else None
        result.append(
            GeometryMetadata(
                name,
                f"{crs.authority.upper()}:{crs.code}" if crs else None,
                field.covering.bbox if field.covering else None,
            )
        )
    return tuple(result)


class MetadataReader:
    def __init__(self, client: ClickHouseClient, *, seaweed_endpoint: str | None = None) -> None:
        self._client = client
        self._seaweed_endpoint = seaweed_endpoint
        self._http = httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False)
        self._cache: OrderedDict[WorkerSourceSpec, tuple[float, tuple[GeometryMetadata, ...]]] = (
            OrderedDict()
        )
        self._semaphore = asyncio.Semaphore(4)
        self._schemas: OrderedDict[WorkerSourceSpec, tuple[float, tuple[ResultColumn, ...]]] = (
            OrderedDict()
        )

    async def schema(self, source: WorkerSourceSpec) -> tuple[ResultColumn, ...]:
        cached = self._schemas.get(source)
        if cached is not None and cached[0] > monotonic():
            self._schemas.move_to_end(source)
            return cached[1]
        relation = source_relation(source, seaweed_endpoint=self._seaweed_endpoint)
        response = ClickHouseResult.model_validate_json(
            await self._client.query(
                f"SELECT * FROM ({relation}) LIMIT 0 FORMAT JSONCompact",
                timeout_seconds=30,
            )
        )
        columns = tuple(response.meta)
        self._schemas[source] = (monotonic() + 60, columns)
        self._schemas.move_to_end(source)
        while len(self._schemas) > 32:
            self._schemas.popitem(last=False)
        return columns

    async def close(self) -> None:
        await self._http.aclose()

    async def resolve(self, source: WorkerSourceSpec) -> tuple[GeometryMetadata, ...]:
        cached = self._cache.get(source)
        if cached is not None and cached[0] > monotonic():
            self._cache.move_to_end(source)
            return cached[1]
        # The metadata reader runs beside MCP, not inside the ClickHouse pod.
        # Its local endpoint can differ from ClickHouse's Compose-network endpoint.
        urls = [source_url(source, uri) for uri in source.object_uris]
        if not urls:
            raise ClickHouseError("storage_unavailable", "Catalog source has no objects")
        if any(any(c in url for c in "*?{") for url in urls):
            relation = source_relation(
                source, seaweed_endpoint=self._seaweed_endpoint, format_name="ParquetMetadata"
            )
            response = ClickHouseResult.model_validate_json(
                await self._client.query(
                    f"SELECT _path FROM ({relation}) LIMIT 1 FORMAT JSONCompact",
                    timeout_seconds=30,
                )
            )
            discovered: list[str] = []
            for row in response.data:
                if not row or not isinstance(row[0], str):
                    raise ClickHouseError(
                        "storage_unavailable", "Invalid object discovery response"
                    )
                path = row[0]
                candidates = [
                    urlsplit(url)._replace(path="/" + path.lstrip("/")).geturl() for url in urls
                ]
                matched = next(
                    (
                        candidate
                        for candidate in candidates
                        if any(fnmatch.fnmatchcase(candidate, pattern) for pattern in urls)
                    ),
                    None,
                )
                if matched is None:
                    raise ClickHouseError(
                        "storage_unavailable", "Discovered object is outside source scope"
                    )
                discovered.append(matched)
            urls = discovered
        if not urls:
            raise ClickHouseError("storage_unavailable", "Catalog source has no objects")
        first = await self._footer(urls[0])
        self._cache[source] = (monotonic() + 60, first)
        self._cache.move_to_end(source)
        while len(self._cache) > 32:
            self._cache.popitem(last=False)
        return first

    async def _range(self, url: str, byte_range: str, maximum: int) -> bytes:
        async with self._http.stream(
            "GET", url, headers={"Range": byte_range, "Accept-Encoding": "identity"}
        ) as response:
            if response.status_code != 206:
                raise ClickHouseError(
                    "storage_unavailable", "Object storage must support bounded range reads"
                )
            data = bytearray()
            async for chunk in response.aiter_bytes():
                if len(data) + len(chunk) > maximum:
                    raise ClickHouseError(
                        "storage_unavailable", "Parquet metadata exceeds the read limit"
                    )
                data.extend(chunk)
            return bytes(data)

    async def _footer(self, url: str) -> tuple[GeometryMetadata, ...]:
        async with self._semaphore:
            tail = await self._range(url, "bytes=-8", 8)
            if len(tail) != 8 or tail[4:] != b"PAR1":
                raise ClickHouseError("storage_unavailable", "Invalid Parquet footer")
            length = int.from_bytes(tail[:4], "little")
            if not 0 < length <= 16 * 1024 * 1024:
                raise ClickHouseError("storage_unavailable", "Parquet footer exceeds 16 MiB limit")
            footer = await self._range(url, f"bytes=-{length + 8}", length + 8)
            if len(footer) != length + 8 or footer[-8:] != tail:
                raise ClickHouseError("storage_unavailable", "Parquet changed during metadata read")
            metadata = pq.ParquetFile(pa.BufferReader(b"PAR1" + footer)).metadata.metadata
            value = metadata.get(b"geo") if metadata else None
            return parse_geo(value) if value is not None else ()
