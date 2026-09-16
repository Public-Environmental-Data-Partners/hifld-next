import pytest

from app.query.sql_policy import SqlPolicy, SqlPolicyError


def test_clickhouse_identifier_escape_cannot_inject_a_relation():
    from query_engine.sql import compile_query, identifier

    alias = 'a\\" FROM numbers(2) -- '
    sql = 'SELECT 1 AS "' + alias.replace('"', '""') + '"'
    with pytest.raises(SqlPolicyError, match="identifier"):
        compile_query(sql, ())
    with pytest.raises(SqlPolicyError, match="identifier"):
        identifier(alias)


def test_nested_cte_cannot_authorize_an_outer_relation():
    with pytest.raises(SqlPolicyError, match="Unknown source"):
        SqlPolicy.validate(
            "SELECT v.* FROM private_view v CROSS JOIN "
            "(WITH private_view AS (SELECT 1 AS x) SELECT x FROM private_view) d",
            frozenset({"hosp"}),
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM system.query_log",
        "SELECT * FROM url('http://localhost/secret')",
        "SELECT * FROM hosp SETTINGS max_threads=100",
        "SELECT * FROM hosp INTO OUTFILE '/tmp/export'",
        "SELECT 1 INTO foo",
        "WITH x AS (DELETE FROM hosp RETURNING *) SELECT 1",
        "WITH x AS (CREATE TABLE leaked(a INT)) SELECT 1",
    ],
)
def test_query_cannot_access_engine_resources(sql):
    with pytest.raises(SqlPolicyError):
        SqlPolicy.validate(sql, frozenset({"hosp"}))


def test_scoped_ctes_remain_supported():
    assert SqlPolicy.validate("WITH f AS (SELECT * FROM hosp) SELECT * FROM f", frozenset({"hosp"}))


def test_source_compilation_uses_native_glob_without_persistent_views():
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT hosp.NAME FROM hosp WHERE state_fips='12'",
        (WorkerSourceSpec("hosp", ("gs://public-bucket/data/**/*.parquet",)),),
    )
    assert "s3(" in result
    assert "https://storage.googleapis.com/public-bucket/data/**/*.parquet" in result
    assert "CREATE" not in result
    assert "'12'" in result


def test_map_binding_reprojects_using_metadata_without_changing_native_bbox():
    from query_engine.sql import GeometrySpec, compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT geometry FROM hosp WHERE bbox.xmin < 100",
        (WorkerSourceSpec("hosp", ("gs://public-bucket/data.parquet",)),),
        geometry={"hosp": (GeometrySpec("geometry", "EPSG:3857"),)},
        spatial=True,
    )
    assert "hifld_reproject_wkb" in result
    assert "EPSG:3857" in result
    assert "bbox.xmin" in result


def test_spatial_binding_rejects_unknown_crs():
    from query_engine.sql import GeometrySpec, compile_query
    from query_worker.protocol import WorkerSourceSpec

    with pytest.raises(SqlPolicyError, match="CRS"):
        compile_query(
            "SELECT geometry FROM hosp",
            (WorkerSourceSpec("hosp", ("gs://b/a.parquet",)),),
            geometry={"hosp": (GeometrySpec("geometry", None),)},
            spatial=True,
        )


def test_common_spatial_predicate_compiles():
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT NAME FROM hosp WHERE ST_Intersects(geometry, ST_MakeEnvelope(-80,25,-79,26))",
        (WorkerSourceSpec("hosp", ("gs://b/a.parquet",)),),
    )
    assert "geometryIntersectCartesian" in result
    assert "readWKT" in result


def test_unsupported_spatial_function_is_actionable():
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    with pytest.raises(SqlPolicyError, match="(?i)ST_Buffer.*not supported"):
        compile_query(
            "SELECT ST_Buffer(geometry, 1) FROM hosp",
            (WorkerSourceSpec("hosp", ("gs://b/a.parquet",)),),
        )


def test_explicit_working_crs_normalizes_every_geometry():
    from query_engine.sql import GeometrySpec, compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT geometry FROM hosp",
        (WorkerSourceSpec("hosp", ("gs://b/a.parquet",)),),
        geometry={"hosp": (GeometrySpec("geometry", "EPSG:4326"),)},
        working_crs="EPSG:3857",
    )
    assert "hifld_reproject_wkb" in result
    assert "'EPSG:4326', 'EPSG:3857'" in result


def test_native_covering_filter_is_inside_reprojection_binding():
    from query_engine.sql import GeometrySpec, compile_query
    from query_worker.protocol import WorkerSourceSpec

    sql = compile_query(
        "SELECT geometry FROM hosp",
        (WorkerSourceSpec("hosp", ("gs://b/a.parquet",)),),
        geometry={"hosp": (GeometrySpec("geometry", "EPSG:3857"),)},
        spatial=True,
        source_filters={"hosp": '"bbox"."xmin" <= 12'},
    )
    assert "FROM (SELECT * FROM s3" in sql
    assert 'WHERE "bbox"."xmin" <= 12' in sql
