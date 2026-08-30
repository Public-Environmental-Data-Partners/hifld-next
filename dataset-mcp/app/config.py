from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.storage.models import StorageSettings


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
    duckdb_extension_directory: str = "/opt/duckdb/extensions"
    max_sources: int = Field(default=8, ge=1, le=8)
    max_result_bytes: int = Field(default=4 * 1024 * 1024, ge=1024)
    public_origin: AnyHttpUrl | None = None
    max_concurrency: int = Field(default=8, ge=1, le=64)
    storage_settings: StorageSettings = Field(default_factory=lambda: StorageSettings(profiles={}))
