"""Resolve catalog source identities into server-managed DuckDB access."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import unquote, urlparse

from app.storage.models import (
    DuckDbSecretSpec,
    DuckDbSetupOperation,
    DuckDbSourceSpec,
    PublicGcsProfile,
    S3Profile,
    SeaweedProfile,
    StorageSettings,
)

if TYPE_CHECKING:
    from app.query.models import ResolvedSource


class StorageResolutionError(ValueError):
    """A catalog source cannot be safely served by configured storage."""


def _decoded_key(value: str) -> str:
    decoded = value
    for _ in range(3):
        next_value = unquote(decoded)
        if next_value == decoded:
            break
        decoded = next_value
    if "\x00" in decoded or any(part == ".." for part in decoded.replace("\\", "/").split("/")):
        raise StorageResolutionError("source path contains traversal")
    return decoded.lstrip("/")


def _key_for_scope(bucket: str, configured_bucket: str, configured_prefix: str, key: str) -> str:
    if bucket != configured_bucket:
        raise StorageResolutionError("source bucket is outside configured storage scope")
    normalized = _decoded_key(key)
    prefix = _decoded_key(configured_prefix).rstrip("/")
    if prefix and not (normalized == prefix or normalized.startswith(prefix + "/")):
        raise StorageResolutionError("source path is outside configured storage scope")
    return normalized


def _s3_parts(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise StorageResolutionError("catalog source must be an s3:// object URI")
    return parsed.netloc, parsed.path.lstrip("/")


def _source_uris(source: ResolvedSource) -> tuple[str, ...]:
    # ResolvedSource is deliberately the only accepted caller input. It contains
    # catalog-produced exact objects, never agent-provided URL components.
    uris = tuple(source.object_uris)
    if not uris:
        raise StorageResolutionError("catalog source has no objects")
    return uris


class StorageResolver:
    def __init__(self, settings: StorageSettings) -> None:
        self._settings = settings

    def resolve(self, source: ResolvedSource) -> DuckDbSourceSpec:
        slug = source.storage_location_slug
        profile = self._settings.profiles.get(slug)
        if profile is None:
            raise StorageResolutionError(f"unknown storage profile: {slug}")
        uris = _source_uris(source)
        if isinstance(profile, PublicGcsProfile):
            return DuckDbSourceSpec(object_uris=self._resolve_gcs(profile, uris))
        if isinstance(profile, S3Profile):
            return self._resolve_s3(profile, uris)
        return self._resolve_seaweed(profile, uris)

    @staticmethod
    def _resolve_gcs(profile: PublicGcsProfile, uris: tuple[str, ...]) -> tuple[str, ...]:
        result: list[str] = []
        for uri in uris:
            parsed = urlparse(uri)
            if parsed.scheme == "gs":
                bucket, key = parsed.netloc, parsed.path.lstrip("/")
            elif parsed.scheme == "https" and parsed.netloc in {
                "storage.googleapis.com",
                "storage.cloud.google.com",
            }:
                parts = parsed.path.lstrip("/").split("/", 1)
                if len(parts) != 2:
                    raise StorageResolutionError("invalid public GCS object URI")
                bucket, key = parts
            else:
                raise StorageResolutionError("public GCS source must be gs:// or GCS HTTPS")
            safe_key = _key_for_scope(bucket, profile.bucket, profile.prefix, key)
            result.append(f"https://storage.googleapis.com/{bucket}/{safe_key}")
        return tuple(result)

    @staticmethod
    def _resolve_s3(profile: S3Profile, uris: tuple[str, ...]) -> DuckDbSourceSpec:
        result: list[str] = []
        for uri in uris:
            bucket, key = _s3_parts(uri)
            result.append(
                f"s3://{bucket}/{_key_for_scope(bucket, profile.bucket, profile.prefix, key)}"
            )
        secret = DuckDbSecretSpec(
            region=profile.region,
            access_key_id=profile.access_key_id,
            secret_access_key=profile.secret_access_key,
        )
        operation = DuckDbSetupOperation(
            statement="CREATE REQUEST SCOPED SECRET",
            parameters=(profile.access_key_id, profile.secret_access_key),
        )
        return DuckDbSourceSpec(
            object_uris=tuple(result), secret=secret, setup_operations=(operation,)
        )

    @staticmethod
    def _resolve_seaweed(profile: SeaweedProfile, uris: tuple[str, ...]) -> DuckDbSourceSpec:
        result: list[str] = []
        for uri in uris:
            bucket, key = _s3_parts(uri)
            safe_key = _key_for_scope(bucket, profile.bucket, profile.prefix, key)
            result.append(f"s3://{bucket}/{safe_key}")
        secret = DuckDbSecretSpec(
            endpoint=profile.endpoint,
            url_style="path" if profile.use_path_style else "vhost",
            tls=profile.tls,
            access_key_id=profile.access_key_id,
            secret_access_key=profile.secret_access_key,
        )
        operation = DuckDbSetupOperation(
            statement="CREATE REQUEST SCOPED SECRET",
            parameters=(profile.access_key_id, profile.secret_access_key),
        )
        return DuckDbSourceSpec(
            object_uris=tuple(result), secret=secret, setup_operations=(operation,)
        )
