"""Opt-in query measurements (informational; never a latency pass/fail gate)."""

import os
import time
from pathlib import Path

import duckdb
import pytest


@pytest.mark.skipif(
    os.getenv("HIFLD_RUN_BENCHMARKS") != "1",
    reason="set HIFLD_RUN_BENCHMARKS=1 to run opt-in query measurements",
)
def test_local_parquet_query_measurement(tmp_path: Path) -> None:
    path = tmp_path / "benchmark.parquet"
    connection = duckdb.connect()
    connection.execute(
        "COPY (SELECT * FROM range(10000) AS t(id)) TO ? (FORMAT PARQUET)", [str(path)]
    )
    started = time.perf_counter()
    count = connection.execute("SELECT count(*) FROM read_parquet(?)", [str(path)]).fetchone()[0]
    elapsed_ms = (time.perf_counter() - started) * 1_000
    print(f"local_parquet_rows={count} elapsed_ms={elapsed_ms:.2f}")
