import json

import pytest

from app.catalog.client import CatalogClientError
from app.catalog.models import QuerySourceRef
from app.errors import AppError, ErrorCode
from app.query.application import QueryApplicationService
from app.query.models import JsonValue, ResolvedSource
from app.query.service import QueryService
from app.query.token_codec import QueryTokenCodec
from app.storage.models import PublicGcsProfile, StorageSettings
from app.storage.resolver import StorageResolver
from query_worker.protocol import (
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerTileQuery,
)


class Resolver:
    changed = False
    failure_code: str | None = None

    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource:
        if self.failure_code is not None:
            raise CatalogClientError(self.failure_code, "catalog failure")
        if self.changed:
            raise CatalogClientError("source_not_found", "source was removed")
        return ResolvedSource(
            source=ref,
            version="v1",
            format_type="geoparquet",
            storage_location_slug="public",
            object_uris=("gs://datasets/roads.parquet",),
            bbox=(-80.0, 35.0, -79.0, 36.0),
            crs="EPSG:4326",
        )


class Executor:
    calls: list[WorkerQuery | WorkerTileQuery]

    def __init__(self) -> None:
        self.calls = []

    async def execute(
        self,
        request: WorkerQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        del timeout_seconds
        self.calls.append(request)
        if not isinstance(request, WorkerQuery):
            return WorkerFailure("unused", "not exercised")
        next_offset = request.offset + request.limit
        return WorkerPage(
            columns=(
                ("id", "INTEGER", False),
                ("geometry", "GEOMETRY", True),
            ),
            rows=({"id": request.offset, "geometry": {"tag": "geometry"}},),
            offset=request.offset,
            returned_count=1,
            has_more=next_offset < 3,
            next_offset=next_offset if next_offset < 3 else None,
            elapsed_ms=1,
            bytes_read=0,
            files_read=1,
            deterministic_order=True,
        )


class UnexpectedTileExecutor(Executor):
    async def execute(
        self,
        request: WorkerQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        if isinstance(request, WorkerTileQuery):
            return WorkerPage(
                columns=(("id", "INTEGER", False),),
                rows=({"id": 1},),
                offset=0,
                returned_count=1,
                has_more=False,
                next_offset=None,
                elapsed_ms=1,
                bytes_read=0,
                files_read=1,
                deterministic_order=True,
            )
        return await super().execute(request, timeout_seconds=timeout_seconds)


def _source(alias: str = "roads") -> dict[str, JsonValue]:
    return QuerySourceRef(
        alias=alias,
        collection_id=1,
        dataset_id=2,
        file_id=3,
        file_source_id=4,
    ).model_dump()


def _service(resolver: Resolver, executor: Executor) -> QueryApplicationService:
    storage = StorageResolver(
        StorageSettings(
            profiles={"public": PublicGcsProfile(slug="public", bucket="datasets", prefix="")}
        )
    )
    return QueryApplicationService(
        source_resolver=resolver,
        storage_resolver=storage,
        query_service=QueryService(executor, timeout_seconds=5),
        worker_executor=executor,
        token_codec=QueryTokenCodec(b"a-production-test-secret-at-least-32-bytes"),
        token_ttl_seconds=7_200,
        tile_timeout_seconds=5,
        public_origin="https://mcp.example.test/base/",
    )


@pytest.mark.asyncio
async def test_query_builds_map_contract_with_explicit_crs_and_preserves_token() -> None:
    resolver = Resolver()
    executor = Executor()
    service = _service(resolver, executor)

    first = await service.query(
        (_source(),),
        "SELECT id, geometry FROM roads ORDER BY id",
        1,
        None,
        "EPSG:4326",
    )
    token = first["query_token"]
    assert isinstance(token, str)
    query_id = first["query_id"]
    assert isinstance(query_id, str)
    assert first["map_configuration"] == {
        "tile_url": (
            f"https://mcp.example.test/base/api/queries/{query_id}/tiles/{{z}}/{{x}}/{{y}}.mvt"
        ),
        "worker_url": "https://mcp.example.test/base/assets/maplibre-gl-worker.mjs",
        "source_layer": "hifld",
        "geometry_column": "geometry",
        "result_crs": "EPSG:4326",
        "initial_bounds": [-80.0, 35.0, -79.0, 36.0],
    }

    second = await service.page(token, 1, 1)
    third = await service.page(token, 2, 1)

    assert second["query_token"] == token
    assert third["query_token"] == token
    assert second["query_id"] == query_id
    assert third["query_id"] == query_id
    service.validate_query_identity(token, query_id)
    with pytest.raises(AppError) as caught:
        service.validate_query_identity(token, "other_query_identity_123")
    assert caught.value.code is ErrorCode.QUERY_TOKEN_INVALID
    assert [request.offset for request in executor.calls if isinstance(request, WorkerQuery)] == [
        0,
        1,
        2,
    ]


@pytest.mark.asyncio
async def test_public_query_payloads_omit_resolved_storage_uris() -> None:
    service = _service(Resolver(), Executor())

    initial = await service.query((_source(),), "SELECT id FROM roads ORDER BY id", 1, None, None)
    token = initial["query_token"]
    assert isinstance(token, str)
    page = await service.page(token, 1, 1)
    serialized = json.dumps({"initial": initial, "page": page})

    assert "resolved_sources" not in initial
    assert "resolved_sources" not in page
    assert "gs://datasets/roads.parquet" not in serialized


@pytest.mark.asyncio
async def test_arbitrary_query_does_not_guess_result_crs_from_its_sources() -> None:
    service = _service(Resolver(), Executor())

    result = await service.query(
        (_source(),),
        "SELECT ST_Transform(geometry, 'EPSG:4326', 'EPSG:3857') AS geometry FROM roads",
        1,
        None,
        None,
    )

    assert "map_configuration" not in result


@pytest.mark.asyncio
async def test_query_rejects_duplicate_aliases_before_execution() -> None:
    resolver = Resolver()
    executor = Executor()
    service = _service(resolver, executor)

    with pytest.raises(ValueError, match="unique"):
        await service.query(
            (_source("roads"), _source("ROADS")),
            "SELECT * FROM roads",
            10,
            None,
            None,
        )

    assert executor.calls == []


@pytest.mark.asyncio
async def test_page_maps_catalog_revalidation_failure_to_source_changed() -> None:
    resolver = Resolver()
    executor = Executor()
    service = _service(resolver, executor)
    initial = await service.query((_source(),), "SELECT id FROM roads", 1, None, None)
    token = initial["query_token"]
    assert isinstance(token, str)
    resolver.changed = True

    with pytest.raises(AppError) as caught:
        await service.page(token, 1, 1)

    assert caught.value.code is ErrorCode.SOURCE_CHANGED


@pytest.mark.asyncio
async def test_page_preserves_catalog_outage_during_token_revalidation() -> None:
    resolver = Resolver()
    executor = Executor()
    service = _service(resolver, executor)
    initial = await service.query((_source(),), "SELECT id FROM roads", 1, None, None)
    token = initial["query_token"]
    assert isinstance(token, str)
    resolver.failure_code = "catalog_unavailable"

    with pytest.raises(AppError) as caught:
        await service.page(token, 1, 1)

    assert caught.value.code is ErrorCode.CATALOG_UNAVAILABLE


@pytest.mark.asyncio
async def test_initial_catalog_outage_is_not_reported_as_not_found() -> None:
    resolver = Resolver()
    resolver.failure_code = "catalog_unavailable"
    service = _service(resolver, Executor())

    with pytest.raises(AppError) as caught:
        await service.query((_source(),), "SELECT id FROM roads", 1, None, None)

    assert caught.value.code is ErrorCode.CATALOG_UNAVAILABLE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("catalog_code", "expected_code"),
    [
        ("source_not_found", ErrorCode.CATALOG_NOT_FOUND),
        ("source_not_queryable", ErrorCode.SOURCE_NOT_GEOPARQUET),
        ("future_catalog_code", ErrorCode.INTERNAL_ERROR),
    ],
)
async def test_initial_source_resolution_preserves_failure_category(
    catalog_code: str, expected_code: ErrorCode
) -> None:
    resolver = Resolver()
    resolver.failure_code = catalog_code
    service = _service(resolver, Executor())

    with pytest.raises(AppError) as caught:
        await service.query((_source(),), "SELECT id FROM roads", 1, None, None)

    assert caught.value.code is expected_code


@pytest.mark.asyncio
async def test_render_tile_reports_unexpected_worker_result_as_protocol_error() -> None:
    resolver = Resolver()
    executor = UnexpectedTileExecutor()
    service = _service(resolver, executor)
    initial = await service.query(
        (_source(),), "SELECT id, geometry FROM roads ORDER BY id", 1, None, None
    )
    token = initial["query_token"]
    assert isinstance(token, str)

    result = await service.render_tile(token, 0, 0, 0, timeout_seconds=5)

    assert result == WorkerFailure(
        "worker_protocol_invalid", "The query worker returned an unexpected result"
    )
