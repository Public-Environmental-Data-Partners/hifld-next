import json

import pytest

from app.storage.registry import StorageRegistry, StorageResolutionError


def test_resolver_returns_only_configured_gcs_object_urls() -> None:
    resolver = StorageRegistry.from_json('{"gcp":{"type":"gcs","bucket":"data"}}')

    source = resolver.resolve("gcp", ("hifld/a.parquet",))

    assert source.object_uris == ("gs://data/hifld/a.parquet",)
    assert source.seaweed_endpoint is None


def test_resolver_returns_seaweedfs_urls_and_server_endpoint() -> None:
    resolver = StorageRegistry.from_json(
        json.dumps(
            {
                "local": {
                    "type": "seaweedfs",
                    "bucket": "data",
                    "endpoint_url": "http://seaweed:8333",
                }
            }
        )
    )

    source = resolver.resolve("local", ("hifld/a.parquet",))

    assert source.object_uris == ("s3://data/hifld/a.parquet",)
    assert source.seaweed_endpoint == "http://seaweed:8333"


def test_resolver_rejects_unregistered_storage_location() -> None:
    resolver = StorageRegistry.from_json("{}")

    with pytest.raises(StorageResolutionError):
        resolver.resolve("missing", ("hifld/a.parquet",))


@pytest.mark.parametrize(
    "object_key",
    ("../a.parquet", "hifld/../a.parquet", "hifld/%2e%2e/a.parquet", "/hifld/a.parquet"),
)
def test_resolver_rejects_traversal_or_absolute_object_keys(object_key: str) -> None:
    resolver = StorageRegistry.from_json('{"gcp":{"type":"gcs","bucket":"data"}}')

    with pytest.raises(StorageResolutionError):
        resolver.resolve("gcp", (object_key,))


def test_resolver_rejects_foreign_uri_components_and_bucket() -> None:
    resolver = StorageRegistry.from_json('{"gcp":{"type":"gcs","bucket":"data","prefix":"hifld"}}')

    with pytest.raises(StorageResolutionError):
        resolver.resolve("gcp", ("gs://other/hifld/a.parquet",))
    with pytest.raises(StorageResolutionError):
        resolver.resolve("gcp", ("other/a.parquet",))
    with pytest.raises(StorageResolutionError):
        resolver.resolve("gcp", ("hifld/a.parquet?x=1",))


@pytest.mark.parametrize(
    "bucket", ("da%74a", "data:evil", "data@evil", "data\\evil", "data bucket", "da\x00ta")
)
def test_registry_rejects_unsafe_bucket_authorities(bucket: str) -> None:
    with pytest.raises(StorageResolutionError):
        StorageRegistry.from_json(json.dumps({"gcp": {"type": "gcs", "bucket": bucket}}))


def test_resolver_rejects_residual_percent_encoding() -> None:
    resolver = StorageRegistry.from_json('{"gcp":{"type":"gcs","bucket":"data"}}')

    with pytest.raises(StorageResolutionError):
        resolver.resolve("gcp", ("hifld/file%2525.parquet",))


def test_resolver_rejects_unknown_type_and_malformed_json() -> None:
    with pytest.raises(StorageResolutionError):
        StorageRegistry.from_json('{"legacy":{"type":"s3","bucket":"data"}}')
    with pytest.raises(StorageResolutionError):
        StorageRegistry.from_json("[]")
