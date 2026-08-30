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
    WorkerMapQuery,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerTileQuery,
)


class Resolver:
    changed = False

    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource:
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
    calls: list[WorkerQuery | WorkerTileQuery | WorkerMapQuery]

    def __init__(self) -> None:
        self.calls = []

    async def execute(
        self,
        request: WorkerQuery | WorkerTileQuery | WorkerMapQuery,
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
async def test_query_infers_map_contract_and_preserves_token_across_three_pages() -> None:
    resolver = Resolver()
    executor = Executor()
    service = _service(resolver, executor)

    first = await service.query(
        (_source(),),
        "SELECT id, geometry FROM roads ORDER BY id",
        1,
        None,
        None,
    )
    token = first["query_token"]
    assert isinstance(token, str)
    assert first["map_configuration"] == {
        "tile_url": "https://mcp.example.test/base/tiles/{z}/{x}/{y}.mvt",
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
    assert [request.offset for request in executor.calls if isinstance(request, WorkerQuery)] == [
        0,
        1,
        2,
    ]


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
