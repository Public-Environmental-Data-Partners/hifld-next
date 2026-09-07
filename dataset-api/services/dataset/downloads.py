"""Download helpers for dataset API routes."""

from fastapi import HTTPException
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select

from models.dataset import BucketStorageLocationConfig, FileLocation, FileSource
from storage.storage_client import StorageClient, StorageClientOptions, create_storage_client


ARCHIVE_FORMATS = {"shapefile", "file_geodatabase"}


def get_archive_source(db: Session, source_id: int) -> FileSource:
    """Load and validate a downloadable archive source."""
    statement = select(FileSource).where(FileSource.id == source_id)
    file_source = db.exec(statement).first()
    if not file_source:
        raise HTTPException(status_code=404, detail="File source not found")

    if not file_source.file_format or not file_source.file_format.format:
        raise HTTPException(status_code=400, detail="File source format information not available")

    if file_source.file_format.format.format_type not in ARCHIVE_FORMATS:
        raise HTTPException(status_code=400, detail="This endpoint is only for archive formats")

    if not file_source.storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")

    return file_source


def create_client_for_source(file_source: FileSource) -> StorageClient:
    """Create a storage client for a source's storage location."""
    storage_location = file_source.storage_location
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")
    if storage_location.backend_type != "s3":
        raise HTTPException(status_code=400, detail="Storage location is not bucket-backed")
    try:
        config_model = BucketStorageLocationConfig.model_validate(storage_location.config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Storage location is not bucket-backed") from exc
    storage_type = config_model.type or storage_location.backend_type
    if storage_type == "s3" and config_model.base_url:
        storage_type = "seaweedfs"
    return create_storage_client(
        storage_type=storage_type,
        options=StorageClientOptions(bucket=config_model.bucket, base_url=config_model.base_url),
    )


def file_source_path(file_source: FileSource) -> str:
    """Get a validated file source path."""
    try:
        location = FileLocation.model_validate(file_source.location)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid file source location") from exc
    source_path = location.path
    if not source_path:
        raise HTTPException(status_code=400, detail="Source path is empty")
    return source_path


async def shapefile_zip_response(
    db: Session,
    source_id: int,
    dataset_slug: str,
    file_slug: str,
) -> RedirectResponse:
    """Redirect a ZIP-packaged shapefile or FileGDB source."""
    del dataset_slug, file_slug
    file_source = get_archive_source(db, source_id)
    storage_client = create_client_for_source(file_source)
    source_path = file_source_path(file_source)

    if not source_path.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Archive source must be a ZIP file")
    return RedirectResponse(url=storage_client.get_public_url(source_path), status_code=302)
