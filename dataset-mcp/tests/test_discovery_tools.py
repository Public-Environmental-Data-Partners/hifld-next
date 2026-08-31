import pytest

from app.tools.discovery import (
    get_dataset_file,
    get_dataset_file_schema,
    search_datasets,
)


class Client:
    async def search_datasets(self, **filters: object) -> dict[str, object]:
        return {"filters": filters}

    async def get_dataset_file(
        self, collection: str, dataset: str, identity: str
    ) -> dict[str, object]:
        return {"sources": [{"id": "s1", "columns": [{"name": "secret"}]}]}

    async def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> dict[str, object]:
        return {"columns": [{"name": str(i)} for i in range(3)], "version": version or "latest"}


class InvalidSchemaClient(Client):
    async def get_dataset_file_schema(
        self, collection: str, dataset: str, identity: str, version: str | None
    ) -> dict[str, object]:
        return {"columns": "invalid", "version": version or "latest"}


@pytest.mark.asyncio
async def test_search_and_schema_are_bounded() -> None:
    result = await search_datasets(Client(), limit=4, offset=2)
    assert result.visibility == ("model", "app")
    assert result.structured_content["filters"]["limit"] == 4  # type: ignore[index]
    schema = await get_dataset_file_schema(Client(), "c", "d", "f", column_offset=1, column_limit=1)
    assert schema.structured_content["columns"] == [{"name": "1"}]
    assert schema.structured_content["has_more"] is True


@pytest.mark.asyncio
async def test_file_detail_omits_inline_columns() -> None:
    result = await get_dataset_file(Client(), "c", "d", "f")
    assert result.structured_content["sources"] == [{"id": "s1"}]


@pytest.mark.asyncio
async def test_schema_rejects_invalid_columns_instead_of_returning_an_empty_page() -> None:
    with pytest.raises(TypeError, match="columns"):
        await get_dataset_file_schema(InvalidSchemaClient(), "c", "d", "f")
