"""Server-owned storage profiles and the safe DuckDB storage contract."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class _Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    slug: str
    bucket: str
    prefix: str = ""


class PublicGcsProfile(_Profile):
    """A public, unauthenticated Google Cloud Storage bucket."""

    type: Literal["public_gcs"] = "public_gcs"


class S3Profile(_Profile):
    """An AWS S3 bucket and credentials owned by the MCP server."""

    type: Literal["s3"] = "s3"
    region: str
    access_key_id: SecretStr
    secret_access_key: SecretStr


class SeaweedProfile(_Profile):
    """A server-managed SeaweedFS S3-compatible bucket."""

    type: Literal["seaweedfs"] = "seaweedfs"
    endpoint: str
    access_key_id: SecretStr
    secret_access_key: SecretStr
    use_path_style: bool = True
    tls: bool = False


StorageProfile = Annotated[
    PublicGcsProfile | S3Profile | SeaweedProfile,
    Field(discriminator="type"),
]


class StorageSettings(BaseModel):
    """Immutable server configuration indexed by catalog storage slug."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    profiles: dict[str, StorageProfile]


class DuckDbSetupOperation(BaseModel):
    """A trusted setup action; values are never interpolated into SQL."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    statement: str
    parameters: tuple[str | SecretStr, ...] = ()


class DuckDbSecretSpec(BaseModel):
    """Request-scoped DuckDB secret settings, with redacted credentials."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: Literal["config"] = "config"
    region: str | None = None
    endpoint: str | None = None
    url_style: Literal["vhost", "path"] = "vhost"
    tls: bool = True
    access_key_id: SecretStr
    secret_access_key: SecretStr


class DuckDbSourceSpec(BaseModel):
    """Exact source objects plus trusted, request-scoped DuckDB setup."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    object_uris: tuple[str, ...]
    setup_operations: tuple[DuckDbSetupOperation, ...] = ()
    secret: DuckDbSecretSpec | None = None
