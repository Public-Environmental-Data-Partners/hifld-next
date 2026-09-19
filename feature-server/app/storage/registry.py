"""Server-owned, storage-neutral source declarations for ClickHouse."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal
from urllib.parse import unquote, urlsplit

from pydantic import TypeAdapter, ValidationError


class StorageResolutionError(ValueError):
    """A catalog storage location or object key is not safe to resolve."""


StorageType = Literal["gcs", "seaweedfs"]
_BUCKET_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,61}[a-z0-9])$")


@dataclass(frozen=True, slots=True)
class StorageLocation:
    type: StorageType
    bucket: str
    prefix: str
    endpoint_url: str | None = None


@dataclass(frozen=True, slots=True)
class ClickHouseSource:
    object_uris: tuple[str, ...]
    seaweed_endpoint: str | None = None


def _decode(value: str) -> str:
    decoded = value
    for _ in range(3):
        next_value = unquote(decoded)
        if next_value == decoded:
            break
        decoded = next_value
    return decoded


def _safe_key(value: str, *, bucket: str, prefix: str, schemes: tuple[str, ...]) -> str:
    if not value or "\x00" in value:
        raise StorageResolutionError("storage object key is invalid")
    parsed = urlsplit(value)
    if parsed.scheme:
        if parsed.scheme not in schemes or not parsed.netloc or parsed.username is not None:
            raise StorageResolutionError("storage object URI is invalid")
        if parsed.netloc != bucket:
            raise StorageResolutionError("storage object bucket is outside configured scope")
        if parsed.query or parsed.fragment or parsed.port is not None:
            raise StorageResolutionError("storage object URI has unsafe components")
        value = parsed.path
    elif parsed.query or parsed.fragment or parsed.netloc:
        raise StorageResolutionError("storage object key has unsafe URI components")

    decoded = _decode(value)
    normalized = decoded.replace("\\", "/")
    if "%" in normalized or normalized.startswith("/"):
        raise StorageResolutionError("storage object key must be relative")
    parts = normalized.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise StorageResolutionError("storage object key contains traversal")
    if prefix and not (normalized == prefix or normalized.startswith(prefix + "/")):
        raise StorageResolutionError("storage object key is outside configured prefix")
    return normalized


def _parse_location(slug: str, raw: Mapping[str, object]) -> StorageLocation:
    storage_type_raw = raw.get("type")
    if storage_type_raw == "gcs":
        storage_type: StorageType = "gcs"
    elif storage_type_raw == "seaweedfs":
        storage_type = "seaweedfs"
    else:
        raise StorageResolutionError(f"unsupported storage type for {slug!r}")
    bucket = raw.get("bucket")
    prefix = raw.get("prefix", "")
    endpoint_url = raw.get("endpoint_url")
    if not isinstance(bucket, str) or _BUCKET_PATTERN.fullmatch(bucket) is None:
        raise StorageResolutionError(f"storage bucket for {slug!r} is invalid")
    if not isinstance(prefix, str):
        raise StorageResolutionError(f"storage prefix for {slug!r} is invalid")
    decoded_prefix = _decode(prefix).replace("\\", "/").strip("/")
    if decoded_prefix and any(
        not part or part in {".", ".."} for part in decoded_prefix.split("/")
    ):
        raise StorageResolutionError(f"storage prefix for {slug!r} is invalid")
    if storage_type == "seaweedfs":
        if not isinstance(endpoint_url, str):
            raise StorageResolutionError("SeaweedFS storage requires an endpoint")
        endpoint = urlsplit(endpoint_url)
        if (
            endpoint.scheme not in {"http", "https"}
            or not endpoint.netloc
            or endpoint.username is not None
            or endpoint.password is not None
            or endpoint.path not in {"", "/"}
            or endpoint.query
            or endpoint.fragment
        ):
            raise StorageResolutionError("SeaweedFS endpoint must be a server-owned HTTP origin")
    elif endpoint_url is not None and not isinstance(endpoint_url, str):
        raise StorageResolutionError(f"storage endpoint for {slug!r} is invalid")
    return StorageLocation(storage_type, bucket, decoded_prefix, endpoint_url)


@dataclass(frozen=True, slots=True)
class StorageRegistry:
    locations: Mapping[str, StorageLocation]

    @classmethod
    def from_json(cls, value: str) -> StorageRegistry:
        try:
            raw = TypeAdapter(dict[str, dict[str, object]]).validate_json(value)
        except (TypeError, ValidationError) as error:
            raise StorageResolutionError("storage locations must be valid JSON") from error
        locations: dict[str, StorageLocation] = {}
        for slug, config in raw.items():
            if not slug:
                raise StorageResolutionError("storage location slug is invalid")
            locations[slug] = _parse_location(slug, config)
        return cls(MappingProxyType(locations))

    def resolve(self, slug: str, object_keys: tuple[str, ...]) -> ClickHouseSource:
        location = self.locations.get(slug)
        if location is None:
            raise StorageResolutionError("storage location is not configured")
        if not object_keys:
            raise StorageResolutionError("catalog storage location has no objects")
        schemes = ("gs", "gcs") if location.type == "gcs" else ("s3",)
        safe_keys = tuple(
            _safe_key(key, bucket=location.bucket, prefix=location.prefix, schemes=schemes)
            for key in object_keys
        )
        scheme = "gs" if location.type == "gcs" else "s3"
        return ClickHouseSource(
            object_uris=tuple(f"{scheme}://{location.bucket}/{key}" for key in safe_keys),
            seaweed_endpoint=location.endpoint_url if location.type == "seaweedfs" else None,
        )
