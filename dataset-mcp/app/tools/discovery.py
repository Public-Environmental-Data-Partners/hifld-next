"""Pure catalog discovery tool functions.

The functions in this module deliberately know nothing about FastMCP.  The
assembly layer decides how their ``ToolResult`` values are exposed.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type JSONMapping = Mapping[str, JSONValue]


@dataclass(frozen=True)
class ToolResult:
    text: str
    structured_content: JSONMapping


class CatalogClient(Protocol):
    def list_collections(self) -> Awaitable[JSONMapping]: ...
    def get_collection(self, identity: str) -> Awaitable[JSONMapping]: ...
    def search_datasets(self, **filters: JSONValue) -> Awaitable[JSONMapping]: ...
    def get_dataset(self, collection: str, identity: str) -> Awaitable[JSONMapping]: ...
    def get_dataset_file(
        self, collection: str, dataset: str, identity: str
    ) -> Awaitable[JSONMapping]: ...
    def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> Awaitable[JSONMapping]: ...


def _result(label: str, payload: JSONMapping) -> ToolResult:
    text_payload = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
    return ToolResult(text=f"{label}:\n{text_payload}", structured_content=payload)


def _strip_columns(value: JSONValue) -> JSONValue:
    if isinstance(value, list):
        return [_strip_columns(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip_columns(item) for key, item in value.items() if key != "columns"}
    return value


async def list_collections(client: CatalogClient) -> ToolResult:
    return _result("Collections", await client.list_collections())


async def get_collection(client: CatalogClient, identity: str) -> ToolResult:
    return _result("Collection", await client.get_collection(identity))


async def search_datasets(
    client: CatalogClient,
    *,
    search: str | None = None,
    collection: str | None = None,
    tags: Sequence[str] = (),
    limit: int = 100,
    offset: int = 0,
) -> ToolResult:
    if not 1 <= limit <= 1_000:
        raise ValueError("limit must be between 1 and 1000")
    if offset < 0:
        raise ValueError("offset must be non-negative")
    payload = await client.search_datasets(
        search=search, collection=collection, tags=list(tags), limit=limit, offset=offset
    )
    return _result("Datasets", payload)


async def get_dataset(client: CatalogClient, collection: str, identity: str) -> ToolResult:
    return _result("Dataset", await client.get_dataset(collection, identity))


async def get_dataset_file(
    client: CatalogClient, collection: str, dataset: str, identity: str
) -> ToolResult:
    payload = _strip_columns(dict(await client.get_dataset_file(collection, dataset, identity)))
    # Inline source column dictionaries are intentionally only available from
    # the focused schema tool; recursively strip them from nested file/format
    # response shapes while retaining counts and hashes from the catalog.
    if not isinstance(payload, dict):
        raise TypeError("catalog file response must be a JSON object")
    return _result("Dataset file", payload)


async def get_dataset_file_schema(
    client: CatalogClient,
    collection: str,
    dataset: str,
    identity: str,
    *,
    version: str | None = None,
    column_offset: int = 0,
    column_limit: int = 100,
) -> ToolResult:
    if column_offset < 0:
        raise ValueError("column_offset must be non-negative")
    if not 1 <= column_limit <= 500:
        raise ValueError("column_limit must be between 1 and 500")
    payload = dict(await client.get_dataset_file_schema(collection, dataset, identity, version))
    if version is not None:
        advertised = payload.get("available_versions")
        if isinstance(advertised, list) and version not in advertised:
            raise ValueError("schema_version_not_found")
    raw_columns = payload.get("columns")
    if not isinstance(raw_columns, list):
        raise TypeError("catalog schema columns must be a list")
    columns: list[JSONValue] = list(raw_columns)
    page = columns[column_offset : column_offset + column_limit]
    payload["columns"] = page
    payload["total"] = len(columns)
    payload["offset"] = column_offset
    payload["limit"] = column_limit
    payload["has_more"] = column_offset + len(page) < len(columns)
    return _result("File schema", payload)
