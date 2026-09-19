from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class QuerySourceRef(CatalogModel):
    model_config = ConfigDict(extra="forbid")

    alias: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    collection_slug: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    dataset_slug: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    file_slug: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    version: str = Field(min_length=1, max_length=128)
    asset_key: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    storage_location_slug: str | None = Field(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
    )


class ColumnSchema(CatalogModel):
    name: str
    type: str = Field(validation_alias=AliasChoices("type", "data_type"))
    description: str | None = None
    nullable: bool = True
    num_null_values: int | None = Field(
        default=None, validation_alias=AliasChoices("num_null_values", "null_count")
    )
    num_unique_values: int | None = Field(
        default=None, validation_alias=AliasChoices("num_unique_values", "unique_count")
    )
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
    asset_key: str | None = None
    version: str | int
    source_type: SourceType
    location: SourceLocation
    source_metadata: SpatialDatasetFileMetadata | None = None
    url: str | None = None
    storage_uri: str | None = None
    glob_pattern: str | None = None
    storage_location: StorageLocation | None = None
    links: dict[str, str] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Format(CatalogModel):
    format_type: FormatType
    name: str
    description: str | None = None
    mime_type: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FileFormat(CatalogModel):
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
    slug: str = Field(validation_alias=AliasChoices("slug", "collection_slug"))
    name: str
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    links: dict[str, str] | None = None


DatasetTags = dict[str, str | list[str]]


class CatalogFileVersion(CatalogModel):
    version_label: str = Field(min_length=1, max_length=128)


class CatalogVersionQuality(CatalogModel):
    passed: bool | None = None
    invalid_geometry_count: int | None = None
    columns_hash: str | None = None


class CatalogVersionMetadata(CatalogFileVersion):
    crs84_bbox_json: str | None = None
    geometry_type: str | None = None
    feature_count: int | None = None
    columns: list[ColumnSchema] = []
    quality: CatalogVersionQuality | None = None


class DatasetFile(CatalogModel):
    slug: str = Field(validation_alias=AliasChoices("slug", "file_slug"))
    name: str
    description: str | None = None
    layer_name: str | None = None
    source_file_path: str | None = None
    file_metadata: SpatialDatasetFileMetadata | None = None
    versions: list[CatalogFileVersion] = []
    version_metadata: list[CatalogVersionMetadata] = []
    formats: list[DatasetFormat] = []
    links: dict[str, str] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class Dataset(CatalogModel):
    slug: str = Field(validation_alias=AliasChoices("slug", "dataset_slug"))
    name: str
    description: str | None = None
    tags: DatasetTags = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    files: list[DatasetFile] | None = None
    links: dict[str, str] | None = None


class DatasetFileFormatSummary(CatalogModel):
    format_count: int = Field(ge=0)


class DatasetFileSummary(CatalogModel):
    slug: str
    name: str
    description: str | None = None
    layer_name: str | None = None
    source_file_path: str | None = None
    formats: list[DatasetFileFormatSummary] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DatasetWithFiles(CatalogModel):
    """Dataset metadata with the compact file summaries returned by dataset-api."""

    slug: str
    name: str
    description: str | None = None
    tags: DatasetTags = Field(default_factory=dict)
    files: list[DatasetFileSummary] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DatasetSearchRequest(CatalogModel):
    collection: str
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


class CollectionDatasetsResponse(CatalogModel):
    collection: Collection
    datasets: list[Dataset]
    total: int
    limit: int | None = None
    offset: int = 0


class DatasetFileResponse(CatalogModel):
    collection: Collection
    dataset: Dataset
    file: DatasetFile


class DatasetFilePayload(CatalogModel):
    """Internal dataset-api file response before collection context is restored."""

    dataset: Dataset
    file: DatasetFile


class DatasetResponse(CatalogModel):
    collection: Collection
    dataset: DatasetWithFiles


class CatalogAssetObject(CatalogModel):
    object_key: str
    relative_path: str
    size_bytes: int | None = None
    sha256: str | None = None
    storage_revision: str | None = None


class CatalogAsset(CatalogModel):
    version: str = Field(min_length=1, max_length=128)
    asset_key: str
    format_key: str
    media_type: str | None = None
    storage_location_slug: str
    storage_config: BucketStorageConfig
    objects: list[CatalogAssetObject] = Field(min_length=1)


class DatasetFileAssetResponse(DatasetFileResponse):
    versions: list[CatalogFileVersion] = []
    assets: list[CatalogAsset] = []


class DatasetFileVersionsResponse(CatalogModel):
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


class StacLink(CatalogModel):
    rel: str
    href: str
    type: str | None = None
    title: str | None = None


class StacCatalog(CatalogModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["Catalog"]
    stac_version: str
    id: str
    title: str | None = None
    description: str
    links: list[StacLink]
    keywords: list[str] = []
    hifld_tags: DatasetTags = Field(default_factory=dict, alias="hifld:tags")


class StacDatasetPage(CatalogModel):
    datasets: list[StacCatalog]
    total: int = Field(ge=0)
    limit: int | None = Field(default=None, ge=1)
    offset: int = Field(default=0, ge=0)
    links: dict[str, str]


class StacSpatialExtent(CatalogModel):
    bbox: list[list[float]]


class StacTemporalExtent(CatalogModel):
    interval: list[list[str | None]]


class StacExtent(CatalogModel):
    spatial: StacSpatialExtent
    temporal: StacTemporalExtent


class StacAsset(CatalogModel):
    model_config = ConfigDict(extra="allow")

    href: str
    type: str
    title: str
    roles: list[str] = Field(min_length=1)
    file_checksum: str | None = Field(default=None, alias="file:checksum")
    file_size: int | None = Field(default=None, alias="file:size", ge=0)


class StacQuality(CatalogModel):
    passed: bool | None = None
    invalid_geometry_count: int | None = None
    null_geometry_count: int | None = None
    columns_hash: str | None = None


class StacVersionCollection(CatalogModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    type: Literal["Collection"]
    stac_version: str
    id: str
    title: str | None = None
    description: str
    license: str
    links: list[StacLink]
    extent: StacExtent
    assets: dict[str, StacAsset]
    table_columns: list[ColumnSchema] = Field(default=[], alias="table:columns")
    feature_count: int | None = Field(default=None, alias="hifld:feature_count")
    native_crs: str | None = Field(default=None, alias="hifld:native_crs")
    geometry_type: str | None = Field(default=None, alias="hifld:geometry_type")
    quality: StacQuality | None = Field(default=None, alias="hifld:quality")

    @field_validator("native_crs", mode="before")
    @classmethod
    def normalize_native_crs(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return value
        return decoded if isinstance(decoded, str) else value
