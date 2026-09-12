import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_require_catalog_and_token_secret() -> None:
    settings = Settings(catalog_base_url="http://dataset-api:8000", query_token_secret="x" * 32)

    assert str(settings.catalog_base_url) == "http://dataset-api:8000/"
    assert settings.query_default_limit == 100
    assert settings.query_max_limit == 1_000
    assert settings.tile_timeout_seconds == 30
    assert settings.tile_cache_max_bytes == 256 * 1024 * 1024
    assert settings.tile_cache_ttl_seconds == 60
    assert settings.tile_cache_max_in_flight == 64
    assert settings.tile_cache_max_entries == 4_096
    assert settings.worker_count == 2
    assert settings.duckdb_threads == 1
    assert settings.duckdb_memory_limit == "1GiB"
    assert settings.duckdb_max_temp_directory_size == "3GiB"


def test_settings_reject_short_token_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(catalog_base_url="http://dataset-api:8000", query_token_secret="short")


def test_settings_reject_tile_timeout_over_thirty_seconds() -> None:
    with pytest.raises(ValidationError):
        Settings(
            catalog_base_url="http://dataset-api:8000",
            query_token_secret="x" * 32,
            tile_timeout_seconds=30.1,
        )


def test_settings_reject_token_ttl_longer_than_codec_contract() -> None:
    with pytest.raises(ValidationError):
        Settings(
            catalog_base_url="http://dataset-api:8000",
            query_token_secret="x" * 32,
            query_token_ttl_seconds=7_201,
        )


def test_settings_normalize_http_allowed_hosts() -> None:
    settings = Settings(
        catalog_base_url="http://dataset-api:8000",
        query_token_secret="x" * 32,
        http_allowed_hosts="Dataset-MCP, mcp.example.test:443",
    )

    assert settings.http_allowed_hosts == ("dataset-mcp", "mcp.example.test")


@pytest.mark.parametrize(
    "host",
    [
        "*",
        "https://mcp.example.test",
        "mcp.example.test/path",
        "user@mcp.example.test",
        "mcp.example.test,mcp.example.test",
    ],
)
def test_settings_reject_unsafe_http_allowed_hosts(host: str) -> None:
    with pytest.raises(ValidationError):
        Settings(
            catalog_base_url="http://dataset-api:8000",
            query_token_secret="x" * 32,
            http_allowed_hosts=host,
        )
