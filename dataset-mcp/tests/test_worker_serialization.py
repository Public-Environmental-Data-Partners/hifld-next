from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

import pytest

from app.query.serialization import RowTooLargeError, encode_cell, serialize_rows


def test_encode_cell_preserves_json_values_and_types_special_values() -> None:
    assert encode_cell(None, "VARCHAR") is None
    assert encode_cell(True, "BOOLEAN") is True
    assert encode_cell(42, "INTEGER") == 42
    assert encode_cell(1 << 53, "BIGINT") == str(1 << 53)
    assert encode_cell(Decimal("1.2300"), "DECIMAL(8,4)") == "1.2300"
    assert encode_cell(date(2026, 8, 29), "DATE") == "2026-08-29"
    assert encode_cell(time(12, 30, 1), "TIME") == "12:30:01"
    assert encode_cell(datetime(2026, 8, 29, tzinfo=UTC), "TIMESTAMP") == (
        "2026-08-29T00:00:00+00:00"
    )
    assert encode_cell(timedelta(days=1, seconds=2), "INTERVAL") == "1 day, 0:00:02"
    assert encode_cell(UUID("12345678-1234-5678-1234-567812345678"), "UUID") == (
        "12345678-1234-5678-1234-567812345678"
    )


def test_encode_cell_recurses_and_summarizes_binary_values() -> None:
    assert encode_cell([1, {"nested": Decimal("2.5")}], "STRUCT") == [
        1,
        {"nested": "2.5"},
    ]
    assert encode_cell(b"abc", "BLOB") == {
        "$type": "binary",
        "byte_length": 3,
    }
    assert encode_cell(b"wkb", "GEOMETRY") == {
        "$type": "geometry",
        "byte_length": 3,
    }


def test_encode_cell_replaces_oversized_values_with_truncated_summary() -> None:
    assert encode_cell("abcdefgh", "VARCHAR", max_cell_bytes=7) == {
        "$type": "truncated",
        "byte_length": 8,
    }


def test_serialize_rows_stops_before_result_cap_without_skipping_row() -> None:
    rows = [(1, "a" * 20), (2, "b" * 20), (3, "c" * 20)]

    first_row_bytes = len(b'{"id":1,"value":"aaaaaaaaaaaaaaaaaaaa"}')
    page = serialize_rows(
        columns=(("id", "INTEGER"), ("value", "VARCHAR")),
        rows=rows,
        offset=10,
        requested_limit=2,
        deterministic_order=False,
        max_result_bytes=first_row_bytes,
    )

    assert page.rows == ({"id": 1, "value": "a" * 20},)
    assert page.returned == 1
    assert page.response_truncated is True
    assert page.has_more is True
    assert page.next_offset == 11
    assert page.deterministic_order is False


def test_serialize_rows_uses_extra_row_only_to_compute_has_more() -> None:
    page = serialize_rows(
        columns=(("id", "INTEGER"),),
        rows=[(1,), (2,), (3,)],
        offset=20,
        requested_limit=2,
        deterministic_order=True,
    )

    assert page.rows == ({"id": 1}, {"id": 2})
    assert page.returned == 2
    assert page.has_more is True
    assert page.next_offset == 22
    assert page.response_truncated is False


def test_serialize_rows_omits_next_offset_at_end() -> None:
    page = serialize_rows(
        columns=(("id", "INTEGER"),),
        rows=[(1,)],
        offset=0,
        requested_limit=10,
        deterministic_order=True,
    )

    assert page.has_more is False
    assert page.next_offset is None


def test_serialize_rows_rejects_row_that_cannot_fit_result_cap() -> None:
    with pytest.raises(RowTooLargeError):
        serialize_rows(
            columns=(("value", "VARCHAR"),),
            rows=[("x" * 100,)],
            offset=4,
            requested_limit=1,
            deterministic_order=False,
            max_result_bytes=1,
        )


def test_serialize_rows_consumes_lazily_after_response_budget() -> None:
    fetched = 0

    def rows():
        nonlocal fetched
        for value in (1, 2, 3, 4):
            fetched += 1
            yield (value,)

    first_row_bytes = len(b'{"value":1}')
    page = serialize_rows(
        columns=(("value", "INTEGER"),),
        rows=rows(),
        offset=0,
        requested_limit=3,
        deterministic_order=False,
        max_result_bytes=first_row_bytes,
    )

    assert page.rows == (({"value": 1}),)
    assert fetched == 2
