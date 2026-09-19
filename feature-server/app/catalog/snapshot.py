"""Project eligible publisher rows into pygeoapi resource definitions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import NotRequired, Protocol, TypedDict
from urllib.parse import urljoin

from app.catalog.repository import SpatialResourceRecord


class LinkDefinition(TypedDict):
    rel: str
    href: str
    type: str
    title: str


class ProviderDefinition(TypedDict):
    name: str
    type: str
    data: str
    asset_key: str
    asset_checksum: str
    storage_location_slug: str
    object_keys: list[str]
    storage_crs: str
    native_crs: str
    geometry_column: str
    feature_count: int
    objects_json: str
    feature_id_column: NotRequired[str]
    id_field: NotRequired[str]
    fields_json: str
    source_uris_json: NotRequired[str]
    seaweed_endpoint: NotRequired[str]


class ExtentDefinition(TypedDict):
    bbox: list[float]
    crs: str


class ResourceDefinition(TypedDict):
    type: str
    title: str
    description: str
    keywords: list[str]
    extents: dict[str, ExtentDefinition]
    links: list[LinkDefinition]
    providers: list[ProviderDefinition]
    hifld_latest_alias: bool


@dataclass(frozen=True, slots=True)
class ProjectedResources:
    generation: str
    resources: dict[str, ResourceDefinition]


class SpatialCatalogReader(Protocol):
    @property
    def generation(self) -> str: ...

    def read_spatial_versions(self) -> tuple[SpatialResourceRecord, ...]: ...


def _collection_id(collection_slug: str, dataset_slug: str, file_slug: str, version: str) -> str:
    components = (collection_slug, dataset_slug, file_slug, version)
    if any(not part or "~" in part for part in components):
        raise ValueError("catalog contains an unsafe OGC collection identity")
    return "~".join(components)


def _crs_uri(value: str) -> str:
    if value.startswith("EPSG:") and value[5:].isdigit():
        return f"http://www.opengis.net/def/crs/EPSG/0/{value[5:]}"
    return value


def project_resources(
    repository: SpatialCatalogReader, *, catalog_root_url: str | None = None
) -> ProjectedResources:
    resources: dict[str, ResourceDefinition] = {}
    for record in repository.read_spatial_versions():
        layer_title = (
            f"{record.dataset_title} — {record.title}"
            if record.dataset_title and record.dataset_title != record.title
            else record.title
        )
        collection_id = _collection_id(
            record.collection_slug,
            record.dataset_slug,
            record.file_slug,
            record.version_label,
        )
        collection_href = (
            urljoin(f"{catalog_root_url.rstrip('/')}/", record.collection_href)
            if catalog_root_url is not None
            else record.collection_href
        )
        provider: ProviderDefinition = {
            "name": "hifld_duckdb",
            "type": "feature",
            "data": record.storage_href,
            "asset_key": record.asset_key,
            "asset_checksum": record.asset_checksum,
            "storage_location_slug": record.storage_slug,
            "object_keys": list(record.object_keys),
            "storage_crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
            "native_crs": _crs_uri(record.native_crs),
            "geometry_column": record.geometry_column,
            "feature_count": record.feature_count,
            "objects_json": json.dumps(record.object_keys),
            "fields_json": json.dumps(record.fields),
        }
        if record.feature_id_column is not None:
            provider["feature_id_column"] = record.feature_id_column
            provider["id_field"] = record.feature_id_column
        definition: ResourceDefinition = {
            "type": "collection",
            "title": f"{layer_title} ({record.version_label})",
            "description": record.description,
            "keywords": [],
            "extents": {
                "spatial": {
                    "bbox": list(record.crs84_bbox),
                    "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
                }
            },
            "links": [
                {
                    "rel": "canonical",
                    "href": collection_href,
                    "type": "application/json",
                    "title": "Portolan collection metadata",
                }
            ],
            "providers": [provider],
            "hifld_latest_alias": False,
        }
        resources[collection_id] = definition
        if record.is_latest:
            alias = "~".join((record.collection_slug, record.dataset_slug, record.file_slug))
            resources[alias] = {
                **definition,
                "title": f"{layer_title} (latest: {record.version_label})",
                "hifld_latest_alias": True,
            }
    return ProjectedResources(generation=repository.generation, resources=resources)
