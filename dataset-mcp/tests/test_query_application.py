import json

import pytest

from app.catalog.client import CatalogClientError
from app.catalog.models import BucketStorageConfig, QuerySourceRef
from app.errors import AppError, ErrorCode
from app.query.application import QueryApplicationService
from app.query.models import JsonValue, ResolvedSource
from app.query.service import QueryService
from app.query.token_codec import QueryTokenCodec
from app.storage.resolver import StorageResolver
from query_worker.protocol import (
    WorkerBounds,
    WorkerBoundsQuery,
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
            storage_config=BucketStorageConfig(
                type="gcs",
                base_url="https://storage.googleapis.com/datasets",
                bucket="datasets",
            ),
            object_uris=("gs://datasets/roads.parquet",),
            bbox=(-80.0, 35.0, -79.0, 36.0),
            crs="EPSG:4326",
        )


class ProjectedResolver(Resolver):
    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource:
        resolved = await super().resolve(ref)
        return resolved.model_copy(update={"bbox": None, "crs": "EPSG:3857"})


class Executor:
    calls: list[WorkerQuery | WorkerBoundsQuery | WorkerTileQuery]

    def __init__(self) -> None:
        self.calls = []

    async def execute(
        self,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        del timeout_seconds
        self.calls.append(request)
        if isinstance(request, WorkerBoundsQuery):
            return WorkerBounds(bounds=(-122.4, 37.0, -121.4, 37.8))
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


class CrsTypedGeometryExecutor(Executor):
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
        return WorkerPage(
            columns=(("geometry", "GEOMETRY('EPSG:3857')", True),),
            rows=({"geometry": {"tag": "geometry"}},),
            offset=request.offset,
            returned_count=1,
            has_more=False,
            next_offset=None,
            elapsed_ms=1,
            bytes_read=0,
            files_read=1,
            deterministic_order=True,
        )


class NonSpatialExecutor(Executor):
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
        return WorkerPage(
            columns=(("id", "INTEGER", False),),
            rows=({"id": 1},),
            offset=request.offset,
            returned_count=1,
            has_more=False,
            next_offset=None,
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
    storage = StorageResolver()
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
async def test_query_bounds_frames_a_projected_result_without_source_bounds() -> None:
    executor = Executor()
    service = _service(ProjectedResolver(), executor)
    result = await service.query(
        (_source(),),
        "SELECT ST_Transform(geometry, 'EPSG:3857', 'EPSG:4326') AS geometry FROM roads",
        100,
        "geometry",
        "EPSG:4326",
    )

    map_configuration = result["map_configuration"]
    assert isinstance(map_configuration, dict)
    assert "initial_bounds" not in map_configuration
    token = result["query_token"]
    assert isinstance(token, str)
    bounds = await service.bounds(token)

    assert bounds == {"bounds": [-122.4, 37.0, -121.4, 37.8]}
    request = executor.calls[-1]
    assert isinstance(request, WorkerBoundsQuery)
    assert request.geometry_column == "geometry"
    assert request.result_crs == "EPSG:4326"


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
async def test_query_uses_crs_declared_by_the_result_geometry_type() -> None:
    service = _service(Resolver(), CrsTypedGeometryExecutor())

    result = await service.query(
        (_source(),),
        "SELECT geometry FROM roads",
        1,
        None,
        None,
    )

    query_id = result["query_id"]
    assert result["map_configuration"] == {
        "tile_url": (
            f"https://mcp.example.test/base/api/queries/{query_id}/tiles/{{z}}/{{x}}/{{y}}.mvt"
        ),
        "worker_url": "https://mcp.example.test/base/assets/maplibre-gl-worker.mjs",
        "source_layer": "hifld",
        "geometry_column": "geometry",
        "result_crs": "EPSG:3857",
        "initial_bounds": [-80.0, 35.0, -79.0, 36.0],
    }

    map_result = await service.map_configuration(result["query_token"])
    assert map_result == {
        "query_token": result["query_token"],
        "query_id": query_id,
        "map_configuration": {
            **result["map_configuration"],
            "tile_url": (f"https://mcp.example.test/base/tiles/{query_id}/{{z}}/{{x}}/{{y}}.mvt"),
        },
    }


@pytest.mark.asyncio
async def test_map_configuration_rejects_a_non_spatial_query_token() -> None:
    service = _service(Resolver(), NonSpatialExecutor())
    result = await service.query(
        (_source(),),
        "SELECT id FROM roads",
        1,
        None,
        None,
    )

    with pytest.raises(AppError) as caught:
        await service.map_configuration(result["query_token"])

    assert caught.value.code is ErrorCode.GEOMETRY_AMBIGUOUS


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
