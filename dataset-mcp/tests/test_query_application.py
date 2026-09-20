import json

import pytest

from app.catalog.client import CatalogClientError
from app.catalog.models import BucketStorageConfig, QuerySourceRef
from app.errors import AppError, ErrorCode
from app.query.application import QueryApplicationService
from app.query.models import JsonValue, ResolvedSource
from app.query.service import QueryService
from app.query.tile_cache import TileCache
from app.query.token_codec import QueryTokenCodec
from app.storage.resolver import StorageResolver
from app.tools.query import generate_mvt_tile_url
from query_worker.protocol import (
    WorkerBounds,
    WorkerBoundsQuery,
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerTile,
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


class EmptyPageExecutor(Executor):
    response_truncated = False

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
            rows=(),
            offset=request.offset,
            returned_count=0,
            has_more=False,
            next_offset=None,
            elapsed_ms=1,
            bytes_read=0,
            files_read=1,
            response_truncated=self.response_truncated,
            deterministic_order=True,
        )


class TruncatedEmptyPageExecutor(EmptyPageExecutor):
    response_truncated = True


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


class TileExecutor(Executor):
    async def execute(
        self,
        request: WorkerQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        if isinstance(request, WorkerTileQuery):
            del timeout_seconds
            self.calls.append(request)
            return WorkerTile(content=b"tile", elapsed_ms=1, bytes_read=2, files_read=1)
        return await super().execute(request, timeout_seconds=timeout_seconds)


def _source(alias: str = "roads") -> dict[str, JsonValue]:
    return QuerySourceRef(
        alias=alias,
        collection_slug="hifld",
        dataset_slug="roads",
        file_slug="roads",
        version="v1.0.0",
        asset_key="geoparquet",
    ).model_dump()


def _service(
    resolver: Resolver,
    executor: Executor,
    *,
    tile_cache: TileCache | None = None,
) -> QueryApplicationService:
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
        tile_cache=tile_cache,
    )


@pytest.mark.asyncio
async def test_query_result_status_distinguishes_empty_results_from_empty_pages() -> None:
    rows_service = _service(Resolver(), Executor())
    rows = await rows_service.query((_source(),), "SELECT id FROM roads", 1, None, None)
    assert rows["result_status"] == "rows_returned"

    empty_service = _service(Resolver(), EmptyPageExecutor())
    initial = await empty_service.query((_source(),), "SELECT id FROM roads", 1, None, None)
    assert initial["result_status"] == "empty_result"
    token = initial["query_token"]
    assert isinstance(token, str)
    later = await empty_service.page(token, 1, 1)
    assert later["result_status"] == "empty_page"

    truncated_service = _service(Resolver(), TruncatedEmptyPageExecutor())
    truncated = await truncated_service.query((_source(),), "SELECT id FROM roads", 1, None, None)
    assert truncated["result_status"] == "indeterminate"


@pytest.mark.parametrize("expired", [False, True])
def test_token_error_distinguishes_expiration_from_invalid_signature(expired):
    from datetime import UTC, datetime, timedelta

    from app.query.models import QueryTokenPayload

    codec = QueryTokenCodec(b"a-production-test-secret-at-least-32-bytes")
    now = datetime.now(UTC)
    token = (
        codec.encode(
            QueryTokenPayload(
                canonical_sql="SELECT id FROM roads",
                sources=(QuerySourceRef.model_validate(_source()),),
                issued_at=now - timedelta(hours=1),
                expires_at=now - timedelta(seconds=1),
            )
        )
        if expired
        else "invalid-token"
    )
    service = _service(Resolver(), Executor())
    with pytest.raises(AppError) as failure:
        service.validate_token(token)
    message = str(failure.value)
    assert "invalid or expired" not in message
    assert ("expired" in message.lower()) == expired


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
        "worker_url": "https://mcp.example.test/base/assets/maplibre-gl-worker.cjs",
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
    request = service._worker_executor.calls[0]
    assert isinstance(request, WorkerQuery)
    assert request.working_crs is None


@pytest.mark.asyncio
async def test_spatial_query_defaults_working_crs_and_preserves_it_for_pages() -> None:
    executor = Executor()
    service = _service(ProjectedResolver(), executor)

    result = await service.prepare_spatial_query(
        (_source(),), "SELECT geometry FROM roads", 1, None, None
    )
    token = result["query_token"]
    assert isinstance(token, str)
    await service.page(token, 1, 1)

    requests = [request for request in executor.calls if isinstance(request, WorkerQuery)]
    assert [request.working_crs for request in requests] == ["EPSG:4326", "EPSG:4326"]
    assert [request.materialize_geometry for request in requests] == [False, True]
    assert result["map_configuration"]["result_crs"] == "EPSG:4326"


@pytest.mark.asyncio
async def test_explicit_query_result_crs_normalizes_before_sql() -> None:
    executor = Executor()
    service = _service(Resolver(), executor)

    await service.query((_source(),), "SELECT geometry FROM roads", 1, None, "EPSG:3857")

    request = executor.calls[0]
    assert isinstance(request, WorkerQuery)
    assert request.working_crs == "EPSG:3857"


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
        "worker_url": "https://mcp.example.test/base/assets/maplibre-gl-worker.cjs",
        "source_layer": "hifld",
        "geometry_column": "geometry",
        "result_crs": "EPSG:3857",
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
@pytest.mark.parametrize(
    "executor, sql, geometry_column, expected",
    [
        (NonSpatialExecutor(), "SELECT id FROM roads", None, ErrorCode.GEOMETRY_AMBIGUOUS),
        (Executor(), "SELECT geometry FROM roads", "missing", ErrorCode.MAP_NOT_SUPPORTED),
    ],
)
async def test_tile_url_tool_requires_selected_geometry_and_known_crs(
    executor: Executor,
    sql: str,
    geometry_column: str | None,
    expected: ErrorCode,
) -> None:
    service = _service(Resolver(), executor)
    with pytest.raises(AppError) as caught:
        await generate_mvt_tile_url(service, [_source()], sql, geometry_column=geometry_column)
    assert caught.value.code is expected


@pytest.mark.asyncio
async def test_tile_url_tool_reuses_full_signed_query_and_sandbox_safe_route() -> None:
    executor = CrsTypedGeometryExecutor()
    service = _service(Resolver(), executor)
    sql = "SELECT geometry FROM roads"
    result = await generate_mvt_tile_url(service, [_source()], sql)
    headers = result.structured_content["headers"]
    assert isinstance(headers, dict)
    token = headers["X-HIFLD-Query-Token"]
    assert isinstance(token, str)
    payload = service._decode_token(token)
    assert payload.canonical_sql == sql
    assert result.structured_content["result_crs"] == "EPSG:4326"
    assert result.structured_content["tile_url"] == (
        f"https://mcp.example.test/base/tiles/{payload.query_id}/{{z}}/{{x}}/{{y}}.mvt"
    )
    assert len(executor.calls) == 1
    assert isinstance(executor.calls[0], WorkerQuery)
    assert executor.calls[0].limit == 1


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


@pytest.mark.asyncio
async def test_render_tile_caches_by_resolved_source_identity_not_query_id() -> None:
    resolver = Resolver()
    executor = TileExecutor()
    service = _service(resolver, executor, tile_cache=TileCache(max_bytes=10_000, ttl_seconds=60))
    initial = await service.query(
        (_source(),), "SELECT id, geometry FROM roads ORDER BY id", 1, None, None
    )
    token = initial["query_token"]
    assert isinstance(token, str)
    repeated = await service.query(
        (_source(),), "SELECT id, geometry FROM roads ORDER BY id", 1, None, None
    )
    repeated_token = repeated["query_token"]
    assert isinstance(repeated_token, str)
    assert repeated["query_id"] != initial["query_id"]

    assert await service.render_tile(token, 0, 0, 0, timeout_seconds=5) == WorkerTile(
        content=b"tile", elapsed_ms=1, bytes_read=2, files_read=1
    )
    assert await service.render_tile(repeated_token, 0, 0, 0, timeout_seconds=5) == WorkerTile(
        content=b"tile", elapsed_ms=1, bytes_read=2, files_read=1
    )
    assert len([call for call in executor.calls if isinstance(call, WorkerTileQuery)]) == 1


@pytest.mark.asyncio
async def test_render_tile_revalidates_sources_before_a_cache_hit() -> None:
    resolver = Resolver()
    executor = TileExecutor()
    service = _service(resolver, executor, tile_cache=TileCache(max_bytes=10_000, ttl_seconds=60))
    initial = await service.query(
        (_source(),), "SELECT id, geometry FROM roads ORDER BY id", 1, None, None
    )
    token = initial["query_token"]
    assert isinstance(token, str)
    await service.render_tile(token, 0, 0, 0, timeout_seconds=5)
    resolver.changed = True

    with pytest.raises(AppError) as caught:
        await service.render_tile(token, 0, 0, 0, timeout_seconds=5)
    assert caught.value.code is ErrorCode.SOURCE_CHANGED
    assert len([call for call in executor.calls if isinstance(call, WorkerTileQuery)]) == 1
