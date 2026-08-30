from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class QuerySourceRef(CatalogModel):
    alias: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    collection_id: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    file_id: int = Field(gt=0)
    file_source_id: int = Field(gt=0)


class ColumnSchema(CatalogModel):
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


class SpatialDatasetFileMetadata(CatalogModel):
    version: str = "v1"
    description: str | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    feature_count: int | None = None
    bounds: list[float] | None = None
    geometry_type: str | None = None
    invalid_geometry_count: int | None = None
    quality_check_passed: bool | None = None
    columns_hash: str | None = None
    columns: list[ColumnSchema] | None = None
    object_paths: list[str] | None = None
    crs: str | None = None


class BucketStorageConfig(CatalogModel):
    type: Literal["s3", "gcs", "seaweedfs"] = "s3"
    version: str = "v1"
    base_url: str
    bucket: str
    endpoint_url: str | None = None


class GeoServerStorageConfig(CatalogModel):
    type: Literal["geoserver"] = "geoserver"
    version: str = "v1"
    base_url: str
    workspace: str


StorageConfig = BucketStorageConfig | GeoServerStorageConfig


class StorageLocation(CatalogModel):
    id: int
    slug: str | None = None
    name: str
    backend_type: str
    description: str | None = None
    config: StorageConfig | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FileLocation(CatalogModel):
    type: Literal["file"] = "file"
    version: str = "v1"
    path: str


class ApiLocation(CatalogModel):
    type: Literal["api"] = "api"
    version: str = "v1"
    url: str
    method: str | None = None


class GeoServerLocation(CatalogModel):
    type: Literal["geoserver"] = "geoserver"
    version: str = "v1"
    workspace: str
    store_name: str
    layer_name: str


SourceLocation = FileLocation | ApiLocation | GeoServerLocation
FormatType = Literal[
    "geoparquet", "pmtiles", "geopackage", "shapefile", "geojson", "file_geodatabase", "geoserver"
]
SourceType = Literal["file", "api", "geoserver"]


class FileSource(CatalogModel):
    id: int
    file_format_id: int | None = None
    storage_location_id: int | None = None
    version: str | int
    source_type: SourceType
    location: SourceLocation
    source_metadata: SpatialDatasetFileMetadata | None = None
    url: str | None = None
    storage_uri: str | None = None
    glob_pattern: str | None = None
    storage_location: StorageLocation | None = None
    links: dict[str, str] | None = None
    references_source_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Format(CatalogModel):
    id: int
    format_type: FormatType
    name: str
    description: str | None = None
    mime_type: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FileFormat(CatalogModel):
    id: int | None = None
    file_id: int | None = None
    dataset_id: int | None = None
    format_id: int | None = None
    format: Format | None = None
    format_type: FormatType | None = None
    name: str | None = None
    sources: list[FileSource] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DatasetFormat(CatalogModel):
    format: Format
    file_format: FileFormat | None = None
    dataset_format: FileFormat | None = None
    sources: list[FileSource] = []


class Collection(CatalogModel):
    id: int
    slug: str
    name: str
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    links: dict[str, str] | None = None


DatasetTags = dict[str, str | list[str]]


class DatasetFile(CatalogModel):
    id: int
    dataset_id: int
    slug: str
    name: str
    description: str | None = None
    layer_name: str | None = None
    source_file_path: str | None = None
    file_metadata: SpatialDatasetFileMetadata | None = None
    formats: list[DatasetFormat] = []
    links: dict[str, str] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Dataset(CatalogModel):
    id: int
    collection_id: int
    slug: str
    name: str
    description: str | None = None
    tags: DatasetTags = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    files: list[DatasetFile] | None = None
    links: dict[str, str] | None = None


class DatasetSearchRequest(CatalogModel):
    collection: int | str
    search: str | None = None
    tag_filters: str | None = None
    limit: int = Field(default=50, ge=1, le=1_000)
    offset: int = Field(default=0, ge=0)

    def to_query_params(self) -> dict[str, str | int]:
        params: dict[str, str | int] = {"limit": self.limit, "offset": self.offset}
        if self.search is not None:
            params["search"] = self.search
        if self.tag_filters is not None:
            params["tag_filters"] = self.tag_filters
        return params


class DatasetPage(CatalogModel):
    items: list[Dataset]
    total: int
    limit: int | None = None
    offset: int = 0


class DatasetFileResponse(CatalogModel):
    collection: Collection
    dataset: Dataset
    file: DatasetFile


class DatasetFileVersionsResponse(CatalogModel):
    dataset_id: int
    file_id: int
    formats: list[DatasetFormat]


class SchemaSummary(CatalogModel):
    columnCount: int
    featureCount: int | None = None
    geometryType: str | None = None
    invalidGeometryCount: int | None = None
    qualityCheckPassed: bool | None = None
    columnsHash: str | None = None


class DatasetFileSchema(CatalogModel):
    version: str | int | None
    format_type: FormatType
    format_name: str
    source_id: int
    storage_location: StorageLocation | None = None
    source: FileSource
    source_metadata: SpatialDatasetFileMetadata | None = None
    summary: SchemaSummary
    columns: list[ColumnSchema]


class DatasetFileSchemaResult(CatalogModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True, serialize_by_alias=True)

    collection: Collection
    dataset: Dataset
    file: DatasetFile
    versions: list[str | int]
    selected_version: str | int | None
    schema_: DatasetFileSchema | None = Field(default=None, alias="schema")
