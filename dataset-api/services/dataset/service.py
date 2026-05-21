"""Dataset service for CRUD operations."""

import logging
from dataclasses import dataclass
from datetime import date, datetime
from re import sub

import sqlalchemy.exc as sa_exc
from sqlmodel import Session, col, func, select

from models.dataset import (
    ApiLocation,
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    Format,
    GeoServerLocation,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from schemas.types import APIDict, APIList, DatasetTags, JSONDict, model_json_dict
from services.dataset.queries import dataset_count_query, dataset_list_query, should_order_by_name
from services.dataset.shaping import dataset_with_urls, file_with_urls


logger = logging.getLogger(__name__)

DEFAULT_FORMAT_DETAILS: dict[str, dict[str, str | None]] = {
    "geoparquet": {
        "name": "GeoParquet",
        "description": "GeoParquet format for efficient spatial data storage and analysis",
        "mime_type": "application/parquet",
    },
    "pmtiles": {
        "name": "PMTiles",
        "description": "PMTiles format for tile serving and web mapping",
        "mime_type": "application/x-protobuf",
    },
    "geopackage": {
        "name": "GeoPackage",
        "description": "GeoPackage file format for portable spatial datasets",
        "mime_type": "application/geopackage+sqlite3",
    },
    "shapefile": {
        "name": "Shapefile",
        "description": "ESRI Shapefile dataset packaged as a multi-file vector format",
        "mime_type": "application/zip",
    },
    "geojson": {
        "name": "GeoJSON",
        "description": "GeoJSON feature collection format for web-friendly spatial data",
        "mime_type": "application/geo+json",
    },
    "file_geodatabase": {
        "name": "File Geodatabase",
        "description": "Esri File Geodatabase dataset format",
        "mime_type": "application/octet-stream",
    },
}


def slug_from_name(name: str) -> str:
    """Create a stable slug from a display name."""
    return sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def source_location_model(
    location: FileLocation | ApiLocation | GeoServerLocation | JSONDict,
) -> FileLocation | ApiLocation | GeoServerLocation:
    """Convert source location input into the matching typed model."""
    if isinstance(location, (FileLocation, ApiLocation, GeoServerLocation)):
        return location
    location_type = location.get("type", "file")
    if location_type == "file":
        return FileLocation.model_validate(location)
    if location_type == "api":
        return ApiLocation.model_validate(location)
    if location_type == "geoserver":
        return GeoServerLocation.model_validate(location)
    msg = f"Unsupported source location type: {location_type}"
    raise ValueError(msg)


def source_metadata_model(
    metadata: SpatialDatasetFileMetadata | JSONDict | None,
) -> SpatialDatasetFileMetadata | None:
    """Convert source metadata input into a typed model."""
    if metadata is None or isinstance(metadata, SpatialDatasetFileMetadata):
        return metadata
    return SpatialDatasetFileMetadata.model_validate(metadata)


@dataclass(frozen=True)
class FormatSourceCreate:
    """Input values for creating a file source."""

    file_format_id: int
    storage_location_id: int
    source_type: str
    location: FileLocation | ApiLocation | GeoServerLocation | JSONDict
    source_metadata: SpatialDatasetFileMetadata | JSONDict | None = None
    version: str | None = None


@dataclass(frozen=True)
class DatasetRegistration:
    """Input values for legacy dataset registration."""

    name: str
    dataset_format_id: int
    storage_location_id: int
    description: str | None = None
    collection_id: int | None = None
    tags: DatasetTags | None = None
    add_to_geoserver: bool = True


def add_dataset_tag_values(
    tag_values: dict[str, set[str]],
    dataset: Dataset,
    tag_key: str | None,
) -> None:
    """Add one dataset's tag values into an accumulator."""
    tags = dataset.tags
    if not tags:
        return
    for key, value in tags.items():
        if tag_key and key != tag_key:
            continue
        add_tag_value(tag_values, key, value)


def add_tag_value(tag_values: dict[str, set[str]], key: str, value: str | list[str]) -> None:
    """Add a scalar or list tag value to an accumulator."""
    values = tag_values.setdefault(key, set())
    if isinstance(value, list):
        values.update(item for item in value if isinstance(item, str))
    elif isinstance(value, str):
        values.add(value)


class DatasetService:
    """Service for dataset operations."""

    def __init__(self, db: Session) -> None:
        """Initialize the service with a database session."""
        self.db = db

    def get_datasets(
        self,
        search: str | None = None,
        collection_id: int | None = None,
        limit: int | None = None,
        offset: int | None = None,
        tag_filters: dict[str, str | list[str]] | None = None,
    ) -> list[Dataset]:
        """Get all datasets with optional full-text search, collection filter, and tag filters.

        Args:
            search: Full-text search query
            collection_id: Filter by collection ID
            limit: Maximum number of results
            offset: Number of results to skip
            tag_filters: Dict of tag key -> value(s) to filter by.
                        Values can be strings or lists of strings.
                        For lists, matches if any value in the list matches.
        """
        query = dataset_list_query(self.db, search, collection_id, tag_filters)
        if not query.has_matches:
            return []
        statement = query.statement
        if should_order_by_name(self.db, search):
            statement = statement.order_by(col(Dataset.name))

        if offset is not None:
            statement = statement.offset(offset)
        if limit is not None:
            statement = statement.limit(limit)

        return list(self.db.exec(statement).all())

    def get_dataset_by_id(self, dataset_id: int) -> Dataset | None:
        """Get a single dataset by ID."""
        return self.db.get(Dataset, dataset_id)

    def get_dataset_by_slug(self, collection_id: int, slug: str) -> Dataset | None:
        """Get a single dataset by slug within a collection."""
        statement = select(Dataset).where(
            col(Dataset.collection_id) == collection_id,
            col(Dataset.slug) == slug,
        )
        return self.db.exec(statement).first()

    def get_dataset_by_name(self, name: str) -> Dataset | None:
        """Get a single dataset by name."""
        statement = select(Dataset).where(col(Dataset.name) == name)
        return self.db.exec(statement).first()

    def create_dataset(
        self,
        name: str,
        description: str | None = None,
        collection_id: int | None = None,
        tags: DatasetTags | None = None,
    ) -> Dataset:
        """Create a new dataset."""
        dataset = Dataset(
            slug=slug_from_name(name),
            name=name,
            description=description,
            collection_id=collection_id,
            tags=tags,
        )
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return dataset

    def get_storage_location(self, storage_location_id: int | None) -> StorageLocation | None:
        """Get storage location by ID."""
        if not storage_location_id:
            return None
        return self.db.get(StorageLocation, storage_location_id)

    def get_storage_location_by_name(self, name: str) -> StorageLocation | None:
        """Get storage location by exact name."""
        statement = select(StorageLocation).where(col(StorageLocation.name) == name)
        return self.db.exec(statement).first()

    def get_file_by_slug(self, dataset_id: int, file_slug: str) -> File | None:
        """Get a file by dataset and slug."""
        statement = select(File).where(
            col(File.dataset_id) == dataset_id,
            col(File.slug) == file_slug,
        )
        return self.db.exec(statement).first()

    def get_or_create_file_format_for_file(self, file_id: int, format_type: str) -> FileFormat:
        """Get or create a file-format link for a specific file."""
        format_obj = self.get_or_create_format(format_type)
        statement = select(FileFormat).where(
            col(FileFormat.file_id) == file_id,
            col(FileFormat.format_id) == format_obj.id,
        )
        existing = self.db.exec(statement).first()
        if existing:
            return existing

        file_format = FileFormat(file_id=file_id, format_id=format_obj.id)
        self.db.add(file_format)
        self.db.commit()
        self.db.refresh(file_format)
        return file_format

    def get_dataset_formats(self, dataset_id: int) -> list[FileFormat]:
        """Get all formats available for a dataset."""
        statement = (
            select(FileFormat)
            .join(File, col(FileFormat.file_id) == col(File.id))
            .where(col(File.dataset_id) == dataset_id)
        )
        return list(self.db.exec(statement).all())

    def get_dataset_formats_with_format(self, dataset_id: int) -> APIList:
        """Get all formats for a dataset with format definition included."""
        statement = (
            select(FileFormat, Format)
            .join(Format, col(FileFormat.format_id) == col(Format.id))
            .join(File, col(FileFormat.file_id) == col(File.id))
            .where(col(File.dataset_id) == dataset_id)
        )
        results = []
        for file_format, format_obj in self.db.exec(statement).all():
            results.append(
                {
                    "file_format": file_format,
                    "format": format_obj,
                }
            )
        return results

    def get_format_by_type(self, format_type: str) -> Format | None:
        """Get a format definition by type."""
        statement = select(Format).where(col(Format.format_type) == format_type)
        return self.db.exec(statement).first()

    def get_or_create_format(self, format_type: str) -> Format:
        """Get or create a format definition."""
        format_obj = self.get_format_by_type(format_type)
        if not format_obj:
            details = DEFAULT_FORMAT_DETAILS.get(
                format_type,
                {
                    "name": format_type.replace("_", " ").title(),
                    "description": None,
                    "mime_type": None,
                },
            )
            format_obj = Format(
                format_type=format_type,
                name=details["name"] or format_type.replace("_", " ").title(),
                description=details["description"],
                mime_type=details["mime_type"],
            )
            self.db.add(format_obj)
            self.db.commit()
            self.db.refresh(format_obj)
        return format_obj

    def get_dataset_format(self, dataset_id: int, format_type: str) -> FileFormat | None:
        """Get a specific format for a dataset."""
        # First get the format definition
        format_obj = self.get_format_by_type(format_type)
        if not format_obj:
            return None

        # Then get the file-format link (through File)
        statement = (
            select(FileFormat)
            .join(File, col(FileFormat.file_id) == col(File.id))
            .where(col(File.dataset_id) == dataset_id)
            .where(col(FileFormat.format_id) == format_obj.id)
        )
        return self.db.exec(statement).first()

    def add_dataset_format(
        self,
        dataset_id: int,
        format_type: str,
        description: str | None = None,
    ) -> FileFormat:
        """Add a format to a dataset (creates a FileFormat for the first File in the dataset)."""
        # Get or create the format definition
        format_obj = self.get_or_create_format(format_type)

        # Check if this dataset already has this format
        existing = self.get_dataset_format(dataset_id, format_type)
        if existing:
            return existing

        # Get the first file for this dataset (or create one if none exists)

        statement = select(File).where(col(File.dataset_id) == dataset_id).limit(1)
        file_obj = self.db.exec(statement).first()

        if not file_obj:
            # Create a default file for this dataset
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                msg = f"Dataset {dataset_id} not found"
                raise ValueError(msg)
            file_obj = File(
                dataset_id=dataset_id,
                name=dataset.name,
                slug=dataset.slug,
                description=description or dataset.description,
            )
            self.db.add(file_obj)
            self.db.commit()
            self.db.refresh(file_obj)

        # Create the file-format link
        file_format = FileFormat(
            file_id=file_obj.id,
            format_id=format_obj.id,
        )
        self.db.add(file_format)
        self.db.commit()
        self.db.refresh(file_format)
        return file_format

    def get_format_sources(self, file_format_id: int, latest_only: bool = True) -> list[FileSource]:
        """Get sources (storage locations) for a format.

        Args:
            file_format_id: ID of the file format
            latest_only: If True, return only the latest version for each storage location.
                        If False, return all versions.
        """
        if latest_only:
            # Get only the latest version for each storage location
            # Use a subquery to find max version per (file_format_id, storage_location_id)
            subquery = (
                select(
                    col(FileSource.storage_location_id),
                    func.max(col(FileSource.version)).label("max_version"),
                )
                .where(col(FileSource.file_format_id) == file_format_id)
                .group_by(col(FileSource.storage_location_id))
            ).subquery()

            statement = (
                select(FileSource)
                .join(
                    subquery,
                    (col(FileSource.storage_location_id) == subquery.c.storage_location_id)
                    & (col(FileSource.version) == subquery.c.max_version),
                )
                .where(col(FileSource.file_format_id) == file_format_id)
            )
        else:
            statement = select(FileSource).where(col(FileSource.file_format_id) == file_format_id)

        return list(self.db.exec(statement).all())

    def get_format_source_by_location(
        self,
        file_format_id: int,
        storage_location_id: int,
        version: str | None = None,
    ) -> FileSource | None:
        """Get a specific source for a format in a storage location.

        Args:
            file_format_id: ID of the file format
            storage_location_id: ID of the storage location
            version: Optional version string. If None, returns the latest version.

        Returns:
            FileSource or None if not found
        """
        statement = (
            select(FileSource)
            .where(col(FileSource.file_format_id) == file_format_id)
            .where(col(FileSource.storage_location_id) == storage_location_id)
        )

        if version is not None:
            statement = statement.where(col(FileSource.version) == version)
        else:
            # Get latest version (by date string, newest first)
            statement = statement.order_by(col(FileSource.version).desc()).limit(1)

        return self.db.exec(statement).first()

    def get_format_source_versions(self, file_format_id: int, storage_location_id: int) -> list[FileSource]:
        """Get all versions of a source for a format in a storage location.

        Args:
            file_format_id: ID of the file format
            storage_location_id: ID of the storage location

        Returns:
            List of FileSource objects ordered by version (newest first)
        """
        statement = (
            select(FileSource)
            .where(col(FileSource.file_format_id) == file_format_id)
            .where(col(FileSource.storage_location_id) == storage_location_id)
            .order_by(col(FileSource.version).desc())
        )
        return list(self.db.exec(statement).all())

    def add_format_source(self, request: FormatSourceCreate) -> FileSource:
        """Add a new version of a data source (file, database, API, etc.) to a format.

        Args:
            request: Source creation values, including:
                - file_format_id: ID of the file format
                - storage_location_id: ID of the storage location
                - source_type: Type of source - "file", "database", "api", or "geoserver"
                - location: Location dict following the appropriate schema:
                - For files: {"path": "tiles/power-plants.pmtiles"} (FileLocation)
                - For databases: {"connection_string": "...", "table": "..."} (DatabaseLocation)
                - For APIs: {"url": "https://...", "method": "GET"} (ApiLocation)
                - source_metadata: Metadata dict following SpatialDatasetFileMetadata schema
                - version: Version string (defaults to current date in YYYY-MM-DD format)

        Returns:
            The newly created FileSource
        """
        # Use provided version or default to today's date
        version = request.version or date.today().isoformat()

        file_source = FileSource(
            file_format_id=request.file_format_id,
            storage_location_id=request.storage_location_id,
            version=version,
            source_type=request.source_type,
            location=source_location_model(request.location),
            source_metadata=source_metadata_model(request.source_metadata),
        )
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def update_format_source(
        self,
        file_source_id: int,
        location: FileLocation | ApiLocation | GeoServerLocation | JSONDict,
        source_metadata: SpatialDatasetFileMetadata | JSONDict | None = None,
    ) -> FileSource | None:
        """Update location and metadata for an existing FileSource."""
        file_source = self.db.get(FileSource, file_source_id)
        if not file_source:
            return None

        file_source.location = source_location_model(location)
        file_source.source_metadata = source_metadata_model(source_metadata)
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def update_source_metadata(
        self, file_source_id: int, metadata_patch: SpatialDatasetFileMetadata | JSONDict
    ) -> FileSource | None:
        """Merge and persist source_metadata for a FileSource."""
        file_source = self.db.get(FileSource, file_source_id)
        if not file_source:
            return None

        current = file_source.source_metadata
        if isinstance(current, dict):
            merged = dict(current)
        elif current and hasattr(current, "model_dump"):
            merged = current.model_dump()
        else:
            merged = {}

        patch_dict = (
            metadata_patch.model_dump() if isinstance(metadata_patch, SpatialDatasetFileMetadata) else metadata_patch
        )
        merged.update(patch_dict)
        if "version" not in merged:
            merged["version"] = "v1"

        file_source.source_metadata = SpatialDatasetFileMetadata.model_validate(merged)
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def get_dataset_sources(self, dataset_id: int) -> list[FileSource]:
        """Get all sources for a dataset (across all formats)."""
        statement = (
            select(FileSource)
            .join(FileFormat, col(FileSource.file_format_id) == col(FileFormat.id))
            .join(File, col(FileFormat.file_id) == col(File.id))
            .where(col(File.dataset_id) == dataset_id)
        )
        return list(self.db.exec(statement).all())

    def get_dataset_with_files(self, dataset_id: int) -> APIDict | None:
        """Get a dataset with files list (but without URLs).

        Returns a dict with dataset fields plus:
        - files (list of files, each with basic info and format count, but no sources/URLs)
        """
        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        dataset_dict: APIDict = model_json_dict(dataset)

        # Get all files for this dataset
        files_statement = select(File).where(col(File.dataset_id) == dataset_id)
        files = list(self.db.exec(files_statement).all())

        # Get format counts for each file (without loading sources)
        file_ids = [file_obj.id for file_obj in files]
        file_format_counts: dict[int, int] = {}
        if file_ids:
            # Count formats per file
            for file_id in file_ids:
                count_statement = select(func.count(col(FileFormat.id))).where(col(FileFormat.file_id) == file_id)
                count = self.db.exec(count_statement).one()
                file_format_counts[file_id] = count or 0

        # Build files array with basic info
        dataset_dict["files"] = []
        for file_obj in files:
            file_dict: APIDict = model_json_dict(file_obj)
            # Add format count for UI display
            file_dict["formats"] = []
            format_count = file_format_counts.get(file_obj.id, 0)
            if format_count > 0:
                # Add a placeholder format entry just to indicate formats exist
                # The UI will use this to show the format count badge
                file_dict["formats"] = [{"format_count": format_count}]
            dataset_dict["files"].append(file_dict)

        return dataset_dict

    def get_dataset_with_urls(self, dataset_id: int) -> APIDict | None:
        """Get a dataset with full URLs constructed from storage locations.

        Returns a dict with dataset fields plus:
        - files (list of files, each with list of formats and sources)
        """
        try:
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                return None
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError):
            # Session is in a bad state - let FastAPI's dependency injection handle rollback
            logger.exception("Database session error for dataset %s", dataset_id)
            raise
        else:
            return dataset_with_urls(self.db, dataset)

    async def get_dataset_file_with_urls_by_id(self, dataset_id: int, file_id: int) -> APIDict | None:
        """Get a single file for a dataset by IDs with full URLs constructed from storage locations.

        Returns a dict with:
        - dataset (dataset metadata)
        - file (file with formats and sources)
        """
        try:
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                return None

            file_statement = select(File).where(
                col(File.id) == file_id,
                col(File.dataset_id) == dataset_id,
            )
            file_obj = self.db.exec(file_statement).first()
            if not file_obj:
                return None

            # Continue with the same logic as the slug-based method
            return await self._get_file_with_urls_impl(dataset, file_obj)
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError):
            logger.exception("Database session error for file %s in dataset %s", file_id, dataset_id)
            raise
        except Exception:
            logger.exception("Unexpected error getting file %s for dataset %s", file_id, dataset_id)
            raise

    async def get_dataset_file_with_urls(self, collection_id: int, dataset_slug: str, file_slug: str) -> APIDict | None:
        """Get a single file for a dataset with full URLs constructed from storage locations.

        Returns a dict with:
        - dataset (dataset metadata)
        - file (file with formats and sources)
        """
        try:
            dataset_statement = select(Dataset).where(
                col(Dataset.collection_id) == collection_id,
                col(Dataset.slug) == dataset_slug,
            )
            dataset = self.db.exec(dataset_statement).first()
            if not dataset:
                return None

            file_statement = select(File).where(
                col(File.dataset_id) == dataset.id,
                col(File.slug) == file_slug,
            )
            file_obj = self.db.exec(file_statement).first()
            if not file_obj:
                return None

            # Use shared implementation
            return await self._get_file_with_urls_impl(dataset, file_obj)
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError):
            logger.exception("Database session error for file %s in dataset %s", file_slug, dataset_slug)
            raise
        except Exception:
            logger.exception("Unexpected error getting file %s for dataset %s", file_slug, dataset_slug)
            raise

    async def _get_file_with_urls_impl(self, dataset: Dataset, file_obj: File) -> APIDict | None:
        """Shared implementation for getting file with URLs."""
        try:
            return await file_with_urls(self.db, dataset, file_obj)
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError):
            logger.exception("Database session error for file %s in dataset %s", file_obj.id, dataset.id)
            raise
        except Exception:
            logger.exception("Unexpected error getting file %s for dataset %s", file_obj.id, dataset.id)
            raise

    def update_dataset(
        self,
        dataset_id: int,
        name: str | None = None,
        description: str | None = None,
        collection_id: int | None = None,
        tags: DatasetTags | None = None,
    ) -> Dataset | None:
        """Update a dataset."""
        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        if name is not None:
            dataset.name = name
        if description is not None:
            dataset.description = description
        if collection_id is not None:
            dataset.collection_id = collection_id
        if tags is not None:
            dataset.tags = tags

        dataset.updated_at = datetime.utcnow()
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return dataset

    def delete_dataset(self, dataset_id: int) -> bool:
        """Delete a dataset and all related records (files, formats, sources)."""
        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return False

        try:
            # Cascade deletes (configured in models) will handle:
            # Dataset -> File -> FileFormat -> FileSource
            self.db.delete(dataset)
            self.db.commit()
        except Exception:
            # Rollback on any error
            self.db.rollback()
            logger.exception("Error deleting dataset %s", dataset_id)
            raise
        else:
            return True

    async def register_dataset(self, request: DatasetRegistration) -> tuple[Dataset, bool]:
        """Register a dataset in the catalog.

        Args:
            request: Registration values. Format/storage IDs are retained for
                legacy callers, but GeoServer registration is no longer used.

        Returns:
            Tuple of (dataset, False). The boolean is retained for legacy callers.
        """
        if request.add_to_geoserver:
            logger.warning("GeoServer registration is no longer supported; skipping")

        # Create dataset
        dataset = self.create_dataset(
            name=request.name,
            description=request.description,
            collection_id=request.collection_id,
            tags=request.tags,
        )

        return dataset, False

    def get_dataset_stats(self) -> dict[str, int]:
        """Get dataset statistics."""
        total = self.db.exec(select(func.count(col(Dataset.id)))).one()

        return {
            "total": total,
        }

    def get_available_tag_values(
        self, collection_id: int | None = None, tag_key: str | None = None
    ) -> dict[str, list[str]]:
        """Get all available tag values for a collection.

        Args:
            collection_id: Filter by collection ID
            tag_key: If provided, only return values for this tag key

        Returns:
            Dict mapping tag keys to lists of unique values
        """
        # Select full Dataset objects, not just tags column
        statement = select(Dataset).where(col(Dataset.tags).isnot(None))
        if collection_id is not None:
            statement = statement.where(col(Dataset.collection_id) == collection_id)

        datasets = self.db.exec(statement).all()

        tag_values: dict[str, set[str]] = {}
        for dataset in datasets:
            add_dataset_tag_values(tag_values, dataset, tag_key)
        return {key: sorted(values) for key, values in tag_values.items()}

    def count_datasets(
        self,
        search: str | None = None,
        collection_id: int | None = None,
        tag_filters: dict[str, str | list[str]] | None = None,
    ) -> int:
        """Count datasets with optional search and collection filter."""
        query = dataset_count_query(self.db, search, collection_id, tag_filters)
        if not query.has_matches:
            return 0
        return self.db.exec(query.statement).one()
