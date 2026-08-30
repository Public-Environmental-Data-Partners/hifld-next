"""Public-GCS acceptance tests; network checks are explicitly opt-in."""

import os
from datetime import UTC, datetime, timedelta

import pytest

from app.query.models import ResolvedSource
from app.storage.models import PublicGcsProfile, StorageSettings
from app.storage.resolver import StorageResolver
from query_worker.protocol import (
    WorkerPage,
    WorkerQuery,
    WorkerRuntimeConfig,
    WorkerSourceSpec,
)
from query_worker.runtime import WorkerRuntime


def test_public_gcs_uri_is_restricted_to_configured_bucket() -> None:
    resolver = StorageResolver(
        StorageSettings(
            profiles={"public": PublicGcsProfile(type="public_gcs", slug="public", bucket="demo")}
        )
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
        storage_location_slug="public",
        object_uris=("gs://demo/roads.parquet",),
    )
    spec = resolver.resolve(source)
    assert spec.object_uris == ("https://storage.googleapis.com/demo/roads.parquet",)
    assert spec.secret is None


@pytest.mark.skipif(
    not os.getenv("HIFLD_TEST_GCS_BUCKET") or not os.getenv("HIFLD_TEST_GCS_OBJECT"),
    reason=(
        "set HIFLD_TEST_GCS_BUCKET and HIFLD_TEST_GCS_OBJECT to run the public-GCS network check"
    ),
)
def test_public_gcs_object_is_reachable_when_explicitly_configured() -> None:
    bucket = os.environ["HIFLD_TEST_GCS_BUCKET"]
    object_key = os.environ["HIFLD_TEST_GCS_OBJECT"]
    settings = StorageSettings(profiles={"public": PublicGcsProfile(slug="public", bucket=bucket)})
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
        storage_location_slug="public",
        object_uris=(f"gs://{bucket}/{object_key}",),
    )
    spec = StorageResolver(settings).resolve(source)
    runtime = WorkerRuntime(
        WorkerRuntimeConfig(
            threads=2,
            memory_limit="512MB",
            temp_directory="/tmp/dataset-mcp-gcs-acceptance",
            extension_directory=os.getenv("HIFLD_TEST_DUCKDB_EXTENSION_DIRECTORY"),
        )
    )
    try:
        result = runtime.execute(
            WorkerQuery(
                canonical_sql="SELECT * FROM dataset",
                sources=(WorkerSourceSpec(alias="dataset", object_uris=spec.object_uris),),
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
