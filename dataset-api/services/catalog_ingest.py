"""Shared catalog ingest logic for dataset discovery."""

from typing import Any, Optional

from pydantic import BaseModel
from sqlmodel import Session, select

from models.dataset import (
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    Format,
    SpatialDatasetFileMetadata,
)
from services.datasets import DatasetService


class CatalogIngestResult(BaseModel):
    created: bool
    dry_run: bool
    file_source_id: Optional[int] = None


class CatalogPruneResult(BaseModel):
    dry_run: bool
    deleted_file_source_ids: list[int]
    deleted_file_format_ids: list[int]
    deleted_file_ids: list[int]
    deleted_dataset_ids: list[int]


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

    def prune_stale_discovered_sources(
        self,
        collection_id: int,
        storage_location_id: int,
        discovered_source_keys: set[tuple[str, str, str, str]],
        dry_run: bool = False,
    ) -> CatalogPruneResult:
        """Delete discovered catalog records that are no longer in the source bucket.

        Pruning is scoped to one collection and one storage location. A source is
        kept only when its dataset slug, file slug, format type, and version were
        observed in the current discovery scan.
        """
        existing_sources = self._list_sources_for_target(
            collection_id=collection_id,
            storage_location_id=storage_location_id,
        )
        stale_source_ids = sorted(
            source.id
            for source, file_format, file_obj, dataset, format_obj in existing_sources
            if source.id is not None
            and (
                dataset.slug,
                file_obj.slug,
                format_obj.format_type,
                source.version,
            )
            not in discovered_source_keys
        )

        cleanup_ids = self._collect_empty_catalog_ids_after_source_prune(
            collection_id=collection_id,
            stale_source_ids=set(stale_source_ids),
        )
        result = CatalogPruneResult(
            dry_run=dry_run,
            deleted_file_source_ids=stale_source_ids,
            deleted_file_format_ids=cleanup_ids["file_format_ids"],
            deleted_file_ids=cleanup_ids["file_ids"],
            deleted_dataset_ids=cleanup_ids["dataset_ids"],
        )
        if dry_run:
            return result

        for source_id in stale_source_ids:
            source = self.db.get(FileSource, source_id)
            if source:
                self.db.delete(source)
        self.db.commit()

        for file_format_id in cleanup_ids["file_format_ids"]:
            file_format = self.db.get(FileFormat, file_format_id)
            if file_format:
                self.db.delete(file_format)
        self.db.commit()

        for file_id in cleanup_ids["file_ids"]:
            file_obj = self.db.get(File, file_id)
            if file_obj:
                self.db.delete(file_obj)
        self.db.commit()

        for dataset_id in cleanup_ids["dataset_ids"]:
            dataset = self.db.get(Dataset, dataset_id)
            if dataset:
                self.db.delete(dataset)
        self.db.commit()
        return result

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

        if name:
            statement = select(File).where(
                File.dataset_id == dataset.id,
                File.name == name,
            )
            file_obj = self.db.exec(statement).first()
            if file_obj:
                file_obj.slug = file_slug
                if description is not None and file_obj.description != description:
                    file_obj.description = description
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

    def _list_sources_for_target(
        self,
        collection_id: int,
        storage_location_id: int,
    ) -> list[tuple[FileSource, FileFormat, File, Dataset, Format]]:
        statement = (
            select(FileSource, FileFormat, File, Dataset, Format)
            .join(FileFormat, FileSource.file_format_id == FileFormat.id)
            .join(File, FileFormat.file_id == File.id)
            .join(Dataset, File.dataset_id == Dataset.id)
            .join(Format, FileFormat.format_id == Format.id)
            .where(Dataset.collection_id == collection_id)
            .where(FileSource.storage_location_id == storage_location_id)
        )
        return list(self.db.exec(statement).all())

    def _collect_empty_catalog_ids_after_source_prune(
        self,
        collection_id: int,
        stale_source_ids: set[int],
    ) -> dict[str, list[int]]:
        file_formats = self.db.exec(
            select(FileFormat, File, Dataset)
            .join(File, FileFormat.file_id == File.id)
            .join(Dataset, File.dataset_id == Dataset.id)
            .where(Dataset.collection_id == collection_id)
        ).all()
        file_format_ids = sorted(
            file_format.id
            for file_format, _, _ in file_formats
            if file_format.id is not None
            and all(
                source.id in stale_source_ids
                for source in self.db.exec(
                    select(FileSource).where(
                        FileSource.file_format_id == file_format.id
                    )
                ).all()
                if source.id is not None
            )
        )

        files = self.db.exec(
            select(File).join(Dataset, File.dataset_id == Dataset.id).where(
                Dataset.collection_id == collection_id
            )
        ).all()
        file_format_ids_set = set(file_format_ids)
        file_ids = sorted(
            file_obj.id
            for file_obj in files
            if file_obj.id is not None
            and all(
                file_format.id in file_format_ids_set
                for file_format in self.db.exec(
                    select(FileFormat).where(FileFormat.file_id == file_obj.id)
                ).all()
                if file_format.id is not None
            )
        )

        datasets = self.db.exec(
            select(Dataset).where(Dataset.collection_id == collection_id)
        ).all()
        file_ids_set = set(file_ids)
        dataset_ids = sorted(
            dataset.id
            for dataset in datasets
            if dataset.id is not None
            and all(
                file_obj.id in file_ids_set
                for file_obj in self.db.exec(
                    select(File).where(File.dataset_id == dataset.id)
                ).all()
                if file_obj.id is not None
            )
        )
        return {
            "file_format_ids": file_format_ids,
            "file_ids": file_ids,
            "dataset_ids": dataset_ids,
        }
