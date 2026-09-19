import sqlite3
from dataclasses import replace
from pathlib import Path

from app.catalog.repository import (
    CatalogRepository,
    SpatialResourceRecord,
    _asset_fingerprint,
    _merge_spatial_records,
)
from app.catalog.snapshot import project_resources


class NeutralRepository:
    generation = "neutral-generation"

    def read_spatial_versions(self) -> tuple[SpatialResourceRecord, ...]:
        return (
            SpatialResourceRecord(
                collection_slug="hifld",
                dataset_slug="d",
                file_slug="f",
                version_label="v1",
                collection_href="hifld/d/f/v1/collection.json",
                crs84_bbox=(0.0, 0.0, 1.0, 1.0),
                native_crs="EPSG:4326",
                geometry_column="geometry",
                feature_count=1,
                is_latest=True,
                title="File",
                description="desc",
                asset_key="geoparquet",
                asset_checksum="1" * 64,
                storage_slug="gcs",
                storage_href="gs://bucket",
                object_keys=("hifld/d/f/v1/geoparquet/a.parquet",),
                feature_id_column=None,
                fields={"name": {"type": "string"}},
            ),
        )


class MultiObjectRepository(NeutralRepository):
    def read_spatial_versions(self) -> tuple[SpatialResourceRecord, ...]:
        first = super().read_spatial_versions()[0]
        return (
            first,
            replace(
                first,
                object_keys=("hifld/d/f/v1/geoparquet/b.parquet",),
                asset_checksum="2" * 64,
            ),
        )


class MergedRepository:
    generation = "merged-generation"

    def read_spatial_versions(self) -> tuple[SpatialResourceRecord, ...]:
        return _merge_spatial_records(MultiObjectRepository().read_spatial_versions())


def test_projection_depends_only_on_neutral_spatial_resource_reader() -> None:
    projected = project_resources(NeutralRepository())

    assert projected.generation == "neutral-generation"
    assert projected.resources["hifld~d~f~v1"]["providers"][0]["objects_json"]


def test_projection_groups_multiple_assets_for_one_version() -> None:
    projected = project_resources(MergedRepository())
    provider = projected.resources["hifld~d~f~v1"]["providers"][0]

    assert "a.parquet" in provider["objects_json"]
    assert "b.parquet" in provider["objects_json"]


def test_merged_asset_fingerprint_matches_feature_id_checksum_contract() -> None:
    merged = _merge_spatial_records(MultiObjectRepository().read_spatial_versions())

    assert len(merged) == 1
    assert merged[0].asset_checksum.isascii()
    assert len(merged[0].asset_checksum) == 64
    assert all(character in "0123456789abcdef" for character in merged[0].asset_checksum)


def test_projection_advertises_version_and_explicit_latest_alias(tmp_path: Path) -> None:
    database = tmp_path / "catalog.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript((Path(__file__).parent / "fixtures/publisher_catalog.sql").read_text())
    connection.execute("UPDATE datasets SET title = 'Example dataset'")
    connection.commit()
    connection.close()

    resources = project_resources(CatalogRepository.open(database)).resources

    assert set(resources) == {
        "hifld~sample~points~v1.0.0",
        "hifld~sample~points",
    }
    assert resources["hifld~sample~points"]["hifld_latest_alias"] is True
    assert "v1.0.0" in resources["hifld~sample~points~v1.0.0"]["title"]
    assert (
        resources["hifld~sample~points~v1.0.0"]["title"]
        == "Example dataset — Sample points (v1.0.0)"
    )
    assert "latest" in resources["hifld~sample~points"]["title"]
    provider = resources["hifld~sample~points~v1.0.0"]["providers"][0]
    assert provider["storage_crs"] == "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
    assert provider["native_crs"] == "http://www.opengis.net/def/crs/EPSG/0/4326"
    assert provider["id_field"] == "objectid"


def test_repository_fingerprints_asset_when_sha256_is_missing() -> None:
    fingerprint = _asset_fingerprint(
        None,
        "gcp-portolan-published",
        "gs://hifld-next-portolan-published/hifld/example",
        ("hifld/example/a.parquet",),
        ("0123456789abcdef0123456789abcdef",),
        ("generation-1",),
    )

    assert len(fingerprint) == 64
