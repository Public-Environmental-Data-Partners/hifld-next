import asyncio
import importlib
import json
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import config
from api import admin as admin_api
from models.dataset import (
    BucketStorageLocationConfig,
    ColumnSchema,
    Collection,
    Dataset,
    File,
    FileSource,
    FileFormat,
    Format,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from scripts.seed_formats import DEFAULT_FORMATS, seed_formats
from services.discovery import DiscoveredVersion, DiscoveryService
from services.datasets import DatasetService


class FakeStorageClient:
    def __init__(self, files: dict[str, bytes]):
        self.files = files

    async def list_files(self, prefix: str) -> list[str]:
        return sorted(path for path in self.files if path.startswith(prefix))

    async def download_file(self, remote_path: str, local_path: Path) -> None:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(self.files[remote_path])


def make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def make_storage_location() -> StorageLocation:
    return StorageLocation(
        name="SeaweedFS Test",
        backend_type="s3",
        description="Test SeaweedFS bucket",
        config=BucketStorageLocationConfig(
            type="seaweedfs",
            base_url="http://localhost:8888",
            bucket="hifld",
        ),
    )


def make_storage_files() -> dict[str, bytes]:
    quality_manifest_v1 = {
        "dataset_name": "Test Dataset",
        "description": "Dataset description",
        "tags": {"agency": "PEDP"},
        "feature_count": 10,
        "bounds": [0, 0, 1, 1],
        "geometry_type": "Polygon",
        "columns_hash": "hash-v1",
    }
    quality_manifest_v2 = {
        "dataset_name": "Test Dataset",
        "description": "Dataset description",
        "tags": {"agency": "PEDP"},
        "feature_count": 12,
        "bounds": [0, 0, 2, 2],
        "geometry_type": "Polygon",
        "columns_hash": "hash-v2",
    }
    data_dictionary_v1 = {
        "columns": [
            {
                "name": "district_name",
                "type": "STRING",
                "description": "Congressional district name",
                "nullable": False,
                "num_null_values": 0,
            }
        ]
    }
    data_dictionary_v2 = {
        "columns": [
            {
                "name": "district_name",
                "type": "STRING",
                "description": "Congressional district name",
                "nullable": False,
                "num_null_values": 0,
            },
            {
                "name": "population",
                "type": "INTEGER",
                "description": "Population estimate",
                "nullable": True,
                "num_null_values": 1,
            },
        ]
    }

    return {
        "test-dataset/test-dataset/v20260101/geoparquet/test-dataset-0.parquet": b"parquet-v1",
        "test-dataset/test-dataset/v20260101/pmtiles/tiles.pmtiles": b"pmtiles-v1",
        "test-dataset/test-dataset/v20260101/metadata/quality_manifest.json": json.dumps(
            quality_manifest_v1
        ).encode("utf-8"),
        "test-dataset/test-dataset/v20260101/metadata/data_dictionary.json": json.dumps(
            data_dictionary_v1
        ).encode("utf-8"),
        "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet": b"parquet-v2",
        "test-dataset/test-dataset/v20260214/pmtiles/tiles.pmtiles": b"pmtiles-v2",
        "test-dataset/test-dataset/v20260214/metadata/quality_manifest.json": json.dumps(
            quality_manifest_v2
        ).encode("utf-8"),
        "test-dataset/test-dataset/v20260214/metadata/data_dictionary.json": json.dumps(
            data_dictionary_v2
        ).encode("utf-8"),
    }


def make_admin_test_client(monkeypatch, session: Session, api_key: str | None) -> TestClient:
    monkeypatch.setattr(config, "ADMIN_API_KEY", api_key, raising=False)

    app = FastAPI()
    app.include_router(admin_api.router)
    app.dependency_overrides[admin_api.get_dataset_service] = lambda: DatasetService(session)
    return TestClient(app)


def test_spatial_dataset_file_metadata_uses_typed_columns():
    metadata = SpatialDatasetFileMetadata(
        columns=[
            {
                "name": "district_name",
                "type": "STRING",
                "description": "Congressional district name",
                "nullable": False,
            }
        ]
    )

    assert isinstance(metadata.columns, list)
    assert isinstance(metadata.columns[0], ColumnSchema)
    assert metadata.columns[0].description == "Congressional district name"


def test_seed_formats_includes_new_discoverable_formats():
    with make_session() as session:
        results = seed_formats(session, DEFAULT_FORMATS)
        assert results["created"] >= 7

        format_types = {
            row.format_type for row in session.exec(select(Format)).all()
        }
        assert {"geopackage", "shapefile", "geojson", "file_geodatabase"} <= format_types


def test_discovery_service_yields_discovered_versions():
    fake_storage = FakeStorageClient(make_storage_files())
    service = DiscoveryService(storage_client=fake_storage)

    async def collect_versions() -> list[DiscoveredVersion]:
        return [item async for item in service.scan(limit=3)]

    discovered_versions = asyncio.run(collect_versions())

    assert len(discovered_versions) == 3
    assert all(isinstance(item, DiscoveredVersion) for item in discovered_versions)
    assert [item.format_type for item in discovered_versions] == [
        "geoparquet",
        "pmtiles",
        "geoparquet",
    ]

    latest_geoparquet = next(
        item
        for item in discovered_versions
        if item.version == "v20260214" and item.format_type == "geoparquet"
    )
    assert latest_geoparquet.location_path.endswith("test-dataset-0.parquet")
    assert latest_geoparquet.metadata is not None
    assert latest_geoparquet.metadata.columns is not None
    assert latest_geoparquet.metadata.columns[1].description == "Population estimate"


def test_admin_storage_location_requires_api_key_when_configured(monkeypatch):
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        client = make_admin_test_client(monkeypatch, session, api_key="secret-key")

        response = client.get(f"/api/admin/storage-locations/{storage_location.id}")
        assert response.status_code == 403

        response = client.get(
            f"/api/admin/storage-locations/{storage_location.id}",
            headers={"X-API-Key": "wrong-key"},
        )
        assert response.status_code == 403

        response = client.get(
            f"/api/admin/storage-locations/{storage_location.id}",
            headers={"X-API-Key": "secret-key"},
        )
        assert response.status_code == 200
        assert response.json()["id"] == storage_location.id


def test_admin_get_storage_location_allows_requests_when_api_key_unset(monkeypatch):
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        client = make_admin_test_client(monkeypatch, session, api_key=None)

        response = client.get(f"/api/admin/storage-locations/{storage_location.id}")
        assert response.status_code == 200
        assert response.json()["id"] == storage_location.id


def test_admin_create_version_dry_run_does_not_write(monkeypatch):
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        client = make_admin_test_client(monkeypatch, session, api_key="secret-key")

        response = client.post(
            (
                f"/api/admin/storage-locations/{storage_location.id}"
                "/datasets/test-dataset/files/test-dataset/formats/geoparquet/versions"
            ),
            headers={"X-API-Key": "secret-key"},
            json={
                "version": "v20260214",
                "location_path": "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
                "source_metadata": {
                    "version": "v1",
                    "feature_count": 12,
                },
                "dry_run": True,
            },
        )
        assert response.status_code == 200
        assert response.json() == {
            "created": True,
            "dry_run": True,
            "file_source_id": None,
        }
        assert session.exec(select(Dataset)).all() == []
        assert session.exec(select(FileSource)).all() == []


def test_admin_create_version_writes_and_deduplicates(monkeypatch):
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        client = make_admin_test_client(monkeypatch, session, api_key="secret-key")

        create_response = client.post(
            (
                f"/api/admin/storage-locations/{storage_location.id}"
                "/datasets/test-dataset/files/test-dataset/formats/geoparquet/versions"
            ),
            headers={"X-API-Key": "secret-key"},
            json={
                "version": "v20260214",
                "location_path": "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
                "source_metadata": {
                    "version": "v1",
                    "feature_count": 12,
                },
            },
        )
        assert create_response.status_code == 200
        create_payload = create_response.json()
        assert create_payload["created"] is True
        assert create_payload["dry_run"] is False
        assert isinstance(create_payload["file_source_id"], int)

        dataset = session.exec(select(Dataset).where(Dataset.slug == "test-dataset")).one()
        collection = session.exec(select(Collection).where(Collection.slug == "hifld")).one()
        file_obj = session.exec(select(File).where(File.dataset_id == dataset.id)).one()
        file_format = session.exec(select(FileFormat).where(FileFormat.file_id == file_obj.id)).one()
        file_source = session.exec(select(FileSource).where(FileSource.file_format_id == file_format.id)).one()

        assert dataset.collection_id == collection.id
        assert file_obj.slug == "test-dataset"
        assert file_source.version == "v20260214"
        assert file_source.source_metadata is not None

        duplicate_response = client.post(
            (
                f"/api/admin/storage-locations/{storage_location.id}"
                "/datasets/test-dataset/files/test-dataset/formats/geoparquet/versions"
            ),
            headers={"X-API-Key": "secret-key"},
            json={
                "version": "v20260214",
                "location_path": "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
            },
        )
        assert duplicate_response.status_code == 200
        assert duplicate_response.json() == {
            "created": False,
            "dry_run": False,
            "file_source_id": file_source.id,
        }

        assert len(session.exec(select(FileSource)).all()) == 1


def test_admin_old_versions_path_is_removed(monkeypatch):
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        client = make_admin_test_client(monkeypatch, session, api_key="secret-key")

        response = client.post(
            "/api/admin/storage-locations/1/versions",
            headers={"X-API-Key": "secret-key"},
            json={},
        )
        assert response.status_code == 404


def test_discover_job_loads_required_env_vars(monkeypatch):
    monkeypatch.setenv("DATASET_API_URL", "https://dataset-api.example.com")
    monkeypatch.setenv("DATASET_API_KEY", "secret-key")
    monkeypatch.setenv("STORAGE_LOCATION_IDS", "6, 7")
    monkeypatch.setenv("DISCOVER_PREFIX", "foo/bar")
    monkeypatch.setenv("DISCOVER_DRY_RUN", "true")
    monkeypatch.setenv("DISCOVER_LIMIT", "5")

    discover_job = importlib.import_module("jobs.discover")
    config = discover_job.load_config_from_env()

    assert config.dataset_api_url == "https://dataset-api.example.com"
    assert config.dataset_api_key == "secret-key"
    assert config.storage_location_ids == [6, 7]
    assert config.discover_prefix == "foo/bar"
    assert config.discover_dry_run is True
    assert config.discover_limit == 5


def test_discover_job_fetches_storage_location_scans_and_posts_versions(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")
    captured_get_requests: list[tuple[int, str | None]] = []
    captured_post_requests: list[tuple[str, str | None, dict[str, object]]] = []

    storage_location = make_storage_location()
    storage_location.id = 6

    class FakeScanner:
        def __init__(self, storage_client):
            self.storage_client = storage_client

        async def scan(self, prefix: str = "", limit: int | None = None):
            yield DiscoveredVersion(
                dataset_slug="test-dataset",
                file_slug="test-dataset",
                version="v20260214",
                format_type="geoparquet",
                location_path="test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
                metadata=SpatialDatasetFileMetadata(version="v1", feature_count=12),
            )
            yield DiscoveredVersion(
                dataset_slug="test-dataset",
                file_slug="test-dataset",
                version="v20260214",
                format_type="pmtiles",
                location_path="test-dataset/test-dataset/v20260214/pmtiles/tiles.pmtiles",
                metadata=None,
            )

    fake_storage_client = object()
    monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
    monkeypatch.setattr(
        discover_job,
        "create_storage_client_from_location",
        lambda _: fake_storage_client,
    )

    app = FastAPI()

    @app.get("/api/admin/storage-locations/{storage_location_id}")
    async def get_storage_location_endpoint(storage_location_id: int, request: Request):
        captured_get_requests.append(
            (
                storage_location_id,
                request.headers.get("x-api-key"),
            )
        )
        return storage_location.model_dump()

    @app.post(
        "/api/admin/storage-locations/{storage_location_id}/datasets/{dataset_slug}/files/{file_slug}/formats/{format_type}/versions"
    )
    async def create_version_endpoint(
        storage_location_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
        payload: dict[str, object],
        request: Request,
    ):
        captured_post_requests.append(
            (
                f"{storage_location_id}:{dataset_slug}:{file_slug}:{format_type}",
                request.headers.get("x-api-key"),
                payload,
            )
        )
        return {"created": True, "dry_run": False, "file_source_id": storage_location_id}

    async def run_test() -> int:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="https://dataset-api.example.com",
        ) as client:
            return await discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    dataset_api_url="https://dataset-api.example.com",
                    dataset_api_key="secret-key",
                    storage_location_ids=[6],
                    discover_prefix="foo/bar",
                    discover_dry_run=True,
                    discover_limit=5,
                ),
                client=client,
            )

    exit_code = asyncio.run(run_test())

    assert exit_code == 0
    assert captured_get_requests == [
        (
            6,
            "secret-key",
        ),
    ]
    assert captured_post_requests == [
        (
            "6:test-dataset:test-dataset:geoparquet",
            "secret-key",
            {
                "version": "v20260214",
                "location_path": "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
                "source_metadata": {
                    "version": "v1",
                    "size_bytes": None,
                    "mime_type": None,
                    "feature_count": 12,
                    "bounds": None,
                    "geometry_type": None,
                    "invalid_geometry_count": None,
                    "quality_check_passed": None,
                    "columns_hash": None,
                    "columns": None,
                },
                "dry_run": True,
            },
        ),
        (
            "6:test-dataset:test-dataset:pmtiles",
            "secret-key",
            {
                "version": "v20260214",
                "location_path": "test-dataset/test-dataset/v20260214/pmtiles/tiles.pmtiles",
                "source_metadata": None,
                "dry_run": True,
            },
        ),
    ]


def test_discover_job_returns_one_when_fetch_or_create_fails(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")

    class FakeScanner:
        def __init__(self, storage_client):
            self.storage_client = storage_client

        async def scan(self, prefix: str = "", limit: int | None = None):
            yield DiscoveredVersion(
                dataset_slug="test-dataset",
                file_slug="test-dataset",
                version="v20260214",
                format_type="geoparquet",
                location_path="test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
                metadata=None,
            )

    monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
    monkeypatch.setattr(
        discover_job,
        "create_storage_client_from_location",
        lambda _: object(),
    )

    app = FastAPI()

    @app.get("/api/admin/storage-locations/{storage_location_id}")
    async def get_storage_location_endpoint(storage_location_id: int):
        if storage_location_id == 7:
            return JSONResponse(
                status_code=500,
                content={"detail": "boom"},
            )
        storage_location = make_storage_location()
        storage_location.id = storage_location_id
        return storage_location.model_dump()

    @app.post(
        "/api/admin/storage-locations/{storage_location_id}/datasets/{dataset_slug}/files/{file_slug}/formats/{format_type}/versions"
    )
    async def create_version_endpoint(storage_location_id: int):
        if storage_location_id == 6:
            return JSONResponse(
                status_code=500,
                content={"detail": "boom"},
            )
        return {"created": True, "dry_run": False, "file_source_id": storage_location_id}

    async def run_test() -> int:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="https://dataset-api.example.com",
        ) as client:
            return await discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    dataset_api_url="https://dataset-api.example.com",
                    dataset_api_key="secret-key",
                    storage_location_ids=[6, 7],
                ),
                client=client,
            )

    exit_code = asyncio.run(run_test())

    assert exit_code == 1
