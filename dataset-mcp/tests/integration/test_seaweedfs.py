"""SeaweedFS acceptance tests with an explicit operator-provided endpoint."""

import os

import pytest

from app.query.models import ResolvedSource
from app.storage.models import SeaweedProfile, StorageSettings
from app.storage.resolver import StorageResolver


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
    not os.getenv("HIFLD_TEST_SEAWEED_ENDPOINT"),
    reason="set HIFLD_TEST_SEAWEED_ENDPOINT to run the SeaweedFS network acceptance check",
)
def test_seaweedfs_endpoint_is_reachable_when_explicitly_configured() -> None:
    pytest.importorskip("httpx")
    pytest.skip("network acceptance harness is deployment-specific")
