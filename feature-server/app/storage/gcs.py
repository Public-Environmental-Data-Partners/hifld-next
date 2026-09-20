"""Fail-closed public GCS object policy for catalog-approved feature reads."""

from __future__ import annotations

import os
from urllib.parse import quote

import duckdb


class GCSStoragePolicyError(ValueError):
    """A catalog object is outside the configured public GCS scope."""


class GCSStoragePolicy:
    """Resolve catalog-relative keys to HTTPS URLs in one public bucket."""

    def __init__(self) -> None:
        self.slug = os.environ.get("FEATURE_SERVER_GCS_STORAGE_SLUG", "")
        self.bucket = os.environ.get("FEATURE_SERVER_GCS_BUCKET", "")
        self.prefix = os.environ.get("FEATURE_SERVER_GCS_PREFIX", "hifld/")
        if not self.slug or not self.bucket or not self.prefix:
            raise GCSStoragePolicyError("public GCS storage is not configured")
        if "/" in self.bucket or any(part in {"", ".", ".."} for part in self.bucket.split("/")):
            raise GCSStoragePolicyError("public GCS bucket is invalid")
        normalized_prefix = self.prefix.strip("/")
        if not normalized_prefix or any(
            part in {".", ".."} for part in normalized_prefix.split("/")
        ):
            raise GCSStoragePolicyError("public GCS prefix is invalid")
        self.prefix = normalized_prefix + "/"

    def resolve_object_keys(self, object_keys: tuple[str, ...]) -> tuple[str, ...]:
        if not object_keys or any(
            key.startswith("/")
            or ".." in key.replace("\\", "/").split("/")
            or not key.startswith(self.prefix)
            for key in object_keys
        ):
            raise GCSStoragePolicyError("catalog object is outside approved public GCS scope")
        return tuple(
            f"https://storage.googleapis.com/{self.bucket}/{quote(key, safe='/')}"
            for key in object_keys
        )

    @staticmethod
    def configure(connection: duckdb.DuckDBPyConnection) -> None:
        """Enable DuckDB's HTTPS filesystem bundled into the server image."""
        connection.execute("LOAD httpfs")
