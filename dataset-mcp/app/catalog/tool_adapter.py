"""JSON boundary adapter for the pure discovery tool functions."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Protocol

from pydantic import BaseModel, TypeAdapter

from app.catalog.client import CatalogClient
from app.catalog.models import DatasetSearchRequest
from app.catalog.shaping import shape_file_metadata

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type JSONMapping = Mapping[str, JSONValue]


class DiscoveryCatalog(Protocol):
    """Structural contract consumed by ``app.tools.discovery``."""

    async def list_collections(self) -> JSONMapping: ...

    async def get_collection(self, identity: str) -> JSONMapping: ...

    async def search_datasets(self, **filters: JSONValue) -> JSONMapping: ...

    async def get_dataset(self, collection: str, identity: str) -> JSONMapping: ...

    async def get_dataset_file(
        self, collection: str, dataset: str, identity: str
    ) -> JSONMapping: ...

    async def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> JSONMapping: ...


_json_mapping: TypeAdapter[dict[str, JSONValue]] = TypeAdapter(dict[str, JSONValue])


def _dump_model(model: BaseModel) -> dict[str, JSONValue]:
    """Validate a Pydantic dump as JSON before crossing the tool boundary."""
    # CatalogClient's models are Pydantic objects, but keeping this helper at
    # the boundary prevents untyped model internals from leaking to tools.
    dumped = model.model_dump(mode="json", by_alias=True)
    return _json_mapping.validate_python(dumped)


def _identity(value: JSONValue | None, field: str) -> int | str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{field} must be a collection or dataset identity")
    if isinstance(value, int):
        if value <= 0:
            raise ValueError(f"{field} must be positive")
        return value
    if not value:
        raise ValueError(f"{field} must not be empty")
    if value.isdecimal():
        numeric = int(value)
        if numeric <= 0:
            raise ValueError(f"{field} must be positive")
        return numeric
    return value


def _optional_string(value: JSONValue | None, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value


def _integer(value: JSONValue | None, field: str, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    return value


class CatalogToolAdapter:
    """Adapt typed catalog responses to discovery's JSON mapping contract."""

    def __init__(self, catalog: CatalogClient) -> None:
        self._catalog = catalog

    async def list_collections(self) -> JSONMapping:
        collections = await self._catalog.list_collections()
        items: list[JSONValue] = []
        for collection in collections:
            items.append(_dump_model(collection))
        return {"items": items}

    async def get_collection(self, identity: str) -> JSONMapping:
        return _dump_model(await self._catalog.resolve_collection(_identity(identity, "identity")))

    async def search_datasets(self, **filters: JSONValue) -> JSONMapping:
        request = DatasetSearchRequest(
            collection=_identity(filters.get("collection"), "collection"),
            search=_optional_string(filters.get("search"), "search"),
            tag_filters=_tag_filters(filters.get("tags")),
            limit=_integer(filters.get("limit"), "limit", 100),
            offset=_integer(filters.get("offset"), "offset", 0),
        )
        return _dump_model(await self._catalog.search_datasets(request))

    async def get_dataset(self, collection: str, identity: str) -> JSONMapping:
        return _dump_model(
            await self._catalog.get_dataset(
                _identity(collection, "collection"), _identity(identity, "identity")
            )
        )

    async def get_dataset_file(self, collection: str, dataset: str, identity: str) -> JSONMapping:
        response = await self._catalog.get_dataset_file(
            _identity(collection, "collection"),
            _identity(dataset, "dataset"),
            _identity(identity, "identity"),
        )
        payload = _dump_model(response)
        shaped = shape_file_metadata(response)
        payload["metadata"] = shaped["metadata"]
        query_sources: list[JSONValue] = []
        for source in shaped["query_sources"]:
            query_sources.append(_dump_model(source))
        payload["query_sources"] = query_sources
        return payload

    async def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> JSONMapping:
        response = await self._catalog.get_dataset_file_schema(
            _identity(collection, "collection"),
            _identity(dataset, "dataset"),
            _identity(identity, "identity"),
            version,
        )
        payload = _dump_model(response)
        schema = response.schema_
        columns: list[JSONValue] = []
        if schema is not None:
            for column in schema.columns:
                columns.append(_dump_model(column))
        payload["columns"] = columns
        available_versions: list[JSONValue] = [str(item) for item in response.versions]
        payload["available_versions"] = available_versions
        return payload


def _tag_filters(value: JSONValue | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("tags must be a list of key=value strings")
    tags: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError("tags must be a list of key=value strings")
        tags.append(item)
    filters: dict[str, str | list[str]] = {}
    for tag in tags:
        key, separator, tag_value = tag.partition("=")
        if not separator or not key or not tag_value:
            raise ValueError("tags must use key=value syntax")
        previous = filters.get(key)
        if previous is None:
            filters[key] = tag_value
        elif isinstance(previous, str):
            filters[key] = [previous, tag_value]
        else:
            previous.append(tag_value)
    return json.dumps(filters, separators=(",", ":"), sort_keys=True)
