from pathlib import Path

from fastapi import FastAPI

from app.development import development_settings


def test_development_settings_need_no_secrets_or_storage_configuration(tmp_path: Path) -> None:
    settings = development_settings({}, runtime_directory=tmp_path)

    assert str(settings.catalog_base_url) == "http://127.0.0.1:8000/"
    assert str(settings.public_origin) == "http://127.0.0.1:8001/"
    assert len(settings.query_token_secret.get_secret_value()) >= 32
    assert settings.duckdb_temp_directory == str(tmp_path / "spill")
    assert settings.duckdb_extension_directory == str(tmp_path / "extensions")
    assert settings.webapp_origins == ("http://127.0.0.1:3000", "http://localhost:3000")


def test_development_settings_use_the_configured_catalog(tmp_path: Path) -> None:
    settings = development_settings(
        {"DATASET_MCP_CATALOG_BASE_URL": "http://127.0.0.1:9000"},
        runtime_directory=tmp_path,
    )

    assert str(settings.catalog_base_url) == "http://127.0.0.1:9000/"


def test_development_settings_use_catalog_storage_and_clickhouse_environment(
    tmp_path: Path,
) -> None:
    settings = development_settings(
        {
            "DATASET_MCP_CATALOG_STORAGE_LOCATIONS": (
                '{"gcp":{"type":"gcs","base_url":"https://storage.googleapis.com/gcp",'
                '"bucket":"gcp"}}'
            ),
            "DATASET_MCP_CLICKHOUSE_URL": "http://127.0.0.1:8123",
            "DATASET_MCP_CLICKHOUSE_USERNAME": "hifld_query",
            "DATASET_MCP_CLICKHOUSE_PASSWORD": "query-password",
            "DATASET_MCP_CLICKHOUSE_CONTROL_USERNAME": "hifld_control",
            "DATASET_MCP_CLICKHOUSE_CONTROL_PASSWORD": "control-password",
            "DATASET_MCP_CLICKHOUSE_SEAWEED_ENDPOINT": "http://seaweedfs-filer:8333",
        },
        runtime_directory=tmp_path,
    )

    assert tuple(settings.catalog_storage_locations) == ("gcp",)
    assert settings.clickhouse_username == "hifld_query"
    assert settings.clickhouse_password.get_secret_value() == "query-password"
    assert settings.clickhouse_control_password.get_secret_value() == "control-password"
    assert settings.clickhouse_seaweed_endpoint == "http://seaweedfs-filer:8333"


def test_development_settings_use_the_configured_public_origin(tmp_path: Path) -> None:
    settings = development_settings(
        {"DATASET_MCP_PUBLIC_ORIGIN": "http://localhost:9001"},
        runtime_directory=tmp_path,
    )

    assert str(settings.public_origin) == "http://localhost:9001/"


def test_main_exports_a_concrete_fastapi_application() -> None:
    from main import app

    assert isinstance(app, FastAPI)
