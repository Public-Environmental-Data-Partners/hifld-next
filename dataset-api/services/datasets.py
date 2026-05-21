"""Dataset service for CRUD operations."""

import logging
import traceback
from datetime import date, datetime
from typing import Optional, Any, Union
from sqlmodel import Session, select, func, or_
import sqlalchemy as sa
import sqlalchemy.exc as sa_exc
from sqlalchemy.dialects import postgresql

from models.dataset import (
    Dataset,
    Format,
    File,
    FileFormat,
    FileSource,
    FileLocation,
    ApiLocation,
    GeoServerLocation,
    SpatialDatasetFileMetadata,
    StorageLocation,
    FileSource as FileSourceModel,
    FileLocation as FileLocationModel,
)
from models.helpers import (
    get_file_source_url,
    get_file_source_storage_uri,
    expand_glob_pattern_in_source,
    construct_glob_pattern_from_sources,
)

logger = logging.getLogger(__name__)

DEFAULT_FORMAT_DETAILS: dict[str, dict[str, Optional[str]]] = {
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


class DatasetService:
    """Service for dataset operations."""

    def __init__(self, db: Session):
        self.db = db

    def get_datasets(
        self,
        search: Optional[str] = None,
        collection_id: Optional[int] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tag_filters: Optional[dict[str, Union[str, list[str]]]] = None,
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
        if search and search.strip():
            search_query = search.strip()

            # Additional validation: prevent extremely long queries
            if len(search_query) > 500:
                logger.warning(
                    f"Search query too long ({len(search_query)} chars), truncating"
                )
                search_query = search_query[:500]

            bind = self.db.get_bind()
            dialect_name = bind.dialect.name

            if dialect_name == "postgresql":
                # Use PostgreSQL tsvector full-text search
                try:
                    # Build tsquery from search terms
                    # PostgreSQL tsquery syntax: term (exact), term:* (prefix), "phrase" (exact phrase)
                    search_terms = search_query.split()
                    ts_queries = []

                    for term in search_terms:
                        # Remove quotes if present for phrase matching
                        if term.startswith('"') and term.endswith('"'):
                            # Exact phrase match
                            ts_queries.append(term)
                        else:
                            # Prefix match for better results
                            ts_queries.append(f"{term}:*")

                    # Combine with & (AND) operator
                    ts_query = " & ".join(ts_queries)

                    # Validate tsquery to prevent crashes from malformed queries
                    # PostgreSQL will throw an error for invalid tsquery syntax
                    # We'll catch it in the try/except below
                    if not ts_query or len(ts_query.strip()) == 0:
                        raise ValueError("Empty tsquery")

                    # Create a single bindparam to reuse in both where and order_by
                    query_param = sa.bindparam("query", ts_query)

                    # Query using tsvector search_vector column
                    # Use text() with bindparam for parameterized queries
                    statement = select(Dataset).where(
                        sa.text(
                            "search_vector @@ to_tsquery('english', :query)"
                        ).bindparams(query_param)
                    )

                    # Filter by collection if provided
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )

                    # Order by relevance (ts_rank) - reuse the same bindparam
                    statement = statement.order_by(
                        sa.text(
                            "ts_rank(search_vector, to_tsquery('english', :query)) DESC"
                        ).bindparams(query_param)
                    )

                except Exception as e:
                    # Fallback to simple LIKE if tsvector query fails
                    logger.warning(
                        f"PostgreSQL tsvector query failed, falling back to LIKE: {e}"
                    )
                    search_pattern = f"%{search.strip()}%"
                    # Search in name, description, and tags (tags is JSONB array)
                    statement = (
                        select(Dataset)
                        .where(
                            or_(
                                Dataset.name.ilike(search_pattern),
                                Dataset.description.ilike(search_pattern),
                                # Search in tags JSONB object (PostgreSQL) - search all values
                                sa.text("tags::text ILIKE :pattern"),
                            )
                        )
                        .params(pattern=search_pattern)
                    )
                    # Filter by collection if provided
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
            else:
                # Use FTS5 for SQLite full-text search
                try:
                    # Build FTS5 query - split terms and handle prefix matching
                    # FTS5 syntax supports: term (exact), term* (prefix), "phrase" (exact phrase)
                    search_terms = search_query.split()
                    fts_queries = []

                    for term in search_terms:
                        # Remove quotes if present for phrase matching
                        if term.startswith('"') and term.endswith('"'):
                            # Exact phrase match
                            fts_queries.append(term)
                        else:
                            # Prefix match for better results
                            fts_queries.append(f"{term}*")

                    # Combine with AND (all terms must match)
                    fts_query = " AND ".join(fts_queries)

                    # Validate FTS5 query to prevent crashes
                    if not fts_query or len(fts_query.strip()) == 0:
                        raise ValueError("Empty FTS5 query")

                    # Sanitize FTS5 query - escape special characters that could cause issues
                    # FTS5 special characters: ", ', \ need to be handled carefully
                    # For now, we'll let SQLite handle it and catch exceptions

                    # Query FTS5 table to get matching dataset IDs
                    fts_statement = sa.text(
                        """
                        SELECT id FROM datasets_fts 
                        WHERE datasets_fts MATCH :query
                        ORDER BY rank
                    """
                    )

                    try:
                        fts_result = self.db.exec(
                            fts_statement.bindparams(query=fts_query)
                        )
                    except Exception as fts_error:
                        # FTS5 query syntax error - log and fallback
                        logger.warning(
                            f"FTS5 query syntax error for query '{fts_query}': {fts_error}. Falling back to LIKE."
                        )
                        raise  # Will be caught by outer try/except
                    matching_ids = [row[0] for row in fts_result]

                    if not matching_ids:
                        return []

                    # Query the main datasets table with the matching IDs
                    statement = select(Dataset).where(Dataset.id.in_(matching_ids))

                    # Filter by collection if provided
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
                except Exception as e:
                    # Fallback to simple LIKE if FTS5 query fails (e.g., FTS5 not available)
                    logger.warning(f"FTS5 query failed, falling back to LIKE: {e}")
                    search_pattern = f"%{search.strip()}%"
                    # Search in name, description, and tags (tags is JSON array)
                    statement = (
                        select(Dataset)
                        .where(
                            or_(
                                Dataset.name.like(search_pattern),
                                Dataset.description.like(search_pattern),
                                # Search in tags JSON object (SQLite json) - search all values
                                sa.text("tags LIKE :pattern"),
                            )
                        )
                        .params(pattern=search_pattern)
                    )
                    # Filter by collection if provided
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
        else:
            statement = select(Dataset)
            # Filter by collection if provided
            if collection_id is not None:
                statement = statement.where(Dataset.collection_id == collection_id)

        # Apply tag filters (more efficient than text search)
        if tag_filters:
            bind = self.db.get_bind()
            dialect_name = bind.dialect.name

            for tag_key, tag_value in tag_filters.items():
                if tag_value is None:
                    continue

                # Normalize to list for consistent handling
                filter_values = (
                    tag_value if isinstance(tag_value, list) else [tag_value]
                )
                filter_values = [str(v) for v in filter_values if v is not None]

                if not filter_values:
                    continue

                if dialect_name == "postgresql":
                    # PostgreSQL JSONB filtering using explicit operators to avoid [] syntax
                    tags_jsonb = sa.cast(Dataset.tags, postgresql.JSONB)
                    conditions = []
                    for val in filter_values:
                        key_literal = sa.literal(tag_key)
                        conditions.append(
                            sa.or_(
                                tags_jsonb.op("->>")(key_literal) == val,
                                tags_jsonb.op("->")(key_literal).op("@>")(
                                    sa.cast([val], postgresql.JSONB)
                                ),
                            )
                        )
                    if conditions:
                        statement = statement.where(or_(*conditions))
                else:
                    # SQLite JSON filtering
                    # Match if tag value equals any filter value (string) or contains it (array)
                    conditions = []
                    for idx, val in enumerate(filter_values):
                        # Use unique parameter names for each iteration to avoid conflicts
                        key_path = f"$.{tag_key}"
                        conditions.append(
                            sa.or_(
                                sa.text(
                                    f"json_extract(tags, :key_path_{idx}) = :tag_val_{idx}"
                                ).params(
                                    **{
                                        f"key_path_{idx}": key_path,
                                        f"tag_val_{idx}": val,
                                    }
                                ),
                                sa.text(f"tags LIKE :tag_like_{idx}").params(
                                    **{f"tag_like_{idx}": f'%"{val}"%'}
                                ),
                            )
                        )
                    if conditions:
                        # Combine with OR (any of the filter values match)
                        statement = statement.where(or_(*conditions))

        # Only order by name if not already ordered by relevance
        bind = self.db.get_bind()
        if not (search and search.strip() and bind.dialect.name == "postgresql"):
            statement = statement.order_by(Dataset.name)

        # Apply pagination
        if offset is not None:
            statement = statement.offset(offset)
        if limit is not None:
            statement = statement.limit(limit)

        return list(self.db.exec(statement).all())

    def get_dataset_by_id(self, dataset_id: int) -> Optional[Dataset]:
        """Get a single dataset by ID."""
        return self.db.get(Dataset, dataset_id)

    def get_dataset_by_slug(self, collection_id: int, slug: str) -> Optional[Dataset]:
        """Get a single dataset by slug within a collection."""
        statement = select(Dataset).where(
            Dataset.collection_id == collection_id, Dataset.slug == slug
        )
        return self.db.exec(statement).first()

    def get_dataset_by_name(self, name: str) -> Optional[Dataset]:
        """Get a single dataset by name."""
        statement = select(Dataset).where(Dataset.name == name)
        return self.db.exec(statement).first()

    def create_dataset(
        self,
        name: str,
        description: Optional[str] = None,
        collection_id: Optional[int] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> Dataset:
        """Create a new dataset."""
        dataset = Dataset(
            name=name,
            description=description,
            collection_id=collection_id,
            tags=tags,
        )
        self.db.add(dataset)
        self.db.commit()
        self.db.refresh(dataset)
        return dataset

    def get_storage_location(
        self, storage_location_id: Optional[int]
    ) -> Optional[StorageLocation]:
        """Get storage location by ID."""
        if not storage_location_id:
            return None
        return self.db.get(StorageLocation, storage_location_id)

    def get_storage_location_by_name(self, name: str) -> Optional[StorageLocation]:
        """Get storage location by exact name."""
        statement = select(StorageLocation).where(StorageLocation.name == name)
        return self.db.exec(statement).first()

    def get_file_by_slug(self, dataset_id: int, file_slug: str) -> Optional[File]:
        """Get a file by dataset and slug."""
        statement = select(File).where(
            File.dataset_id == dataset_id,
            File.slug == file_slug,
        )
        return self.db.exec(statement).first()

    def get_or_create_file_format_for_file(
        self, file_id: int, format_type: str
    ) -> FileFormat:
        """Get or create a file-format link for a specific file."""
        format_obj = self.get_or_create_format(format_type)
        statement = select(FileFormat).where(
            FileFormat.file_id == file_id,
            FileFormat.format_id == format_obj.id,
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
            .join(File, FileFormat.file_id == File.id)
            .where(File.dataset_id == dataset_id)
        )
        return list(self.db.exec(statement).all())

    def get_dataset_formats_with_format(self, dataset_id: int) -> list[dict]:
        """Get all formats for a dataset with format definition included."""

        statement = (
            select(FileFormat, Format)
            .join(Format, FileFormat.format_id == Format.id)
            .join(File, FileFormat.file_id == File.id)
            .where(File.dataset_id == dataset_id)
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

    def get_format_by_type(self, format_type: str) -> Optional[Format]:
        """Get a format definition by type."""

        statement = select(Format).where(Format.format_type == format_type)
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
            format_obj = Format(format_type=format_type, **details)
            self.db.add(format_obj)
            self.db.commit()
            self.db.refresh(format_obj)
        return format_obj

    def get_dataset_format(
        self, dataset_id: int, format_type: str
    ) -> Optional[FileFormat]:
        """Get a specific format for a dataset."""

        # First get the format definition
        format_obj = self.get_format_by_type(format_type)
        if not format_obj:
            return None

        # Then get the file-format link (through File)
        statement = (
            select(FileFormat)
            .join(File, FileFormat.file_id == File.id)
            .where(File.dataset_id == dataset_id)
            .where(FileFormat.format_id == format_obj.id)
        )
        return self.db.exec(statement).first()

    def add_dataset_format(
        self,
        dataset_id: int,
        format_type: str,
        description: Optional[str] = None,
    ) -> FileFormat:
        """Add a format to a dataset (creates a FileFormat for the first File in the dataset)."""
        # Get or create the format definition
        format_obj = self.get_or_create_format(format_type)

        # Check if this dataset already has this format
        existing = self.get_dataset_format(dataset_id, format_type)
        if existing:
            return existing

        # Get the first file for this dataset (or create one if none exists)

        statement = select(File).where(File.dataset_id == dataset_id).limit(1)
        file_obj = self.db.exec(statement).first()

        if not file_obj:
            # Create a default file for this dataset
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                raise ValueError(f"Dataset {dataset_id} not found")
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

    def get_format_sources(
        self, file_format_id: int, latest_only: bool = True
    ) -> list[FileSource]:
        """
        Get sources (storage locations) for a format.

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
                    FileSource.storage_location_id,
                    func.max(FileSource.version).label("max_version"),
                )
                .where(FileSource.file_format_id == file_format_id)
                .group_by(FileSource.storage_location_id)
            ).subquery()

            statement = (
                select(FileSource)
                .join(
                    subquery,
                    (FileSource.storage_location_id == subquery.c.storage_location_id)
                    & (FileSource.version == subquery.c.max_version),
                )
                .where(FileSource.file_format_id == file_format_id)
            )
        else:
            statement = select(FileSource).where(
                FileSource.file_format_id == file_format_id
            )

        return list(self.db.exec(statement).all())

    def get_format_source_by_location(
        self,
        file_format_id: int,
        storage_location_id: int,
        version: Optional[str] = None,
    ) -> Optional[FileSource]:
        """
        Get a specific source for a format in a storage location.

        Args:
            file_format_id: ID of the file format
            storage_location_id: ID of the storage location
            version: Optional version string. If None, returns the latest version.

        Returns:
            FileSource or None if not found
        """

        statement = (
            select(FileSource)
            .where(FileSource.file_format_id == file_format_id)
            .where(FileSource.storage_location_id == storage_location_id)
        )

        if version is not None:
            statement = statement.where(FileSource.version == version)
        else:
            # Get latest version (by date string, newest first)
            statement = statement.order_by(FileSource.version.desc()).limit(1)

        return self.db.exec(statement).first()

    def get_format_source_versions(
        self, file_format_id: int, storage_location_id: int
    ) -> list[FileSource]:
        """
        Get all versions of a source for a format in a storage location.

        Args:
            file_format_id: ID of the file format
            storage_location_id: ID of the storage location

        Returns:
            List of FileSource objects ordered by version (newest first)
        """

        statement = (
            select(FileSource)
            .where(FileSource.file_format_id == file_format_id)
            .where(FileSource.storage_location_id == storage_location_id)
            .order_by(FileSource.version.desc())
        )
        return list(self.db.exec(statement).all())

    def add_format_source(
        self,
        file_format_id: int,
        storage_location_id: int,
        source_type: str,
        location: FileLocation | ApiLocation | GeoServerLocation | dict[str, Any],
        source_metadata: Optional[SpatialDatasetFileMetadata | dict[str, Any]] = None,
        version: Optional[str] = None,
    ) -> FileSource:
        """
        Add a new version of a data source (file, database, API, etc.) to a format.

        Args:
            file_format_id: ID of the file format
            storage_location_id: ID of the storage location
            source_type: Type of source - "file", "database", "api", or "geoserver"
            location: Location dict following the appropriate schema:
                - For files: {"path": "tiles/power-plants.pmtiles"} (FileLocation)
                - For databases: {"connection_string": "...", "table": "..."} (DatabaseLocation)
                - For APIs: {"url": "https://...", "method": "GET"} (ApiLocation)
            source_metadata: Metadata dict following SpatialDatasetFileMetadata schema
            version: Version string (defaults to current date in YYYY-MM-DD format)

        Returns:
            The newly created FileSource
        """

        # Use provided version or default to today's date
        if version is None:
            version = date.today().isoformat()

        # Create new source
        # Convert Pydantic models to dicts if needed
        location_dict = (
            location.model_dump() if hasattr(location, "model_dump") else location
        )
        metadata_dict = (
            source_metadata.model_dump()
            if source_metadata and hasattr(source_metadata, "model_dump")
            else source_metadata
        )

        file_source = FileSource(
            file_format_id=file_format_id,
            storage_location_id=storage_location_id,
            version=version,
            source_type=source_type,
            location=location_dict,
            source_metadata=metadata_dict,
        )
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def update_format_source(
        self,
        file_source_id: int,
        location: FileLocation | ApiLocation | GeoServerLocation | dict[str, Any],
        source_metadata: Optional[SpatialDatasetFileMetadata | dict[str, Any]] = None,
    ) -> Optional[FileSource]:
        """Update location and metadata for an existing FileSource."""
        file_source = self.db.get(FileSource, file_source_id)
        if not file_source:
            return None

        location_dict = (
            location.model_dump() if hasattr(location, "model_dump") else location
        )
        metadata_dict = (
            source_metadata.model_dump()
            if source_metadata and hasattr(source_metadata, "model_dump")
            else source_metadata
        )
        file_source.location = location_dict
        file_source.source_metadata = metadata_dict
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def update_source_metadata(
        self, file_source_id: int, metadata_patch: dict[str, Any]
    ) -> Optional[FileSource]:
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

        merged.update(metadata_patch or {})
        if "version" not in merged:
            merged["version"] = "v1"

        file_source.source_metadata = merged
        self.db.add(file_source)
        self.db.commit()
        self.db.refresh(file_source)
        return file_source

    def get_dataset_sources(self, dataset_id: int) -> list[FileSource]:
        """Get all sources for a dataset (across all formats)."""

        statement = (
            select(FileSource)
            .join(FileFormat, FileSource.file_format_id == FileFormat.id)
            .join(File, FileFormat.file_id == File.id)
            .where(File.dataset_id == dataset_id)
        )
        return list(self.db.exec(statement).all())

    def get_dataset_with_files(self, dataset_id: int) -> Optional[dict]:
        """
        Get a dataset with files list (but without URLs).

        Returns a dict with dataset fields plus:
        - files (list of files, each with basic info and format count, but no sources/URLs)
        """

        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        dataset_dict = dataset.model_dump()

        # Get all files for this dataset
        files_statement = select(File).where(File.dataset_id == dataset_id)
        files = list(self.db.exec(files_statement).all())

        # Get format counts for each file (without loading sources)
        file_ids = [file_obj.id for file_obj in files]
        file_format_counts: dict[int, int] = {}
        if file_ids:
            # Count formats per file
            for file_id in file_ids:
                count_statement = select(func.count(FileFormat.id)).where(
                    FileFormat.file_id == file_id
                )
                count = self.db.exec(count_statement).one()
                file_format_counts[file_id] = count or 0

        # Build files array with basic info
        dataset_dict["files"] = []
        for file_obj in files:
            file_dict = file_obj.model_dump()
            # Add format count for UI display
            file_dict["formats"] = []
            format_count = file_format_counts.get(file_obj.id, 0)
            if format_count > 0:
                # Add a placeholder format entry just to indicate formats exist
                # The UI will use this to show the format count badge
                file_dict["formats"] = [{"format_count": format_count}]
            dataset_dict["files"].append(file_dict)

        return dataset_dict

    def get_dataset_with_urls(self, dataset_id: int) -> Optional[dict]:
        """
        Get a dataset with full URLs constructed from storage locations.

        Returns a dict with dataset fields plus:
        - files (list of files, each with list of formats and sources)
        """

        try:
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                return None

            # Convert dataset to dict immediately while session is healthy
            # This ensures we have the data even if the session gets rolled back later
            dataset_dict = dataset.model_dump()

            # Get all files for this dataset
            files_statement = select(File).where(File.dataset_id == dataset_id)
            files = list(self.db.exec(files_statement).all())

            # Preload formats and sources in bulk to avoid N+1 queries
            file_ids = [file_obj.id for file_obj in files]
            file_formats: list[tuple[FileFormat, Format]] = []
            if file_ids:
                file_formats_statement = (
                    select(FileFormat, Format)
                    .join(Format, FileFormat.format_id == Format.id)
                    .where(FileFormat.file_id.in_(file_ids))
                )
                file_formats = list(self.db.exec(file_formats_statement).all())

            file_format_ids = [ff.id for ff, _ in file_formats]
            file_sources: list[FileSource] = []
            if file_format_ids:
                file_sources_statement = select(FileSource).where(
                    FileSource.file_format_id.in_(file_format_ids)
                )
                file_sources = list(self.db.exec(file_sources_statement).all())

            storage_location_ids = {
                source.storage_location_id for source in file_sources
            }
            storage_locations_by_id: dict[int, StorageLocation] = {}
            if storage_location_ids:
                storage_locations_statement = select(StorageLocation).where(
                    StorageLocation.id.in_(storage_location_ids)
                )
                storage_locations = list(
                    self.db.exec(storage_locations_statement).all()
                )
                storage_locations_by_id = {
                    storage_location.id: storage_location
                    for storage_location in storage_locations
                }

            # Debug: log storage locations and format info
            logger.info(
                "Dataset debug: dataset_id=%s format_ids=%s storage_location_ids=%s",
                dataset_id,
                file_format_ids,
                sorted(storage_location_ids),
            )
            if storage_locations_by_id:
                logger.info(
                    "Storage locations: %s",
                    [
                        {
                            "id": loc.id,
                            "name": loc.name,
                            "backend_type": loc.backend_type,
                        }
                        for loc in storage_locations_by_id.values()
                    ],
                )

            file_formats_by_file_id: dict[int, list[tuple[FileFormat, Format]]] = {}
            for file_format, format_obj in file_formats:
                file_formats_by_file_id.setdefault(file_format.file_id, []).append(
                    (file_format, format_obj)
                )

            sources_by_file_format_id: dict[int, list[FileSource]] = {}
            for source in file_sources:
                sources_by_file_format_id.setdefault(source.file_format_id, []).append(
                    source
                )

            # Build files array with their formats and sources
            dataset_dict["files"] = []
            for file_obj in files:
                try:
                    file_dict = file_obj.model_dump()
                    file_dict["formats"] = []

                    for file_format, format_obj in file_formats_by_file_id.get(
                        file_obj.id, []
                    ):
                        try:
                            format_dict = {
                                "format": format_obj.model_dump(),
                                "file_format": file_format.model_dump(),
                                "sources": [],
                            }

                            for source in sources_by_file_format_id.get(
                                file_format.id, []
                            ):
                                try:
                                    source_storage = storage_locations_by_id.get(
                                        source.storage_location_id
                                    )
                                    source_dict = source.model_dump()
                                    source_dict["url"] = get_file_source_url(
                                        source, source_storage
                                    )
                                    source_dict["storage_uri"] = (
                                        get_file_source_storage_uri(
                                            source, source_storage
                                        )
                                    )
                                    source_dict["storage_location"] = (
                                        source_storage.model_dump()
                                        if source_storage
                                        else None
                                    )
                                    format_dict["sources"].append(source_dict)
                                except Exception as source_error:
                                    logger.warning(
                                        f"Error processing source {source.id} for file {file_obj.id}: {source_error}"
                                    )
                                    try:
                                        source_dict = source.model_dump()
                                        source_dict["url"] = None
                                        source_dict["storage_uri"] = None
                                        source_dict["storage_location"] = None
                                        format_dict["sources"].append(source_dict)
                                    except Exception:
                                        pass

                            file_dict["formats"].append(format_dict)
                        except Exception as format_error:
                            logger.warning(
                                f"Error processing format for file {file_obj.id}: {format_error}"
                            )

                    dataset_dict["files"].append(file_dict)
                except Exception as file_error:
                    logger.warning(
                        f"Error processing file {file_obj.id} for dataset {dataset_id}: {file_error}"
                    )

            return dataset_dict
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
            # Session is in a bad state - let FastAPI's dependency injection handle rollback
            logger.error(f"Database session error for dataset {dataset_id}: {e}")
            raise

    async def get_dataset_file_with_urls_by_id(
        self, dataset_id: int, file_id: int
    ) -> Optional[dict]:
        """
        Get a single file for a dataset by IDs with full URLs constructed from storage locations.

        Returns a dict with:
        - dataset (dataset metadata)
        - file (file with formats and sources)
        """

        try:
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                return None

            file_statement = select(File).where(
                File.id == file_id,
                File.dataset_id == dataset_id,
            )
            file_obj = self.db.exec(file_statement).first()
            if not file_obj:
                return None

            # Continue with the same logic as the slug-based method
            return await self._get_file_with_urls_impl(dataset, file_obj)
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
            logger.error(
                f"Database session error for file {file_id} in dataset {dataset_id}: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error getting file {file_id} for dataset {dataset_id}: {e}",
                exc_info=True,
            )
            raise

    async def get_dataset_file_with_urls(
        self, collection_id: int, dataset_slug: str, file_slug: str
    ) -> Optional[dict]:
        """
        Get a single file for a dataset with full URLs constructed from storage locations.

        Returns a dict with:
        - dataset (dataset metadata)
        - file (file with formats and sources)
        """

        try:
            dataset_statement = select(Dataset).where(
                Dataset.collection_id == collection_id,
                Dataset.slug == dataset_slug,
            )
            dataset = self.db.exec(dataset_statement).first()
            if not dataset:
                return None

            file_statement = select(File).where(
                File.dataset_id == dataset.id,
                File.slug == file_slug,
            )
            file_obj = self.db.exec(file_statement).first()
            if not file_obj:
                return None

            # Use shared implementation
            return await self._get_file_with_urls_impl(dataset, file_obj)
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
            logger.error(
                f"Database session error for file {file_slug} in dataset {dataset_slug}: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error getting file {file_slug} for dataset {dataset_slug}: {e}",
                exc_info=True,
            )
            raise

    async def _get_file_with_urls_impl(
        self, dataset: Dataset, file_obj: File
    ) -> Optional[dict]:
        """
        Shared implementation for getting file with URLs.
        """

        try:

            file_dict = file_obj.model_dump()
            file_dict["formats"] = []

            file_formats_statement = (
                select(FileFormat, Format)
                .join(Format, FileFormat.format_id == Format.id)
                .where(FileFormat.file_id == file_obj.id)
            )
            file_formats = list(self.db.exec(file_formats_statement).all())
            file_format_ids = [ff.id for ff, _ in file_formats]

            file_sources: list[FileSource] = []
            if file_format_ids:
                file_sources_statement = select(FileSource).where(
                    FileSource.file_format_id.in_(file_format_ids)
                )
                file_sources = list(self.db.exec(file_sources_statement).all())

            storage_location_ids = {
                source.storage_location_id for source in file_sources
            }
            storage_locations_by_id: dict[int, StorageLocation] = {}
            if storage_location_ids:
                storage_locations_statement = select(StorageLocation).where(
                    StorageLocation.id.in_(storage_location_ids)
                )
                storage_locations = list(
                    self.db.exec(storage_locations_statement).all()
                )
                storage_locations_by_id = {
                    storage_location.id: storage_location
                    for storage_location in storage_locations
                }

            # Debug: log storage locations and file format info
            logger.info(
                "File detail debug: file_id=%s slug=%s format_ids=%s storage_location_ids=%s",
                file_obj.id,
                file_obj.slug,
                file_format_ids,
                sorted(storage_location_ids),
            )
            if storage_locations_by_id:
                # Log full storage location details including config (bucket, base_url, etc.)
                storage_location_details = []
                for loc in storage_locations_by_id.values():
                    loc_dict = {
                        "id": loc.id,
                        "name": loc.name,
                        "backend_type": loc.backend_type,
                    }
                    # Extract config details (bucket, base_url, etc.)
                    if loc.config:
                        if isinstance(loc.config, dict):
                            # Config is already a dict
                            loc_dict["config"] = {
                                "type": loc.config.get("type"),
                                "bucket": loc.config.get("bucket"),
                                "base_url": loc.config.get("base_url"),
                                "version": loc.config.get("version"),
                            }
                        else:
                            # Config is a Pydantic model, convert to dict
                            config_dict = (
                                loc.config.model_dump()
                                if hasattr(loc.config, "model_dump")
                                else {}
                            )
                            loc_dict["config"] = {
                                "type": config_dict.get("type"),
                                "bucket": config_dict.get("bucket"),
                                "base_url": config_dict.get("base_url"),
                                "version": config_dict.get("version"),
                            }
                    storage_location_details.append(loc_dict)

                logger.info("Storage locations: %s", storage_location_details)

            sources_by_file_format_id: dict[int, list[FileSource]] = {}
            for source in file_sources:
                sources_by_file_format_id.setdefault(source.file_format_id, []).append(
                    source
                )

            # Debug: log file source details
            file_source_details = []
            for source in file_sources:
                source_location = source.location
                file_path = ""
                if isinstance(source_location, dict):
                    file_path = source_location.get("path", "")
                elif hasattr(source_location, "path"):
                    file_path = source_location.path

                has_glob = "*" in file_path if file_path else False
                source_storage = storage_locations_by_id.get(source.storage_location_id)
                storage_name = source_storage.name if source_storage else "unknown"
                config_type = None
                if source_storage and source_storage.config:
                    if isinstance(source_storage.config, dict):
                        config_type = source_storage.config.get("type")
                    elif hasattr(source_storage.config, "type"):
                        config_type = source_storage.config.type

                file_source_details.append(
                    {
                        "id": source.id,
                        "file_format_id": source.file_format_id,
                        "storage_location_id": source.storage_location_id,
                        "storage_name": storage_name,
                        "config_type": config_type,
                        "version": source.version,
                        "source_type": source.source_type,
                        "path": file_path,
                        "has_glob": has_glob,
                    }
                )

            logger.info("File sources: %s", file_source_details)

            for file_format, format_obj in file_formats:
                try:
                    logger.info(
                        "Format debug: file_format_id=%s format_type=%s source_count=%s",
                        file_format.id,
                        format_obj.format_type,
                        len(sources_by_file_format_id.get(file_format.id, [])),
                    )
                    format_dict = {
                        "format": format_obj.model_dump(),
                        "file_format": file_format.model_dump(),
                        "sources": [],
                    }

                    # Get all sources for this format
                    format_sources = sources_by_file_format_id.get(file_format.id, [])

                    # For file-based formats (geoparquet, pmtiles), group by location and version
                    # and construct glob patterns
                    if format_obj.format_type in ("geoparquet", "pmtiles"):
                        # Filter to only file sources
                        file_type_sources = [
                            s for s in format_sources if s.source_type == "file"
                        ]

                        # Group sources by storage_location_id and version
                        sources_by_location_version: dict[
                            tuple[int, str], list[FileSource]
                        ] = {}
                        for source in file_type_sources:
                            # Normalize version to string for consistent dict keys
                            version_str = str(source.version) if source.version else "1"
                            key = (source.storage_location_id, version_str)
                            sources_by_location_version.setdefault(key, []).append(
                                source
                            )

                        # Construct glob patterns for each location/version group
                        # Store them in a dict keyed by (location_id, version)
                        glob_patterns_by_group: dict[tuple[int, str], Optional[str]] = (
                            {}
                        )
                        for (
                            loc_id,
                            version,
                        ), grouped_sources in sources_by_location_version.items():
                            source_storage = storage_locations_by_id.get(loc_id)
                            if source_storage:
                                # Check if any source has a wildcard pattern
                                has_wildcard = False
                                for source in grouped_sources:
                                    source_location = source.location
                                    if isinstance(source_location, dict):
                                        file_path = source_location.get("path", "")
                                    elif hasattr(source_location, "path"):
                                        file_path = source_location.path
                                    else:
                                        file_path = ""
                                    if "*" in file_path:
                                        has_wildcard = True
                                        break

                                if has_wildcard:
                                    # Construct glob pattern from the source with wildcard
                                    # Use the first source with a wildcard to construct the glob pattern
                                    wildcard_source = next(
                                        (
                                            s
                                            for s in grouped_sources
                                            if "*"
                                            in (
                                                (
                                                    s.location.path
                                                    if hasattr(s.location, "path")
                                                    else ""
                                                )
                                                if not isinstance(s.location, dict)
                                                else s.location.get("path", "")
                                            )
                                        ),
                                        None,
                                    )
                                    if wildcard_source:
                                        glob_pattern = get_file_source_storage_uri(
                                            wildcard_source, source_storage
                                        )
                                        logger.info(
                                            "Constructed glob pattern: location_id=%s version=%s pattern=%s",
                                            loc_id,
                                            version,
                                            glob_pattern,
                                        )
                                        glob_patterns_by_group[(loc_id, version)] = (
                                            glob_pattern
                                        )
                                    else:
                                        glob_patterns_by_group[(loc_id, version)] = None
                                elif len(grouped_sources) > 1:
                                    # Multiple sources without wildcards - construct common pattern
                                    glob_pattern = construct_glob_pattern_from_sources(
                                        grouped_sources, source_storage
                                    )
                                    glob_patterns_by_group[(loc_id, version)] = (
                                        glob_pattern
                                    )
                                else:
                                    glob_patterns_by_group[(loc_id, version)] = None
                            else:
                                glob_patterns_by_group[(loc_id, version)] = None

                        # Process each group
                        for (
                            loc_id,
                            version,
                        ), grouped_sources in sources_by_location_version.items():
                            source_storage = storage_locations_by_id.get(loc_id)
                            glob_pattern = glob_patterns_by_group.get((loc_id, version))
                            if not source_storage:
                                logger.error(
                                    f"Storage location {loc_id} not found in storage_locations_by_id! Available IDs: {list(storage_locations_by_id.keys())}"
                                )

                            # Expand glob patterns in sources and collect all sources to process
                            all_sources_to_process = []
                            for source in grouped_sources:
                                # Check if source path contains a wildcard
                                source_location = source.location
                                if isinstance(source_location, dict):
                                    file_path = source_location.get("path", "")
                                elif hasattr(source_location, "path"):
                                    file_path = source_location.path
                                else:
                                    file_path = ""

                                if source.source_type == "file" and "*" in file_path:
                                    # Expand glob pattern
                                    logger.info(
                                        "Expanding glob pattern: source_id=%s path=%s storage_location_id=%s storage_name=%s",
                                        source.id,
                                        file_path,
                                        loc_id,
                                        (
                                            source_storage.name
                                            if source_storage
                                            else "unknown"
                                        ),
                                    )
                                    try:

                                        expanded = await expand_glob_pattern_in_source(
                                            source, source_storage
                                        )
                                    except Exception as e:
                                        error_trace = traceback.format_exc()
                                        logger.error(
                                            "Exception expanding glob pattern for source %s: %s\n%s",
                                            source.id,
                                            e,
                                            error_trace,
                                        )
                                        # Fallback to original source on error
                                        expanded = None

                                    if expanded is None:
                                        # Exception occurred, use original source
                                        all_sources_to_process.append(source)
                                        continue
                                    logger.info(
                                        "Glob expansion result: source_id=%s expanded_count=%s",
                                        source.id,
                                        len(expanded) if expanded else 0,
                                    )
                                    if expanded:
                                        # Log first few expanded paths
                                        expanded_paths = [
                                            (
                                                s.get("location", {}).get(
                                                    "path", "unknown"
                                                )
                                                if isinstance(s, dict)
                                                else "not-dict"
                                            )
                                            for s in expanded[:5]
                                        ]
                                    logger.info(
                                        "Expanded source paths (first 5): %s",
                                        expanded_paths,
                                    )
                                    # Add expanded sources (they're already dicts with location as dict)
                                    # Keep the original source for glob pattern display, and add expanded sources for individual files
                                    if expanded:
                                        logger.info(
                                            "Adding %d expanded sources and 1 original glob pattern source for source_id=%s",
                                            len(expanded),
                                            source.id,
                                        )
                                        # Keep original source for glob pattern display
                                        all_sources_to_process.append(source)
                                        # Add expanded individual files
                                        all_sources_to_process.extend(expanded)
                                    else:
                                        # Fallback to original source if expansion failed
                                        all_sources_to_process.append(source)
                                else:
                                    # Not a glob pattern, keep as FileSource object for now
                                    all_sources_to_process.append(source)

                            # Process all sources (original + expanded)
                            for source_item in all_sources_to_process:
                                try:
                                    # source_item is either a dict (from expansion) or a FileSource object
                                    if isinstance(source_item, dict):
                                        source_dict = source_item.copy()
                                        # Preserve metadata from expanded source (includes size_bytes)
                                        source_metadata_dict = source_dict.get(
                                            "source_metadata"
                                        )

                                        # Get storage_location_id from the expanded source dict
                                        expanded_loc_id = source_dict.get(
                                            "storage_location_id"
                                        )
                                        if expanded_loc_id:
                                            # Look up storage location for this expanded source
                                            source_storage = (
                                                storage_locations_by_id.get(
                                                    expanded_loc_id
                                                )
                                            )
                                            loc_id = expanded_loc_id
                                        else:
                                            # Fallback to original source's storage location
                                            source_storage = (
                                                storage_locations_by_id.get(loc_id)
                                            )

                                        # Reconstruct FileSource object for URL generation
                                        # Use metadata from expanded source if available
                                        source_metadata_model = None
                                        if source_metadata_dict:
                                            try:
                                                from models.dataset import (
                                                    SpatialDatasetFileMetadata,
                                                )

                                                source_metadata_model = (
                                                    SpatialDatasetFileMetadata(
                                                        **source_metadata_dict
                                                    )
                                                )
                                            except Exception as e:
                                                logger.warning(
                                                    f"Failed to parse source_metadata for expanded source: {e}"
                                                )

                                        temp_source = FileSourceModel(
                                            id=source_dict.get("id"),
                                            file_format_id=source_dict.get(
                                                "file_format_id"
                                            ),
                                            storage_location_id=source_dict.get(
                                                "storage_location_id"
                                            ),
                                            version=source_dict.get("version", "1"),
                                            source_type=source_dict.get(
                                                "source_type", "file"
                                            ),
                                            location=FileLocationModel(
                                                **source_dict.get("location", {})
                                            ),
                                            source_metadata=source_metadata_model,
                                        )
                                    else:
                                        # It's a FileSource object
                                        source_dict = source_item.model_dump()
                                        temp_source = source_item
                                        # Ensure storage_location_id is in the dict
                                        if "storage_location_id" not in source_dict:
                                            source_dict["storage_location_id"] = (
                                                source_item.storage_location_id
                                            )
                                        # Use the original source's storage location
                                        source_storage = storage_locations_by_id.get(
                                            loc_id
                                        )

                                    # Always explicitly set storage_location from our loaded dict
                                    if not source_storage:
                                        logger.warning(
                                            f"Storage location {loc_id} not found in storage_locations_by_id for source {source_dict.get('id')}"
                                        )
                                    source_dict["url"] = get_file_source_url(
                                        temp_source, source_storage
                                    )
                                    source_dict["storage_uri"] = (
                                        get_file_source_storage_uri(
                                            temp_source, source_storage
                                        )
                                    )
                                    source_dict["storage_location"] = (
                                        source_storage.model_dump()
                                        if source_storage
                                        else None
                                    )
                                    # Add glob pattern to each source in the group for easy access
                                    # Only add glob_pattern to the original glob pattern source, not expanded individual files
                                    if glob_pattern:
                                        source_path = (
                                            source_dict.get("location", {})
                                            if isinstance(
                                                source_dict.get("location"), dict
                                            )
                                            else {}
                                        ).get("path", "")
                                        # Only add glob_pattern if this is the original glob pattern source
                                        if "*" in source_path:
                                            source_dict["glob_pattern"] = glob_pattern

                                    logger.debug(
                                        "Adding source to format: id=%s path=%s has_glob=%s",
                                        source_dict.get("id"),
                                        (
                                            source_path
                                            if isinstance(
                                                source_dict.get("location"), dict
                                            )
                                            else "unknown"
                                        ),
                                        "glob_pattern" in source_dict,
                                    )
                                    format_dict["sources"].append(source_dict)
                                except Exception as source_error:
                                    logger.warning(
                                        f"Error processing source for file {file_obj.id}: {source_error}",
                                        exc_info=True,
                                    )
                                    try:
                                        source_dict = (
                                            source_item
                                            if isinstance(source_item, dict)
                                            else source_item.model_dump()
                                        )
                                        source_dict["url"] = None
                                        source_dict["storage_uri"] = None
                                        # Try to add storage_location even in error case
                                        if source_storage:
                                            source_dict["storage_location"] = (
                                                source_storage.model_dump()
                                            )
                                        else:
                                            source_dict["storage_location"] = None
                                        format_dict["sources"].append(source_dict)
                                    except Exception as fallback_error:
                                        logger.warning(
                                            f"Fallback error handler also failed: {fallback_error}",
                                            exc_info=True,
                                        )
                                        pass

                        # Also process non-file sources (if any)
                        non_file_sources = [
                            s for s in format_sources if s.source_type != "file"
                        ]
                        for source in non_file_sources:
                            try:
                                source_storage = storage_locations_by_id.get(
                                    source.storage_location_id
                                )
                                source_dict = source.model_dump()
                                source_dict["url"] = get_file_source_url(
                                    source, source_storage
                                )
                                source_dict["storage_uri"] = (
                                    get_file_source_storage_uri(source, source_storage)
                                )
                                source_dict["storage_location"] = (
                                    source_storage.model_dump()
                                    if source_storage
                                    else None
                                )
                                format_dict["sources"].append(source_dict)
                            except Exception as source_error:
                                logger.warning(
                                    f"Error processing source {source.id} for file {file_obj.id}: {source_error}"
                                )
                                try:
                                    source_dict = source.model_dump()
                                    source_dict["url"] = None
                                    source_dict["storage_uri"] = None
                                    source_dict["storage_location"] = None
                                    format_dict["sources"].append(source_dict)
                                except Exception:
                                    pass
                    else:
                        # For non-file formats (e.g., geoserver), process normally
                        for source in format_sources:
                            try:
                                source_storage = storage_locations_by_id.get(
                                    source.storage_location_id
                                )
                                source_dict = source.model_dump()
                                source_dict["url"] = get_file_source_url(
                                    source, source_storage
                                )
                                source_dict["storage_uri"] = (
                                    get_file_source_storage_uri(source, source_storage)
                                )
                                source_dict["storage_location"] = (
                                    source_storage.model_dump()
                                    if source_storage
                                    else None
                                )
                                format_dict["sources"].append(source_dict)
                            except Exception as source_error:
                                logger.warning(
                                    f"Error processing source {source.id} for file {file_obj.id}: {source_error}"
                                )
                                try:
                                    source_dict = source.model_dump()
                                    source_dict["url"] = None
                                    source_dict["storage_uri"] = None
                                    source_dict["storage_location"] = None
                                    format_dict["sources"].append(source_dict)
                                except Exception:
                                    pass

                    file_dict["formats"].append(format_dict)
                except Exception as format_error:
                    logger.warning(
                        f"Error processing format for file {file_obj.id}: {format_error}"
                    )

            # If geoparquet is missing for globbed files, load from datasets.jsonl

            return {"dataset": dataset.model_dump(), "file": file_dict}
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
            logger.error(
                f"Database session error for file {file_obj.id} in dataset {dataset.id}: {e}"
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error getting file {file_obj.id} for dataset {dataset.id}: {e}",
                exc_info=True,
            )
            raise

    def update_dataset(self, dataset_id: int, **kwargs) -> Optional[Dataset]:
        """Update a dataset."""
        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        # Update fields
        for key, value in kwargs.items():
            if hasattr(dataset, key) and value is not None:
                setattr(dataset, key, value)

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
            return True
        except Exception as e:
            # Rollback on any error
            self.db.rollback()
            logger.error(f"Error deleting dataset {dataset_id}: {e}")
            raise

    async def register_dataset(
        self,
        name: str,
        dataset_format_id: int,
        storage_location_id: int,
        description: Optional[str] = None,
        collection_id: Optional[int] = None,
        tags: Optional[dict[str, str]] = None,
        add_to_geoserver: bool = True,
    ) -> tuple[Dataset, bool]:
        """
        Register a dataset in the catalog.

        Args:
            dataset_format_id: ID of the FileFormat.
            storage_location_id: ID of the storage location containing the file.

        Returns:
            Tuple of (dataset, False). The boolean is retained for legacy callers.
        """
        if add_to_geoserver:
            logger.warning("GeoServer registration is no longer supported; skipping")

        # Create dataset
        dataset = self.create_dataset(
            name=name,
            description=description,
            collection_id=collection_id,
            tags=tags,
        )

        return dataset, False

    def get_dataset_stats(self) -> dict[str, int]:
        """Get dataset statistics."""
        total = self.db.exec(select(func.count(Dataset.id))).one()

        return {
            "total": total,
        }

    def get_available_tag_values(
        self, collection_id: Optional[int] = None, tag_key: Optional[str] = None
    ) -> dict[str, list[str]]:
        """Get all available tag values for a collection.

        Args:
            collection_id: Filter by collection ID
            tag_key: If provided, only return values for this tag key

        Returns:
            Dict mapping tag keys to lists of unique values
        """
        # Select full Dataset objects, not just tags column
        statement = select(Dataset).where(Dataset.tags.isnot(None))
        if collection_id is not None:
            statement = statement.where(Dataset.collection_id == collection_id)

        datasets = self.db.exec(statement).all()

        tag_values: dict[str, set[str]] = {}

        for dataset in datasets:
            # Handle both Dataset objects and dicts (SQLModel can return either)
            if isinstance(dataset, dict):
                tags = dataset.get("tags")
            else:
                tags = dataset.tags if hasattr(dataset, "tags") else None

            if not tags:
                continue

            # tags is a dict, iterate over it
            for key, value in tags.items():
                if tag_key and key != tag_key:
                    continue

                if key not in tag_values:
                    tag_values[key] = set()

                if isinstance(value, list):
                    for v in value:
                        if isinstance(v, str):
                            tag_values[key].add(v)
                elif isinstance(value, str):
                    tag_values[key].add(value)

        # Convert sets to sorted lists
        return {k: sorted(list(v)) for k, v in tag_values.items()}

    def count_datasets(
        self,
        search: Optional[str] = None,
        collection_id: Optional[int] = None,
        tag_filters: Optional[dict[str, Union[str, list[str]]]] = None,
    ) -> int:
        """Count datasets with optional search and collection filter."""
        if search and search.strip():
            search_query = search.strip()

            # Additional validation: prevent extremely long queries
            if len(search_query) > 500:
                logger.warning(
                    f"Search query too long ({len(search_query)} chars), truncating"
                )
                search_query = search_query[:500]

            bind = self.db.get_bind()
            dialect_name = bind.dialect.name

            if dialect_name == "postgresql":
                # Use PostgreSQL tsvector full-text search
                try:
                    search_terms = search_query.split()
                    ts_queries = []
                    for term in search_terms:
                        if term.startswith('"') and term.endswith('"'):
                            ts_queries.append(term)
                        else:
                            ts_queries.append(f"{term}:*")
                    ts_query = " & ".join(ts_queries)
                    query_param = sa.bindparam("query", ts_query)
                    statement = select(func.count(Dataset.id)).where(
                        sa.text(
                            "search_vector @@ to_tsquery('english', :query)"
                        ).bindparams(query_param)
                    )
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
                except Exception as e:
                    logger.warning(
                        f"PostgreSQL tsvector count query failed, falling back to LIKE: {e}"
                    )
                    search_pattern = f"%{search.strip()}%"
                    statement = (
                        select(func.count(Dataset.id))
                        .where(
                            or_(
                                Dataset.name.ilike(search_pattern),
                                Dataset.description.ilike(search_pattern),
                                sa.text("tags::text ILIKE :pattern"),
                            )
                        )
                        .params(pattern=search_pattern)
                    )
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
            else:
                # Use FTS5 for SQLite
                try:
                    search_terms = search_query.split()
                    fts_queries = []
                    for term in search_terms:
                        if term.startswith('"') and term.endswith('"'):
                            fts_queries.append(term)
                        else:
                            fts_queries.append(f"{term}*")
                    fts_query = " AND ".join(fts_queries)
                    fts_statement = sa.text(
                        """
                        SELECT id FROM datasets_fts 
                        WHERE datasets_fts MATCH :query
                    """
                    )
                    fts_result = self.db.exec(fts_statement.bindparams(query=fts_query))
                    matching_ids = [row[0] for row in fts_result]
                    if not matching_ids:
                        return 0
                    statement = select(func.count(Dataset.id)).where(
                        Dataset.id.in_(matching_ids)
                    )
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
                except Exception as e:
                    logger.warning(
                        f"FTS5 count query failed, falling back to LIKE: {e}"
                    )
                    search_pattern = f"%{search.strip()}%"
                    statement = (
                        select(func.count(Dataset.id))
                        .where(
                            or_(
                                Dataset.name.like(search_pattern),
                                Dataset.description.like(search_pattern),
                                sa.text("tags LIKE :pattern"),
                            )
                        )
                        .params(pattern=search_pattern)
                    )
                    if collection_id is not None:
                        statement = statement.where(
                            Dataset.collection_id == collection_id
                        )
        else:
            statement = select(func.count(Dataset.id))
            if collection_id is not None:
                statement = statement.where(Dataset.collection_id == collection_id)

        # Apply tag filters (same logic as get_datasets)
        if tag_filters:
            bind = self.db.get_bind()
            dialect_name = bind.dialect.name

            for tag_key, tag_value in tag_filters.items():
                if tag_value is None:
                    continue

                # Normalize to list for consistent handling
                filter_values = (
                    tag_value if isinstance(tag_value, list) else [tag_value]
                )
                filter_values = [str(v) for v in filter_values if v is not None]

                if not filter_values:
                    continue

                if dialect_name == "postgresql":
                    # PostgreSQL JSONB filtering using explicit operators to avoid [] syntax
                    tags_jsonb = sa.cast(Dataset.tags, postgresql.JSONB)
                    conditions = []
                    for val in filter_values:
                        key_literal = sa.literal(tag_key)
                        conditions.append(
                            sa.or_(
                                tags_jsonb.op("->>")(key_literal) == val,
                                tags_jsonb.op("->")(key_literal).op("@>")(
                                    sa.cast([val], postgresql.JSONB)
                                ),
                            )
                        )
                    if conditions:
                        statement = statement.where(or_(*conditions))
                else:
                    # SQLite JSON filtering
                    conditions = []
                    for idx, val in enumerate(filter_values):
                        # Use unique parameter names for each iteration to avoid conflicts
                        key_path = f"$.{tag_key}"
                        conditions.append(
                            sa.or_(
                                sa.text(
                                    f"json_extract(tags, :key_path_{idx}) = :tag_val_{idx}"
                                ).params(
                                    **{
                                        f"key_path_{idx}": key_path,
                                        f"tag_val_{idx}": val,
                                    }
                                ),
                                sa.text(f"tags LIKE :tag_like_{idx}").params(
                                    **{f"tag_like_{idx}": f'%"{val}"%'}
                                ),
                            )
                        )
                    if conditions:
                        statement = statement.where(or_(*conditions))

        return self.db.exec(statement).one()
