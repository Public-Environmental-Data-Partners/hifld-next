"""Dataset service for CRUD operations."""

import logging
from datetime import datetime
from typing import Optional, Any
from sqlmodel import Session, select, func, or_
import sqlalchemy as sa

from models.dataset import (
    Dataset,
    Format,
    DatasetFormat,
    DatasetSource,
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
        self, search: Optional[str] = None, collection_id: Optional[int] = None
    ) -> list[Dataset]:
        """Get all datasets with optional full-text search and collection filter."""
        if search and search.strip():
            # Use FTS5 for full-text search
            search_query = search.strip()

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

            # Query FTS5 table to get matching dataset IDs
            try:
                fts_statement = sa.text(
                    """
                    SELECT id FROM datasets_fts 
                    WHERE datasets_fts MATCH :query
                    ORDER BY rank
                """
                )

                fts_result = self.db.exec(fts_statement.bindparams(query=fts_query))
                matching_ids = [row[0] for row in fts_result]

                if not matching_ids:
                    return []

                # Query the main datasets table with the matching IDs
                statement = select(Dataset).where(Dataset.id.in_(matching_ids))

                # Filter by collection if provided
                if collection_id is not None:
                    statement = statement.where(Dataset.collection_id == collection_id)
            except Exception as e:
                # Fallback to simple LIKE if FTS5 query fails (e.g., FTS5 not available)
                logger.warning(f"FTS5 query failed, falling back to LIKE: {e}")
                search_pattern = f"%{search.strip()}%"
                statement = select(Dataset).where(
                    or_(
                        Dataset.name.like(search_pattern),
                        Dataset.alias.like(search_pattern),
                        Dataset.description.like(search_pattern),
                    )
                )
                # Filter by collection if provided
                if collection_id is not None:
                    statement = statement.where(Dataset.collection_id == collection_id)
        else:
            statement = select(Dataset)
            # Filter by collection if provided
            if collection_id is not None:
                statement = statement.where(Dataset.collection_id == collection_id)

        statement = statement.order_by(Dataset.alias)
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
        alias: str,
        type: str,
        description: Optional[str] = None,
        collection_id: Optional[int] = None,
    ) -> Dataset:
        """Create a new dataset."""
        dataset = Dataset(
            name=name,
            alias=alias,
            type=type,
            description=description,
            collection_id=collection_id,
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
        location: dict[str, Any],
        source_metadata: Optional[dict[str, Any]] = None,
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
        dataset_source = DatasetSource(
            dataset_format_id=dataset_format_id,
            storage_location_id=storage_location_id,
            version=next_version,
            source_type=source_type,
            location=location,
            source_metadata=source_metadata,
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
            
            geoserver_sources.append({
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
                "source_geoparquet_version": metadata.get("source_geoparquet_version"),
                "source_storage_location_id": metadata.get("source_storage_location_id"),
            })

        return {
            "dataset_name": dataset.name,
            "workspace": sources[0].location.get("workspace", "hifld") if sources else "hifld",
            "sources": geoserver_sources,
        }

    def get_dataset_with_urls(self, dataset_id: int) -> Optional[dict]:
        """
        Get a dataset with full URLs constructed from storage locations.

        Returns a dict with dataset fields plus:
        - formats (list of formats, each with list of files/locations)
        - geoserver_info (inferred from geoparquet format if available)
        """
        from sqlmodel import select

        dataset = self.get_dataset_by_id(dataset_id)
        if not dataset:
            return None

        # Convert dataset to dict
        dataset_dict = dataset.model_dump()

        # Add geoserver_info if available
        dataset_dict["geoserver_info"] = self.get_geoserver_info(dataset_id)

        # Add formats with their files
        # Join DatasetFormat with Format to get format definition
        statement = (
            select(DatasetFormat, Format)
            .join(Format, DatasetFormat.format_id == Format.id)
            .where(DatasetFormat.dataset_id == dataset_id)
        )
        dataset_dict["formats"] = []

        for dataset_format, format_obj in self.db.exec(statement).all():
            sources = self.get_format_sources(dataset_format.id, latest_only=False)
            format_dict = {
                "format": format_obj.model_dump(),
                "dataset_format": dataset_format.model_dump(),
                "sources": [],
            }

            for source in sources:
                source_storage = self.get_storage_location(source.storage_location_id)
                source_dict = source.model_dump()
                source_dict["url"] = get_dataset_source_url(source, source_storage)
                source_dict["storage_location"] = (
                    source_storage.model_dump() if source_storage else None
                )
                format_dict["sources"].append(source_dict)

            dataset_dict["formats"].append(format_dict)

        return dataset_dict

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

        # Get all dataset formats for this dataset
        dataset_formats = self.get_dataset_formats(dataset_id)

        # Delete all sources for each format
        for dataset_format in dataset_formats:
            sources = self.get_format_sources(dataset_format.id)
            for source in sources:
                self.db.delete(source)

        # Delete all dataset formats
        for dataset_format in dataset_formats:
            self.db.delete(dataset_format)

        # Finally, delete the dataset itself
        self.db.delete(dataset)
        self.db.commit()
        return True

    async def register_dataset(
        self,
        name: str,
        alias: str,
        type: str,
        dataset_format_id: int,
        storage_location_id: int,
        description: Optional[str] = None,
        collection_id: Optional[int] = None,
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
            alias=alias,
            type=type,
            description=description,
            collection_id=collection_id,
        )

        return dataset, geoserver_success

    def get_dataset_stats(self) -> dict[str, int]:
        """Get dataset statistics."""
        total = self.db.exec(select(func.count(Dataset.id))).one()

        return {
            "total": total,
        }
