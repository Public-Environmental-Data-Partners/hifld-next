import json
from datetime import UTC, datetime, timedelta

import duckdb
import pytest

from query_worker.protocol import WorkerTileQuery
from query_worker.tiles import build_tile_sql


def test_inline_tile_bounds_reach_parquet_reader(tmp_path):
    c = duckdb.connect()
    c.execute("LOAD spatial")
    path = str(tmp_path / "points.parquet")
    c.execute(
        "COPY (SELECT i, ST_Point(x, 25.8) geometry, "
        "struct_pack(xmin:=x,xmax:=x,ymin:=25.8,ymax:=25.8) bbox "
        "FROM (SELECT i, -179.0+i*358.0/50000 x FROM range(50000) t(i))) "
        "TO ? (FORMAT PARQUET, ROW_GROUP_SIZE 2048)",
        [path],
    )
    c.read_parquet(path).create_view("points")
    request = WorkerTileQuery(
        "SELECT * FROM points",
        (),
        12,
        1134,
        1743,
        "geometry",
        "EPSG:4326",
        20000,
        datetime.now(UTC) + timedelta(seconds=30),
    )
    columns = tuple((r[0], r[1]) for r in c.execute("DESCRIBE points").fetchall())
    sql = build_tile_sql(request.canonical_sql, request, columns=columns, bbox_column="bbox")
    plan = json.loads(c.execute("EXPLAIN (FORMAT JSON) " + sql).fetchone()[1])

    def scans(nodes):
        for node in nodes:
            if "PARQUET" in node["name"]:
                yield node["extra_info"]
            yield from scans(node.get("children", []))

    scan = next(scans(plan))
    assert "bbox.xmax" in scan.get("Filters", "")
    assert c.execute(sql).fetchone()[1] > 0
    from query_worker.covering import GeometryCovering
    from query_worker.tiles import retain_declared_covering

    covering = GeometryCovering(
        crs="EPSG:4326",
        xmin=("bbox", "xmin"),
        xmax=("bbox", "xmax"),
        ymin=("bbox", "ymin"),
        ymax=("bbox", "ymax"),
    )
    retained, bbox_column = retain_declared_covering(
        c, "SELECT i, geometry FROM points", "geometry", "EPSG:4326", {"points": covering}
    )
    retained_columns = tuple((r[0], r[1]) for r in c.execute("DESCRIBE " + retained).fetchall())
    retained_sql = build_tile_sql(
        retained, request, columns=retained_columns, bbox_column=bbox_column
    )
    retained_plan = json.loads(c.execute("EXPLAIN (FORMAT JSON) " + retained_sql).fetchone()[1])
    assert "bbox.xmax" in next(scans(retained_plan)).get("Filters", "")
    c.close()


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT IF(id > 1, 'T', 'F') AS flag FROM roads",
        "SELECT CASE WHEN id > 1 THEN 'T' ELSE 'F' END AS flag FROM roads",
        "SELECT BOOL_OR(id > 1) AS flag FROM roads",
    ],
)
def test_conditional_sql_can_be_validated_after_normalization(sql):
    from app.query.sql_policy import SqlPolicy

    validated = SqlPolicy.validate(sql, frozenset({"roads"}))
    again = SqlPolicy.validate(validated.canonical_sql, frozenset({"roads"}))
    assert again.canonical_sql == validated.canonical_sql


def test_covering_uses_declared_paths_not_bbox_convention():
    from query_worker.covering import parse_covering

    value = json.dumps(
        {
            "columns": {
                "geometry": {
                    "crs": {"id": {"authority": "EPSG", "code": 4269}},
                    "covering": {
                        "bbox": {
                            name: ["envelope", name] for name in ("xmin", "xmax", "ymin", "ymax")
                        }
                    },
                }
            }
        }
    )
    covering = parse_covering(value, "geometry")
    assert covering is not None
    assert covering.xmin == ("envelope", "xmin")
    assert covering.crs == "EPSG:4269"
    assert parse_covering(value, "other_geometry") is None
    assert parse_covering('{"columns":{"geometry":{"crs":null}}}', "geometry") is None


def test_declared_covering_is_carried_only_for_unchanged_geometry():
    from query_worker.covering import parse_covering
    from query_worker.tiles import execute_tile

    c = duckdb.connect()
    c.execute("LOAD spatial")
    c.execute(
        "CREATE TABLE points AS SELECT ST_Point(-80.3,25.83) geometry, "
        "struct_pack(xmin:=-80.3,xmax:=-80.3,ymin:=25.83,ymax:=25.83) envelope"
    )
    covering = parse_covering(
        json.dumps(
            {
                "columns": {
                    "geometry": {
                        "covering": {
                            "bbox": {
                                name: ["envelope", name]
                                for name in ("xmin", "xmax", "ymin", "ymax")
                            }
                        }
                    }
                }
            }
        ),
        "geometry",
    )
    req = WorkerTileQuery(
        "SELECT geometry FROM points",
        (),
        12,
        1134,
        1743,
        "geometry",
        "EPSG:4326",
        20000,
        datetime.now(UTC) + timedelta(seconds=30),
    )
    result = execute_tile(c, req.canonical_sql, req, source_coverings={"points": covering})
    from query_worker.protocol import WorkerTile

    assert isinstance(result, WorkerTile)
    assert result.content
    from query_worker.tiles import retain_declared_covering

    rewritten, field = retain_declared_covering(
        c, req.canonical_sql, "geometry", "EPSG:4326", {"points": covering}
    )
    assert field == "__hifld_covering"
    assert '"envelope"."xmin"' in rewritten
    for sql in [
        "SELECT ST_Buffer(geometry,1) AS geometry FROM points",
        "SELECT ST_Buffer(geometry,1) AS geometry, geometry FROM points",
        "SELECT ST_Buffer(geometry,1) AS geometry, * FROM points",
        "SELECT p.* REPLACE(ST_Buffer(geometry,1) AS geometry), geometry FROM points p",
        "SELECT * REPLACE(ST_Buffer(geometry,1) AS geometry) FROM points",
        "SELECT geometry FROM points LIMIT 1",
        "SELECT p.geometry FROM points p JOIN points q ON true",
        "WITH p AS (SELECT * FROM points) SELECT geometry FROM p",
    ]:
        assert retain_declared_covering(c, sql, "geometry", "EPSG:4326", {"points": covering}) == (
            sql,
            None,
        )
    assert retain_declared_covering(
        c, req.canonical_sql, "geometry", "EPSG:3857", {"points": covering}
    ) == (req.canonical_sql, None)
    c.close()


def test_metadata_cache_requires_consistent_covering_on_every_file(tmp_path):
    from query_worker.covering import CoveringMetadataCache

    c = duckdb.connect()

    def write(name, field):
        path = str(tmp_path / name)
        geo = json.dumps(
            {
                "version": "1.1.0",
                "primary_column": "geometry",
                "columns": {
                    "geometry": {
                        "encoding": "WKB",
                        "geometry_types": [],
                        "covering": {
                            "bbox": {n: [field, n] for n in ("xmin", "xmax", "ymin", "ymax")}
                        },
                    }
                },
            }
        )
        c.execute(
            "COPY (SELECT 1 id) TO '"
            + path
            + "' (FORMAT PARQUET, KV_METADATA {geo: '"
            + geo
            + "'})"
        )
        return path

    a, b = write("a.parquet", "envelope"), write("b.parquet", "bbox")
    write("a2.parquet", "envelope")
    cache = CoveringMetadataCache()
    assert cache.resolve(c, (a,), "geometry").xmin == ("envelope", "xmin")
    assert cache.resolve(c, (str(tmp_path / "a*.parquet"),), "geometry").xmin == (
        "envelope",
        "xmin",
    )
    assert cache.resolve(c, (a, b), "geometry") is None
    assert cache.resolve(c, (str(tmp_path / "*.parquet"),), "geometry") is None
    assert cache.resolve(c, (a,), "missing") is None
    from query_worker.protocol import WorkerSeaweedSource

    before = len(cache._entries)
    cache.resolve(c, (a,), "geometry", storage=WorkerSeaweedSource("bucket", "localhost:8333"))
    cache.resolve(c, (a,), "geometry", storage=WorkerSeaweedSource("bucket", "localhost:8334"))
    assert len(cache._entries) == before + 2
    c.execute("COPY (SELECT 1 id) TO ? (FORMAT PARQUET)", [str(tmp_path / "absent.parquet")])
    assert CoveringMetadataCache().resolve(c, (str(tmp_path / "a*.parquet"),), "geometry") is None
    c.close()


def test_arbitrary_projected_crs_does_not_use_corner_covering():
    from dataclasses import replace

    req = WorkerTileQuery(
        "SELECT * FROM points",
        (),
        12,
        1134,
        1743,
        "geometry",
        "EPSG:5070",
        20000,
        datetime.now(UTC) + timedelta(seconds=30),
    )
    columns = (
        ("geometry", "GEOMETRY"),
        ("bbox", "STRUCT(xmin DOUBLE,ymin DOUBLE,xmax DOUBLE,ymax DOUBLE)"),
    )
    sql = build_tile_sql(req.canonical_sql, req, columns=columns, bbox_column="bbox")
    assert '"bbox".xmin' not in sql
    assert 'ST_Intersects(ST_Transform("geometry"' in sql
    geographic = build_tile_sql(
        req.canonical_sql, replace(req, result_crs="EPSG:4269"), columns=columns, bbox_column="bbox"
    )
    assert '"bbox".xmin' in geographic
