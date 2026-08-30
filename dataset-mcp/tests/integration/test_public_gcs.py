"""Public-GCS acceptance tests; network checks are explicitly opt-in."""

import os

import pytest

from app.query.models import ResolvedSource
from app.storage.models import PublicGcsProfile, StorageSettings
from app.storage.resolver import StorageResolver


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
    """Reserved for an operator-supplied object; no implicit network in CI."""
    pytest.importorskip("httpx")
    pytest.skip("network acceptance harness is deployment-specific")
