from __future__ import annotations

import secrets
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.catalog.models import QuerySourceRef

type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
EncodedRow = dict[str, JsonValue]


class QueryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadRowsRequest(QueryModel):
    source: QuerySourceRef
    columns: list[str] | None = None
    limit: int = Field(default=100, ge=1)
    offset: int = Field(default=0, ge=0)


class QueryRequest(QueryModel):
    sources: list[QuerySourceRef] = Field(min_length=1, max_length=8)
    sql: str = Field(min_length=1)
    limit: int = Field(default=100, ge=1)
    geometry_column: str | None = None
    result_crs: str | None = None


class QueryPageRequest(QueryModel):
    query_token: str
    offset: int = Field(ge=0)
    page_size: int = Field(default=100, ge=1)


class ResolvedSource(QueryModel):
    source: QuerySourceRef
    version: str
    format_type: str
    storage_location_slug: str
    object_uris: tuple[str, ...] = Field(min_length=1)
    bbox: tuple[float, float, float, float] | None = None
    crs: str | None = None


class ColumnResult(QueryModel):
    name: str
    logical_type: str
    nullable: bool


class PageResult(QueryModel):
    columns: list[ColumnResult]
    rows: list[EncodedRow]
    offset: int
    returned_count: int
    has_more: bool
    next_offset: int | None = None
    warnings: tuple[str, ...] = ()
    elapsed_ms: float
    bytes_read: int
    files_read: int
    response_truncated: bool = False
    deterministic_order: bool = False


class QueryResult(QueryModel):
    page: PageResult
    query_token: str
    query_id: str = Field(pattern=r"^[A-Za-z0-9_-]{20,64}$")
    map_configuration: dict[str, JsonValue] | None = None


class QueryTokenPayload(QueryModel):
    token_version: int = 1
    canonical_sql: str
    sources: tuple[QuerySourceRef, ...] = Field(min_length=1, max_length=8)
    geometry_column: str | None = None
    result_crs: str | None = None
    query_id: str = Field(
        default_factory=lambda: secrets.token_urlsafe(18),
        pattern=r"^[A-Za-z0-9_-]{20,64}$",
    )
    issued_at: datetime
    expires_at: datetime
