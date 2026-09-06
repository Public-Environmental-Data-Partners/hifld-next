"""Tests for archive download responses."""

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models.dataset import (
    BucketStorageLocationConfig,
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    Format,
    StorageLocation,
)
from services.dataset import downloads


HTTP_REDIRECT = 302
HTTP_BAD_REQUEST = 400


class FakeStorageClient:
    """Storage client exposing a deterministic public URL."""

    def get_public_url(self, path: str) -> str:
        """Return a public URL for a storage path."""
        return f"https://downloads.example/{path}"


def make_source(format_type: str, path: str) -> tuple[Session, FileSource]:
    """Create a persisted source with its format and storage relationships."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    session = Session(engine)
    dataset = Dataset(slug="dataset", name="Dataset")
    storage = StorageLocation(
        slug="storage",
        name="Storage",
        backend_type="s3",
        config=BucketStorageLocationConfig(type="seaweedfs", base_url="http://localhost:8888", bucket="bucket"),
    )
    format_obj = Format(format_type=format_type, name=format_type, description=format_type)
    session.add(dataset)
    session.add(storage)
    session.add(format_obj)
    session.commit()
    file_obj = File(dataset_id=dataset.id, slug="layer", name="Layer")
    session.add(file_obj)
    session.commit()
    file_format = FileFormat(file_id=file_obj.id, format_id=format_obj.id)
    session.add(file_format)
    session.commit()
    source = FileSource(
        file_format_id=file_format.id,
        storage_location_id=storage.id,
        source_type="file",
        location=FileLocation(path=path),
        version="v1.0.0",
    )
    session.add(source)
    session.commit()
    session.refresh(source)
    return session, source


@pytest.mark.parametrize("format_type", ["shapefile", "file_geodatabase"])
def test_archive_download_redirects_zip_sources(
    monkeypatch: pytest.MonkeyPatch,
    format_type: str,
) -> None:
    """Supported archive formats redirect directly to their stored ZIP."""
    session, source = make_source(format_type, f"dataset/layer/v1.0.0/{format_type}/layer.zip")
    monkeypatch.setattr(downloads, "create_client_for_source", lambda _: FakeStorageClient())
    try:
        response = asyncio.run(downloads.shapefile_zip_response(session, source.id, "dataset", "layer"))
    finally:
        session.close()

    assert isinstance(response, RedirectResponse)
    assert response.status_code == HTTP_REDIRECT
    assert response.headers["location"].endswith("/layer.zip")


@pytest.mark.parametrize(
    ("format_type", "path"),
    [
        ("shapefile", "dataset/layer/v1.0.0/shapefile/layer.shp"),
        ("file_geodatabase", "dataset/layer/v1.0.0/file_geodatabase/layer.gdb/a.gdbtable"),
        ("geoparquet", "dataset/layer/v1.0.0/geoparquet/layer.parquet"),
    ],
)
def test_archive_download_rejects_unzipped_or_unsupported_sources(
    monkeypatch: pytest.MonkeyPatch,
    format_type: str,
    path: str,
) -> None:
    """The route never rebuilds loose archives and rejects other formats."""
    session, source = make_source(format_type, path)
    monkeypatch.setattr(downloads, "create_client_for_source", lambda _: FakeStorageClient())
    try:
        with pytest.raises(HTTPException) as error:
            asyncio.run(downloads.shapefile_zip_response(session, source.id, "dataset", "layer"))
    finally:
        session.close()

    assert error.value.status_code == HTTP_BAD_REQUEST
