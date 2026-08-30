"""SeaweedFS acceptance tests with an explicit operator-provided endpoint."""

import os
from datetime import UTC, datetime, timedelta

import pytest

from app.query.models import ResolvedSource
from app.query.service import worker_profiles_from_storage
from app.storage.models import SeaweedProfile, StorageSettings
from app.storage.resolver import StorageResolver
from query_worker.protocol import (
    WorkerPage,
    WorkerQuery,
    WorkerRuntimeConfig,
    WorkerSourceSpec,
)
from query_worker.runtime import WorkerRuntime


def test_seaweedfs_source_gets_request_scoped_secret_and_path_style() -> None:
    profile = SeaweedProfile(
        type="seaweedfs",
        slug="local-seaweed",
        bucket="datasets",
        endpoint="http://seaweed-s3:8333",
        access_key_id="access",
        secret_access_key="secret",
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
        object_uris=("s3://datasets/roads.parquet",),
    )
    spec = StorageResolver(StorageSettings(profiles={"local-seaweed": profile})).resolve(source)
    assert spec.object_uris == ("s3://datasets/roads.parquet",)
    assert spec.secret is not None
    assert spec.secret.endpoint == "http://seaweed-s3:8333"
    assert spec.secret.url_style == "path"


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
    settings = StorageSettings(
        profiles={
            "local-seaweed": SeaweedProfile(
                slug="local-seaweed",
                bucket=bucket,
                endpoint=endpoint,
                access_key_id=os.getenv("HIFLD_TEST_SEAWEED_ACCESS_KEY", "access"),
                secret_access_key=os.getenv("HIFLD_TEST_SEAWEED_SECRET_KEY", "secret"),
            )
        }
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
        object_uris=(f"s3://{bucket}/{object_key}",),
    )
    spec = StorageResolver(settings).resolve(source)
    runtime = WorkerRuntime(
        WorkerRuntimeConfig(
            threads=2,
            memory_limit="512MB",
            temp_directory="/tmp/dataset-mcp-seaweed-acceptance",
            extension_directory=os.getenv("HIFLD_TEST_DUCKDB_EXTENSION_DIRECTORY"),
            credential_profiles=worker_profiles_from_storage(settings),
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
                        profile_slug="local-seaweed",
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
