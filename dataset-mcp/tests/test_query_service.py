from datetime import UTC, datetime, timedelta

import pytest

from app.catalog.models import QuerySourceRef
from app.errors import AppError, ErrorCode
from app.query.models import ResolvedSource
from app.query.service import ExecutionSource, QueryService, worker_profiles_from_storage
from app.query.sql_policy import ValidatedSql
from app.storage.models import DuckDbSourceSpec, SeaweedProfile, StorageSettings
from query_worker.protocol import WorkerFailure, WorkerPage, WorkerQuery


class Executor:
    def __init__(self, result: WorkerPage | WorkerFailure) -> None:
        self.result = result
        self.request: WorkerQuery | None = None
        self.timeout: float | None = None

    async def execute(
        self, request: WorkerQuery, *, timeout_seconds: float | None = None
    ) -> WorkerPage | WorkerFailure:
        self.request = request
        self.timeout = timeout_seconds
        return self.result


def _source() -> ExecutionSource:
    resolved = ResolvedSource(
        source=QuerySourceRef(
            alias="roads",
            collection_id=1,
            dataset_id=2,
            file_id=3,
            file_source_id=4,
        ),
        version="v1",
        format_type="geoparquet",
        storage_location_slug="public-gcs",
        object_uris=("gs://datasets/roads.parquet",),
    )
    return ExecutionSource(
        resolved=resolved,
        duckdb=DuckDbSourceSpec(
            object_uris=("https://storage.googleapis.com/datasets/roads.parquet",)
        ),
    )


@pytest.mark.asyncio
async def test_service_dispatches_typed_worker_request_and_builds_page_result() -> None:
    executor = Executor(
        WorkerPage(
            columns=(("id", "BIGINT", False),),
            rows=({"id": 1}, {"id": 2}),
            offset=5,
            returned_count=2,
            has_more=True,
            next_offset=7,
            response_truncated=False,
            deterministic_order=False,
            elapsed_ms=12.5,
            bytes_read=1024,
            files_read=1,
        )
    )
    service = QueryService(
        executor,
        max_limit=1_000,
        max_offset=50_000,
        timeout_seconds=30,
        max_result_bytes=4 * 1024 * 1024,
    )

    page = await service.execute_page(
        validated_sql=ValidatedSql(canonical_sql="SELECT * FROM roads", deterministic_order=False),
        sources=(_source(),),
        limit=2,
        offset=5,
    )

    assert executor.request is not None
    assert executor.request.canonical_sql == "SELECT * FROM roads"
    assert executor.request.sources[0].alias == "roads"
    assert executor.request.sources[0].object_uris == (
        "https://storage.googleapis.com/datasets/roads.parquet",
    )
    assert executor.request.limit == 2
    assert executor.request.offset == 5
    assert executor.request.deadline <= datetime.now(tz=UTC) + timedelta(seconds=31)
    assert executor.timeout == 30
    assert page.returned_count == 2
    assert page.next_offset == 7
    assert page.warnings == ("result_order_is_not_deterministic",)
    assert page.model_dump()["rows"] == [{"id": 1}, {"id": 2}]
    assert "total" not in page.model_dump()


@pytest.mark.asyncio
async def test_service_surfaces_response_truncation_warning() -> None:
    executor = Executor(
        WorkerPage(
            columns=(("id", "INTEGER", True),),
            rows=({"id": 1},),
            offset=0,
            returned_count=1,
            has_more=True,
            next_offset=1,
            response_truncated=True,
            deterministic_order=True,
            elapsed_ms=1,
            bytes_read=0,
            files_read=1,
        )
    )
    service = QueryService(executor)

    page = await service.execute_page(
        validated_sql=ValidatedSql(
            canonical_sql="SELECT * FROM roads ORDER BY id", deterministic_order=True
        ),
        sources=(_source(),),
        limit=100,
        offset=0,
    )

    assert page.response_truncated is True
    assert page.warnings == ("response_size_limit_reached",)


@pytest.mark.asyncio
async def test_service_maps_worker_failure_to_safe_app_error() -> None:
    service = QueryService(
        Executor(
            WorkerFailure(
                code="query_timeout",
                message="The query exceeded its execution timeout",
            )
        )
    )

    with pytest.raises(AppError) as caught:
        await service.execute_page(
            validated_sql=ValidatedSql(
                canonical_sql="SELECT * FROM roads", deterministic_order=False
            ),
            sources=(_source(),),
            limit=100,
            offset=0,
        )

    assert caught.value.code is ErrorCode.QUERY_TIMEOUT
    assert "execution timeout" in caught.value.message


@pytest.mark.asyncio
async def test_service_rejects_limit_and_offset_before_dispatch() -> None:
    executor = Executor(WorkerFailure(code="unused", message="must not be returned"))
    service = QueryService(executor, max_limit=1_000, max_offset=50_000)

    with pytest.raises(ValueError, match="limit"):
        await service.execute_page(
            validated_sql=ValidatedSql(canonical_sql="SELECT 1", deterministic_order=True),
            sources=(),
            limit=1_001,
            offset=0,
        )
    with pytest.raises(AppError) as caught:
        await service.execute_page(
            validated_sql=ValidatedSql(canonical_sql="SELECT 1", deterministic_order=True),
            sources=(),
            limit=1,
            offset=50_001,
        )

    assert caught.value.code is ErrorCode.QUERY_OFFSET_LIMIT
    assert executor.request is None


def test_worker_profile_strips_http_scheme_from_duckdb_endpoint() -> None:
    settings = StorageSettings(
        profiles={
            "local-seaweed": SeaweedProfile(
                slug="local-seaweed",
                bucket="datasets",
                endpoint="http://seaweed-s3:8333",
                access_key_id="access",
                secret_access_key="secret",
            )
        }
    )

    (profile,) = worker_profiles_from_storage(settings)

    assert profile.endpoint == "seaweed-s3:8333"
