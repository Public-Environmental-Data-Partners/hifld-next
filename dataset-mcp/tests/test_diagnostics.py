import duckdb

from query_worker.diagnostics import duckdb_diagnostic
from query_worker.protocol import WorkerRuntimeConfig, WorkerSeaweedCredentials, WorkerSourceSpec


def test_redacts_execution_details_but_retains_diagnostic() -> None:
    config = WorkerRuntimeConfig(
        threads=1,
        memory_limit="1GiB",
        temp_directory="/private/spill",
        seaweedfs_credentials=WorkerSeaweedCredentials("access-value", "secret-value"),
    )
    error = duckdb.IOException(
        "HTTP Error: 403 reading https://user:password@host/file?token=abc "
        "s3://bucket/file /private/spill/chunk access-value secret-value "
        "Authorization: Bearer bearer-value\n"
        "LINE 1: SELECT * FROM internal_generated_sql\n ^"
    )
    message = duckdb_diagnostic(error, config, (), {})
    assert "HTTP Error: 403" in message
    for private in (
        "password",
        "token=abc",
        "s3://",
        "/private/",
        "access-value",
        "secret-value",
        "bearer-value",
        "internal_generated_sql",
    ):
        assert private not in message


def test_restores_source_alias_and_bounds_length() -> None:
    config = WorkerRuntimeConfig(threads=1, memory_limit="1GiB", temp_directory="/tmp/spill")
    error = duckdb.BinderException("Candidate bindings: _mcp_source_123.id " + "x" * 10000)
    message = duckdb_diagnostic(
        error,
        config,
        (WorkerSourceSpec("roads", ("gs://bucket/file",)),),
        {"roads": "_mcp_source_123"},
    )
    assert "Candidate bindings: roads.id" in message
    assert len(message) <= 4096
