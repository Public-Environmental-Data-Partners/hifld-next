"""Dataset models using SQLModel."""

from datetime import datetime, timezone, date
from typing import Optional, Union, Any, Literal, List
from sqlmodel import Field, SQLModel, UniqueConstraint, Relationship
from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator
from pydantic import BaseModel, field_validator, model_validator


# Backend type literals
BackendType = Literal["s3", "geoserver"]

# Format type literals
FormatType = Literal[
    "geoparquet",
    "pmtiles",
    "geoserver",
    "geopackage",
    "shapefile",
    "geojson",
    "file_geodatabase",
]


class BucketStorageLocationConfig(BaseModel):
    """Pydantic schema for bucket-based storage (S3-compatible: AWS S3, GCS, SeaweedFS, etc.)."""

    type: Literal["s3", "gcs", "seaweedfs"] = (
        "s3"  # Type discriminator for self-contained JSON
    )
    version: str = "v1"  # Schema version
    base_url: str  # Base URL for accessing files
    bucket: str  # Bucket name
    # Add other storage-specific config fields as needed


class GeoServerStorageLocationConfig(BaseModel):
    """Pydantic schema for GeoServer storage location."""

    type: Literal["geoserver"] = (
        "geoserver"  # Type discriminator for self-contained JSON
    )
    version: str = "v1"  # Schema version
    base_url: str  # GeoServer base URL (e.g. "https://geoserver.../geoserver")
    workspace: str  # Default workspace (e.g. "hifld")


class FileLocation(BaseModel):
    """Location schema for file-based sources."""

    type: Literal["file"] = "file"  # Type discriminator for self-contained JSON
    version: str = "v1"  # Schema version
    path: str  # Relative path to file within storage location


class GeoServerLocation(BaseModel):
    """Location schema for GeoServer layer sources."""

    type: Literal["geoserver"] = (
        "geoserver"  # Type discriminator for self-contained JSON
    )
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

    type: Literal["api"] = "api"  # Type discriminator for self-contained JSON
    version: str = "v1"  # Schema version
    url: str  # Full API endpoint URL
    method: Optional[str] = None  # HTTP method (default: GET)


class ColumnSchema(BaseModel):
    """Typed column schema derived from data_dictionary.json."""

    name: str
    type: str
    description: Optional[str] = None
    nullable: bool = True
    num_null_values: Optional[int] = None
    num_unique_values: Optional[int] = None
    example_values: Optional[list[str]] = None
    min: Optional[float] = None
    max: Optional[float] = None
    length: Optional[int] = None
    possible_values: Optional[list[str]] = None


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
    # Data quality metadata
    invalid_geometry_count: Optional[int] = None
    quality_check_passed: Optional[bool] = None
    columns_hash: Optional[str] = None
    columns: Optional[list[ColumnSchema]] = None


class PydanticJSON(TypeDecorator):
    """
    JSON column that accepts Pydantic models by converting to dict on bind.
    Note: For StorageLocation.config, we return the dict as-is and let the
    field_validator handle conversion to avoid SQLAlchemy dirty tracking issues.
    """

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if isinstance(value, BaseModel):
            return value.model_dump()
        return value

    def process_result_value(self, value, dialect):
        # Return dict as-is - let Pydantic validators handle conversion
        # This avoids SQLAlchemy marking objects as dirty
        return value


class Collection(SQLModel, table=True):
    """Collection model for organizing datasets."""

    __tablename__ = "collections"

    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(unique=True)  # Unique, user-defined identifier for the collection
    name: str
    description: Optional[str] = None

    # Relationships
    datasets: List["Dataset"] = Relationship(
        back_populates="collection",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

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
    backend_type: str  # "s3" | "geoserver" - validated by field_validator
    description: Optional[str] = None

    # Configuration (JSON object with storage-specific config)
    # Type depends on backend_type:
    # - "s3" -> BucketStorageLocationConfig (for S3-compatible storage: AWS S3, GCS, SeaweedFS, etc.)
    # - "geoserver" -> GeoServerStorageLocationConfig
    config: Optional[
        Union[BucketStorageLocationConfig, GeoServerStorageLocationConfig]
    ] = Field(default=None, sa_type=PydanticJSON())

    # Relationships
    file_sources: List["FileSource"] = Relationship(back_populates="storage_location")

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
        """Convert dict to appropriate config model based on backend_type or type field."""
        if v is None:
            return None
        if isinstance(v, dict):
            # First, check for explicit type field in JSON (preferred)
            config_type = v.get("type")
            if config_type == "geoserver":
                return GeoServerStorageLocationConfig(**v)
            elif config_type in ("s3", "gcs", "seaweedfs"):
                return BucketStorageLocationConfig(**v)
            else:
                raise ValueError(
                    f"Storage location config must have explicit 'type' field ('gcs', 'seaweedfs', 's3', or 'geoserver'), got: {config_type}"
                )
        return v

    @model_validator(mode="after")
    def convert_config_after(self):
        """
        Avoid mutating config after hydration to prevent SQLAlchemy dirty tracking.
        Keep config as dict on ORM instances; helpers already handle dicts.
        """
        return self

    def model_dump(self, **kwargs):
        """
        Serialize without mutating ORM instances; suppress warnings about dict input.
        """
        return super().model_dump(**kwargs, warnings=False)


class Dataset(SQLModel, table=True):
    """Dataset model matching the webapp schema."""

    __tablename__ = "datasets"

    id: Optional[int] = Field(default=None, primary_key=True)
    # Core identification
    slug: str = Field(unique=True)  # Unique, user-defined identifier for the dataset
    name: str  # Human-readable name (e.g. "Security Zones - SecurityZones")
    description: Optional[str] = None
    tags: Optional[dict[str, Union[str, list[str]]]] = Field(
        default=None, sa_type=JSON
    )  # Searchable metadata tags (e.g. {"inventory_name": "security-zones-securityzones", "geometry_type": "Point", "categories": ["Boundaries", "Water Supply"]})

    # Collection membership
    collection_id: Optional[int] = Field(
        default=None,
        ondelete="CASCADE",
        foreign_key="collections.id",
    )

    # Relationships
    collection: Optional["Collection"] = Relationship(back_populates="datasets")
    files: List["File"] = Relationship(
        back_populates="dataset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# TODO: rename "File" to "Layer"
class File(SQLModel, table=True):
    """
    File model representing a file (or layer) within a dataset.

    A dataset can have multiple files in several scenarios:
    1. Multiple source files (e.g., dataset split into chunks or parts)
    2. Multiple layers from a single source file (e.g., GeoPackage/File Geodatabase)
    3. Multiple processed outputs from the same source

    For multi-layer source files (GeoPackage, File Geodatabase), each layer is
    represented as a separate File record. This allows each layer to have:
    - Its own formats (geoparquet, pmtiles, etc.)
    - Its own versions and storage locations
    - Its own metadata (feature count, bounds, geometry type)

    Each file can have multiple formats and versions.
    """

    __tablename__ = "files"
    __table_args__ = (
        UniqueConstraint("dataset_id", "name", name="uq_dataset_file_name"),
        # Note: For multi-layer files, consider also ensuring uniqueness of
        # (dataset_id, source_file_path, layer_name) when source_file_path is not NULL
        # This can be enforced via a partial unique index in the database if needed
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(ondelete="CASCADE", foreign_key="datasets.id")

    # File identification
    name: str  # Human-readable name for the file (e.g. "main", "chunk-1", "part-a", "layer-name")
    slug: str  # Unique identifier within the dataset
    description: Optional[str] = None

    # Layer information (for multi-layer source files)
    layer_name: Optional[str] = (
        None  # Layer name if from a multi-layer source (GeoPackage/FileGDB)
    )
    # For multi-layer files, this identifies which layer from the source file
    # For single-layer files, this is None or "default"

    source_file_path: Optional[str] = (
        None  # Original source file path (for multi-layer sources)
    )
    # This allows grouping files that came from the same source file
    # e.g., "gs://bucket/dataset.gpkg" for all layers from that GeoPackage

    # File-level metadata (optional, can be overridden by format-specific metadata)
    file_metadata: Optional[SpatialDatasetFileMetadata] = Field(
        default=None, sa_type=PydanticJSON()
    )

    # Relationships
    dataset: "Dataset" = Relationship(back_populates="files")
    file_formats: List["FileFormat"] = Relationship(
        back_populates="file",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("file_metadata", mode="wrap")
    @classmethod
    def validate_file_metadata(
        cls, v: Any, handler
    ) -> Optional[SpatialDatasetFileMetadata]:
        """Validate and convert file_metadata field."""
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
    def convert_file_metadata_field(self):
        """Convert file_metadata dict to model after instantiation."""
        if self.file_metadata is not None and isinstance(self.file_metadata, dict):
            self.file_metadata = SpatialDatasetFileMetadata(**self.file_metadata)
        return self

    def model_dump(self, **kwargs):
        """Ensure file_metadata is a Pydantic model before serialization."""
        if self.file_metadata is not None and isinstance(self.file_metadata, dict):
            self.file_metadata = SpatialDatasetFileMetadata(**self.file_metadata)
        return super().model_dump(**kwargs)


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

    # Relationships
    file_formats: List["FileFormat"] = Relationship(back_populates="format")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("format_type")
    @classmethod
    def validate_format_type(cls, v: str) -> str:
        """Validate format_type is one of the allowed values."""
        allowed = [
            "geoparquet",
            "pmtiles",
            "geoserver",
            "geopackage",
            "shapefile",
            "geojson",
            "file_geodatabase",
        ]
        if v not in allowed:
            raise ValueError(f"format_type must be one of {allowed}, got '{v}'")
        return v


class FileFormat(SQLModel, table=True):
    """Join table linking files to formats (many-to-many).

    Each file can have multiple formats (e.g., geoparquet, pmtiles, geoserver),
    and each format can be associated with multiple files.
    """

    __tablename__ = "file_formats"
    __table_args__ = (UniqueConstraint("file_id", "format_id", name="uq_file_format"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    file_id: int = Field(ondelete="CASCADE", foreign_key="files.id")
    format_id: int = Field(ondelete="CASCADE", foreign_key="formats.id")

    # Relationships
    file: "File" = Relationship(back_populates="file_formats")
    format: "Format" = Relationship(back_populates="file_formats")
    file_sources: List["FileSource"] = Relationship(
        back_populates="file_format",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FileSource(SQLModel, table=True):
    """
    Model for storing data source references (files, databases, APIs, etc.) in specific storage locations.

    A file format can exist in multiple storage locations (for redundancy/backups).
    Each instance represents one data source (file, database connection, API endpoint, etc.)
    for a file format in a specific storage location.

    Supports versioning: each source can have multiple versions, with the highest version
    string being the latest/current version (determined by application logic).

    For GeoServer format sources:
    - The source_type should be "geoserver"
    - The location should be a GeoServerLocation (workspace, store_name, layer_name)
    - The references_source_id should point to the FileSource that contains the actual data
      (e.g., the GeoParquet file that the GeoServer layer serves)
    - The version should typically match the referenced source's version
    """

    __tablename__ = "file_sources"
    __table_args__ = (
        UniqueConstraint(
            "file_format_id",
            "storage_location_id",
            "version",
            name="uq_file_source_version",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    file_format_id: int = Field(ondelete="CASCADE", foreign_key="file_formats.id")
    storage_location_id: int = Field(
        ondelete="CASCADE", foreign_key="storage_locations.id"
    )

    # Versioning: version string (defaults to current date in YYYY-MM-DD format, e.g., "2026-02-05")
    # Latest version should be determined by application logic based on version string comparison
    version: str = Field(default_factory=lambda: date.today().isoformat())

    # Source type: "file", "database", "api", "geoserver"
    source_type: str  # Type of data source (indexed for efficient querying)

    # Location information (validated against appropriate Pydantic schema based on source_type)
    # For "file": FileLocation schema (path)
    # For "api": ApiLocation schema (url, method)
    # For "geoserver": GeoServerLocation schema (workspace, store_name, layer_name)
    location: Union[FileLocation, ApiLocation, GeoServerLocation] = Field(
        sa_type=PydanticJSON()
    )

    # Reference to another FileSource (for service formats like GeoServer that reference data sources)
    # e.g., a GeoServer layer source references the GeoParquet file source it serves
    references_source_id: Optional[int] = Field(
        default=None,
        ondelete="CASCADE",
        foreign_key="file_sources.id",
    )

    # Source metadata (optional, validated against SpatialDatasetFileMetadata schema)
    source_metadata: Optional[SpatialDatasetFileMetadata] = Field(
        default=None, sa_type=PydanticJSON()
    )

    # Relationships
    file_format: "FileFormat" = Relationship(back_populates="file_sources")
    storage_location: "StorageLocation" = Relationship(back_populates="file_sources")
    referenced_source: Optional["FileSource"] = Relationship(
        sa_relationship_kwargs={
            "remote_side": "FileSource.id",
            "foreign_keys": "FileSource.references_source_id",
        }
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
            # First, check for explicit type field (preferred)
            location_type = v.get("type")
            if location_type == "file":
                return FileLocation(**v)
            elif location_type == "api":
                return ApiLocation(**v)
            elif location_type == "geoserver":
                return GeoServerLocation(**v)
            else:
                raise ValueError(
                    f"FileSource location must have explicit 'type' field ('file', 'api', or 'geoserver'), got: {location_type}"
                )

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
        Avoid mutating ORM instances to prevent SQLAlchemy dirty tracking.
        """
        return self

    def model_dump(self, **kwargs):
        """
        Ensure typed fields before serialization to avoid Pydantic warnings.
        This covers cases where instances were hydrated without running validators.
        Serialize without mutating ORM instances; suppress warnings about dict input.
        """
        return super().model_dump(**kwargs, warnings=False)
