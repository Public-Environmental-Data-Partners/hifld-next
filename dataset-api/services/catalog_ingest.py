"""Shared catalog ingest logic for dataset discovery."""

from typing import Any, Optional

from pydantic import BaseModel
from sqlmodel import Session, select

from models.dataset import (
    Dataset,
    File,
    FileFormat,
    FileLocation,
    SpatialDatasetFileMetadata,
)
from services.datasets import DatasetService


class CatalogIngestResult(BaseModel):
    created: bool
    dry_run: bool
    file_source_id: Optional[int] = None


class CatalogIngestService:
    """Create or update catalog records discovered from bucket storage."""

    def __init__(self, db: Session):
        self.db = db
        self.dataset_service = DatasetService(db)

    def preview_discovered_version(
        self,
        collection_id: int,
        storage_location_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
        version: str,
    ) -> CatalogIngestResult:
        file_format = self._get_existing_file_format(
            collection_id=collection_id,
            dataset_slug=dataset_slug,
            file_slug=file_slug,
            format_type=format_type,
        )
        if file_format:
            existing = self.dataset_service.get_format_source_by_location(
                file_format.id,
                storage_location_id,
                version,
            )
            if existing:
                return CatalogIngestResult(
                    created=False,
                    dry_run=True,
                    file_source_id=existing.id,
                )

        return CatalogIngestResult(created=True, dry_run=True, file_source_id=None)

    def upsert_discovered_version(
        self,
        collection_id: int,
        storage_location_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
        version: str,
        location_path: str,
        source_metadata: Optional[SpatialDatasetFileMetadata] = None,
        dataset_name: Optional[str] = None,
        dataset_description: Optional[str] = None,
        dataset_tags: Optional[dict[str, Any]] = None,
        file_name: Optional[str] = None,
        file_description: Optional[str] = None,
    ) -> CatalogIngestResult:
        dataset = self._get_or_create_dataset(
            dataset_slug=dataset_slug,
            collection_id=collection_id,
            name=dataset_name,
            description=dataset_description,
            tags=dataset_tags,
        )
        file_obj = self._get_or_create_file(
            file_slug=file_slug,
            dataset=dataset,
            name=file_name,
            description=file_description,
        )
        file_format = self.dataset_service.get_or_create_file_format_for_file(
            file_obj.id, format_type
        )

        existing = self.dataset_service.get_format_source_by_location(
            file_format.id,
            storage_location_id,
            version,
        )
        if existing:
            updated = self.dataset_service.update_format_source(
                existing.id,
                location=FileLocation(path=location_path),
                source_metadata=source_metadata,
            )
            return CatalogIngestResult(
                created=False,
                dry_run=False,
                file_source_id=updated.id if updated else existing.id,
            )

        file_source = self.dataset_service.add_format_source(
            file_format_id=file_format.id,
            storage_location_id=storage_location_id,
            source_type="file",
            location=FileLocation(path=location_path),
            source_metadata=source_metadata,
            version=version,
        )
        return CatalogIngestResult(
            created=True,
            dry_run=False,
            file_source_id=file_source.id,
        )

    def _get_or_create_dataset(
        self,
        dataset_slug: str,
        collection_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[dict[str, Any]] = None,
    ) -> Dataset:
        statement = select(Dataset).where(Dataset.slug == dataset_slug)
        dataset = self.db.exec(statement).first()
        if dataset:
            if dataset.collection_id != collection_id:
                raise ValueError(
                    f"Dataset slug {dataset_slug!r} already belongs to a different collection"
                )
            changed = False
            if name and dataset.name != name:
                dataset.name = name
                changed = True
            if description is not None and dataset.description != description:
                dataset.description = description
                changed = True
            if tags is not None and dataset.tags != tags:
                dataset.tags = tags
                changed = True
            if changed:
                self.db.add(dataset)
                self.db.commit()
                self.db.refresh(dataset)
            return dataset

        dataset = Dataset(
            slug=dataset_slug,
            name=name or dataset_slug,
            description=description,
            tags=tags,
            collection_id=collection_id,
        )
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return dataset

    def _get_or_create_file(
        self,
        file_slug: str,
        dataset: Dataset,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> File:
        statement = select(File).where(
            File.dataset_id == dataset.id,
            File.slug == file_slug,
        )
        file_obj = self.db.exec(statement).first()
        if file_obj:
            changed = False
            if name and file_obj.name != name:
                file_obj.name = name
                changed = True
            if description is not None and file_obj.description != description:
                file_obj.description = description
                changed = True
            if changed:
                self.db.add(file_obj)
                self.db.commit()
                self.db.refresh(file_obj)
            return file_obj

        file_obj = File(
            dataset_id=dataset.id,
            slug=file_slug,
            name=name or file_slug,
            description=description,
        )
        self.db.add(file_obj)
        self.db.commit()
        self.db.refresh(file_obj)
        return file_obj

    def _get_existing_file_format(
        self,
        collection_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
    ) -> Optional[FileFormat]:
        statement = select(Dataset).where(Dataset.slug == dataset_slug)
        dataset = self.db.exec(statement).first()
        if not dataset:
            return None
        if dataset.collection_id != collection_id:
            raise ValueError(
                f"Dataset slug {dataset_slug!r} already belongs to a different collection"
            )

        file_obj = self.dataset_service.get_file_by_slug(dataset.id, file_slug)
        if not file_obj:
            return None

        format_obj = self.dataset_service.get_format_by_type(format_type)
        if not format_obj:
            return None

        statement = select(FileFormat).where(
            FileFormat.file_id == file_obj.id,
            FileFormat.format_id == format_obj.id,
        )
        return self.db.exec(statement).first()
