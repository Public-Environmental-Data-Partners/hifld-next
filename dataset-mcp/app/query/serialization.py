"""Bounded conversion of DuckDB result values to the public JSON contract."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID

from app.query.models import EncodedRow, JsonValue

DEFAULT_MAX_CELL_BYTES = 64 * 1024
DEFAULT_MAX_RESULT_BYTES = 4 * 1024 * 1024
_MAX_SAFE_INTEGER = (1 << 53) - 1


class RowTooLargeError(ValueError):
    """Raised when one encoded row cannot fit in the response budget."""


@dataclass(frozen=True, slots=True)
class SerializedRows:
    rows: tuple[EncodedRow, ...]
    returned: int
    has_more: bool
    next_offset: int | None
    response_truncated: bool
    deterministic_order: bool


def _json_size(value: JsonValue) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _summary(kind: str, byte_length: int) -> dict[str, JsonValue]:
    return {"$type": kind, "byte_length": byte_length}


def _encode_unbounded(value: object, logical_type: str) -> JsonValue:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        if abs(value) > _MAX_SAFE_INTEGER:
            return str(value)
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (timedelta, UUID)):
        return str(value)
    if isinstance(value, memoryview):
        raw = value.tobytes()
        kind = "geometry" if logical_type.upper() == "GEOMETRY" else "binary"
        return _summary(kind, len(raw))
    if isinstance(value, (bytes, bytearray)):
        kind = "geometry" if logical_type.upper() == "GEOMETRY" else "binary"
        return _summary(kind, len(value))
    if isinstance(value, (list, tuple)):
        items = cast(list[object] | tuple[object, ...], value)
        return [_encode_unbounded(item, "") for item in items]
    if isinstance(value, dict):
        struct = cast(dict[object, object], value)
        encoded: dict[str, JsonValue] = {}
        for key, item in struct.items():
            if not isinstance(key, str):
                raise TypeError("DuckDB struct keys must be strings")
            encoded[key] = _encode_unbounded(item, "")
        return encoded
    raise TypeError(f"Unsupported DuckDB value type: {type(value).__name__}")


def encode_cell(
    value: object,
    logical_type: str,
    *,
    max_cell_bytes: int = DEFAULT_MAX_CELL_BYTES,
) -> JsonValue:
    """Encode one value, replacing an oversized cell with a safe summary."""
    if max_cell_bytes < 1:
        raise ValueError("max_cell_bytes must be positive")
    encoded = _encode_unbounded(value, logical_type)
    size = _json_size(encoded)
    if size > max_cell_bytes:
        original_size = len(value.encode("utf-8")) if isinstance(value, str) else size
        return _summary("truncated", original_size)
    return encoded


def serialize_rows(
    *,
    columns: tuple[tuple[str, str], ...],
    rows: Iterable[tuple[object, ...]],
    offset: int,
    requested_limit: int,
    deterministic_order: bool,
    max_cell_bytes: int = DEFAULT_MAX_CELL_BYTES,
    max_result_bytes: int = DEFAULT_MAX_RESULT_BYTES,
) -> SerializedRows:
    """Serialize at most ``requested_limit`` rows within the byte budget.

    The caller fetches ``requested_limit + 1`` rows. The extra row is used only
    to establish whether another page exists. A row rejected by the response
    budget is deliberately not counted in ``next_offset``.
    """
    if requested_limit < 1:
        raise ValueError("requested_limit must be positive")
    if offset < 0:
        raise ValueError("offset must not be negative")
    if max_result_bytes < 1:
        raise ValueError("max_result_bytes must be positive")

    encoded_rows: list[EncodedRow] = []
    used_bytes = 0
    response_truncated = False

    fetched_extra = False
    for row_index, raw_row in enumerate(rows):
        if row_index >= requested_limit:
            fetched_extra = True
            break
        if len(raw_row) != len(columns):
            raise ValueError("DuckDB row width does not match its schema")
        encoded_row: EncodedRow = {}
        for index, (name, logical_type) in enumerate(columns):
            encoded_row[name] = encode_cell(
                raw_row[index], logical_type, max_cell_bytes=max_cell_bytes
            )
        row_bytes = _json_size(encoded_row)
        separator_bytes = 1 if encoded_rows else 0
        if used_bytes + separator_bytes + row_bytes > max_result_bytes:
            if not encoded_rows:
                raise RowTooLargeError("A result row exceeds the response size limit")
            response_truncated = True
            break
        encoded_rows.append(encoded_row)
        used_bytes += separator_bytes + row_bytes

    has_more = response_truncated or fetched_extra
    returned = len(encoded_rows)
    next_offset = offset + returned if has_more else None
    return SerializedRows(
        rows=tuple(encoded_rows),
        returned=returned,
        has_more=has_more,
        next_offset=next_offset,
        response_truncated=response_truncated,
        deterministic_order=deterministic_order,
    )
