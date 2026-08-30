from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest
from pydantic import SecretStr

from app.storage.models import (
    PublicGcsProfile,
    S3Profile,
    SeaweedProfile,
    StorageSettings,
)
from app.storage.resolver import StorageResolutionError, StorageResolver

if TYPE_CHECKING:
    from app.query.models import ResolvedSource


def source(slug: str, *uris: str) -> ResolvedSource:
    return cast(
        "ResolvedSource",
        SimpleNamespace(storage_location_slug=slug, object_uris=tuple(uris)),
    )


def test_public_gcs_is_converted_to_https() -> None:
    resolver = StorageResolver(
        StorageSettings(
            profiles={"published": PublicGcsProfile(slug="published", bucket="hifld", prefix="geo")}
        )
    )
    spec = resolver.resolve(source("published", "gs://hifld/geo/roads.parquet"))
    assert spec.object_uris == ("https://storage.googleapis.com/hifld/geo/roads.parquet",)
    assert spec.secret is None


def test_s3_is_scoped_and_uses_native_uri() -> None:
    profile = S3Profile(
        slug="aws",
        bucket="catalog",
        prefix="datasets",
        region="us-east-1",
        access_key_id=SecretStr("AKIA-secret"),
        secret_access_key=SecretStr("super-secret"),
    )
    spec = StorageResolver(StorageSettings(profiles={"aws": profile})).resolve(
        source("aws", "s3://catalog/datasets/a.parquet")
    )
    assert spec.object_uris == ("s3://catalog/datasets/a.parquet",)
    assert spec.secret is not None
    assert "super-secret" not in repr(spec)
    assert "super-secret" not in str(spec.model_dump(mode="json"))


def test_seaweed_uses_configured_endpoint_and_path_style() -> None:
    profile = SeaweedProfile(
        slug="local",
        bucket="hifld",
        prefix="",
        endpoint="https://s3.local:8333",
        access_key_id=SecretStr("local-key"),
        secret_access_key=SecretStr("local-secret"),
        tls=True,
    )
    spec = StorageResolver(StorageSettings(profiles={"local": profile})).resolve(
        source("local", "s3://hifld/a.parquet")
    )
    assert spec.secret is not None
    assert spec.secret.endpoint == "https://s3.local:8333"
    assert spec.secret.url_style == "path"
    assert spec.secret.tls is True


@pytest.mark.parametrize(
    "uri", ["s3://catalog/other/a.parquet", "s3://catalog/datasets/%2e%2e/secret.parquet"]
)
def test_scope_and_traversal_are_rejected(uri: str) -> None:
    profile = S3Profile(
        slug="aws",
        bucket="catalog",
        prefix="datasets",
        region="us-east-1",
        access_key_id=SecretStr("key"),
        secret_access_key=SecretStr("secret"),
    )
    with pytest.raises(StorageResolutionError):
        StorageResolver(StorageSettings(profiles={"aws": profile})).resolve(source("aws", uri))


def test_unknown_slug_and_non_catalog_endpoint_fail_closed() -> None:
    profile = PublicGcsProfile(slug="published", bucket="hifld")
    resolver = StorageResolver(StorageSettings(profiles={"published": profile}))
    with pytest.raises(StorageResolutionError):
        resolver.resolve(source("missing", "gs://hifld/a.parquet"))
    with pytest.raises(StorageResolutionError):
        resolver.resolve(source("published", "https://evil.example/a.parquet"))
