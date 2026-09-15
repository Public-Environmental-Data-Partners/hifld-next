"""Route and startup tests for the Dataset API."""

import asyncio
import sys
import warnings
from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from api.datasets import DatasetVersionUpsertRequest
from database.db import get_db
from main import app
from models import helpers
from models.dataset import (
    BucketStorageLocationConfig,
    Collection,
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    Format,
    StorageLocation,
)
from models.helpers import file_source_json_dict, storage_location_json_dict
from services.dataset import DatasetService, shaping


HTTP_OK = 200
GCS_CLIENT_CREATION_MESSAGE = "URL formatting must not create a GCS client"


def test_geoserver_routes_are_not_registered() -> None:
    """Verify the expected behavior."""
    routes = {getattr(route, "path", "") for route in app.routes if getattr(route, "path", "")}

    assert not any(path.startswith("/api/geoserver") for path in routes)


def test_quality_compute_routes_are_not_registered() -> None:
    """Verify dataset quality is not computed on demand by the API."""
    routes = {getattr(route, "path", "") for route in app.routes if getattr(route, "path", "")}

    assert not any(path.endswith("/compute-quality") for path in routes)


def test_dataset_service_module_exports_public_service() -> None:
    """Verify dataset service code is exported from the dataset module."""
    assert DatasetService.__name__ == "DatasetService"


def test_openapi_schema_includes_dataset_version_upsert_request() -> None:
    """Verify recursive JSON metadata does not break OpenAPI generation."""
    cached_schema = app.openapi_schema
    try:
        app.openapi_schema = None
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/openapi.json")

        assert response.status_code == HTTP_OK
        schemas = response.json()["components"]["schemas"]
        assert {"DatasetVersionUpsertRequest", "JSONDict", "JSONValue"} <= schemas.keys()
    finally:
        app.openapi_schema = cached_schema


def test_dataset_version_request_accepts_nested_json_metadata() -> None:
    """Verify named recursive aliases preserve nested metadata validation."""
    payload = {
        "version": "2026-08-04",
        "storage_location_name": "gcs",
        "files": [
            {
                "file_slug": "hospitals",
                "path": "hifld/hospitals.parquet",
                "format_type": "geoparquet",
                "source_type": "file",
                "source_metadata": {"columns": [{"name": "geometry", "nullable": True}]},
            }
        ],
        "overwrite_existing": False,
    }

    request = DatasetVersionUpsertRequest.model_validate(payload)

    assert request.model_dump(exclude_none=True) == payload


def test_startup_database_setup_logs_revision_and_initializes_db(monkeypatch: MonkeyPatch) -> None:
    """Verify the expected behavior."""
    calls: list[str] = []

    class FakeCommand:
        """Test helper FakeCommand."""

        @staticmethod
        def current(_cfg: object) -> None:
            """Test helper for current."""
            calls.append("current-before")

        @staticmethod
        def upgrade(_cfg: object, target: str) -> None:
            """Test helper for upgrade."""
            calls.append(f"upgrade-{target}")

    monkeypatch.setattr(main, "alembic_command", FakeCommand)
    monkeypatch.setattr(main, "init_db", lambda: calls.append("init-db"))

    main.run_startup_database_setup()

    assert calls == ["current-before", "upgrade-head", "current-before", "init-db"]


def test_dynamic_dataset_routes_do_not_infer_recursive_response_models() -> None:
    """Verify dynamic dataset payload routes serialize without response model inference."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        collection = Collection(slug="hifld", name="HIFLD")
        session.add(collection)
        session.commit()
        session.refresh(collection)

        dataset = Dataset(
            slug="nfhl",
            name="NFHL",
            description="National Flood Hazard Layer",
            collection_id=collection.id,
            tags={"categories": ["Natural Hazards"]},
        )
        session.add(dataset)
        session.commit()
        session.refresh(dataset)

        file_obj = File(dataset_id=dataset.id, slug="alluvial-fans", name="Alluvial Fans")
        session.add(file_obj)
        session.commit()

    def override_get_db() -> Session:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        list_response = client.get("/api/collections/1/datasets", params={"limit": 100, "offset": 0})
        detail_response = client.get("/api/collections/1/datasets/by-slug/nfhl/urls")
    finally:
        app.dependency_overrides.clear()

    assert list_response.status_code == HTTP_OK
    assert list_response.json()["items"][0]["slug"] == "nfhl"
    assert detail_response.status_code == HTTP_OK
    assert detail_response.json()["files"][0]["slug"] == "alluvial-fans"


def test_collection_list_can_expand_datasets_and_files() -> None:
    """Verify collection discovery can include compact dataset and file children."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        collection = Collection(slug="hifld", name="HIFLD")
        session.add(collection)
        session.commit()
        session.refresh(collection)

        dataset = Dataset(slug="hospitals-3", name="Hospitals", collection_id=collection.id)
        session.add(dataset)
        session.commit()
        session.refresh(dataset)

        file_obj = File(dataset_id=dataset.id, slug="hospitals-3", name="Hospitals")
        session.add(file_obj)
        session.commit()

    def override_get_db() -> Session:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        response = client.get("/api/collections", params={"include": "datasets,files"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == HTTP_OK
    payload = response.json()
    assert payload[0]["slug"] == "hifld"
    assert payload[0]["datasets"][0]["slug"] == "hospitals-3"
    assert payload[0]["datasets"][0]["files"][0]["slug"] == "hospitals-3"


def test_dataset_list_can_include_files() -> None:
    """Verify dataset list discovery can include compact file children."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        collection = Collection(slug="hifld", name="HIFLD")
        session.add(collection)
        session.commit()
        session.refresh(collection)

        dataset = Dataset(slug="hospitals-3", name="Hospitals", collection_id=collection.id)
        session.add(dataset)
        session.commit()
        session.refresh(dataset)

        file_obj = File(dataset_id=dataset.id, slug="hospitals-3", name="Hospitals")
        session.add(file_obj)
        session.commit()

    def override_get_db() -> Session:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        response = client.get("/api/collections/1/datasets", params={"include": "files"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == HTTP_OK
    assert response.json()["items"][0]["slug"] == "hospitals-3"
    assert response.json()["items"][0]["files"][0]["slug"] == "hospitals-3"


def test_file_source_json_dict_normalizes_json_columns_without_serializer_warnings() -> None:
    """Verify ORM-style JSON dict fields serialize without Pydantic warnings."""
    source = FileSource(
        id=1,
        file_format_id=2,
        storage_location_id=3,
        source_type="file",
        location={"type": "file", "version": "v1", "path": "dataset/file.parquet"},
        source_metadata={"version": "v1", "feature_count": 12},
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        payload = file_source_json_dict(source)

    assert caught == []
    assert payload["location"] == {"type": "file", "version": "v1", "path": "dataset/file.parquet"}
    assert payload["source_metadata"] == {"version": "v1", "feature_count": 12}


def test_storage_location_json_dict_normalizes_config_without_serializer_warnings() -> None:
    """Verify ORM-style storage config dict fields serialize without Pydantic warnings."""
    storage_location = StorageLocation(
        id=1,
        slug="seaweedfs-local",
        name="SeaweedFS Local",
        backend_type="s3",
        config={
            "type": "seaweedfs",
            "version": "v1",
            "base_url": "http://localhost:8888",
            "bucket": "hifld",
            "endpoint_url": "http://localhost:8333",
        },
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        payload = storage_location_json_dict(storage_location)

    assert caught == []
    assert payload["config"] == {
        "type": "seaweedfs",
        "version": "v1",
        "base_url": "http://localhost:8888",
        "bucket": "hifld",
        "endpoint_url": "http://localhost:8333",
    }


def test_gcs_source_urls_are_formatted_without_creating_a_storage_client(monkeypatch: MonkeyPatch) -> None:
    """GCS response URLs are pure formatting and never initialize credentials."""
    source = FileSource(
        id=1,
        file_format_id=2,
        storage_location_id=3,
        source_type="file",
        location=FileLocation(path="hifld/hospitals.parquet"),
    )
    storage_location = StorageLocation(
        id=3,
        slug="gcs",
        name="GCS",
        backend_type="s3",
        config=BucketStorageLocationConfig(
            type="gcs",
            bucket="hifld-next-datasets-prod",
            base_url="https://datasets.example/storage",
        ),
    )

    def fail_client_creation(*_args: object, **_kwargs: object) -> None:
        raise AssertionError(GCS_CLIENT_CREATION_MESSAGE)

    monkeypatch.setattr(helpers, "create_storage_client_from_location", fail_client_creation)

    payload = shaping._safe_source_response(source, {storage_location.id: storage_location})

    assert payload["url"] == "https://datasets.example/storage/hifld/hospitals.parquet"
    assert payload["storage_uri"] == "gs://hifld-next-datasets-prod/hifld/hospitals.parquet"


def test_geoparquet_detail_keeps_catalog_glob_without_expanding_it(monkeypatch: MonkeyPatch) -> None:
    """GeoParquet glob sources remain native DuckDB-discoverable catalog paths."""
    source = FileSource(
        id=1,
        file_format_id=2,
        storage_location_id=3,
        source_type="file",
        location=FileLocation(path="hifld/hospitals/v1/geoparquet/**/*.parquet"),
    )
    storage_location = StorageLocation(
        id=3,
        slug="seaweedfs",
        name="SeaweedFS",
        backend_type="s3",
        config=BucketStorageLocationConfig(
            type="seaweedfs",
            bucket="hifld",
            base_url="http://localhost:8888",
        ),
    )
    context = shaping.SourceContext(
        file_formats_by_file_id={},
        sources_by_file_format_id={2: [source]},
        storage_locations_by_id={3: storage_location},
    )
    expanded = False

    async def record_expansion(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
        nonlocal expanded
        expanded = True
        return []

    monkeypatch.setattr(shaping, "expand_glob_pattern_in_source", record_expansion)

    payload = asyncio.run(
        shaping._detail_format_response(
            File(id=4, dataset_id=5, slug="hospitals", name="Hospitals"),
            FileFormat(id=2, file_id=4, format_id=6),
            Format(id=6, format_type="geoparquet", name="GeoParquet", description="GeoParquet"),
            context,
        )
    )

    assert expanded is False
    assert len(payload["sources"]) == 1
    response_source = payload["sources"][0]
    assert response_source["location"] == {
        "type": "file",
        "version": "v1",
        "path": "hifld/hospitals/v1/geoparquet/**/*.parquet",
    }
    assert response_source["url"] is None
    assert response_source["storage_uri"] == (
        "s3://hifld/hifld/hospitals/v1/geoparquet/**/*.parquet?endpoint_url=http://localhost:8333"
    )
    assert response_source["glob_pattern"] == response_source["storage_uri"]
