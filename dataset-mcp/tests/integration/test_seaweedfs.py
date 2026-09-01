"""SeaweedFS acceptance tests with an explicit operator-provided endpoint."""

import os
from datetime import UTC, datetime, timedelta

import pytest

from app.catalog.models import BucketStorageConfig
from app.query.models import ResolvedSource
from app.storage.resolver import StorageResolver
from query_worker.protocol import (
    WorkerPage,
    WorkerQuery,
    WorkerRuntimeConfig,
    WorkerSeaweedCredentials,
    WorkerSeaweedSource,
    WorkerSourceSpec,
)
from query_worker.runtime import WorkerRuntime


def test_seaweedfs_source_gets_request_scoped_secret_and_path_style() -> None:
    config = BucketStorageConfig(
        type="seaweedfs",
        base_url="http://localhost:8888",
        bucket="datasets",
        endpoint_url="http://localhost:8333",
    )
    source = ResolvedSource(
        source={
            "alias": "roads",
            "collection_id": 1,
            "dataset_id": 2,
            "file_id": 3,
            "file_source_id": 4,
        },
        version="v1",
        format_type="geoparquet",
        storage_location_slug="local-seaweed",
        storage_config=config,
        object_uris=("s3://datasets/roads.parquet",),
    )
    spec = StorageResolver().resolve(source)
    assert spec.object_uris == ("s3://datasets/roads.parquet",)
    assert spec.seaweedfs is not None
    assert spec.seaweedfs.endpoint == "localhost:8333"
    assert spec.seaweedfs.url_style == "path"


@pytest.mark.skipif(
    not all(
        os.getenv(name)
        for name in (
            "HIFLD_TEST_SEAWEED_ENDPOINT",
            "HIFLD_TEST_SEAWEED_BUCKET",
            "HIFLD_TEST_SEAWEED_OBJECT",
        )
    ),
    reason="set the HIFLD_TEST_SEAWEED_* endpoint, bucket, and object variables",
)
def test_seaweedfs_endpoint_is_reachable_when_explicitly_configured() -> None:
    endpoint = os.environ["HIFLD_TEST_SEAWEED_ENDPOINT"]
    bucket = os.environ["HIFLD_TEST_SEAWEED_BUCKET"]
    object_key = os.environ["HIFLD_TEST_SEAWEED_OBJECT"]
    config = BucketStorageConfig(
        type="seaweedfs",
        base_url="http://localhost:8888",
        bucket=bucket,
        endpoint_url=endpoint,
    )
    source = ResolvedSource(
        source={
            "alias": "dataset",
            "collection_id": 1,
            "dataset_id": 2,
            "file_id": 3,
            "file_source_id": 4,
        },
        version="acceptance",
        format_type="geoparquet",
        storage_location_slug="local-seaweed",
        storage_config=config,
        object_uris=(f"s3://{bucket}/{object_key}",),
    )
    spec = StorageResolver().resolve(source)
    assert spec.seaweedfs is not None
    runtime = WorkerRuntime(
        WorkerRuntimeConfig(
            threads=2,
            memory_limit="512MB",
            temp_directory="/tmp/dataset-mcp-seaweed-acceptance",
            extension_directory=os.getenv("HIFLD_TEST_DUCKDB_EXTENSION_DIRECTORY"),
            seaweedfs_credentials=WorkerSeaweedCredentials(
                access_key_id=os.getenv("HIFLD_TEST_SEAWEED_ACCESS_KEY", "access"),
                secret_access_key=os.getenv("HIFLD_TEST_SEAWEED_SECRET_KEY", "secret"),
            ),
        )
    )
    try:
        result = runtime.execute(
            WorkerQuery(
                canonical_sql="SELECT * FROM dataset",
                sources=(
                    WorkerSourceSpec(
                        alias="dataset",
                        object_uris=spec.object_uris,
                        seaweedfs=WorkerSeaweedSource(
                            bucket=spec.seaweedfs.bucket,
                            endpoint=spec.seaweedfs.endpoint,
                            tls=spec.seaweedfs.tls,
                        ),
                    ),
                ),
                limit=2,
                offset=0,
                deadline=datetime.now(tz=UTC) + timedelta(seconds=30),
            )
        )
    finally:
        runtime.close()

    assert isinstance(result, WorkerPage)
    assert result.returned_count == 2
    assert result.files_read == 1
