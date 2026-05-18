"""Shared catalog ingest logic for dataset discovery."""

from typing import Optional

from pydantic import BaseModel
from sqlmodel import Session, select

from models.dataset import (
    Collection,
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


def humanize_slug(slug: str) -> str:
    words = [part for part in slug.replace("_", "-").split("-") if part]
    return " ".join(word.capitalize() for word in words) or slug


class CatalogIngestService:
    """Create or update catalog records discovered from bucket storage."""

    def __init__(self, db: Session):
        self.db = db
        self.dataset_service = DatasetService(db)

    def preview_discovered_version(
        self,
        storage_location_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
        version: str,
    ) -> CatalogIngestResult:
        file_format = self._get_existing_file_format(
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
        storage_location_id: int,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
        version: str,
        location_path: str,
        source_metadata: Optional[SpatialDatasetFileMetadata] = None,
        dataset_description: Optional[str] = None,
    ) -> CatalogIngestResult:
        collection = self._get_or_create_hifld_collection()
        dataset = self._get_or_create_dataset(
            dataset_slug=dataset_slug,
            collection_id=collection.id,
            description=dataset_description,
        )
        file_obj = self._get_or_create_file(file_slug=file_slug, dataset=dataset)
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

    def _get_or_create_hifld_collection(self) -> Collection:
        statement = select(Collection).where(Collection.slug == "hifld")
        collection = self.db.exec(statement).first()
        if collection:
            return collection

        collection = Collection(
            slug="hifld",
            name="HIFLD",
            description="HIFLD discovered datasets",
        )
        self.db.add(collection)
        self.db.commit()
        self.db.refresh(collection)
        return collection

    def _get_or_create_dataset(
        self,
        dataset_slug: str,
        collection_id: int,
        description: Optional[str] = None,
    ) -> Dataset:
        statement = select(Dataset).where(Dataset.slug == dataset_slug)
        dataset = self.db.exec(statement).first()
        if dataset:
            changed = False
            if dataset.collection_id is None:
                dataset.collection_id = collection_id
                changed = True
            if dataset.description is None and description:
                dataset.description = description
                changed = True
            if changed:
                self.db.add(dataset)
                self.db.commit()
                self.db.refresh(dataset)
            return dataset

        dataset = Dataset(
            slug=dataset_slug,
            name=humanize_slug(dataset_slug),
            description=description,
            collection_id=collection_id,
        )
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return dataset

    def _get_or_create_file(self, file_slug: str, dataset: Dataset) -> File:
        statement = select(File).where(
            File.dataset_id == dataset.id,
            File.slug == file_slug,
        )
        file_obj = self.db.exec(statement).first()
        if file_obj:
            return file_obj

        file_obj = File(
            dataset_id=dataset.id,
            slug=file_slug,
            name=humanize_slug(file_slug),
            description=dataset.description,
        )
        self.db.add(file_obj)
        self.db.commit()
        self.db.refresh(file_obj)
        return file_obj

    def _get_existing_file_format(
        self,
        dataset_slug: str,
        file_slug: str,
        format_type: str,
    ) -> Optional[FileFormat]:
        statement = select(Dataset).where(Dataset.slug == dataset_slug)
        dataset = self.db.exec(statement).first()
        if not dataset:
            return None

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
