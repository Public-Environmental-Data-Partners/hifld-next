"""Admin endpoints for operational tasks like storage discovery."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from sqlmodel import Session, select

from config import config
from database.db import get_db
from models.dataset import (
    Collection,
    Dataset,
    File,
    FileFormat,
    FileLocation,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from services.datasets import DatasetService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


class CreateVersionRequest(BaseModel):
    version: str
    location_path: str
    source_metadata: Optional[SpatialDatasetFileMetadata] = None
    dry_run: bool = False


class CreateVersionResponse(BaseModel):
    created: bool
    dry_run: bool
    file_source_id: Optional[int] = None


def get_dataset_service(db: Session = Depends(get_db)) -> DatasetService:
    return DatasetService(db)


def verify_admin_key(key: str | None = Security(api_key_header)) -> None:
    if config.ADMIN_API_KEY is None:
        return
    if key != config.ADMIN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin API key",
        )


def get_or_create_hifld_collection(db: Session) -> Collection:
    statement = select(Collection).where(Collection.slug == "hifld")
    collection = db.exec(statement).first()
    if collection:
        return collection

    collection = Collection(
        slug="hifld",
        name="HIFLD",
        description="HIFLD discovered datasets",
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


def humanize_slug(slug: str) -> str:
    words = [part for part in slug.replace("_", "-").split("-") if part]
    return " ".join(word.capitalize() for word in words) or slug


def get_or_create_dataset(
    db: Session,
    dataset_slug: str,
    collection_id: int,
) -> Dataset:
    statement = select(Dataset).where(Dataset.slug == dataset_slug)
    dataset = db.exec(statement).first()
    if dataset:
        if dataset.collection_id is None:
            dataset.collection_id = collection_id
            db.add(dataset)
            db.commit()
            db.refresh(dataset)
        return dataset

    dataset = Dataset(
        slug=dataset_slug,
        name=humanize_slug(dataset_slug),
        description=None,
        collection_id=collection_id,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


def get_or_create_file(
    db: Session,
    file_slug: str,
    dataset: Dataset,
) -> File:
    statement = select(File).where(
        File.dataset_id == dataset.id,
        File.slug == file_slug,
    )
    file_obj = db.exec(statement).first()
    if file_obj:
        return file_obj

    file_obj = File(
        dataset_id=dataset.id,
        slug=file_slug,
        name=humanize_slug(file_slug),
        description=dataset.description,
    )
    db.add(file_obj)
    db.commit()
    db.refresh(file_obj)
    return file_obj


def get_existing_file_format(
    service: DatasetService,
    dataset_slug: str,
    file_slug: str,
    format_type: str,
) -> Optional[object]:
    statement = select(Dataset).where(Dataset.slug == dataset_slug)
    dataset = service.db.exec(statement).first()
    if not dataset:
        return None

    file_obj = service.get_file_by_slug(dataset.id, file_slug)
    if not file_obj:
        return None

    format_obj = service.get_format_by_type(format_type)
    if not format_obj:
        return None

    statement = select(FileFormat).where(
        FileFormat.file_id == file_obj.id,
        FileFormat.format_id == format_obj.id,
    )
    return service.db.exec(statement).first()


@router.get("/storage-locations/{storage_location_id}")
async def get_storage_location(
    storage_location_id: int,
    _: None = Depends(verify_admin_key),
    service: DatasetService = Depends(get_dataset_service),
):
    storage_location = service.get_storage_location(storage_location_id)
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")
    return storage_location


@router.post(
    "/storage-locations/{storage_location_id}/datasets/{dataset_slug}/files/{file_slug}/formats/{format_type}/versions"
)
async def create_storage_location_version(
    storage_location_id: int,
    dataset_slug: str,
    file_slug: str,
    format_type: str,
    request: CreateVersionRequest,
    _: None = Depends(verify_admin_key),
    service: DatasetService = Depends(get_dataset_service),
) -> CreateVersionResponse:
    storage_location = service.get_storage_location(storage_location_id)
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")

    try:
        if request.dry_run:
            existing_file_format = get_existing_file_format(
                service,
                dataset_slug=dataset_slug,
                file_slug=file_slug,
                format_type=format_type,
            )
            if existing_file_format:
                existing = service.get_format_source_by_location(
                    existing_file_format.id,
                    storage_location_id,
                    request.version,
                )
                if existing:
                    return CreateVersionResponse(
                        created=False,
                        dry_run=True,
                        file_source_id=existing.id,
                    )

            return CreateVersionResponse(
                created=True,
                dry_run=True,
                file_source_id=None,
            )

        collection = get_or_create_hifld_collection(service.db)
        dataset = get_or_create_dataset(
            service.db,
            dataset_slug=dataset_slug,
            collection_id=collection.id,
        )
        file_obj = get_or_create_file(service.db, file_slug=file_slug, dataset=dataset)
        file_format = service.get_or_create_file_format_for_file(file_obj.id, format_type)

        existing = service.get_format_source_by_location(
            file_format.id,
            storage_location_id,
            request.version,
        )
        if existing:
            return CreateVersionResponse(
                created=False,
                dry_run=request.dry_run,
                file_source_id=existing.id,
            )

        file_source = service.add_format_source(
            file_format_id=file_format.id,
            storage_location_id=storage_location_id,
            source_type="file",
            location=FileLocation(path=request.location_path),
            source_metadata=request.source_metadata,
            version=request.version,
        )
        return CreateVersionResponse(
            created=True,
            dry_run=False,
            file_source_id=file_source.id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Failed to create version for storage location %s dataset=%s file=%s format=%s: %s",
            storage_location_id,
            dataset_slug,
            file_slug,
            format_type,
            exc,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
