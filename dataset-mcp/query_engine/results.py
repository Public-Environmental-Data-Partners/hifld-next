"""Typed models for ClickHouse JSONCompact responses."""

from pydantic import BaseModel, ConfigDict, Field

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]


class ResultColumn(BaseModel):
    """A column declared in a ClickHouse result envelope."""

    model_config = ConfigDict(extra="forbid", strict=True)

    name: str
    type: str


class ResultStatistics(BaseModel):
    """Bounded execution statistics returned by ClickHouse."""

    model_config = ConfigDict(extra="forbid", strict=True)

    elapsed: float = Field(ge=0)
    rows_read: int = Field(ge=0)
    bytes_read: int = Field(ge=0)


class ClickHouseResult(BaseModel):
    """Validated ClickHouse JSONCompact response envelope."""

    model_config = ConfigDict(extra="forbid", strict=True)

    meta: list[ResultColumn]
    data: list[list[JsonValue]]
    rows: int = Field(ge=0)
    rows_before_limit_at: int | None = None
    rows_before_limit_at_least: int | None = None
    rows_before_aggregation: int | None = None
    statistics: ResultStatistics
