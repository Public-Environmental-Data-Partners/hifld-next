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
        return {"rows": [], "query_token": "signed"}

    def validate_token(self, token: str) -> dict[str, object]:
        assert token == "signed"
        return {}

    async def page(self, token: str, offset: int, limit: int) -> dict[str, object]:
        self.paged = True
        return {"rows": [], "offset": offset}


@pytest.mark.asyncio
async def test_query_returns_initial_page_and_later_page_revalidates() -> None:
    service = Service()
    result = await query_geoparquet(service, [{"alias": "roads"}], "SELECT * FROM roads")
    assert result.structured_content["query_token"] == "signed"
    page = await get_query_page(service, "signed", 100)
    assert page.structured_content["offset"] == 100
    assert service.paged
