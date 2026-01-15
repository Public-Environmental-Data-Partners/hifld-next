"""Dataset service for CRUD operations."""

import logging
from datetime import datetime
from typing import Optional, Any, Union
from sqlmodel import Session, select, func, or_
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from models.dataset import (
    Dataset,
    Format,
    DatasetFormat,
    DatasetSource,
    FileLocation,
    ApiLocation,
    GeoServerLocation,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from models.helpers import (
    get_dataset_source_url,
)
from services.geoserver import GeoServerClient

logger = logging.getLogger(__name__)


class DatasetService:
    """Service for dataset operations."""

    def __init__(self, db: Session, geoserver_client: Optional[GeoServerClient] = None):
        self.db = db
        self.geoserver = geoserver_client or GeoServerClient()

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

    def get_dataset_formats(self, dataset_id: int) -> list[DatasetFormat]:
        """Get all formats available for a dataset."""
        from sqlmodel import select

        statement = select(DatasetFormat).where(DatasetFormat.dataset_id == dataset_id)
        return list(self.db.exec(statement).all())

    def get_dataset_formats_with_format(self, dataset_id: int) -> list[dict]:
        """Get all formats for a dataset with format definition included."""
        from sqlmodel import select

        statement = (
            select(DatasetFormat, Format)
            .join(Format, DatasetFormat.format_id == Format.id)
            .where(DatasetFormat.dataset_id == dataset_id)
        )
        results = []
        for dataset_format, format_obj in self.db.exec(statement).all():
            results.append(
                {
                    "dataset_format": dataset_format,
                    "format": format_obj,
                }
            )
        return results

    def get_format_by_type(self, format_type: str) -> Optional[Format]:
        """Get a format definition by type."""
        from sqlmodel import select

        statement = select(Format).where(Format.format_type == format_type)
        return self.db.exec(statement).first()

    def get_or_create_format(self, format_type: str) -> Format:
        """Get or create a format definition."""
        format_obj = self.get_format_by_type(format_type)
        if not format_obj:
            # Format doesn't exist - this shouldn't happen if formats are seeded
            raise ValueError(
                f"Format '{format_type}' not found. Run seed_formats.py first."
            )
        return format_obj

    def get_dataset_format(
        self, dataset_id: int, format_type: str
    ) -> Optional[DatasetFormat]:
        """Get a specific format for a dataset."""
        from sqlmodel import select

        # First get the format definition
        format_obj = self.get_format_by_type(format_type)
        if not format_obj:
            return None

        # Then get the dataset-format link
        statement = (
            select(DatasetFormat)
            .where(DatasetFormat.dataset_id == dataset_id)
            .where(DatasetFormat.format_id == format_obj.id)
        )
        return self.db.exec(statement).first()

    def add_dataset_format(
        self,
        dataset_id: int,
        format_type: str,
        description: Optional[str] = None,
    ) -> DatasetFormat:
        """Add a format to a dataset."""
        # Get or create the format definition
        format_obj = self.get_or_create_format(format_type)

        # Check if this dataset already has this format
        existing = self.get_dataset_format(dataset_id, format_type)
        if existing:
            return existing

        # Create the dataset-format link
        dataset_format = DatasetFormat(
            dataset_id=dataset_id,
            format_id=format_obj.id,
            description=description,
        )
        self.db.add(dataset_format)
        self.db.commit()
        self.db.refresh(dataset_format)
        return dataset_format

    def get_format_sources(
        self, dataset_format_id: int, latest_only: bool = True
    ) -> list[DatasetSource]:
        """
        Get sources (storage locations) for a format.

        Args:
            dataset_format_id: ID of the dataset format
            latest_only: If True, return only the latest version for each storage location.
                        If False, return all versions.
        """
        from sqlmodel import select, func

        if latest_only:
            # Get only the latest version for each storage location
            # Use a subquery to find max version per (dataset_format_id, storage_location_id)
            subquery = (
                select(
                    DatasetSource.storage_location_id,
                    func.max(DatasetSource.version).label("max_version"),
                )
                .where(DatasetSource.dataset_format_id == dataset_format_id)
                .group_by(DatasetSource.storage_location_id)
            ).subquery()

            statement = (
                select(DatasetSource)
                .join(
                    subquery,
                    (
                        DatasetSource.storage_location_id
                        == subquery.c.storage_location_id
                    )
                    & (DatasetSource.version == subquery.c.max_version),
                )
                .where(DatasetSource.dataset_format_id == dataset_format_id)
            )
        else:
            statement = select(DatasetSource).where(
                DatasetSource.dataset_format_id == dataset_format_id
            )

        return list(self.db.exec(statement).all())

    def get_format_source_by_location(
        self,
        dataset_format_id: int,
        storage_location_id: int,
        version: Optional[int] = None,
    ) -> Optional[DatasetSource]:
        """
        Get a specific source for a format in a storage location.

        Args:
            dataset_format_id: ID of the dataset format
            storage_location_id: ID of the storage location
            version: Optional version number. If None, returns the latest version.

        Returns:
            DatasetSource or None if not found
        """
        from sqlmodel import select

        statement = (
            select(DatasetSource)
            .where(DatasetSource.dataset_format_id == dataset_format_id)
            .where(DatasetSource.storage_location_id == storage_location_id)
        )

        if version is not None:
            statement = statement.where(DatasetSource.version == version)
        else:
            # Get latest version
            statement = statement.order_by(DatasetSource.version.desc()).limit(1)

        return self.db.exec(statement).first()

    def get_format_source_versions(
        self, dataset_format_id: int, storage_location_id: int
    ) -> list[DatasetSource]:
        """
        Get all versions of a source for a format in a storage location.

        Args:
            dataset_format_id: ID of the dataset format
            storage_location_id: ID of the storage location

        Returns:
            List of DatasetSource objects ordered by version (newest first)
        """
        from sqlmodel import select

        statement = (
            select(DatasetSource)
            .where(DatasetSource.dataset_format_id == dataset_format_id)
            .where(DatasetSource.storage_location_id == storage_location_id)
            .order_by(DatasetSource.version.desc())
        )
        return list(self.db.exec(statement).all())

    def add_format_source(
        self,
        dataset_format_id: int,
        storage_location_id: int,
        source_type: str,
        location: FileLocation | ApiLocation | GeoServerLocation | dict[str, Any],
        source_metadata: Optional[SpatialDatasetFileMetadata | dict[str, Any]] = None,
    ) -> DatasetSource:
        """
        Add a new version of a data source (file, database, API, etc.) to a format.
        Automatically increments the version number.

        Args:
            dataset_format_id: ID of the dataset format
            storage_location_id: ID of the storage location
            source_type: Type of source - "file", "database", or "api"
            location: Location dict following the appropriate schema:
                - For files: {"path": "tiles/power-plants.pmtiles"} (FileLocation)
                - For databases: {"connection_string": "...", "table": "..."} (DatabaseLocation)
                - For APIs: {"url": "https://...", "method": "GET"} (ApiLocation)
            source_metadata: Metadata dict following SpatialDatasetFileMetadata schema

        Returns:
            The newly created DatasetSource with the incremented version number
        """
        # Get current latest source to determine next version
        existing = self.get_format_source_by_location(
            dataset_format_id, storage_location_id, version=None  # Gets latest
        )

        if existing:
            next_version = existing.version + 1
        else:
            next_version = 1

        # Create new version
        # Convert Pydantic models to dicts if needed
        location_dict = (
            location.model_dump() if hasattr(location, "model_dump") else location
        )
        metadata_dict = (
            source_metadata.model_dump()
            if source_metadata and hasattr(source_metadata, "model_dump")
            else source_metadata
        )

        dataset_source = DatasetSource(
            dataset_format_id=dataset_format_id,
            storage_location_id=storage_location_id,
            version=next_version,
            source_type=source_type,
            location=location_dict,
            source_metadata=metadata_dict,
        )
        self.db.add(dataset_source)
        self.db.commit()
        self.db.refresh(dataset_source)
        return dataset_source

    def get_dataset_sources(self, dataset_id: int) -> list[DatasetSource]:
        """Get all sources for a dataset (across all formats)."""
        from sqlmodel import select

        statement = (
            select(DatasetSource)
            .join(DatasetFormat)
            .where(DatasetFormat.dataset_id == dataset_id)
        )
        return list(self.db.exec(statement).all())

    def get_dataset_source_by_type(
        self, dataset_id: int, format_type: str
    ) -> Optional[DatasetSource]:
        """Get the primary file for a specific format type (legacy method)."""
        dataset_format = self.get_dataset_format(dataset_id, format_type)
        if not dataset_format:
            return None

        # Get latest source
        sources = self.get_format_sources(dataset_format.id, latest_only=True)
        if sources:
            return sources[0]
        return None

    def get_geoserver_info(self, dataset_id: int) -> Optional[dict]:
        """
        Get GeoServer information from registered GeoServer sources.

        Looks for the 'geoserver' format and returns all registered sources.
        Each source represents a versioned GeoServer layer/store with full metadata.

        Returns:
            Dict with dataset name, workspace, and list of GeoServer sources, or None if no geoserver format
        """
        # Look for geoserver format
        geoserver_format = self.get_dataset_format(dataset_id, "geoserver")
        if not geoserver_format:
            return None

        # Get ALL geoserver sources (all versions)
        sources = self.get_format_sources(geoserver_format.id, latest_only=False)
        if not sources:
            return None

        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        # Build info for each GeoServer source
        geoserver_sources = []
        for source in sources:
            storage_loc = self.get_storage_location(source.storage_location_id)

            # Extract location info (workspace, store_name, layer_name)
            location = source.location or {}
            workspace = location.get("workspace", "hifld")
            store_name = location.get("store_name")
            layer_name = location.get("layer_name", store_name)

            # Extract metadata (URLs, linked geoparquet info)
            metadata = source.source_metadata or {}

            geoserver_sources.append(
                {
                    "source_id": source.id,
                    "version": source.version,
                    "storage_location_id": source.storage_location_id,
                    "storage_location_name": storage_loc.name if storage_loc else None,
                    "workspace": workspace,
                    "store_name": store_name,
                    "layer_name": layer_name,
                    "feature_url": metadata.get("feature_api_url"),
                    "wfs_url": metadata.get("wfs_url"),
                    "wms_url": metadata.get("wms_url"),
                    "source_geoparquet_id": metadata.get("source_geoparquet_id"),
                    "source_geoparquet_version": metadata.get(
                        "source_geoparquet_version"
                    ),
                    "source_storage_location_id": metadata.get(
                        "source_storage_location_id"
                    ),
                }
            )

        return {
            "dataset_name": dataset.name,
            "workspace": (
                sources[0].location.get("workspace", "hifld") if sources else "hifld"
            ),
            "sources": geoserver_sources,
        }

    def get_dataset_with_urls(self, dataset_id: int) -> Optional[dict]:
        """
        Get a dataset with full URLs constructed from storage locations.

        Returns a dict with dataset fields plus:
        - formats (list of formats, each with list of files/locations)
        """
        from sqlmodel import select
        import sqlalchemy.exc as sa_exc

        try:
            dataset = self.get_dataset_by_id(dataset_id)
            if not dataset:
                return None

            # Convert dataset to dict immediately while session is healthy
            # This ensures we have the data even if the session gets rolled back later
            dataset_dict = dataset.model_dump()

            # Add formats with their files
            # Join DatasetFormat with Format to get format definition
            statement = (
                select(DatasetFormat, Format)
                .join(Format, DatasetFormat.format_id == Format.id)
                .where(DatasetFormat.dataset_id == dataset_id)
            )
            dataset_dict["formats"] = []

            try:
                format_results = self.db.exec(statement).all()
            except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
                # Session is in a bad state - let FastAPI's dependency injection handle rollback
                logger.warning(f"Database session error for dataset {dataset_id}: {e}")
                raise

            for dataset_format, format_obj in format_results:
                try:
                    sources = self.get_format_sources(
                        dataset_format.id, latest_only=False
                    )
                    # Convert to dicts immediately to avoid lazy loading issues
                    format_dict = {
                        "format": format_obj.model_dump(),
                        "dataset_format": dataset_format.model_dump(),
                        "sources": [],
                    }

                    for source in sources:
                        try:
                            source_storage = self.get_storage_location(
                                source.storage_location_id
                            )
                            source_dict = source.model_dump()
                            source_dict["url"] = get_dataset_source_url(
                                source, source_storage
                            )
                            source_dict["storage_location"] = (
                                source_storage.model_dump() if source_storage else None
                            )
                            format_dict["sources"].append(source_dict)
                        except Exception as source_error:
                            # Log but continue with other sources
                            logger.warning(
                                f"Error processing source {source.id} for dataset {dataset_id}: {source_error}"
                            )
                            # Add source without URL if we can't get it
                            try:
                                source_dict = source.model_dump()
                                source_dict["url"] = None
                                source_dict["storage_location"] = None
                                format_dict["sources"].append(source_dict)
                            except Exception:
                                # If even model_dump fails, skip this source
                                pass

                    dataset_dict["formats"].append(format_dict)
                except Exception as format_error:
                    # Log but continue with other formats
                    logger.warning(
                        f"Error processing format {dataset_format.id} for dataset {dataset_id}: {format_error}"
                    )
                    # Add format without sources if we can't process it
                    try:
                        format_dict = {
                            "format": format_obj.model_dump(),
                            "dataset_format": dataset_format.model_dump(),
                            "sources": [],
                        }
                        dataset_dict["formats"].append(format_dict)
                    except Exception:
                        # If even model_dump fails, skip this format
                        pass

            return dataset_dict
        except (sa_exc.PendingRollbackError, sa_exc.InvalidRequestError) as e:
            # Session is in a bad state - let FastAPI's dependency injection handle rollback
            logger.error(f"Database session error for dataset {dataset_id}: {e}")
            raise
        except Exception as e:
            # Other errors - log and re-raise
            # FastAPI's get_db() dependency will handle rollback automatically
            logger.error(
                f"Unexpected error getting URLs for dataset {dataset_id}: {e}",
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
        """Delete a dataset and all related records (formats, sources)."""
        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return False

        try:
            # Get all dataset formats for this dataset
            dataset_formats = self.get_dataset_formats(dataset_id)

            # Delete all sources for each format
            for dataset_format in dataset_formats:
                sources = self.get_format_sources(dataset_format.id)
                for source in sources:
                    self.db.delete(source)
                # Commit sources deletion before deleting format
                self.db.commit()

            # Delete all dataset formats
            for dataset_format in dataset_formats:
                self.db.delete(dataset_format)
            # Commit formats deletion before deleting dataset
            self.db.commit()

            # Finally, delete the dataset itself
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
        geoserver_workspace: Optional[str] = None,
        geoserver_store: Optional[str] = None,
        geoserver_layer: Optional[str] = None,
        add_to_geoserver: bool = True,
    ) -> tuple[Dataset, bool]:
        """
        Register a dataset in the catalog and optionally add to GeoServer.

        Args:
            dataset_format_id: ID of the DatasetFormat (must be geoparquet format for GeoServer)
            storage_location_id: ID of the storage location containing the file

        Returns:
            Tuple of (dataset, geoserver_success)
        """
        # Default workspace from environment or use "hifld"
        import os

        workspace = geoserver_workspace or os.getenv("GEOSERVER_WORKSPACE", "hifld")
        store_name = geoserver_store or name
        layer_name = geoserver_layer or name

        geoserver_success = False

        if add_to_geoserver:
            # Get format and file to construct full URL for GeoServer
            dataset_format = self.db.get(DatasetFormat, dataset_format_id)
            if not dataset_format or dataset_format.format_type != "geoparquet":
                raise ValueError(
                    "GeoParquet format required for GeoServer registration"
                )

            # Get the source for this format and storage location
            dataset_source = self.get_format_source_by_location(
                dataset_format_id, storage_location_id
            )
            if not dataset_source:
                raise ValueError(
                    "Dataset source not found for format and storage location"
                )

            # Get storage location to construct full URL
            storage_location = self.get_storage_location(storage_location_id)
            if not storage_location:
                raise ValueError("Storage location required for GeoServer registration")

            # Construct full geoparquet URL for GeoServer
            from models.helpers import get_file_url

            geoparquet_url = get_file_url(
                dataset_source.source_type, dataset_source.location, storage_location
            )

            if not geoparquet_url:
                raise ValueError(
                    "Could not construct GeoParquet URL from storage location"
                )

            # Create store and publish layer
            store_created = await self.geoserver.create_geoparquet_store(
                workspace, store_name, geoparquet_url
            )

            if store_created:
                geoserver_success = await self.geoserver.publish_layer(
                    workspace, store_name, layer_name
                )
            else:
                raise ValueError("Failed to create GeoServer store")

        # Create dataset
        dataset = self.create_dataset(
            name=name,
            description=description,
            collection_id=collection_id,
            tags=tags,
        )

        return dataset, geoserver_success

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
