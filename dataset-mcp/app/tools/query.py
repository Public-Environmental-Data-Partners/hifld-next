"""Pure, dependency-injected GeoParquet query tool functions."""

from __future__ import annotations

from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type JSONMapping = Mapping[str, JSONValue]


@dataclass(frozen=True)
class ToolResult:
    text: str
    structured_content: JSONMapping
    visibility: tuple[str, str] = ("model", "app")
    resource_uri: str = "ui://hifld/dataset-explorer.html"


class QueryService(Protocol):
    def read_rows(
        self, source: JSONMapping, columns: Sequence[str], limit: int, offset: int
    ) -> Awaitable[JSONMapping]: ...
    def query(
        self,
        sources: Sequence[JSONMapping],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> Awaitable[JSONMapping]: ...
    def page(self, token: str, offset: int, limit: int) -> Awaitable[JSONMapping]: ...
    def validate_sql(self, sql: str, aliases: Sequence[str]) -> None: ...
    def validate_token(self, token: str) -> JSONMapping: ...


def _limit(value: int) -> int:
    if not 1 <= value <= 1_000:
        raise ValueError("limit must be between 1 and 1000")
    return value


def _result(label: str, payload: JSONMapping) -> ToolResult:
    return ToolResult(text=f"{label}: {len(payload)} result fields", structured_content=payload)


async def read_geoparquet_rows(
    service: QueryService,
    source: JSONMapping,
    *,
    columns: Sequence[str] = (),
    limit: int = 100,
    offset: int = 0,
) -> ToolResult:
    if offset < 0:
        raise ValueError("offset must be non-negative")
    payload = await service.read_rows(source, columns, _limit(limit), offset)
    return _result("GeoParquet rows", payload)


async def query_geoparquet(
    service: QueryService,
    sources: Sequence[JSONMapping],
    sql: str,
    *,
    limit: int = 100,
    geometry_column: str | None = None,
    result_crs: str | None = None,
) -> ToolResult:
    if not 1 <= len(sources) <= 8:
        raise ValueError("between 1 and 8 sources are required")
    aliases = tuple(str(source.get("alias", "")) for source in sources)
    if any(not alias for alias in aliases):
        raise ValueError("every source must have an alias")
    service.validate_sql(sql, aliases)
    payload = await service.query(sources, sql, _limit(limit), geometry_column, result_crs)
    return _result("GeoParquet query", payload)


async def get_query_page(
    service: QueryService, query_token: str, offset: int, page_size: int = 100
) -> ToolResult:
    if offset < 0:
        raise ValueError("offset must be non-negative")
    service.validate_token(query_token)
    payload = await service.page(query_token, offset, _limit(page_size))
    return _result("Query page", payload)
