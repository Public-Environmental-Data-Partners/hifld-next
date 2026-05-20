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
        slug="seaweedfs-test",
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
    dataset_manifest = {
        "title": "Catalog Dataset Name",
        "description": "Catalog dataset description",
        "tags": {"categories": ["Boundaries"], "inventory_name": "test-dataset"},
    }
    layer_manifest = {
        "title": "Catalog Layer Name",
        "description": "Catalog layer description",
        "tags": {"categories": ["Layer"]},
    }
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
        "test-dataset/metadata/source_manifest.json": json.dumps(
            dataset_manifest
        ).encode("utf-8"),
        "test-dataset/test-dataset/metadata/source_manifest.json": json.dumps(
            layer_manifest
        ).encode("utf-8"),
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
        "fallback-dataset/fallback-layer/metadata/source_manifest.json": json.dumps(
            {"title": "Fallback Layer Name", "description": "Fallback layer description"}
        ).encode("utf-8"),
        "fallback-dataset/fallback-layer/v1.0.0/geoparquet/fallback.parquet": b"fallback",
        "partitioned-dataset/partitioned-layer/v1.0.0/geoparquet/huc2=01/part-000.parquet": b"partition-01",
        "partitioned-dataset/partitioned-layer/v1.0.0/geoparquet/huc2=02/part-000.parquet": b"partition-02",
        "single-partitioned/single-partitioned/v1.0.0/geoparquet/huc2=01/part-000.parquet": b"single-partition",
        "slug-only/slug-file/v1.0.0/geoparquet/slug.parquet": b"slug-only",
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
        return [item async for item in service.scan(prefix="test-dataset", limit=3)]

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
    assert latest_geoparquet.dataset_name == "Catalog Dataset Name"
    assert latest_geoparquet.dataset_description == "Catalog dataset description"
    assert latest_geoparquet.dataset_tags == {
        "categories": ["Boundaries"],
        "inventory_name": "test-dataset",
    }
    assert latest_geoparquet.file_name == "Catalog Layer Name"
    assert latest_geoparquet.file_description == "Catalog layer description"
    assert latest_geoparquet.catalog_metadata_object_paths == [
        "test-dataset/metadata/source_manifest.json",
        "test-dataset/test-dataset/metadata/source_manifest.json",
    ]
    assert {item.version for item in discovered_versions} == {"v1.0.0", "v1.1.0"}


def test_discovery_service_resolves_manifest_fallbacks_and_exact_slugs():
    fake_storage = FakeStorageClient(make_storage_files())
    service = DiscoveryService(storage_client=fake_storage)

    async def collect_versions() -> list[DiscoveredVersion]:
        return [item async for item in service.scan()]

    discovered_versions = asyncio.run(collect_versions())

    fallback = next(
        item for item in discovered_versions if item.dataset_slug == "fallback-dataset"
    )
    assert fallback.dataset_name == "fallback-dataset"
    assert fallback.dataset_description is None
    assert fallback.dataset_tags is None
    assert fallback.file_name == "Fallback Layer Name"
    assert fallback.file_description == "Fallback layer description"
    assert fallback.catalog_metadata_object_paths == [
        "fallback-dataset/fallback-layer/metadata/source_manifest.json"
    ]

    slug_only = next(
        item for item in discovered_versions if item.dataset_slug == "slug-only"
    )
    assert slug_only.dataset_name == "slug-only"
    assert slug_only.dataset_description is None
    assert slug_only.dataset_tags is None
    assert slug_only.file_name == "slug-file"
    assert slug_only.file_description is None
    assert slug_only.catalog_metadata_object_paths == []


def test_discovery_service_builds_recursive_geoparquet_globs_for_partitioned_files():
    fake_storage = FakeStorageClient(make_storage_files())
    service = DiscoveryService(storage_client=fake_storage)

    async def collect_versions() -> list[DiscoveredVersion]:
        return [item async for item in service.scan()]

    discovered_versions = asyncio.run(collect_versions())

    flat_multiple = next(
        item
        for item in discovered_versions
        if item.dataset_slug == "test-dataset"
        and item.version == "v1.1.0"
        and item.format_type == "geoparquet"
    )
    assert (
        flat_multiple.location_path
        == "test-dataset/test-dataset/v1.1.0/geoparquet/*.parquet"
    )

    flat_single = next(
        item for item in discovered_versions if item.dataset_slug == "slug-only"
    )
    assert (
        flat_single.location_path
        == "slug-only/slug-file/v1.0.0/geoparquet/slug.parquet"
    )

    nested_multiple = next(
        item
        for item in discovered_versions
        if item.dataset_slug == "partitioned-dataset"
    )
    assert (
        nested_multiple.location_path
        == "partitioned-dataset/partitioned-layer/v1.0.0/geoparquet/**/*.parquet"
    )
    assert nested_multiple.object_paths == [
        "partitioned-dataset/partitioned-layer/v1.0.0/geoparquet/huc2=01/part-000.parquet",
        "partitioned-dataset/partitioned-layer/v1.0.0/geoparquet/huc2=02/part-000.parquet",
    ]

    nested_single = next(
        item
        for item in discovered_versions
        if item.dataset_slug == "single-partitioned"
    )
    assert (
        nested_single.location_path
        == "single-partitioned/single-partitioned/v1.0.0/geoparquet/**/*.parquet"
    )


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
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        result = ingest.preview_discovered_version(
            collection_id=collection.id,
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
        collection = Collection(slug="target", name="Target Collection")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        create_result = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="test-dataset",
            file_slug="test-dataset",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="test-dataset/test-dataset/v1.0.0/geoparquet/test-dataset-0.parquet",
            source_metadata=SpatialDatasetFileMetadata(version="v1", feature_count=12),
            dataset_name="Catalog Dataset Name",
            dataset_description="Dataset description",
            dataset_tags={"categories": ["Boundaries"]},
            file_name="Catalog Layer Name",
            file_description="Catalog layer description",
        )
        assert create_result.created is True
        assert create_result.dry_run is False
        assert isinstance(create_result.file_source_id, int)

        dataset = session.exec(select(Dataset).where(Dataset.slug == "test-dataset")).one()
        file_obj = session.exec(select(File).where(File.dataset_id == dataset.id)).one()
        file_format = session.exec(select(FileFormat).where(FileFormat.file_id == file_obj.id)).one()
        file_source = session.exec(select(FileSource).where(FileSource.file_format_id == file_format.id)).one()

        assert dataset.collection_id == collection.id
        assert dataset.name == "Catalog Dataset Name"
        assert dataset.description == "Dataset description"
        assert dataset.tags == {"categories": ["Boundaries"]}
        assert file_obj.slug == "test-dataset"
        assert file_obj.name == "Catalog Layer Name"
        assert file_obj.description == "Catalog layer description"
        assert file_source.version == "v1.0.0"
        assert file_source.source_metadata is not None

        upsert_result = ingest.upsert_discovered_version(
            collection_id=collection.id,
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
            dataset_name="Updated Dataset Name",
            dataset_description="Updated dataset description",
            dataset_tags={"categories": ["Updated"]},
            file_name="Updated Layer Name",
            file_description="Updated layer description",
        )
        assert upsert_result.created is False
        assert upsert_result.dry_run is False
        assert upsert_result.file_source_id == file_source.id

        session.refresh(file_source)
        session.refresh(dataset)
        session.refresh(file_obj)
        assert len(session.exec(select(FileSource)).all()) == 1
        assert dataset.name == "Updated Dataset Name"
        assert dataset.description == "Updated dataset description"
        assert dataset.tags == {"categories": ["Updated"]}
        assert file_obj.name == "Updated Layer Name"
        assert file_obj.description == "Updated layer description"
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


def test_catalog_ingest_uses_exact_slugs_when_manifest_metadata_is_missing():
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="slug-only",
            file_slug="slug-file",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="slug-only/slug-file/v1.0.0/geoparquet/slug.parquet",
        )

        dataset = session.exec(select(Dataset).where(Dataset.slug == "slug-only")).one()
        file_obj = session.exec(select(File).where(File.dataset_id == dataset.id)).one()

        assert dataset.name == "slug-only"
        assert dataset.description is None
        assert dataset.tags is None
        assert file_obj.name == "slug-file"
        assert file_obj.description is None


def test_catalog_ingest_adopts_legacy_file_by_manifest_name_when_slug_changed():
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        dataset = Dataset(
            slug="test-dataset",
            name="Test Dataset",
            collection_id=collection.id,
        )
        session.add(dataset)
        session.commit()
        session.refresh(dataset)
        legacy_file = File(
            dataset_id=dataset.id,
            slug="test-dataset-test-layer",
            name="Catalog Layer Name",
            description="Old description",
        )
        session.add(legacy_file)
        session.commit()
        session.refresh(legacy_file)
        ingest = CatalogIngestService(session)

        result = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="test-dataset",
            file_slug="test-layer",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="test-dataset/test-layer/v1.0.0/geoparquet/test.parquet",
            file_name="Catalog Layer Name",
            file_description="New description",
        )

        session.refresh(legacy_file)
        assert result.created is True
        assert legacy_file.slug == "test-layer"
        assert legacy_file.name == "Catalog Layer Name"
        assert legacy_file.description == "New description"
        assert len(session.exec(select(File)).all()) == 1


def test_catalog_ingest_previews_stale_sources_without_deleting():
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        other_collection = Collection(slug="other", name="Other")
        storage_location = make_storage_location()
        other_storage_location = StorageLocation(
            slug="seaweedfs-other",
            name="SeaweedFS Other",
            backend_type="s3",
            config=BucketStorageLocationConfig(
                type="seaweedfs",
                base_url="http://localhost:8888",
                bucket="other",
            ),
        )
        session.add(collection)
        session.add(other_collection)
        session.add(storage_location)
        session.add(other_storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(other_collection)
        session.refresh(storage_location)
        session.refresh(other_storage_location)
        ingest = CatalogIngestService(session)

        keep = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="dataset",
            file_slug="layer",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="dataset/layer/v1.0.0/geoparquet/data.parquet",
        )
        stale = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="dataset",
            file_slug="stale-layer",
            format_type="geoparquet",
            version="v20260214",
            location_path="dataset/stale-layer/geoparquet/data.parquet",
        )
        other_storage = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=other_storage_location.id,
            dataset_slug="dataset",
            file_slug="other-storage-layer",
            format_type="geoparquet",
            version="v20260214",
            location_path="dataset/other-storage-layer/geoparquet/data.parquet",
        )
        other_collection_source = ingest.upsert_discovered_version(
            collection_id=other_collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="other-dataset",
            file_slug="layer",
            format_type="geoparquet",
            version="v20260214",
            location_path="other-dataset/layer/geoparquet/data.parquet",
        )

        result = ingest.prune_stale_discovered_sources(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            discovered_source_keys={
                ("dataset", "layer", "geoparquet", "v1.0.0"),
            },
            dry_run=True,
        )

        assert result.dry_run is True
        assert result.deleted_file_source_ids == [stale.file_source_id]
        assert result.deleted_file_format_ids
        assert result.deleted_file_ids
        assert result.deleted_dataset_ids == []
        source_ids = {source.id for source in session.exec(select(FileSource)).all()}
        assert keep.file_source_id in source_ids
        assert stale.file_source_id in source_ids
        assert other_storage.file_source_id in source_ids
        assert other_collection_source.file_source_id in source_ids


def test_catalog_ingest_prunes_stale_sources_and_empty_catalog_records():
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)

        keep = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="dataset",
            file_slug="layer",
            format_type="geoparquet",
            version="v1.0.0",
            location_path="dataset/layer/v1.0.0/geoparquet/data.parquet",
        )
        stale = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="empty-dataset",
            file_slug="empty-layer",
            format_type="pmtiles",
            version="v20260214",
            location_path="empty-dataset/empty-layer/pmtiles/tiles.pmtiles",
        )

        result = ingest.prune_stale_discovered_sources(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            discovered_source_keys={
                ("dataset", "layer", "geoparquet", "v1.0.0"),
            },
            dry_run=False,
        )

        assert result.dry_run is False
        assert result.deleted_file_source_ids == [stale.file_source_id]
        assert result.deleted_file_format_ids
        assert result.deleted_file_ids
        assert result.deleted_dataset_ids
        assert session.get(FileSource, stale.file_source_id) is None
        assert session.get(FileSource, keep.file_source_id) is not None
        assert session.exec(select(Dataset).where(Dataset.slug == "empty-dataset")).first() is None
        assert session.exec(select(Dataset).where(Dataset.slug == "dataset")).one()


def test_catalog_ingest_rejects_dataset_slug_in_different_collection():
    with make_session() as session:
        first_collection = Collection(slug="first", name="First")
        second_collection = Collection(slug="second", name="Second")
        storage_location = make_storage_location()
        session.add(first_collection)
        session.add(second_collection)
        session.add(storage_location)
        session.commit()
        session.refresh(first_collection)
        session.refresh(second_collection)
        session.refresh(storage_location)
        session.add(
            Dataset(
                slug="shared-dataset",
                name="Shared Dataset",
                collection_id=first_collection.id,
            )
        )
        session.commit()
        ingest = CatalogIngestService(session)

        try:
            ingest.upsert_discovered_version(
                collection_id=second_collection.id,
                storage_location_id=storage_location.id,
                dataset_slug="shared-dataset",
                file_slug="shared-layer",
                format_type="geoparquet",
                version="v1.0.0",
                location_path="shared-dataset/shared-layer/v1.0.0/geoparquet/data.parquet",
            )
        except ValueError as exc:
            assert "different collection" in str(exc)
        else:
            raise AssertionError("Expected cross-collection slug collision to fail")


def test_discover_job_loads_required_env_vars(monkeypatch):
    monkeypatch.setenv("DISCOVER_STORAGE_LOCATION_SLUG", "seaweedfs-test")
    monkeypatch.setenv("DISCOVER_COLLECTION_SLUG", "hifld")
    monkeypatch.setenv("DISCOVER_PREFIX", "foo/bar")
    monkeypatch.setenv("DISCOVER_DRY_RUN", "true")
    monkeypatch.setenv("DISCOVER_LIMIT", "5")
    monkeypatch.setenv("DISCOVER_PRUNE_STALE", "true")

    discover_job = importlib.import_module("jobs.discover")
    config = discover_job.load_config_from_env()

    assert config.storage_location_slug == "seaweedfs-test"
    assert config.collection_slug == "hifld"
    assert config.discover_prefix == "foo/bar"
    assert config.discover_dry_run is True
    assert config.discover_limit == 5
    assert config.discover_prune_stale is True


def test_discover_job_requires_single_target_env_vars(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")
    monkeypatch.delenv("DISCOVER_STORAGE_LOCATION_SLUG", raising=False)
    monkeypatch.delenv("DISCOVER_COLLECTION_SLUG", raising=False)

    try:
        discover_job.load_config_from_env({})
    except ValueError as exc:
        assert "DISCOVER_STORAGE_LOCATION_SLUG is required" in str(exc)
    else:
        raise AssertionError("Expected missing storage location slug to fail")

    try:
        discover_job.load_config_from_env(
            {"DISCOVER_STORAGE_LOCATION_SLUG": "seaweedfs-test"}
        )
    except ValueError as exc:
        assert "DISCOVER_COLLECTION_SLUG is required" in str(exc)
    else:
        raise AssertionError("Expected missing collection slug to fail")


def test_discover_job_loads_storage_location_scans_and_upserts_versions(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")

    with make_session() as session:
        collection = Collection(slug="target", name="Target Collection")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
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
                    dataset_name="Catalog Dataset Name",
                    dataset_description="Catalog dataset description",
                    dataset_tags={"categories": ["Boundaries"]},
                    file_name="Catalog Layer Name",
                    file_description="Catalog layer description",
                    catalog_metadata_object_paths=[
                        "test-dataset/metadata/source_manifest.json",
                        "test-dataset/test-dataset/metadata/source_manifest.json",
                    ],
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
                    storage_location_slug=storage_location.slug,
                    collection_slug=collection.slug,
                    discover_prefix="foo/bar",
                    discover_dry_run=False,
                    discover_limit=5,
                ),
                db_session=session,
            )
        )

        assert exit_code == 0
        dataset = session.exec(select(Dataset).where(Dataset.slug == "test-dataset")).one()
        file_obj = session.exec(select(File).where(File.dataset_id == dataset.id)).one()
        assert dataset.collection_id == collection.id
        assert dataset.name == "Catalog Dataset Name"
        assert dataset.description == "Catalog dataset description"
        assert dataset.tags == {"categories": ["Boundaries"]}
        assert file_obj.name == "Catalog Layer Name"
        assert file_obj.description == "Catalog layer description"
        assert len(session.exec(select(FileSource)).all()) == 2


def test_discover_job_logs_dry_run_object_paths_and_summary(monkeypatch, caplog):
    discover_job = importlib.import_module("jobs.discover")
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
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
                    catalog_metadata_object_paths=[
                        "test-dataset/metadata/source_manifest.json",
                        "test-dataset/test-dataset/metadata/source_manifest.json",
                    ],
                    metadata=SpatialDatasetFileMetadata(
                        version="v1",
                        feature_count=12,
                        columns=[{"name": "id", "type": "INTEGER"}],
                    ),
                    dataset_name="Catalog Dataset Name",
                    dataset_description="Catalog dataset description",
                    dataset_tags={"categories": ["Boundaries"]},
                    file_name="Catalog Layer Name",
                    file_description="Catalog layer description",
                )

        monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
        monkeypatch.setattr(
            discover_job, "create_storage_client_from_location", lambda _: object()
        )

        with caplog.at_level(logging.INFO, logger=discover_job.logger.name):
            exit_code = asyncio.run(
                discover_job.run_job(
                    discover_job.DiscoverJobConfig(
                        storage_location_slug=storage_location.slug,
                        collection_slug=collection.slug,
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
    assert discovery_log["collection_id"] == collection.id
    assert discovery_log["storage_location_id"] == storage_location.id
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
        "dataset_name": "Catalog Dataset Name",
        "dataset_description": "Catalog dataset description",
        "dataset_tags": {"categories": ["Boundaries"]},
        "file_name": "Catalog Layer Name",
        "file_description": "Catalog layer description",
    }
    assert discovery_log["location_path"].endswith("*.parquet")
    assert discovery_log["source_object_count"] == 2
    assert discovery_log["object_paths"] == [
        "test-dataset/test-dataset/v1.0.0/geoparquet/part-0.parquet",
        "test-dataset/test-dataset/v1.0.0/geoparquet/part-1.parquet",
    ]
    assert discovery_log["catalog_metadata_object_paths"] == [
        "test-dataset/metadata/source_manifest.json",
        "test-dataset/test-dataset/metadata/source_manifest.json",
    ]
    assert discovery_log["has_catalog_description"] is True
    assert discovery_log["has_catalog_tags"] is True
    assert discovery_log["has_quality_metadata"] is True
    assert discovery_log["has_data_dictionary"] is True

    summary_log = next(
        item for item in log_payloads if item["event"] == "dataset_discovery_summary"
    )
    assert summary_log["discovered_versions"] == 1
    assert summary_log["collection_id"] == collection.id
    assert summary_log["storage_location_id"] == storage_location.id
    assert summary_log["source_objects"] == 2


def test_discover_job_dry_run_logs_stale_source_prune_preview(monkeypatch, caplog):
    discover_job = importlib.import_module("jobs.discover")
    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        storage_location = make_storage_location()
        session.add(collection)
        session.add(storage_location)
        session.commit()
        session.refresh(collection)
        session.refresh(storage_location)
        ingest = CatalogIngestService(session)
        stale = ingest.upsert_discovered_version(
            collection_id=collection.id,
            storage_location_id=storage_location.id,
            dataset_slug="stale-dataset",
            file_slug="stale-layer",
            format_type="geoparquet",
            version="v20260214",
            location_path="stale-dataset/stale-layer/geoparquet/data.parquet",
        )

        class FakeScanner:
            def __init__(self, storage_client):
                self.storage_client = storage_client

            async def scan(self, prefix: str = "", limit: int | None = None):
                yield DiscoveredVersion(
                    dataset_slug="test-dataset",
                    file_slug="test-layer",
                    version="v1.0.0",
                    format_type="geoparquet",
                    location_path="test-dataset/test-layer/v1.0.0/geoparquet/data.parquet",
                    object_paths=[
                        "test-dataset/test-layer/v1.0.0/geoparquet/data.parquet"
                    ],
                    metadata=None,
                )

        monkeypatch.setattr(discover_job, "DiscoveryService", FakeScanner)
        monkeypatch.setattr(
            discover_job, "create_storage_client_from_location", lambda _: object()
        )

        with caplog.at_level(logging.INFO, logger=discover_job.logger.name):
            exit_code = asyncio.run(
                discover_job.run_job(
                    discover_job.DiscoverJobConfig(
                        storage_location_slug=storage_location.slug,
                        collection_slug=collection.slug,
                        discover_dry_run=True,
                        discover_prune_stale=True,
                    ),
                    db_session=session,
                )
            )

    assert exit_code == 0
    assert session.get(FileSource, stale.file_source_id) is not None
    log_payloads = [json.loads(record.message) for record in caplog.records]
    prune_log = next(
        item for item in log_payloads if item["event"] == "dataset_discovery_prune"
    )
    assert prune_log["dry_run"] is True
    assert prune_log["would_delete"] is True
    assert prune_log["result"]["deleted_file_source_ids"] == [stale.file_source_id]
    summary_log = next(
        item for item in log_payloads if item["event"] == "dataset_discovery_summary"
    )
    assert summary_log["prune_stale"] is True
    assert summary_log["stale_sources"] == 1
    assert summary_log["empty_formats"] == 1
    assert summary_log["empty_files"] == 1
    assert summary_log["empty_datasets"] == 1
    assert summary_log["metadata_records"] == 0
    assert summary_log["metadata_objects"] == 0
    assert summary_log["format_counts"] == {"geoparquet": 1}
    assert summary_log["written_versions"] == 0


def test_discover_job_returns_one_when_storage_location_missing(monkeypatch):
    discover_job = importlib.import_module("jobs.discover")

    with make_session() as session:
        collection = Collection(slug="hifld", name="HIFLD")
        session.add(collection)
        session.commit()
        session.refresh(collection)

        exit_code = asyncio.run(
            discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    storage_location_slug="missing-storage",
                    collection_slug=collection.slug,
                ),
                db_session=session,
            )
        )

    assert exit_code == 1


def test_discover_job_returns_one_when_collection_missing():
    discover_job = importlib.import_module("jobs.discover")

    with make_session() as session:
        storage_location = make_storage_location()
        session.add(storage_location)
        session.commit()
        session.refresh(storage_location)

        exit_code = asyncio.run(
            discover_job.run_job(
                discover_job.DiscoverJobConfig(
                    storage_location_slug=storage_location.slug,
                    collection_slug="missing-collection",
                ),
                db_session=session,
            )
        )

    assert exit_code == 1
