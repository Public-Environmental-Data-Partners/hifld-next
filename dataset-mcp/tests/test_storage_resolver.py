from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest

from app.catalog.models import BucketStorageConfig
from app.storage.resolver import StorageResolutionError, StorageResolver

if TYPE_CHECKING:
    from app.query.models import ResolvedSource


def source(config: BucketStorageConfig, *uris: str) -> ResolvedSource:
    return cast(
        "ResolvedSource",
        SimpleNamespace(storage_config=config, object_uris=tuple(uris)),
    )


def test_public_gcs_is_resolved_from_catalog_storage_config() -> None:
    config = BucketStorageConfig(
        type="gcs",
        base_url="https://storage.googleapis.com/hifld",
        bucket="hifld",
    )

    spec = StorageResolver().resolve(source(config, "gs://hifld/geo/roads.parquet"))

    assert spec.object_uris == ("gs://hifld/geo/roads.parquet",)
    assert spec.seaweedfs is None


def test_public_gcs_preserves_catalog_glob_for_duckdb() -> None:
    config = BucketStorageConfig(
        type="gcs",
        base_url="https://storage.googleapis.com/hifld",
        bucket="hifld",
    )

    result = StorageResolver().resolve(source(config, "gs://hifld/geo/%2A.parquet"))
    assert result.object_uris == ("gs://hifld/geo/*.parquet",)


@pytest.mark.parametrize(
    "uri",
    [
        "gs://other/data/*.parquet",
        "gs://hifld/data/%2e%2e/*.parquet",
        "https://evil.test/hifld/*.parquet",
    ],
)
def test_gcs_glob_cannot_escape_catalog_scope(uri: str) -> None:
    config = BucketStorageConfig(
        type="gcs", bucket="hifld", base_url="https://storage.googleapis.com/hifld"
    )
    with pytest.raises(StorageResolutionError):
        StorageResolver().resolve(source(config, uri))


def test_local_seaweed_is_resolved_from_catalog_storage_config() -> None:
    config = BucketStorageConfig(
        type="seaweedfs",
        base_url="http://localhost:8888",
        bucket="hifld",
        endpoint_url="http://localhost:8333",
    )

    spec = StorageResolver().resolve(source(config, "s3://hifld/a.parquet"))

    assert spec.object_uris == ("s3://hifld/a.parquet",)
    assert spec.seaweedfs is not None
    assert spec.seaweedfs.bucket == "hifld"
    assert spec.seaweedfs.endpoint == "localhost:8333"
    assert spec.seaweedfs.tls is False


def test_compose_seaweed_dns_is_resolved_from_server_config() -> None:
    config = BucketStorageConfig(
        type="seaweedfs",
        base_url="http://seaweedfs:8888",
        bucket="hifld",
        endpoint_url="http://seaweedfs:8333",
    )

    spec = StorageResolver().resolve(source(config, "s3://hifld/a.parquet"))

    assert spec.seaweedfs is not None
    assert spec.seaweedfs.endpoint == "seaweedfs:8333"


@pytest.mark.parametrize(
    "uri", ["s3://other/a.parquet", "s3://hifld/datasets/%2e%2e/secret.parquet"]
)
def test_catalog_bucket_scope_and_traversal_are_rejected(uri: str) -> None:
    config = BucketStorageConfig(
        type="seaweedfs",
        base_url="http://localhost:8888",
        bucket="hifld",
        endpoint_url="http://localhost:8333",
    )

    with pytest.raises(StorageResolutionError):
        StorageResolver().resolve(source(config, uri))


@pytest.mark.parametrize(
    "config",
    [
        BucketStorageConfig(
            type="s3",
            base_url="https://s3.amazonaws.com/catalog",
            bucket="catalog",
        ),
    ],
)
def test_unsupported_or_nonlocal_storage_fails_closed(config: BucketStorageConfig) -> None:
    with pytest.raises(StorageResolutionError):
        StorageResolver().resolve(source(config, f"s3://{config.bucket}/a.parquet"))
