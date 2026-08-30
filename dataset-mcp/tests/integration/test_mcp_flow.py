"""End-to-end acceptance flow using a local Parquet object and in-memory service state."""

from collections.abc import Sequence
from pathlib import Path

import duckdb
import pytest

from app.catalog.models import QuerySourceRef
from app.query.sql_policy import SqlPolicy
from app.tools.query import get_query_page, query_geoparquet


class LocalQueryService:
    def __init__(self, parquet: Path) -> None:
        self.parquet = parquet
        self.pages: dict[str, tuple[dict[str, int | str], ...]] = {}
        self.persisted_results = False

    def validate_sql(self, sql: str, aliases: Sequence[str]) -> None:
        SqlPolicy.validate(sql, frozenset(aliases))

    def validate_token(self, token: str) -> dict[str, str]:
        if token != "local-token" or token not in self.pages:
            raise ValueError("invalid query token")
        return {"query_token": token}

    async def query(
        self,
        sources: Sequence[dict[str, object]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> dict[str, object]:
        del geometry_column, result_crs
        source = next(iter(sources))
        alias = str(source["alias"])
        rows = tuple(
            {"id": int(row[0]), "name": str(row[1])}
            for row in duckdb.connect()
            .execute(
                "SELECT id, name FROM read_parquet(?) ORDER BY id",
                [str(self.parquet)],
            )
            .fetchall()
        )
        assert alias == "roads"
        self.pages["local-token"] = rows
        return {
            "rows": list(rows[:limit]),
            "query_token": "local-token",
            "source_alias": alias,
            "persisted": self.persisted_results,
        }

    async def page(self, token: str, offset: int, limit: int) -> dict[str, object]:
        rows = self.pages[token][offset : offset + limit]
        return {
            "rows": list(rows),
            "offset": offset,
            "has_more": offset + len(rows) < len(self.pages[token]),
        }

    async def read_rows(
        self, source: dict[str, object], columns: Sequence[str], limit: int, offset: int
    ) -> dict[str, object]:
        del source, columns, limit, offset
        raise NotImplementedError


@pytest.mark.asyncio
async def test_metadata_source_query_and_next_page_use_only_ephemeral_result_state(
    tmp_path: Path,
) -> None:
    parquet = tmp_path / "roads.parquet"
    connection = duckdb.connect()
    connection.execute(
        "COPY (SELECT * FROM (VALUES (1, 'A'), (2, 'B'), (3, 'C')) t(id, name)) "
        "TO ? (FORMAT PARQUET)",
        [str(parquet)],
    )

    # Metadata -> selected source identity is deliberately catalog-shaped, not a file path.
    metadata_source = QuerySourceRef(
        alias="roads", collection_id=1, dataset_id=2, file_id=3, file_source_id=4
    )
    service = LocalQueryService(parquet)
    initial = await query_geoparquet(
        service,
        [metadata_source.model_dump()],
        "SELECT id, name FROM roads ORDER BY id",
        limit=2,
    )
    assert initial.structured_content["source_alias"] == "roads"
    assert initial.structured_content["rows"] == [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]
    assert initial.structured_content["persisted"] is False

    next_page = await get_query_page(service, "local-token", offset=2, page_size=2)
    assert next_page.structured_content == {
        "rows": [{"id": 3, "name": "C"}],
        "offset": 2,
        "has_more": False,
    }
    assert service.persisted_results is False
