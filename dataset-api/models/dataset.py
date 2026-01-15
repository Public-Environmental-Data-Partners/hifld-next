"""Dataset models using SQLModel."""

from datetime import datetime, timezone
from typing import Optional, Union, Any, Literal
from sqlmodel import Field, SQLModel, UniqueConstraint
from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator
from pydantic import BaseModel, field_validator, model_validator


# Backend type literals
BackendType = Literal["s3", "geoserver"]

# Format type literals
FormatType = Literal["geoparquet", "pmtiles", "geoserver"]


class BucketStorageLocationConfig(BaseModel):
    """Pydantic schema for bucket-based storage (S3-compatible: AWS S3, GCS, SeaweedFS, etc.)."""

    version: str = "v1"  # Schema version
    base_url: str  # Base URL for accessing files
    bucket: str  # Bucket name
    # Add other storage-specific config fields as needed


class GeoServerStorageLocationConfig(BaseModel):
    """Pydantic schema for GeoServer storage location."""

    version: str = "v1"  # Schema version
    base_url: str  # GeoServer base URL (e.g. "https://geoserver.../geoserver")
    workspace: str  # Default workspace (e.g. "hifld")


class FileLocation(BaseModel):
    """Location schema for file-based sources."""

    version: str = "v1"  # Schema version
    path: str  # Relative path to file within storage location


class GeoServerLocation(BaseModel):
    """Location schema for GeoServer layer sources."""

    version: str = "v1"  # Schema version
    workspace: str  # Workspace name
    store_name: str  # Datastore name
    layer_name: str  # Layer name


# class DatabaseLocation(BaseModel):
#     """Location schema for database-based sources."""

#     version: str = "v1"  # Schema version
#     connection_string: str  # Database connection string
#     table: Optional[str] = None  # Table name (if applicable)
#     schema: Optional[str] = None  # Database schema (if applicable)


class ApiLocation(BaseModel):
    """Location schema for API-based sources."""

    version: str = "v1"  # Schema version
    url: str  # Full API endpoint URL
    method: Optional[str] = None  # HTTP method (default: GET)


class SpatialDatasetFileMetadata(BaseModel):
    """Pydantic schema for spatial dataset file metadata."""

    version: str = "v1"  # Schema version

    # File-specific metadata (only relevant when source_type="file")
    size_bytes: Optional[int] = None  # File size in bytes
    mime_type: Optional[str] = (
        None  # MIME type (e.g. "application/x-protobuf", "application/parquet")
    )

    # Spatial metadata
    feature_count: Optional[int] = None  # Number of features
    bounds: Optional[list[float]] = None  # Bounding box [minx, miny, maxx, maxy]
    geometry_type: Optional[str] = (
        None  # Geometry type (e.g. "Point", "Polygon", "LineString", "Mixed")
    )


class PydanticJSON(TypeDecorator):
    """
    JSON column that accepts Pydantic models by converting to dict on bind.
    """

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if isinstance(value, BaseModel):
            return value.model_dump()
        return value

    def process_result_value(self, value, dialect):
        return value


class Collection(SQLModel, table=True):
    """Collection model for organizing datasets."""

    __tablename__ = "collections"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    description: Optional[str] = None

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StorageLocation(SQLModel, table=True):
    """Storage location model for tracking different storage backends."""

    __tablename__ = "storage_locations"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(
        unique=True
    )  # e.g. "S3 Local", "GCS Production", "SeaweedFS Local"
    backend_type: str  # "s3" | "geoserver" (validated in code)
    description: Optional[str] = None

    # Configuration (JSON object with storage-specific config)
    # Type depends on backend_type:
    # - "s3" -> BucketStorageLocationConfig (for S3-compatible storage: AWS S3, GCS, SeaweedFS, etc.)
    # - "geoserver" -> GeoServerStorageLocationConfig
    config: Optional[
        Union[BucketStorageLocationConfig, GeoServerStorageLocationConfig]
    ] = Field(default=None, sa_type=PydanticJSON())

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("backend_type")
    @classmethod
    def validate_backend_type(cls, v: str) -> str:
        """Validate backend_type is one of the allowed values."""
        allowed = ["s3", "geoserver"]
        if v not in allowed:
            raise ValueError(f"backend_type must be one of {allowed}, got '{v}'")
        return v

    @field_validator("config", mode="before")
    @classmethod
    def validate_config(
        cls, v: Any, info
    ) -> Optional[Union[BucketStorageLocationConfig, GeoServerStorageLocationConfig]]:
        """Convert dict to appropriate config model based on backend_type."""
        if v is None:
            return None
        if isinstance(v, dict):
            # Check if backend_type is available in validation context
            # If we have backend_type, use it to determine which config model to use
            backend_type = (
                info.data.get("backend_type")
                if info and hasattr(info, "data")
                else None
            )

            if backend_type == "geoserver":
                return GeoServerStorageLocationConfig(**v)
            else:
                # Default to bucket config for s3 (S3-compatible storage)
                return BucketStorageLocationConfig(**v)
        return v

    @model_validator(mode="after")
    def convert_config_after(self):
        """Convert config dict to model after instantiation (handles SQLModel direct assignment)."""
        if self.config is not None and isinstance(self.config, dict):
            if self.backend_type == "geoserver":
                self.config = GeoServerStorageLocationConfig(**self.config)
            else:
                self.config = BucketStorageLocationConfig(**self.config)
        return self

    def model_dump(self, **kwargs):
        """
        Ensure config is a Pydantic model before serialization to avoid warnings.
        """
        if self.config is not None and isinstance(self.config, dict):
            if self.backend_type == "geoserver":
                self.config = GeoServerStorageLocationConfig(**self.config)
            else:
                self.config = BucketStorageLocationConfig(**self.config)
        return super().model_dump(**kwargs)


class Dataset(SQLModel, table=True):
    """Dataset model matching the webapp schema."""

    __tablename__ = "datasets"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Core identification
    name: str = Field(
        unique=True
    )  # Human-readable name (e.g. "Security Zones - SecurityZones")
    description: Optional[str] = None
    tags: Optional[dict[str, Union[str, list[str]]]] = Field(
        default=None, sa_type=JSON
    )  # Searchable metadata tags (e.g. {"inventory_name": "security-zones-securityzones", "geometry_type": "Point", "categories": ["Boundaries", "Water Supply"]})

    # Collection membership
    collection_id: Optional[int] = Field(default=None, foreign_key="collections.id")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Format(SQLModel, table=True):
    """Format definition (shared across all datasets)."""

    __tablename__ = "formats"

    id: Optional[int] = Field(default=None, primary_key=True)
    format_type: str = Field(
        unique=True
    )  # "geoparquet" | "pmtiles" | "geoserver" (validated in code)
    name: str  # Human-readable name, e.g. "GeoParquet", "PMTiles"
    description: Optional[str] = None  # Description of the format
    mime_type: Optional[str] = None  # Default MIME type for this format

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("format_type")
    @classmethod
    def validate_format_type(cls, v: str) -> str:
        """Validate format_type is one of the allowed values."""
        allowed = ["geoparquet", "pmtiles", "geoserver"]
        if v not in allowed:
            raise ValueError(f"format_type must be one of {allowed}, got '{v}'")
        return v


class DatasetFormat(SQLModel, table=True):
    """Join table linking datasets to formats (many-to-many)."""

    __tablename__ = "dataset_formats"
    __table_args__ = (
        UniqueConstraint("dataset_id", "format_id", name="uq_dataset_format"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(foreign_key="datasets.id")
    format_id: int = Field(foreign_key="formats.id")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DatasetSource(SQLModel, table=True):
    """
    Model for storing data source references (files, databases, APIs, etc.) in specific storage locations.

    A format can exist in multiple storage locations (for redundancy/backups).
    Each instance represents one data source (file, database connection, API endpoint, etc.)
    for a format in a specific storage location.

    Supports versioning: each source can have multiple versions, with the highest version
    number being the latest/current version.
    """

    __tablename__ = "dataset_sources"
    __table_args__ = (
        UniqueConstraint(
            "dataset_format_id",
            "storage_location_id",
            "version",
            name="uq_source_version",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_format_id: int = Field(foreign_key="dataset_formats.id")
    storage_location_id: int = Field(foreign_key="storage_locations.id")

    # Versioning: version number (auto-incremented per source group)
    # Latest version = MAX(version) for (dataset_format_id, storage_location_id)
    version: int = Field(default=1)

    # Source type: "file", "database", "api"
    source_type: str  # Type of data source (indexed for efficient querying)

    # Location information (validated against appropriate Pydantic schema based on source_type)
    # For "file": FileLocation schema (path)
    # For "api": ApiLocation schema (url, method)
    # For "geoserver": GeoServerLocation schema (workspace, store_name, layer_name)
    location: Union[FileLocation, ApiLocation, GeoServerLocation] = Field(
        sa_type=PydanticJSON()
    )

    # Source metadata (optional, validated against SpatialDatasetFileMetadata schema)
    source_metadata: Optional[SpatialDatasetFileMetadata] = Field(
        default=None, sa_type=PydanticJSON()
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("location", mode="wrap")
    @classmethod
    def validate_location(
        cls, v: Any, handler
    ) -> Union[FileLocation, ApiLocation, GeoServerLocation]:
        """Validate and convert location field."""
        # If it's already a model instance, return it
        if isinstance(v, (FileLocation, ApiLocation, GeoServerLocation)):
            return v

        # If it's a dict, convert to appropriate model type
        if isinstance(v, dict):
            if "url" in v:
                return ApiLocation(**v)
            elif "workspace" in v and "layer_name" in v:
                return GeoServerLocation(**v)
            elif "path" in v:
                return FileLocation(**v)
            else:
                return FileLocation(**v)

        # Otherwise let Pydantic handle it
        return handler(v)

    @field_validator("source_metadata", mode="wrap")
    @classmethod
    def validate_source_metadata(
        cls, v: Any, handler
    ) -> Optional[SpatialDatasetFileMetadata]:
        """Validate and convert source_metadata field."""
        if v is None:
            return None

        # If it's already a model instance, return it
        if isinstance(v, SpatialDatasetFileMetadata):
            return v

        # If it's a dict, convert to model
        if isinstance(v, dict):
            return SpatialDatasetFileMetadata(**v)

        # Otherwise let Pydantic handle it
        return handler(v)

    @model_validator(mode="after")
    def convert_dict_fields(self):
        """
        Convert dict fields to typed models after instantiation.

        SQLModel can hydrate from the database by setting attributes directly,
        bypassing validators; this ensures we still end up with typed models.
        """
        if isinstance(self.location, dict):
            if "url" in self.location:
                self.location = ApiLocation(**self.location)
            elif "workspace" in self.location and "layer_name" in self.location:
                self.location = GeoServerLocation(**self.location)
            elif "path" in self.location:
                self.location = FileLocation(**self.location)
            else:
                self.location = FileLocation(**self.location)

        if self.source_metadata is not None and isinstance(self.source_metadata, dict):
            self.source_metadata = SpatialDatasetFileMetadata(**self.source_metadata)

        return self

    def model_dump(self, **kwargs):
        """
        Ensure typed fields before serialization to avoid Pydantic warnings.
        This covers cases where instances were hydrated without running validators.
        """
        if isinstance(self.location, dict):
            if "url" in self.location:
                self.location = ApiLocation(**self.location)
            elif "workspace" in self.location and "layer_name" in self.location:
                self.location = GeoServerLocation(**self.location)
            elif "path" in self.location:
                self.location = FileLocation(**self.location)
            else:
                self.location = FileLocation(**self.location)

        if self.source_metadata is not None and isinstance(self.source_metadata, dict):
            self.source_metadata = SpatialDatasetFileMetadata(**self.source_metadata)

        return super().model_dump(**kwargs)
