import json
from collections.abc import Callable

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from query_engine.client import ClickHouseClient, ClickHouseError
from query_engine.metadata import MetadataReader
from query_worker.protocol import WorkerSourceSpec


@pytest.mark.asyncio
async def test_source_schema_is_cached_and_never_reads_preview_rows():
    queries = []

    def handler(request):
        queries.append(request.content.decode())
        return httpx.Response(
            200,
            json={
                "meta": [{"name": "geometry", "type": "MultiPolygon"}],
                "data": [],
                "rows": 0,
                "statistics": {"elapsed": 0.01, "rows_read": 0, "bytes_read": 0},
            },
        )

    client = ClickHouseClient("http://engine", "u", "p", transport=httpx.MockTransport(handler))
    reader = MetadataReader(client)
    source = WorkerSourceSpec("f", ("gs://b/data/**/*.parquet",))
    try:
        first = await reader.schema(source)
        assert await reader.schema(source) == first
        assert first[0].name == "geometry"
        assert len(queries) == 1
        assert "LIMIT 0" in queries[0]
    finally:
        await reader.close()
        await client.close()


def _parquet(geo: dict[str, object]) -> bytes:
    sink = pa.BufferOutputStream()
    schema = pa.schema([("geometry", pa.binary())], metadata={b"geo": json.dumps(geo).encode()})
    pq.write_table(pa.Table.from_arrays([pa.array([b"point"])], schema=schema), sink)
    return sink.getvalue().to_pybytes()


def _range_handler(
    objects: dict[str, bytes], requests: list[httpx.Request]
) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        data = objects[str(request.url)]
        byte_range = request.headers["range"]
        assert byte_range.startswith("bytes=-")
        return httpx.Response(206, content=data[-int(byte_range.removeprefix("bytes=-")) :])

    return handler


def test_geoparquet_omitted_crs_is_crs84_but_explicit_null_is_unknown():
    from query_engine.metadata import parse_geo

    fields = parse_geo(
        json.dumps(
            {
                "columns": {
                    "shape": {"encoding": "WKB"},
                    "unknown": {"encoding": "WKB", "crs": None},
                }
            }
        )
    )
    assert fields[0].crs == "OGC:CRS84"
    assert fields[1].crs is None


def test_metadata_reads_authority_and_covering_paths():
    from query_engine.metadata import parse_geo

    fields = parse_geo(
        json.dumps(
            {
                "columns": {
                    "shape": {
                        "encoding": "WKB",
                        "crs": {"id": {"authority": "EPSG", "code": 3857}},
                        "covering": {
                            "bbox": {k: ["bounds", k] for k in ("xmin", "ymin", "xmax", "ymax")}
                        },
                    }
                }
            }
        )
    )
    assert fields[0].name == "shape"
    assert fields[0].crs == "EPSG:3857"
    assert fields[0].covering is not None
    assert fields[0].covering.xmin == ("bounds", "xmin")


def test_metadata_rejects_non_wkb_geometry_encoding():
    from query_engine.client import ClickHouseError
    from query_engine.metadata import parse_geo

    with pytest.raises(ClickHouseError):
        parse_geo('{"columns":{"geometry":{"encoding":"point"}}}')


@pytest.mark.asyncio
async def test_glob_discovers_and_reads_one_representative_footer():
    queries: list[str] = []

    def clickhouse_handler(request: httpx.Request) -> httpx.Response:
        queries.append(request.content.decode())
        return httpx.Response(
            200,
            json={
                "meta": [{"name": "_path", "type": "String"}],
                "data": [["bucket/data/first.parquet"]],
                "rows": 1,
                "statistics": {"elapsed": 0.01, "rows_read": 1, "bytes_read": 1},
            },
        )

    geo: dict[str, object] = {
        "columns": {
            "geometry": {
                "encoding": "WKB",
                "crs": {"id": {"authority": "EPSG", "code": 4326}},
                "covering": {
                    "bbox": {key: ["bbox", key] for key in ("xmin", "ymin", "xmax", "ymax")}
                },
            }
        }
    }
    footer_requests: list[httpx.Request] = []
    client = ClickHouseClient(
        "http://clickhouse.test",
        "reader",
        "secret",
        transport=httpx.MockTransport(clickhouse_handler),
    )
    reader = MetadataReader(client)
    await reader._http.aclose()
    reader._http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            _range_handler(
                {"https://storage.googleapis.com/bucket/data/first.parquet": _parquet(geo)},
                footer_requests,
            )
        )
    )
    source = WorkerSourceSpec("data", ("gs://bucket/data/*.parquet",))

    try:
        metadata = await reader.resolve(source)
        cached = await reader.resolve(source)
    finally:
        await reader.close()
        await client.close()

    assert metadata == cached
    assert metadata[0].crs == "EPSG:4326"
    assert metadata[0].covering is not None
    assert len(queries) == 1
    assert "ParquetMetadata" in queries[0]
    assert "LIMIT 1 FORMAT JSONCompact" in queries[0]
    assert len(footer_requests) == 2
    assert source.object_uris == ("gs://bucket/data/*.parquet",)


@pytest.mark.asyncio
async def test_explicit_urls_read_only_the_first_footer():
    geo: dict[str, object] = {"columns": {"geometry": {"encoding": "WKB"}}}
    footer_requests: list[httpx.Request] = []
    client = ClickHouseClient(
        "http://clickhouse.test",
        "reader",
        "secret",
        transport=httpx.MockTransport(lambda _request: httpx.Response(500)),
    )
    reader = MetadataReader(client)
    await reader._http.aclose()
    reader._http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            _range_handler(
                {"https://storage.googleapis.com/bucket/first.parquet": _parquet(geo)},
                footer_requests,
            )
        )
    )

    try:
        metadata = await reader.resolve(
            WorkerSourceSpec("data", ("gs://bucket/first.parquet", "gs://bucket/unread.parquet"))
        )
    finally:
        await reader.close()
        await client.close()

    assert metadata[0].crs == "OGC:CRS84"
    assert len(footer_requests) == 2


@pytest.mark.asyncio
async def test_discovered_object_must_remain_within_source_scope():
    def clickhouse_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "meta": [{"name": "_path", "type": "String"}],
                "data": [["other/private.parquet"]],
                "rows": 1,
                "statistics": {"elapsed": 0.01, "rows_read": 1, "bytes_read": 1},
            },
        )

    client = ClickHouseClient(
        "http://clickhouse.test",
        "reader",
        "secret",
        transport=httpx.MockTransport(clickhouse_handler),
    )
    reader = MetadataReader(client)
    try:
        with pytest.raises(ClickHouseError, match="outside source scope"):
            await reader.resolve(WorkerSourceSpec("data", ("gs://bucket/data/*.parquet",)))
    finally:
        await reader.close()
        await client.close()


@pytest.mark.asyncio
async def test_empty_source_fails_without_footer_request():
    client = ClickHouseClient(
        "http://clickhouse.test",
        "reader",
        "secret",
        transport=httpx.MockTransport(lambda _request: httpx.Response(500)),
    )
    reader = MetadataReader(client)
    try:
        with pytest.raises(ClickHouseError, match="no objects"):
            await reader.resolve(WorkerSourceSpec("data", ()))
    finally:
        await reader.close()
        await client.close()
