from collections.abc import Sequence

import pytest

from app.catalog.client import catalog_request_scope
from app.errors import AppError, ErrorCode
from app.tools.maps import MapLayerInput, QueryMapSourceInput, prepare_map_layer
from app.tools.query import JSONMapping


def test_catalog_request_scope_preserves_app_error() -> None:
    error = AppError(ErrorCode.QUERY_EXECUTION_FAILED, "column missing")

    with pytest.raises(AppError) as raised:
        with catalog_request_scope():
            raise error

    assert raised.value is error
    assert raised.value.code is ErrorCode.QUERY_EXECUTION_FAILED
    assert raised.value.message == "column missing"


@pytest.mark.asyncio
async def test_prepare_map_layer_preserves_query_app_error() -> None:
    class FailingService:
        async def read_rows(
            self, source: JSONMapping, columns: Sequence[str], limit: int, offset: int
        ) -> JSONMapping:
            raise AssertionError("read_rows should not be called")

        async def query(
            self,
            sources: Sequence[JSONMapping],
            sql: str,
            limit: int,
            geometry_column: str | None,
            result_crs: str | None,
        ) -> JSONMapping:
            raise AppError(ErrorCode.QUERY_EXECUTION_FAILED, "column missing")

        async def page(self, token: str, offset: int, limit: int) -> JSONMapping:
            raise AssertionError("page should not be called")

        async def map_configuration(self, token: str) -> JSONMapping:
            raise AssertionError("map_configuration should not be called")

        def validate_sql(self, sql: str, aliases: Sequence[str]) -> None:
            return None

        def validate_token(self, token: str) -> JSONMapping:
            raise AssertionError("validate_token should not be called")

    with pytest.raises(AppError) as raised:
        await prepare_map_layer(
            FailingService(),
            MapLayerInput(
                layer_name="Roads",
                source=QueryMapSourceInput(
                    inputs=[{"alias": "roads"}], sql="SELECT missing FROM roads"
                ),
            ),
        )

    assert raised.value.code is ErrorCode.QUERY_EXECUTION_FAILED
    assert raised.value.message == "column missing"
