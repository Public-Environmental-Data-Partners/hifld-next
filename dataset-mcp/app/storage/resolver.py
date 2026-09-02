"""Resolve catalog source identities into server-managed DuckDB access."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import unquote, urlparse

from app.storage.models import (
    DuckDbSeaweedSpec,
    DuckDbSourceSpec,
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


def _reject_wildcard(key: str) -> None:
    if any(character in key for character in "*?["):
        raise StorageResolutionError("public GCS sources must name concrete objects")


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
    def resolve(self, source: ResolvedSource) -> DuckDbSourceSpec:
        config = source.storage_config
        uris = _source_uris(source)
        if config.type == "gcs":
            return DuckDbSourceSpec(object_uris=self._resolve_gcs(config.bucket, uris))
        if config.type == "seaweedfs":
            return self._resolve_seaweed(config.bucket, config.endpoint_url, uris)
        raise StorageResolutionError(f"unsupported catalog storage type: {config.type}")

    @staticmethod
    def _resolve_gcs(configured_bucket: str, uris: tuple[str, ...]) -> tuple[str, ...]:
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
            safe_key = _key_for_scope(bucket, configured_bucket, "", key)
            _reject_wildcard(safe_key)
            result.append(f"https://storage.googleapis.com/{bucket}/{safe_key}")
        return tuple(result)

    @staticmethod
    def _resolve_seaweed(
        configured_bucket: str, endpoint_url: str | None, uris: tuple[str, ...]
    ) -> DuckDbSourceSpec:
        if endpoint_url is None:
            raise StorageResolutionError("local SeaweedFS storage has no endpoint")
        endpoint = urlparse(endpoint_url)
        if (
            endpoint.scheme != "http"
            or endpoint.hostname not in {"localhost", "127.0.0.1", "::1"}
            or not endpoint.netloc
            or endpoint.username is not None
            or endpoint.password is not None
            or endpoint.path not in {"", "/"}
            or endpoint.params
            or endpoint.query
            or endpoint.fragment
        ):
            raise StorageResolutionError("SeaweedFS endpoint must be local HTTP")
        result: list[str] = []
        for uri in uris:
            bucket, key = _s3_parts(uri)
            safe_key = _key_for_scope(bucket, configured_bucket, "", key)
            result.append(f"s3://{bucket}/{safe_key}")
        return DuckDbSourceSpec(
            object_uris=tuple(result),
            seaweedfs=DuckDbSeaweedSpec(
                bucket=configured_bucket,
                endpoint=endpoint.netloc,
            ),
        )
