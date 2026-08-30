import pickle
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb

from query_worker.metrics import init_connection, measure
from query_worker.protocol import (
    WorkerCredentialProfile,
    WorkerFailure,
    WorkerQuery,
    WorkerRuntimeConfig,
    WorkerSourceSpec,
)
from query_worker.runtime import WorkerRuntime


def _write_parquet(path: Path, sql: str) -> None:
    connection = duckdb.connect()
    try:
        connection.execute(f"COPY ({sql}) TO ? (FORMAT PARQUET)", [str(path)])
    finally:
        connection.close()


def _request(
    sql: str,
    sources: tuple[WorkerSourceSpec, ...],
    *,
    limit: int = 100,
    offset: int = 0,
) -> WorkerQuery:
    return WorkerQuery(
        canonical_sql=sql,
        sources=sources,
        limit=limit,
        offset=offset,
        deadline=datetime.now(tz=UTC) + timedelta(seconds=5),
    )


def _runtime(tmp_path: Path) -> WorkerRuntime:
    return WorkerRuntime(
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path / "spill"),
            load_extensions=False,
        )
    )


def test_runtime_executes_complex_join_and_extracts_schema(tmp_path: Path) -> None:
    left_path = tmp_path / "left.parquet"
    right_path = tmp_path / "right.parquet"
    _write_parquet(left_path, "SELECT * FROM (VALUES (1, 'a'), (2, 'b')) t(id, name)")
    _write_parquet(right_path, "SELECT * FROM (VALUES (1, 10), (2, 20)) t(id, score)")
    runtime = _runtime(tmp_path)
    try:
        result = runtime.execute(
            _request(
                "WITH ranked AS ("
                "SELECT l.id, l.name, r.score, row_number() OVER (ORDER BY r.score DESC) AS rank "
                "FROM left_data AS l JOIN right_data AS r USING (id)"
                ") SELECT * FROM ranked ORDER BY id",
                (
                    WorkerSourceSpec(alias="left_data", object_uris=(str(left_path),)),
                    WorkerSourceSpec(alias="right_data", object_uris=(str(right_path),)),
                ),
            )
        )
    finally:
        runtime.close()

    assert not isinstance(result, WorkerFailure)
    assert result.rows == (
        {"id": 1, "name": "a", "score": 10, "rank": 2},
        {"id": 2, "name": "b", "score": 20, "rank": 1},
    )
    assert result.columns[0][:2] == ("id", "INTEGER")
    assert result.returned_count == 2
    assert result.has_more is False


def test_runtime_applies_outer_limit_and_offset_but_preserves_inner_limit(
    tmp_path: Path,
) -> None:
    path = tmp_path / "items.parquet"
    _write_parquet(path, "SELECT range AS id FROM range(10)")
    source = WorkerSourceSpec(alias="items", object_uris=(str(path),))
    runtime = _runtime(tmp_path)
    try:
        page = runtime.execute(
            _request("SELECT * FROM items ORDER BY id LIMIT 4", (source,), limit=2, offset=1)
        )
    finally:
        runtime.close()

    assert not isinstance(page, WorkerFailure)
    assert page.rows == ({"id": 1}, {"id": 2})
    assert page.has_more is True


def test_runtime_removes_unique_views_and_isolates_sequential_requests(tmp_path: Path) -> None:
    first_path = tmp_path / "first.parquet"
    second_path = tmp_path / "second.parquet"
    _write_parquet(first_path, "SELECT 1 AS id")
    _write_parquet(second_path, "SELECT 2 AS id")
    runtime = _runtime(tmp_path)
    try:
        first = runtime.execute(
            _request(
                "SELECT * FROM source ORDER BY id",
                (WorkerSourceSpec(alias="source", object_uris=(str(first_path),)),),
            )
        )
        views_after_first = runtime.connection.execute(
            "SELECT view_name FROM duckdb_views() WHERE view_name LIKE '_mcp_source_%'"
        ).fetchall()
        second = runtime.execute(
            _request(
                "SELECT * FROM source ORDER BY id",
                (WorkerSourceSpec(alias="source", object_uris=(str(second_path),)),),
            )
        )
        views_after_second = runtime.connection.execute(
            "SELECT view_name FROM duckdb_views() WHERE view_name LIKE '_mcp_source_%'"
        ).fetchall()
    finally:
        runtime.close()

    assert not isinstance(first, WorkerFailure)
    assert not isinstance(second, WorkerFailure)
    assert first.rows == ({"id": 1},)
    assert second.rows == ({"id": 2},)
    assert views_after_first == []
    assert views_after_second == []


def test_metrics_profile_uses_stable_typed_output(tmp_path: Path) -> None:
    connection = duckdb.connect()
    try:
        init_connection(connection, temp_directory=tmp_path, enabled=True)
        with measure(
            connection,
            label="bounded page",
            temp_directory=tmp_path,
            enabled=True,
        ) as mutable:
            connection.execute("SELECT * FROM range(3)").fetchall()
        metrics = mutable.snapshot()
    finally:
        connection.close()

    assert metrics.label == "bounded page"
    assert metrics.wall_ms >= 0
    assert metrics.latency_ms is not None
    assert metrics.bytes_read is not None
    assert metrics.error_code is None
    assert list(tmp_path.glob("*.json")) == []


def test_credentials_are_spawn_time_only_and_redacted_from_runtime_repr(tmp_path: Path) -> None:
    profile = WorkerCredentialProfile(
        slug="seaweed",
        type="seaweedfs",
        bucket="datasets",
        access_key_id="access-value",
        secret_access_key="secret-value",
        endpoint="seaweed:8333",
        url_style="path",
        tls=False,
    )
    config = WorkerRuntimeConfig(
        threads=1,
        memory_limit="256MiB",
        temp_directory=str(tmp_path),
        credential_profiles=(profile,),
        load_extensions=False,
    )
    request = _request(
        "SELECT * FROM source",
        (
            WorkerSourceSpec(
                alias="source",
                object_uris=("s3://datasets/sample.parquet",),
                profile_slug="seaweed",
            ),
        ),
    )

    assert "access-value" not in repr(config)
    assert "secret-value" not in repr(config)
    request_message = pickle.dumps(request)
    assert b"access-value" not in request_message
    assert b"secret-value" not in request_message
    assert b"seaweed" in request_message


def test_runtime_sets_pinned_extension_directory_before_accepting_queries(tmp_path: Path) -> None:
    extension_directory = tmp_path / "extensions"
    runtime = WorkerRuntime(
        WorkerRuntimeConfig(
            threads=1,
            memory_limit="256MiB",
            temp_directory=str(tmp_path / "spill"),
            extension_directory=str(extension_directory),
            load_extensions=False,
        )
    )
    try:
        configured = runtime.connection.execute(
            "SELECT current_setting('extension_directory')"
        ).fetchone()
    finally:
        runtime.close()

    assert configured == (str(extension_directory),)
