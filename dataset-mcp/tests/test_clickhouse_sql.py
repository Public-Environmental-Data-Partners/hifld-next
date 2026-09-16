import pytest

from app.query.sql_policy import SqlPolicy, SqlPolicyError
from query_engine.results import ResultColumn


def test_explicit_scan_schema_preserves_public_tuple_and_raw_geometry():
    from query_engine.sql import GeometrySpec, compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT geometry, bbox FROM f WHERE bbox.xmin < 10",
        (WorkerSourceSpec("f", ("gs://b/data/**/*.parquet",)),),
        geometry={"f": (GeometrySpec("geometry", "EPSG:4269"),)},
        working_crs="EPSG:4326",
        schemas={
            "f": (
                ResultColumn(name="geometry", type="MultiPolygon"),
                ResultColumn(name="bbox", type="Tuple(xmin Float64, xmax Float64)"),
                ResultColumn(name="name", type="Nullable(String)"),
            )
        },
    )
    assert '"bbox.xmin" Float64' in result
    assert '"bbox.xmax" Float64' in result
    assert "tuple(" in result.lower()
    assert "AS bbox" in result or 'AS "bbox"' in result
    assert "hex(wkb(" not in result.lower()
    assert "hifld_reproject_wkb" in result
    assert "bbox.xmin < 10" in result


def test_user_stars_keep_original_schema_without_internal_scan_leaves():
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "WITH x AS (SELECT f.* FROM f WHERE bbox.xmin < 1) SELECT * FROM x",
        (WorkerSourceSpec("f", ("gs://b/a.parquet",)),),
        schemas={"f": (ResultColumn(name="bbox", type="Tuple(xmin Float64)"),)},
    )
    assert '"bbox.xmin" Float64' not in result
    assert "SELECT f.*" in result


@pytest.mark.parametrize(
    "tuple_type", ["Tuple(xmin Float64, label String)", "Tuple(Float64, Float64)"]
)
def test_complex_or_unnamed_tuples_use_native_schema(tuple_type):
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        "SELECT bbox FROM f",
        (WorkerSourceSpec("f", ("gs://b/a.parquet",)),),
        schemas={"f": (ResultColumn(name="bbox", type=tuple_type),)},
    )
    assert '"bbox.xmin"' not in result


def test_existing_dotted_column_is_not_shadowed_by_flattening():
    from query_engine.sql import compile_query
    from query_worker.protocol import WorkerSourceSpec

    result = compile_query(
        'SELECT bbox, "bbox.xmin" FROM f',
        (WorkerSourceSpec("f", ("gs://b/a.parquet",)),),
        schemas={
            "f": (
                ResultColumn(name="bbox", type="Tuple(xmin Float64)"),
                ResultColumn(name="bbox.xmin", type="String"),
            )
        },
    )
    assert "CAST(tuple(" not in result
    assert '"bbox.xmin" String' in result


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
