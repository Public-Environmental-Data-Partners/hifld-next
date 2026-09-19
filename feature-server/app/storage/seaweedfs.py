"""Fail-closed SeaweedFS object policy; requests never supply these values."""

from __future__ import annotations

import os
from urllib.parse import urlparse

import duckdb


class StoragePolicyError(ValueError):
    """A catalog object is outside the deployment-approved storage scope."""


def _quoted(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class SeaweedFSStoragePolicy:
    def __init__(
        self,
        *,
        endpoint: str | None = None,
        bucket: str | None = None,
        prefix: str | None = None,
    ) -> None:
        self.endpoint = endpoint or os.environ.get("FEATURE_SERVER_S3_ENDPOINT", "")
        self.bucket = bucket or os.environ.get("S3_BUCKET", "")
        self.prefix = (
            prefix if prefix is not None else os.environ.get("FEATURE_SERVER_S3_PREFIX", "hifld/")
        )
        self.access_key = os.environ.get("S3_ACCESS_KEY_ID", "")
        self.secret_key = os.environ.get("S3_SECRET_ACCESS_KEY", "")
        parsed = urlparse(self.endpoint)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or not self.bucket
            or not self.prefix
        ):
            raise StoragePolicyError("SeaweedFS deployment storage is not configured")

    def approved_objects(self, objects: tuple[str, ...]) -> tuple[str, ...]:
        prefix = f"s3://{self.bucket}/{self.prefix.rstrip('/')}/"
        if not objects or any(
            not value.startswith(prefix) or ".." in value.split("/") for value in objects
        ):
            raise StoragePolicyError("catalog object is outside approved storage scope")
        return objects

    def resolve_object_keys(self, object_keys: tuple[str, ...]) -> tuple[str, ...]:
        """Turn catalog-relative keys into fixed S3 URIs without client input."""
        prefix = self.prefix.rstrip("/") + "/"
        if not object_keys or any(
            key.startswith("/") or ".." in key.split("/") or not key.startswith(prefix)
            for key in object_keys
        ):
            raise StoragePolicyError("catalog object is outside approved storage scope")
        return tuple(f"s3://{self.bucket}/{key}" for key in object_keys)

    def configure(self, connection: duckdb.DuckDBPyConnection) -> None:
        connection.execute("SET autoinstall_known_extensions = false")
        connection.execute("SET autoload_known_extensions = false")
        connection.execute("LOAD httpfs")
        options = ", ".join(
            (
                "TYPE S3",
                "PROVIDER CONFIG",
                f"KEY_ID {_quoted(self.access_key)}",
                f"SECRET {_quoted(self.secret_key)}",
                f"ENDPOINT {_quoted(urlparse(self.endpoint).netloc)}",
                "URL_STYLE 'path'",
                f"USE_SSL {'true' if self.endpoint.startswith('https://') else 'false'}",
                f"SCOPE {_quoted(f's3://{self.bucket}/{self.prefix.rstrip("/")}')}",
            )
        )
        connection.execute(f"CREATE SECRET hifld_feature_server ({options})")
