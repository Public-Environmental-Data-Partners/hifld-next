"""Download helpers for dataset API routes."""

import io
import logging
import tempfile
import zipfile
from collections.abc import Iterator
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlmodel import Session, select

from models.dataset import BucketStorageLocationConfig, FileLocation, FileSource
from storage.storage_client import StorageClient, StorageClientOptions, create_storage_client


logger = logging.getLogger(__name__)
SHAPEFILE_PARTS_LENGTH = 2
ZIP_CHUNK_SIZE_BYTES = 8192


def get_shapefile_source(db: Session, source_id: int) -> FileSource:
    """Load and validate a shapefile source."""
    statement = select(FileSource).where(FileSource.id == source_id)
    file_source = db.exec(statement).first()
    if not file_source:
        raise HTTPException(status_code=404, detail="File source not found")

    if not file_source.file_format or not file_source.file_format.format:
        raise HTTPException(status_code=400, detail="File source format information not available")

    if file_source.file_format.format.format_type != "shapefile":
        raise HTTPException(status_code=400, detail="This endpoint is only for shapefile formats")

    if not file_source.storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")

    return file_source


def create_client_for_source(file_source: FileSource) -> StorageClient:
    """Create a storage client for a source's storage location."""
    storage_location = file_source.storage_location
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")
    config_model = storage_location.config
    if not isinstance(config_model, BucketStorageLocationConfig):
        raise HTTPException(status_code=400, detail="Storage location is not bucket-backed")
    storage_type = config_model.type or storage_location.backend_type
    if storage_type == "s3" and config_model.base_url:
        storage_type = "seaweedfs"
    return create_storage_client(
        storage_type=storage_type,
        options=StorageClientOptions(bucket=config_model.bucket, base_url=config_model.base_url),
    )


def file_source_path(file_source: FileSource) -> str:
    """Get a validated file source path."""
    location = file_source.location
    if not isinstance(location, FileLocation):
        raise HTTPException(status_code=400, detail="Invalid file source location")
    source_path = location.path
    if not source_path:
        raise HTTPException(status_code=400, detail="Source path is empty")
    return source_path


async def list_shapefile_parts(storage_client: StorageClient, folder_path: str) -> list[str]:
    """List shapefile part files from storage."""
    try:
        all_files = await storage_client.list_files(folder_path)
    except Exception as exc:
        logger.exception("Error listing files in folder %s", folder_path)
        raise HTTPException(status_code=500, detail=f"Error listing files in storage: {exc!s}") from exc
    if not all_files:
        raise HTTPException(status_code=404, detail=f"No files found in folder: {folder_path}")
    return all_files


async def build_shapefile_zip(storage_client: StorageClient, file_paths: list[str]) -> io.BytesIO:
    """Build an in-memory zip from shapefile component paths."""
    zip_buffer = io.BytesIO()
    files_added = 0

    try:
        with (
            zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file,
            tempfile.TemporaryDirectory() as temp_dir,
        ):
            for file_path in file_paths:
                try:
                    local_file = Path(temp_dir) / Path(file_path).name
                    await storage_client.download_file(file_path, local_file)
                    if not local_file.exists():
                        logger.warning("File was not downloaded: %s", file_path)
                        continue
                    zip_file.write(local_file, Path(file_path).name)
                    files_added += 1
                except Exception:
                    logger.exception("Failed to add %s to zip", file_path)
                    continue
    except Exception as exc:
        logger.exception("Error creating zip file")
        raise HTTPException(status_code=500, detail=f"Error creating zip file: {exc!s}") from exc

    if files_added == 0:
        raise HTTPException(status_code=500, detail="No files were successfully added to the zip archive")
    zip_buffer.seek(0)
    return zip_buffer


def stream_zip_buffer(zip_buffer: io.BytesIO) -> Iterator[bytes]:
    """Yield zip buffer chunks."""
    zip_buffer.seek(0)
    while chunk := zip_buffer.read(ZIP_CHUNK_SIZE_BYTES):
        yield chunk


async def shapefile_zip_response(
    db: Session,
    source_id: int,
    dataset_slug: str,
    file_slug: str,
) -> RedirectResponse | StreamingResponse:
    """Create a redirect or streaming response for a shapefile source."""
    file_source = get_shapefile_source(db, source_id)
    storage_client = create_client_for_source(file_source)
    source_path = file_source_path(file_source)

    if source_path.lower().endswith(".zip"):
        return RedirectResponse(url=storage_client.get_public_url(source_path), status_code=302)

    path_parts = source_path.rsplit("/", 1)
    folder_path = path_parts[0] + "/" if len(path_parts) == SHAPEFILE_PARTS_LENGTH else ""
    all_files = await list_shapefile_parts(storage_client, folder_path)
    zip_buffer = await build_shapefile_zip(storage_client, all_files)
    zip_filename = f"{dataset_slug}_{file_slug}_shapefile.zip"
    return StreamingResponse(
        stream_zip_buffer(zip_buffer),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
