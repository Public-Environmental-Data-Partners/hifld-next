"""Opt-in real ClickHouse/object-storage checks; no dataset writes."""

import asyncio
import json
import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from pyproj import CRS, Transformer
from shapely import Point, box, to_wkb
from shapely.ops import transform

from query_engine.client import ClickHouseClient
from query_engine.executor import ClickHouseExecutor
from query_worker.protocol import (
    WorkerBounds,
    WorkerBoundsQuery,
    WorkerPage,
    WorkerQuery,
    WorkerSeaweedSource,
    WorkerSourceSpec,
    WorkerTile,
    WorkerTileQuery,
)

pytestmark = pytest.mark.skipif(
    not os.getenv("CLICKHOUSE_TEST_URL"), reason="local ClickHouse required"
)
HOSPITALS = "gs://hifld-next-datasets-prod/hospitals-3/hospitals-3/v1.1.0/geoparquet/*.parquet"
FLOOD = "gs://hifld-next-datasets-prod/nfhl/national-flood-hazard-layer-area-nfhl-1-east/v1.0.0/geoparquet/state_fips=12/part-*.parquet"


def executor(*, seaweed_endpoint=None):
    return ClickHouseExecutor(
        ClickHouseClient(
            os.environ["CLICKHOUSE_TEST_URL"],
            "hifld_query",
            os.environ["CLICKHOUSE_TEST_PASSWORD"],
            control_username="hifld_control",
            control_password=os.environ["CLICKHOUSE_TEST_CONTROL_PASSWORD"],
        ),
        seaweed_endpoint=seaweed_endpoint,
    )


def deadline():
    return datetime.now(UTC) + timedelta(seconds=60)


@pytest.mark.asyncio
async def test_concurrency_cap_is_shared_across_clients():
    """Six calls from two independent MCP clients execute at most two at once."""
    engines = [executor(), executor()]
    marker = "admission_" + uuid4().hex
    observed = []
    async with httpx.AsyncClient(
        base_url=os.environ["CLICKHOUSE_TEST_URL"],
        auth=("hifld_control", os.environ["CLICKHOUSE_TEST_CONTROL_PASSWORD"]),
    ) as control:
        tasks = [
            asyncio.create_task(
                engines[i % 2].client.query(
                    f"SELECT sleep(1) AS {marker} FORMAT TSV", timeout_seconds=20
                )
            )
            for i in range(6)
        ]
        try:
            while not all(task.done() for task in tasks):
                response = await control.post(
                    "/",
                    content=f"SELECT count() FROM system.processes WHERE user='hifld_query' "
                    f"AND query LIKE '%{marker}%' FORMAT TSV",
                )
                response.raise_for_status()
                observed.append(int(response.text))
                await asyncio.sleep(0.05)
            assert await asyncio.gather(*tasks) == [b"0\n"] * 6
            assert max(observed) == 2, observed
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for engine in engines:
                await engine.close()


@pytest.mark.asyncio
async def test_two_replicas_route_and_cancel_independently(monkeypatch):
    from query_engine.routing import ReplicaRouter

    peer = os.getenv("CLICKHOUSE_TEST_PEER_URL")
    if not peer:
        pytest.skip("second local ClickHouse required")
    urls = (os.environ["CLICKHOUSE_TEST_URL"], peer)

    async def addresses(self):
        return urls

    monkeypatch.setattr(ReplicaRouter, "addresses", addresses)
    engine = executor()
    marker = "replica_" + uuid4().hex
    tasks = []
    try:
        hosts = await asyncio.gather(
            *(engine.client.query("SELECT hostName() FORMAT TSV", timeout_seconds=5) for _ in urls)
        )
        assert hosts[0] != hosts[1]
        tasks = [
            asyncio.create_task(
                engine.client.query(f"SELECT sleep(3) AS {marker} FORMAT TSV", timeout_seconds=10)
            )
            for _ in urls
        ]
        async with httpx.AsyncClient(
            auth=("hifld_control", os.environ["CLICKHOUSE_TEST_CONTROL_PASSWORD"])
        ) as control:
            counts_sql = (
                "SELECT count() FROM system.processes WHERE user='hifld_query' "
                f"AND query LIKE '%{marker}%' FORMAT TSV"
            )
            async with asyncio.timeout(2):
                while True:
                    counts = [
                        int((await control.post(url, content=counts_sql)).text) for url in urls
                    ]
                    if counts == [1, 1]:
                        break
                    await asyncio.sleep(0.02)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            counts = [int((await control.post(url, content=counts_sql)).text) for url in urls]
            assert counts == [0, 0]
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.close()


def assert_decodable_tile(tile, z, x, y, geometry_type):
    """Decode with the map frontend's actual vector-tile library, including IDs."""
    script = """
        import assert from 'node:assert/strict';
        import {readFileSync} from 'node:fs';
        import {VectorTile} from '@mapbox/vector-tile';
        import {PbfReader} from 'pbf';
        const p = JSON.parse(readFileSync(0, 'utf8'));
        const layer = new VectorTile(new PbfReader(Buffer.from(p.hex, 'hex'))).layers.hifld;
        assert(layer && layer.length > 0);
        for (let i=0; i<layer.length; i++) {
            const feature = layer.feature(i);
            assert(Number.isSafeInteger(feature.id) && feature.id >= 0);
            assert.equal(typeof feature.properties.__hifld_feature_key, 'string');
            const geo = feature.toGeoJSON(p.x,p.y,p.z).geometry;
            assert(geo.type.includes(p.geometry_type));
            assert(geo.coordinates.flat(Infinity).every(Number.isFinite));
        }
        console.log(JSON.stringify({features:layer.length}));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(
            {"hex": tile.content.hex(), "z": z, "x": x, "y": y, "geometry_type": geometry_type}
        ),
        text=True,
        capture_output=True,
        timeout=10,
        cwd=Path(__file__).resolve().parents[3],
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.asyncio
async def test_public_gcs_glob_page_native_and_projected_bounds_and_mvt():
    engine = executor()
    sources = (WorkerSourceSpec("hosp", (HOSPITALS,)),)
    sql = "SELECT NAME, geometry FROM hosp WHERE STATE='NY' AND COUNTYFIPS='36061'"
    try:
        page = await engine.execute(WorkerQuery(sql, sources, 3, 0, deadline()))
        assert isinstance(page, WorkerPage), page
        assert page.returned_count == 3 and page.has_more
        projected = await engine.execute(
            WorkerQuery(sql, sources, 3, 0, deadline(), working_crs="EPSG:3857")
        )
        assert isinstance(projected, WorkerPage), projected
        assert "3857" in projected.columns[1][1]
        bounds = await engine.execute(
            WorkerBoundsQuery(sql, sources, "geometry", "EPSG:3857", deadline())
        )
        assert isinstance(bounds, WorkerBounds) and bounds.bounds is not None, bounds
        assert -75 < bounds.bounds[0] < -73
        tile = await engine.execute(
            WorkerTileQuery(sql, sources, 10, 301, 385, "geometry", "EPSG:3857", 10000, deadline())
        )
        assert isinstance(tile, WorkerTile), tile
        assert len(tile.content) > 100 and b"hifld" in tile.content
        assert_decodable_tile(tile, 10, 301, 385, "Point")
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_nfhl_gcs_glob_polygon_reprojection_and_mvt():
    engine = executor()
    sources = (WorkerSourceSpec("flood", (FLOOD,)),)
    sql = (
        "SELECT FLD_ZONE,SFHA_TF,geometry FROM flood WHERE state_fips='12' "
        "AND bbox.xmin<=-80.30 AND bbox.xmax>=-80.35 AND bbox.ymin<=25.80 AND bbox.ymax>=25.75"
    )
    try:
        result = await engine.execute(
            WorkerQuery(sql, sources, 3, 0, deadline(), working_crs="EPSG:4326")
        )
        assert isinstance(result, WorkerPage) and result.returned_count > 0, result
        tile = await engine.execute(
            WorkerTileQuery(
                sql, sources, 12, 1134, 1744, "geometry", "EPSG:4326", 10000, deadline()
            )
        )
        assert isinstance(tile, WorkerTile), tile
        assert_decodable_tile(tile, 12, 1134, 1744, "Polygon")
    finally:
        await engine.close()


@pytest.mark.asyncio
async def test_miami_tile_preserves_parquet_row_group_pruning():
    """Opt-in production-file regression for the projection/pushdown interaction."""
    from query_engine.results import ClickHouseResult
    from query_engine.tiles import mvt_sql

    engine = executor()
    source = WorkerSourceSpec("f", (FLOOD.replace("state_fips=12/part-*", "**/*"),))
    sql = (
        "SELECT geometry,FLD_ZONE,SFHA_TF FROM f WHERE state_fips='12' "
        "AND bbox.xmin<=-80.10 AND bbox.xmax>=-80.35 "
        "AND bbox.ymin<=25.90 AND bbox.ymax>=25.65"
    )
    request = WorkerTileQuery(
        sql, (source,), 10, 283, 436, "geometry", "EPSG:4326", 20000, deadline()
    )
    marker = "pruning_" + uuid4().hex
    task = None
    read_groups = 0
    pruned_groups = 0
    try:
        compiled, _ = await engine.compiled(sql, request, "EPSG:4326")
        schema = await engine.describe(compiled, 30)
        tile_sql = mvt_sql(compiled, schema.meta, "geometry", "EPSG:4326", 10, 283, 436, 20000)
        task = asyncio.create_task(
            engine.client.query(f"/*{marker}*/ {tile_sql}", timeout_seconds=60)
        )
        async with httpx.AsyncClient(
            base_url=os.environ["CLICKHOUSE_TEST_URL"],
            auth=("hifld_control", os.environ["CLICKHOUSE_TEST_CONTROL_PASSWORD"]),
            timeout=5,
        ) as control:
            while not task.done():
                response = await control.post(
                    "/",
                    content=(
                        "SELECT ProfileEvents['ParquetReadRowGroups'], "
                        "ProfileEvents['ParquetPrunedRowGroups'] FROM system.processes "
                        f"WHERE user='hifld_query' AND position(query,'{marker}')>0 "
                        "FORMAT JSONCompact"
                    ),
                )
                response.raise_for_status()
                for read, pruned in response.json()["data"]:
                    read_groups = max(read_groups, int(read))
                    pruned_groups = max(pruned_groups, int(pruned))
                await asyncio.sleep(0.03)
        result = ClickHouseResult.model_validate_json(await task)
        assert result.data[0][0] == 729
        assert 0 < read_groups <= 4, (read_groups, pruned_groups)
        assert pruned_groups >= 47, (read_groups, pruned_groups)
    finally:
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await engine.close()


@pytest.mark.asyncio
async def test_cancel_removes_running_server_query():
    engine = executor()
    marker = "cancel_probe_" + uuid4().hex
    task = asyncio.create_task(
        engine.client.query(f"SELECT sleep(3) AS {marker}", timeout_seconds=30)
    )
    async with httpx.AsyncClient(
        base_url=os.environ["CLICKHOUSE_TEST_URL"],
        auth=("hifld_control", os.environ["CLICKHOUSE_TEST_CONTROL_PASSWORD"]),
        trust_env=False,
    ) as control:

        async def active():
            response = await control.post(
                "/",
                content=(
                    "SELECT count() FROM system.processes WHERE user='hifld_query' "
                    f"AND position(query, '{marker}')>0 FORMAT TSV"
                ),
            )
            response.raise_for_status()
            return int(response.text.strip())

        try:
            async with asyncio.timeout(2):
                while not await active():
                    await asyncio.sleep(0.025)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert await active() == 0
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await engine.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not os.getenv("SEAWEED_TEST_URL"), reason="local SeaweedFS required")
async def test_seaweed_mixed_crs_join_and_concurrent_alias_isolation():
    bucket = "clickhouse-test-" + uuid4().hex
    endpoint = os.environ["SEAWEED_TEST_URL"].rstrip("/")
    engine = executor(seaweed_endpoint=os.environ["CLICKHOUSE_TEST_SEAWEED_URL"])
    storage = WorkerSeaweedSource(bucket, endpoint.removeprefix("http://"))
    uris = []
    async with httpx.AsyncClient(trust_env=False) as client:
        (await client.put(f"{endpoint}/{bucket}")).raise_for_status()
        try:
            projection = Transformer.from_crs(4326, 3857, always_xy=True)
            fixtures = [
                ("hosp", Point(-80.2, 25.8), 4326),
                ("flood", transform(projection.transform, box(-80.3, 25.7, -80.1, 25.9)), 3857),
            ]
            sources = []
            for name, geometry, epsg in fixtures:
                geo = {
                    "version": "1.1.0",
                    "primary_column": "geometry",
                    "columns": {
                        "geometry": {
                            "encoding": "WKB",
                            "geometry_types": [geometry.geom_type],
                            "crs": CRS.from_epsg(epsg).to_json_dict(),
                        }
                    },
                }
                table = pa.table({"name": [name, "null"], "geometry": [to_wkb(geometry), None]})
                table = table.replace_schema_metadata({b"geo": json.dumps(geo).encode()})
                output = pa.BufferOutputStream()
                pq.write_table(table, output)
                uri = f"{endpoint}/{bucket}/{name}/part-0.parquet"
                uris.append(uri)
                (await client.put(uri, content=output.getvalue().to_pybytes())).raise_for_status()
                sources.append(
                    WorkerSourceSpec(name, (f"s3://{bucket}/{name}/*.parquet",), storage)
                )
            for crs in ("EPSG:4326", "EPSG:3857"):
                null_result = await engine.execute(
                    WorkerQuery(
                        "SELECT geometry FROM hosp WHERE name='null'",
                        tuple(sources[:1]),
                        1,
                        0,
                        deadline(),
                        working_crs=crs,
                    )
                )
                assert isinstance(null_result, WorkerPage), null_result
                assert null_result.rows == ({"geometry": None},)
                result = await engine.execute(
                    WorkerQuery(
                        "SELECT h.name AS hospital, f.name AS flood FROM hosp h "
                        "JOIN flood f ON ST_Intersects(h.geometry, f.geometry)",
                        tuple(sources),
                        5,
                        0,
                        deadline(),
                        working_crs=crs,
                    )
                )
                assert isinstance(result, WorkerPage), result
                assert result.rows == ({"hospital": "hosp", "flood": "flood"},)
            results = await asyncio.gather(
                *(
                    engine.execute(
                        WorkerQuery(
                            "SELECT name FROM same_alias",
                            (WorkerSourceSpec("same_alias", source.object_uris, storage),),
                            1,
                            0,
                            deadline(),
                        )
                    )
                    for source in sources
                )
            )
            assert all(isinstance(result, WorkerPage) for result in results), results
            assert [result.rows for result in results if isinstance(result, WorkerPage)] == [
                ({"name": "hosp"},),
                ({"name": "flood"},),
            ]
        finally:
            await engine.close()
            for uri in uris:
                (await client.delete(uri)).raise_for_status()
            (await client.delete(f"{endpoint}/{bucket}")).raise_for_status()
