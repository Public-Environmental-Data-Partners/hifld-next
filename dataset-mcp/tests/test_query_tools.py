import pytest

from app.tools.query import get_query_page, query_geoparquet


class Service:
    validated = False
    paged = False

    def validate_sql(self, sql: str, aliases: tuple[str, ...]) -> None:
        self.validated = True

    async def query(
        self,
        sources: list[dict[str, object]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> dict[str, object]:
        assert self.validated
        return {
            "rows": [],
            "query_token": "signed",
            "resolved_sources": [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ],
        }

    def validate_token(self, token: str) -> dict[str, object]:
        assert token == "signed"
        return {}

    async def page(self, token: str, offset: int, limit: int) -> dict[str, object]:
        self.paged = True
        return {
            "rows": [],
            "offset": offset,
            "resolved_sources": [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ],
        }


@pytest.mark.asyncio
async def test_query_returns_initial_page_and_later_page_revalidates() -> None:
    service = Service()
    result = await query_geoparquet(service, [{"alias": "roads"}], "SELECT * FROM roads")
    assert result.structured_content["query_token"] == "signed"
    assert "resolved_sources" not in result.structured_content
    assert "secret-bucket" not in str(result.structured_content)
    page = await get_query_page(service, "signed", 100)
    assert page.structured_content["offset"] == 100
    assert "resolved_sources" not in page.structured_content
    assert "secret-bucket" not in str(page.structured_content)
    assert service.paged
