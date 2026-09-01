from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DATASET_MCP_", extra="forbid")

    catalog_base_url: AnyHttpUrl
    query_token_secret: SecretStr = Field(min_length=32)
    query_token_ttl_seconds: int = Field(default=7_200, ge=60, le=7_200)
    query_default_limit: int = Field(default=100, ge=1, le=1_000)
    query_max_limit: int = Field(default=1_000, ge=1, le=1_000)
    query_max_offset: int = Field(default=50_000, ge=0)
    query_timeout_seconds: float = Field(default=30.0, gt=0)
    tile_timeout_seconds: float = Field(default=10.0, gt=0, le=10.0)
    worker_count: int = Field(default=1, ge=1, le=8)
    duckdb_threads: int = Field(default=2, ge=1, le=8)
    duckdb_memory_limit: str = "1GiB"
    duckdb_temp_directory: str = "/tmp/dataset-mcp"
    duckdb_max_temp_directory_size: str = "3GiB"
    duckdb_extension_directory: str = "/opt/duckdb/extensions"
    max_sources: int = Field(default=8, ge=1, le=8)
    max_result_bytes: int = Field(default=4 * 1024 * 1024, ge=1024)
    public_origin: AnyHttpUrl | None = None
    webapp_origins: Annotated[tuple[str, ...], NoDecode] = ()
    http_allowed_hosts: Annotated[tuple[str, ...], NoDecode] = ()
    max_concurrency: int = Field(default=8, ge=1, le=64)

    @field_validator("webapp_origins", mode="before")
    @classmethod
    def parse_webapp_origins(cls, value: str | tuple[str, ...]) -> tuple[str, ...]:
        values = (
            tuple(part.strip() for part in value.split(",")) if isinstance(value, str) else value
        )
        origins: list[str] = []
        for value in values:
            parsed = urlsplit(value)
            if (
                not parsed.scheme
                or parsed.hostname is None
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("webapp origins must be absolute origins without a path")
            try:
                port = parsed.port
            except ValueError as error:
                raise ValueError("webapp origins must use a valid port") from error
            hostname = parsed.hostname.lower()
            if parsed.scheme != "https" and not (
                parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1"}
            ):
                raise ValueError("webapp origins must use HTTPS except for localhost development")
            default_port = 443 if parsed.scheme == "https" else 80
            host = f"[{hostname}]" if ":" in hostname else hostname
            netloc = host if port is None or port == default_port else f"{host}:{port}"
            origins.append(f"{parsed.scheme}://{netloc}")
        if len(set(origins)) != len(origins):
            raise ValueError("webapp origins must be unique")
        return tuple(origins)

    @field_validator("http_allowed_hosts", mode="before")
    @classmethod
    def parse_http_allowed_hosts(cls, value: str | tuple[str, ...]) -> tuple[str, ...]:
        values = (
            tuple(part.strip() for part in value.split(",")) if isinstance(value, str) else value
        )
        hosts: list[str] = []
        for value in values:
            candidate = value.strip().lower()
            if not candidate or "*" in candidate:
                raise ValueError("HTTP allowed hosts must be exact hostnames")
            parsed = urlsplit(f"//{candidate}")
            if (
                parsed.hostname is None
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("HTTP allowed hosts must be hostnames without a path")
            try:
                _ = parsed.port
            except ValueError as error:
                raise ValueError("HTTP allowed hosts must use a valid port") from error
            hostname = parsed.hostname.lower()
            hosts.append(hostname)
        if len(set(hosts)) != len(hosts):
            raise ValueError("HTTP allowed hosts must be unique")
        return tuple(hosts)
