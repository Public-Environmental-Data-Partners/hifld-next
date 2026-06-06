"""Dataset models using SQLModel."""

from datetime import UTC, date, datetime
from typing import Literal, Optional, Self

from pydantic import BaseModel, ValidationInfo, ValidatorFunctionWrapHandler, field_validator, model_validator
from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator
from sqlmodel import Field, Relationship, SQLModel, UniqueConstraint


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

    type: Literal["s3", "gcs", "seaweedfs"] = "s3"  # Type discriminator for self-contained JSON
    version: str = "v1"  # Schema version
    base_url: str  # Base URL for accessing files
    bucket: str  # Bucket name
    endpoint_url: str | None = None  # Optional S3-compatible endpoint URL
    # Add other storage-specific config fields as needed


class GeoServerStorageLocationConfig(BaseModel):
    """Pydantic schema for GeoServer storage location."""

    type: Literal["geoserver"] = "geoserver"  # Type discriminator for self-contained JSON
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

    type: Literal["geoserver"] = "geoserver"  # Type discriminator for self-contained JSON
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
    method: str | None = None  # HTTP method (default: GET)


class ColumnSchema(BaseModel):
    """Typed column schema derived from data_dictionary.json."""

    name: str
    type: str
    description: str | None = None
    nullable: bool = True
    num_null_values: int | None = None
    num_unique_values: int | None = None
    example_values: list[str] | None = None
    min: float | None = None
    max: float | None = None
    length: int | None = None
    possible_values: list[str] | None = None


class SpatialDatasetFileMetadata(BaseModel):
    """Pydantic schema for spatial dataset file metadata."""

    version: str = "v1"  # Schema version
    description: str | None = None

    # File-specific metadata (only relevant when source_type="file")
    size_bytes: int | None = None  # File size in bytes
    mime_type: str | None = None  # MIME type (e.g. "application/x-protobuf", "application/parquet")

    # Spatial metadata
    feature_count: int | None = None  # Number of features
    bounds: list[float] | None = None  # Bounding box [minx, miny, maxx, maxy]
    geometry_type: str | None = None  # Geometry type (e.g. "Point", "Polygon", "LineString", "Mixed")
    # Data quality metadata
    invalid_geometry_count: int | None = None
    quality_check_passed: bool | None = None
    columns_hash: str | None = None
    columns: list[ColumnSchema] | None = None


class PydanticJSON(TypeDecorator[object]):
    """JSON column that accepts Pydantic models by converting to dict on bind.

    Note: For StorageLocation.config, we return the dict as-is and let the
    field_validator handle conversion to avoid SQLAlchemy dirty tracking issues.
    """

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value: object, dialect: object) -> object:
        """Convert Pydantic models before database writes."""
        if isinstance(value, BaseModel):
            return value.model_dump()
        return value

    def process_result_value(self, value: object, dialect: object) -> object:
        """Return database JSON values without converting them."""
        # Return dict as-is - let Pydantic validators handle conversion
        # This avoids SQLAlchemy marking objects as dirty
        return value


class Collection(SQLModel, table=True):
    """Collection model for organizing datasets."""

    __tablename__ = "collections"

    id: int = Field(default=None, primary_key=True)
    slug: str = Field(unique=True)  # Unique, user-defined identifier for the collection
    name: str
    description: str | None = None

    # Relationships
    datasets: list["Dataset"] = Relationship(
        back_populates="collection",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class StorageLocation(SQLModel, table=True):
    """Storage location model for tracking different storage backends."""

    __tablename__ = "storage_locations"

    id: int = Field(default=None, primary_key=True)
    slug: str = Field(unique=True)  # Stable, user-defined identifier for config
    name: str  # e.g. "S3 Local", "GCS Production", "SeaweedFS Local"
    backend_type: str  # "s3" | "geoserver" - validated by field_validator
    description: str | None = None

    # Configuration (JSON object with storage-specific config)
    # Type depends on backend_type:
    # - "s3" -> BucketStorageLocationConfig (for S3-compatible storage: AWS S3, GCS, SeaweedFS, etc.)
    # - "geoserver" -> GeoServerStorageLocationConfig
    config: BucketStorageLocationConfig | GeoServerStorageLocationConfig | None = Field(
        default=None, sa_type=PydanticJSON
    )

    # Relationships
    file_sources: list["FileSource"] = Relationship(back_populates="storage_location")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("backend_type")
    @classmethod
    def validate_backend_type(cls, v: str) -> str:
        """Validate backend_type is one of the allowed values."""
        allowed = ["s3", "geoserver"]
        if v not in allowed:
            msg = f"backend_type must be one of {allowed}, got '{v}'"
            raise ValueError(msg)
        return v

    @field_validator("config", mode="before")
    @classmethod
    def validate_config(
        cls,
        v: object,
        info: ValidationInfo,
    ) -> BucketStorageLocationConfig | GeoServerStorageLocationConfig | None:
        """Convert dict to appropriate config model based on backend_type or type field."""
        if v is None:
            return None
        if isinstance(v, (BucketStorageLocationConfig, GeoServerStorageLocationConfig)):
            return v
        if isinstance(v, dict):
            # First, check for explicit type field in JSON (preferred)
            config_type = v.get("type")
            if config_type == "geoserver":
                return GeoServerStorageLocationConfig(**v)
            if config_type in ("s3", "gcs", "seaweedfs"):
                return BucketStorageLocationConfig(**v)
            msg = (
                "Storage location config must have explicit 'type' field "
                f"('gcs', 'seaweedfs', 's3', or 'geoserver'), got: {config_type}"
            )
            raise ValueError(msg)
        msg = "Storage location config must be a typed config model or dict"
        raise TypeError(msg)

    @model_validator(mode="after")
    def convert_config_after(self) -> Self:
        """Avoid mutating config after hydration to prevent SQLAlchemy dirty tracking.

        Keep config as dict on ORM instances; helpers already handle dicts.
        """
        return self


class Dataset(SQLModel, table=True):
    """Dataset model matching the webapp schema."""

    __tablename__ = "datasets"

    id: int = Field(default=None, primary_key=True)
    # Core identification
    slug: str = Field(unique=True)  # Unique, user-defined identifier for the dataset
    name: str  # Human-readable name (e.g. "Security Zones - SecurityZones")
    description: str | None = None
    tags: dict[str, str | list[str]] | None = Field(
        default=None, sa_type=JSON
    )  # Searchable metadata tags (e.g. {"inventory_name": "security-zones-securityzones", "geometry_type": "Point", "categories": ["Boundaries", "Water Supply"]})

    # Collection membership
    collection_id: int | None = Field(
        default=None,
        ondelete="CASCADE",
        foreign_key="collections.id",
    )

    # Relationships
    collection: Optional["Collection"] = Relationship(back_populates="datasets")
    files: list["File"] = Relationship(
        back_populates="dataset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


# TODO: rename "File" to "Layer"
class File(SQLModel, table=True):
    """File model representing a file (or layer) within a dataset.

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
        UniqueConstraint("dataset_id", "slug", name="uq_dataset_file_slug"),
        # Note: For multi-layer files, consider also ensuring uniqueness of
        # (dataset_id, source_file_path, layer_name) when source_file_path is not NULL
        # This can be enforced via a partial unique index in the database if needed
    )

    id: int = Field(default=None, primary_key=True)
    dataset_id: int = Field(ondelete="CASCADE", foreign_key="datasets.id")

    # File identification
    name: str  # Human-readable name for the file (e.g. "main", "chunk-1", "part-a", "layer-name")
    slug: str  # Unique identifier within the dataset
    description: str | None = None

    # Layer information (for multi-layer source files)
    layer_name: str | None = None  # Layer name if from a multi-layer source (GeoPackage/FileGDB)
    # For multi-layer files, this identifies which layer from the source file
    # For single-layer files, this is None or "default"

    source_file_path: str | None = None  # Original source file path (for multi-layer sources)
    # This allows grouping files that came from the same source file
    # e.g., "gs://bucket/dataset.gpkg" for all layers from that GeoPackage

    # File-level metadata (optional, can be overridden by format-specific metadata)
    file_metadata: SpatialDatasetFileMetadata | None = Field(default=None, sa_type=PydanticJSON)

    # Relationships
    dataset: "Dataset" = Relationship(back_populates="files")
    file_formats: list["FileFormat"] = Relationship(
        back_populates="file",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("file_metadata", mode="wrap")
    @classmethod
    def validate_file_metadata(
        cls,
        v: object,
        handler: ValidatorFunctionWrapHandler,
    ) -> SpatialDatasetFileMetadata | None:
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
    def convert_file_metadata_field(self) -> Self:
        """Convert file_metadata dict to model after instantiation."""
        if self.file_metadata is not None and isinstance(self.file_metadata, dict):
            self.file_metadata = SpatialDatasetFileMetadata(**self.file_metadata)
        return self


class Format(SQLModel, table=True):
    """Format definition (shared across all datasets)."""

    __tablename__ = "formats"

    id: int = Field(default=None, primary_key=True)
    format_type: str = Field(unique=True)  # "geoparquet" | "pmtiles" | "geoserver" (validated in code)
    name: str  # Human-readable name, e.g. "GeoParquet", "PMTiles"
    description: str | None = None  # Description of the format
    mime_type: str | None = None  # Default MIME type for this format

    # Relationships
    file_formats: list["FileFormat"] = Relationship(back_populates="format")

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

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
            msg = f"format_type must be one of {allowed}, got '{v}'"
            raise ValueError(msg)
        return v


class FileFormat(SQLModel, table=True):
    """Join table linking files to formats (many-to-many).

    Each file can have multiple formats (e.g., geoparquet, pmtiles, geoserver),
    and each format can be associated with multiple files.
    """

    __tablename__ = "file_formats"
    __table_args__ = (UniqueConstraint("file_id", "format_id", name="uq_file_format"),)

    id: int = Field(default=None, primary_key=True)
    file_id: int = Field(ondelete="CASCADE", foreign_key="files.id")
    format_id: int = Field(ondelete="CASCADE", foreign_key="formats.id")

    # Relationships
    file: "File" = Relationship(back_populates="file_formats")
    format: "Format" = Relationship(back_populates="file_formats")
    file_sources: list["FileSource"] = Relationship(
        back_populates="file_format",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class FileSource(SQLModel, table=True):
    """Model for storing data source references (files, databases, APIs, etc.) in specific storage locations.

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

    id: int = Field(default=None, primary_key=True)
    file_format_id: int = Field(ondelete="CASCADE", foreign_key="file_formats.id")
    storage_location_id: int = Field(ondelete="CASCADE", foreign_key="storage_locations.id")

    # Versioning: version string (defaults to current date in YYYY-MM-DD format, e.g., "2026-02-05")
    # Latest version should be determined by application logic based on version string comparison
    version: str = Field(default_factory=lambda: date.today().isoformat())

    # Source type: "file", "database", "api", "geoserver"
    source_type: str  # Type of data source (indexed for efficient querying)

    # Location information (validated against appropriate Pydantic schema based on source_type)
    # For "file": FileLocation schema (path)
    # For "api": ApiLocation schema (url, method)
    # For "geoserver": GeoServerLocation schema (workspace, store_name, layer_name)
    location: FileLocation | ApiLocation | GeoServerLocation = Field(sa_type=PydanticJSON)

    # Reference to another FileSource (for service formats like GeoServer that reference data sources)
    # e.g., a GeoServer layer source references the GeoParquet file source it serves
    references_source_id: int | None = Field(
        default=None,
        ondelete="CASCADE",
        foreign_key="file_sources.id",
    )

    # Source metadata (optional, validated against SpatialDatasetFileMetadata schema)
    source_metadata: SpatialDatasetFileMetadata | None = Field(default=None, sa_type=PydanticJSON)

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
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("location", mode="wrap")
    @classmethod
    def validate_location(
        cls,
        v: object,
        handler: ValidatorFunctionWrapHandler,
    ) -> FileLocation | ApiLocation | GeoServerLocation:
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
            if location_type == "api":
                return ApiLocation(**v)
            if location_type == "geoserver":
                return GeoServerLocation(**v)
            msg = (
                "FileSource location must have explicit 'type' field "
                f"('file', 'api', or 'geoserver'), got: {location_type}"
            )
            raise ValueError(msg)

        # Otherwise let Pydantic handle it
        return handler(v)

    @field_validator("source_metadata", mode="wrap")
    @classmethod
    def validate_source_metadata(
        cls,
        v: object,
        handler: ValidatorFunctionWrapHandler,
    ) -> SpatialDatasetFileMetadata | None:
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
    def convert_dict_fields(self) -> Self:
        """Convert dict fields to typed models after instantiation.

        SQLModel can hydrate from the database by setting attributes directly,
        bypassing validators; this ensures we still end up with typed models.
        Avoid mutating ORM instances to prevent SQLAlchemy dirty tracking.
        """
        return self
