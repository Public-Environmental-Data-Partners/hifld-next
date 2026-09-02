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


def test_development_settings_use_the_configured_public_origin(tmp_path: Path) -> None:
    settings = development_settings(
        {"DATASET_MCP_PUBLIC_ORIGIN": "http://localhost:9001"},
        runtime_directory=tmp_path,
    )

    assert str(settings.public_origin) == "http://localhost:9001/"


def test_main_exports_a_concrete_fastapi_application() -> None:
    from main import app

    assert isinstance(app, FastAPI)
