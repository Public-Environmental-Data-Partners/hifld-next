import asyncio
import importlib
import json
import logging
import sys
from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
from services.catalog_ingest import CatalogIngestService
from services.discovery import DiscoveredVersion, DiscoveryService


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
                "numNullValues": 1,
                "numUniqueValues": 11,
                "exampleValues": ["10", "20"],
                "possibleValues": ["10", "20", "30"],
            },
        ]
    }

    return {
        "test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet": b"parquet-v1",
        "test-dataset/test-dataset/v1.0.0/pmtiles/tiles.pmtiles": b"pmtiles-v1",
        "test-dataset/test-dataset/v1.0.0/metadata/quality_manifest.json": json.dumps(
            quality_manifest_v1
        ).encode("utf-8"),
        "test-dataset/test-dataset/v1.0.0/metadata/data_dictionary.json": json.dumps(
            data_dictionary_v1
        ).encode("utf-8"),
        "test-dataset/test-dataset/v1.1.0/geoparquet/test-dataset-0.parquet": b"parquet-v2",
        "test-dataset/test-dataset/v1.1.0/geoparquet/test-dataset-1.parquet": b"parquet-v2-part2",
        "test-dataset/test-dataset/v1.1.0/pmtiles/tiles.pmtiles": b"pmtiles-v2",
        "test-dataset/test-dataset/v1.1.0/metadata/quality_manifest.json": json.dumps(
            quality_manifest_v2
        ).encode("utf-8"),
        "test-dataset/test-dataset/v1.1.0/metadata/data_dictionary.json": json.dumps(
            data_dictionary_v2
        ).encode("utf-8"),
        "test-dataset/test-dataset/v20260214/geoparquet/legacy.parquet": b"legacy",
        "metadata-only/metadata-only/v1.0.0/metadata/quality_manifest.json": b"{}",
        "too/short/geoparquet/file.parquet": b"short",
        "test-dataset/test-dataset/v1.1.0/unknown_format/file.bin": b"unknown",
    }


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
        if item.version == "v1.1.0" and item.format_type == "geoparquet"
    )
    assert latest_geoparquet.location_path.endswith("*.parquet")
    assert latest_geoparquet.object_paths == [
        "test-dataset/test-dataset/v1.1.0/geoparquet/test-dataset-0.parquet",
        "test-dataset/test-dataset/v1.1.0/geoparquet/test-dataset-1.parquet",
    ]
    assert latest_geoparquet.metadata is not None
    assert latest_geoparquet.metadata.columns is not None
    assert latest_geoparquet.metadata.columns[1].description == "Population estimate"
    assert latest_geoparquet.metadata.columns[1].num_null_values == 1
    assert latest_geoparquet.metadata.columns[1].num_unique_values == 11
    assert latest_geoparquet.metadata.columns[1].example_values == ["10", "20"]
    assert latest_geoparquet.metadata.columns[1].possible_values == ["10", "20", "30"]
    assert latest_geoparquet.dataset_description == "Dataset description"
    assert {item.version for item in discovered_versions} == {"v1.0.0", "v1.1.0"}


def test_discovery_service_ignores_non_semver_and_metadata_only_groups():
    fake_storage = FakeStorageClient(make_storage_files())
    service = DiscoveryService(storage_client=fake_storage)

    async def collect_versions() -> list[DiscoveredVersion]:
        return [item async for item in service.scan()]

    discovered_versions = asyncio.run(collect_versions())

    assert all(item.version != "v20260214" for item in discovered_versions)
    assert all(item.dataset_slug != "metadata-only" for item in discovered_versions)
    assert all(item.format_type != "unknown_format" for item in discovered_versions)


def test_catalog_ingest_preview_does_not_write():
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        result = ingest.preview_discovered_version(
            storage_location_id=storage_location.id,
            dataset_slug="test-dataset",
            file_slug="test-dataset",
            format_type="geoparquet",
            version="v1.0.0",
        )

        assert result.model_dump() == {
            "created": True,
            "dry_run": True,
            "file_source_id": None,
        }
        assert session.exec(select(Dataset)).all() == []
        assert session.exec(select(FileSource)).all() == []


def test_catalog_ingest_upserts_discovered_version():
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        create_result = ingest.upsert_discovered_version(
            storage_location_id=storage_location.id,
            dataset_slug="test-dataset",
            file_slug="test-dataset",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet",
            source_metadata=SpatialDatasetFileMetadata(version="v1", feature_count=12),
            dataset_description="Dataset description",
        )
        assert create_result.created is True
        assert create_result.dry_run is False
        assert isinstance(create_result.file_source_id, int)

        dataset = session.exec(select(Dataset).where(Dataset.slug == "test-dataset")).one()
        collection = session.exec(select(Collection).where(Collection.slug == "hifld")).one()
        file_obj = session.exec(select(File).where(File.dataset_id == dataset.id)).one()
        file_format = session.exec(select(FileFormat).where(FileFormat.file_id == file_obj.id)).one()
        file_source = session.exec(select(FileSource).where(FileSource.file_format_id == file_format.id)).one()

        assert dataset.collection_id == collection.id
        assert dataset.description == "Dataset description"
        assert file_obj.slug == "test-dataset"
        assert file_source.version == "v1.0.0"
        assert file_source.source_metadata is not None

        upsert_result = ingest.upsert_discovered_version(
            storage_location_id=storage_location.id,
            dataset_slug="test-dataset",
            file_slug="test-dataset",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-updated.parquet",
            source_metadata=SpatialDatasetFileMetadata(
                version="v1",
                feature_count=24,
                geometry_type="Polygon",
            ),
        )
        assert upsert_result.created is False
        assert upsert_result.dry_run is False
        assert upsert_result.file_source_id == file_source.id

        session.refresh(file_source)
        assert len(session.exec(select(FileSource)).all()) == 1
        location_path = (
            file_source.location["path"]
            if isinstance(file_source.location, dict)
            else file_source.location.path
        )
        assert (
            location_path
            == "test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-updated.parquet"
        )
        assert file_source.source_metadata is not None
        metadata = (
            file_source.source_metadata
            if isinstance(file_source.source_metadata, dict)
            else file_source.source_metadata.model_dump()
        )
        assert metadata["feature_count"] == 24
        assert metadata["geometry_type"] == "Polygon"


def test_discover_job_loads_required_env_vars(monkeypatch):
    monkeypatch.setenv("STORAGE_LOCATION_IDS", "6, 7")
    monkeypatch.setenv("DISCOVER_PREFIX", "foo/bar")
    monkeypatch.setenv("DISCOVER_DRY_RUN", "true")
    monkeypatch.setenv("DISCOVER_LIMIT", "5")

    discover_job = importlib.import_module("jobs.discover")
    config = discover_job.load_config_from_env()

    assert config.storage_location_ids == [6, 7]
    assert config.discover_prefix == "foo/bar"
    assert config.discover_dry_run is True
    assert config.discover_limit == 5


def test_discover_job_loads_storage_location_scans_and_upserts_versions(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")

    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)

        class FakeScanner:
            def __init__(self, storage_client):
                self.storage_client = storage_client

            async def scan(self, prefix: str = "", limit: int | None = None):
                assert prefix == "foo/bar"
                assert limit == 5
                yield DiscoveredVersion(
                    dataset_slug="test-dataset",
                    file_slug="test-dataset",
                    version="v1.0.0",
                    format_type="geoparquet",
                    location_path="test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet",
                    object_paths=[
                        "test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet"
                    ],
                    metadata=SpatialDatasetFileMetadata(version="v1", feature_count=12),
                )
                yield DiscoveredVersion(
                    dataset_slug="test-dataset",
                    file_slug="test-dataset",
                    version="v1.0.0",
                    format_type="pmtiles",
                    location_path="test-dataset/test-dataset/v1.0.0/pmtiles/tiles.pmtiles",
                    object_paths=[
                        "test-dataset/test-dataset/v1.0.0/pmtiles/tiles.pmtiles"
                    ],
                    metadata=None,
                )

        fake_storage_client = object()
        monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
        monkeypatch.setattr(
            discover_job,
            "create_storage_client_from_location",
            lambda _: fake_storage_client,
        )

        exit_code = asyncio.run(
            discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    storage_location_ids=[storage_location.id],
                    discover_prefix="foo/bar",
                    discover_dry_run=False,
                    discover_limit=5,
                ),
                db_session=session,
            )
        )

        assert exit_code == 0
        assert session.exec(select(Dataset).where(Dataset.slug == "test-dataset")).one()
        assert len(session.exec(select(FileSource)).all()) == 2


def test_discover_job_logs_dry_run_object_paths_and_summary(monkeypatch, caplog):
    discover_job = importlib.import_module("jobs.discover")
    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)

        class FakeScanner:
            def __init__(self, storage_client):
                self.storage_client = storage_client

            async def scan(self, prefix: str = "", limit: int | None = None):
                yield DiscoveredVersion(
                    dataset_slug="test-dataset",
                    file_slug="test-dataset",
                    version="v1.0.0",
                    format_type="geoparquet",
                    location_path="test-dataset/test-dataset/v1.0.0/geoparquet/*.parquet",
                    object_paths=[
                        "test-dataset/test-dataset/v1.0.0/geoparquet/part-0.parquet",
                        "test-dataset/test-dataset/v1.0.0/geoparquet/part-1.parquet",
                    ],
                    metadata_object_paths=[
                        "test-dataset/test-dataset/v1.0.0/metadata/quality_manifest.json",
                        "test-dataset/test-dataset/v1.0.0/metadata/data_dictionary.json",
                    ],
                    metadata=SpatialDatasetFileMetadata(
                        version="v1",
                        feature_count=12,
                        columns=[{"name": "id", "type": "INTEGER"}],
                    ),
                )

        monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
        monkeypatch.setattr(
            discover_job, "create_storage_client_from_location", lambda _: object()
        )

        with caplog.at_level(logging.INFO, logger=discover_job.logger.name):
            exit_code = asyncio.run(
                discover_job.run_job(
                    discover_job.DiscoverJobConfig(
                        storage_location_ids=[storage_location.id],
                        discover_dry_run=True,
                    ),
                    db_session=session,
                )
            )

    assert exit_code == 0
    assert session.exec(select(FileSource)).all() == []
    log_payloads = [json.loads(record.message) for record in caplog.records]
    discovery_log = next(item for item in log_payloads if item["event"] == "dataset_discovery")
    assert discovery_log["dry_run"] is True
    assert discovery_log["would_write"] is True
    assert discovery_log["request_payload"] == {
        "version": "v1.0.0",
        "location_path": "test-dataset/test-dataset/v1.0.0/geoparquet/*.parquet",
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
            "columns": [
                {
                    "name": "id",
                    "type": "INTEGER",
                    "description": None,
                    "nullable": True,
                    "num_null_values": None,
                    "num_unique_values": None,
                    "example_values": None,
                    "min": None,
                    "max": None,
                    "length": None,
                    "possible_values": None,
                }
            ],
        },
        "dry_run": True,
    }
    assert discovery_log["location_path"].endswith("*.parquet")
    assert discovery_log["source_object_count"] == 2
    assert discovery_log["object_paths"] == [
        "test-dataset/test-dataset/v1.0.0/geoparquet/part-0.parquet",
        "test-dataset/test-dataset/v1.0.0/geoparquet/part-1.parquet",
    ]
    assert discovery_log["has_quality_metadata"] is True
    assert discovery_log["has_data_dictionary"] is True

    summary_log = next(
        item for item in log_payloads if item["event"] == "dataset_discovery_summary"
    )
    assert summary_log["discovered_versions"] == 1
    assert summary_log["source_objects"] == 2
    assert summary_log["metadata_records"] == 1
    assert summary_log["metadata_objects"] == 2
    assert summary_log["format_counts"] == {"geoparquet": 1}
    assert summary_log["written_versions"] == 0


def test_discover_job_returns_one_when_storage_location_or_write_fails(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")

    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)

        class FakeScanner:
            def __init__(self, storage_client):
                self.storage_client = storage_client

            async def scan(self, prefix: str = "", limit: int | None = None):
                yield DiscoveredVersion(
                    dataset_slug="test-dataset",
                    file_slug="test-dataset",
                    version="v1.0.0",
                    format_type="geoparquet",
                    location_path="test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet",
                    object_paths=[
                        "test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet"
                    ],
                    metadata=None,
                )

        monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
        monkeypatch.setattr(
            discover_job,
            "create_storage_client_from_location",
            lambda _: object(),
        )

        exit_code = asyncio.run(
            discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    storage_location_ids=[storage_location.id, 999999],
                ),
                db_session=session,
            )
        )

    assert exit_code == 1
