"""Dataset models using SQLModel."""

from enum import Enum
from datetime import datetime, timezone
from typing import Optional, Union, Any
from sqlmodel import Field, SQLModel, UniqueConstraint
from sqlalchemy import JSON
from pydantic import BaseModel, field_validator, model_validator


class BucketStorageLocationConfig(BaseModel):
    """Pydantic schema for storage location configuration."""

    version: str = "v1"  # Schema version
    base_url: Optional[str] = None  # Base URL for accessing files
    bucket: Optional[str] = None  # Bucket name (for S3/GCS)
    # Add other storage-specific config fields as needed


class FileLocation(BaseModel):
    """Location schema for file-based sources."""

    version: str = "v1"  # Schema version
    path: str  # Relative path to file within storage location


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


class GeometryType(str, Enum):
    Point = "Point"
    Polygon = "Polygon"
    LineString = "LineString"
    MultiPoint = "MultiPoint"
    MultiPolygon = "MultiPolygon"
    MultiLineString = "MultiLineString"
    GeometryCollection = "GeometryCollection"
    Unknown = "Unknown"


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
    name: str = Field(unique=True)  # e.g. "SeaweedFS Local", "GCS Production"
    backend_type: str  # e.g. "seaweedfs", "gcs", "s3"
    description: Optional[str] = None

    # Configuration (JSON object with storage-specific config)
    config: Optional[BucketStorageLocationConfig] = Field(
        default=None, sa_type=JSON
    )  # JSON object following StorageLocationConfig schema

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("config", mode="before")
    @classmethod
    def validate_config(cls, v: Any) -> Optional[BucketStorageLocationConfig]:
        """Convert dict to BucketStorageLocationConfig when loading from DB."""
        if v is None:
            return None
        if isinstance(v, dict):
            return BucketStorageLocationConfig(**v)
        return v

    @model_validator(mode="after")
    def convert_config_after(self):
        """Convert config dict to model after instantiation (handles SQLModel direct assignment)."""
        if self.config is not None and isinstance(self.config, dict):
            self.config = BucketStorageLocationConfig(**self.config)
        return self


class Dataset(SQLModel, table=True):
    """Dataset model matching the webapp schema."""

    __tablename__ = "datasets"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Core identification
    name: str = Field(unique=True)  # e.g. "security-zones-securityzones"
    alias: str  # e.g. "Security Zones - SecurityZones"
    description: Optional[str] = None

    # Collection membership
    collection_id: Optional[int] = Field(default=None, foreign_key="collections.id")

    # Dataset type (geometry type)
    type: GeometryType  # Point, Polygon, LineString, etc.

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Format(SQLModel, table=True):
    """Format definition (shared across all datasets)."""

    __tablename__ = "formats"

    id: Optional[int] = Field(default=None, primary_key=True)
    format_type: str = Field(unique=True)  # e.g. "geoparquet", "pmtiles", "ogc_feature"
    name: str  # Human-readable name, e.g. "GeoParquet", "PMTiles"
    description: Optional[str] = None  # Description of the format
    mime_type: Optional[str] = None  # Default MIME type for this format

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DatasetFormat(SQLModel, table=True):
    """Join table linking datasets to formats (many-to-many)."""

    __tablename__ = "dataset_formats"
    __table_args__ = (
        UniqueConstraint("dataset_id", "format_id", name="uq_dataset_format"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(foreign_key="datasets.id")
    format_id: int = Field(foreign_key="formats.id")

    # Dataset-specific format metadata (optional)
    description: Optional[str] = None

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
    # Note: Stored as dict, but can be validated/coerced to Pydantic models based on source_type
    location: Union[FileLocation, ApiLocation] = Field(sa_type=JSON)

    # Source metadata (optional, validated against SpatialDatasetFileMetadata schema)
    # Note: For OGC Feature API sources, a different metadata schema may be needed
    # Using 'file_metadata' instead of 'metadata' to avoid SQLAlchemy reserved name conflict
    source_metadata: Optional[SpatialDatasetFileMetadata] = Field(
        default=None, sa_type=JSON
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("location", mode="before")
    @classmethod
    def validate_location(cls, v: Any) -> Union[FileLocation, ApiLocation]:
        """Convert dict to FileLocation or ApiLocation when loading from DB."""
        if isinstance(v, dict):
            # Determine which type based on the dict keys
            if "url" in v:
                return ApiLocation(**v)
            elif "path" in v:
                return FileLocation(**v)
            else:
                # Default to FileLocation if we can't determine
                return FileLocation(**v)
        return v

    @field_validator("source_metadata", mode="before")
    @classmethod
    def validate_source_metadata(cls, v: Any) -> Optional[SpatialDatasetFileMetadata]:
        """Convert dict to SpatialDatasetFileMetadata when loading from DB."""
        if v is None:
            return None
        if isinstance(v, dict):
            return SpatialDatasetFileMetadata(**v)
        return v

    @model_validator(mode="after")
    def convert_fields_after(self):
        """Convert dict fields to models after instantiation (handles SQLModel direct assignment)."""
        # Convert location
        if isinstance(self.location, dict):
            if "url" in self.location:
                self.location = ApiLocation(**self.location)
            elif "path" in self.location:
                self.location = FileLocation(**self.location)
            else:
                # Default to FileLocation if we can't determine
                self.location = FileLocation(**self.location)

        # Convert source_metadata
        if self.source_metadata is not None and isinstance(self.source_metadata, dict):
            self.source_metadata = SpatialDatasetFileMetadata(**self.source_metadata)

        return self
