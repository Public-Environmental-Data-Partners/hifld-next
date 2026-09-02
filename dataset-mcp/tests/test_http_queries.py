from __future__ import annotations

from collections.abc import Mapping, Sequence

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import AppError, ErrorCode
from app.http.queries import create_query_router
from app.observability import InMemoryMetricSink, InMemoryStructuredLogSink, QueryObservability
from app.query.models import JsonValue
from query_worker.protocol import WorkerFailure, WorkerTile


class QueryService:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.identity_error = False
        self.request_error = False
        self.query_error_code: ErrorCode | None = None
        self.include_resolved_sources = False
        self.tile = WorkerTile(b"mvt", 1.0, 0, 0)

    async def query(
        self,
        sources: Sequence[Mapping[str, JsonValue]],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> Mapping[str, JsonValue]:
        del sources, sql, geometry_column, result_crs
        if self.request_error:
            raise ValueError("internal validation detail")
        if self.query_error_code is not None:
            raise AppError(self.query_error_code, "query rejected")
        self.calls.append(f"query:{limit}")
        response: dict[str, JsonValue] = {
            "query_id": "query_123",
            "query_token": "signed",
            "limit": limit,
        }
        if self.include_resolved_sources:
            response["resolved_sources"] = [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ]
        return response

    def validate_query_identity(self, token: str, query_id: str) -> None:
        self.calls.append(f"validate:{token}:{query_id}")
        if self.identity_error:
            raise AppError(ErrorCode.QUERY_TOKEN_INVALID, "The query token is invalid or expired")

    async def page(self, token: str, offset: int, limit: int) -> Mapping[str, JsonValue]:
        self.calls.append(f"page:{token}:{offset}:{limit}")
        response: dict[str, JsonValue] = {
            "query_id": "query_123",
            "query_token": token,
            "offset": offset,
            "limit": limit,
        }
        if self.include_resolved_sources:
            response["resolved_sources"] = [
                {"object_uris": ["gs://secret-bucket/roads.parquet", "s3://secret/roads.parquet"]}
            ]
        return response

    async def bounds(self, token: str) -> Mapping[str, JsonValue]:
        self.calls.append(f"bounds:{token}")
        return {"bounds": [-122.4, 37.0, -121.4, 37.8]}

    async def render_tile(
        self,
        token: str,
        z: int,
        x: int,
        y: int,
        *,
        timeout_seconds: float,
    ) -> WorkerTile | WorkerFailure:
        self.calls.append(f"tile:{token}:{z}:{x}:{y}:{timeout_seconds}")
        return self.tile


def client(service: QueryService, observability: QueryObservability | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(
        create_query_router(
            service,
            webapp_origins=("https://webapp.example.test", "http://localhost:3000"),
            observability=observability,
        )
    )
    return TestClient(app)


def query_request() -> dict[str, JsonValue]:
    return {
        "sources": [
            {
                "alias": "roads",
                "collection_id": 1,
                "dataset_id": 2,
                "file_id": 3,
                "file_source_id": 4,
            }
        ],
        "sql": "SELECT id FROM roads",
    }


def test_http_query_create_validates_strict_body_and_uses_service() -> None:
    service = QueryService()
    created = client(service).post("/api/queries", json=query_request())

    assert created.status_code == 200
    assert created.json() == {"query_id": "query_123", "query_token": "signed", "limit": 100}
    assert service.calls == ["query:100"]

    malformed = client(service).post("/api/queries", json={**query_request(), "extra": True})
    assert malformed.status_code == 422


def test_http_query_create_maps_service_validation_without_leaking_details() -> None:
    service = QueryService()
    service.request_error = True

    response = client(service).post("/api/queries", json=query_request())

    assert response.status_code == 400
    assert response.json() == {
        "code": "invalid_request",
        "message": "request validation failed",
    }


@pytest.mark.parametrize(
    ("error_code", "expected_status"),
    [
        (ErrorCode.SQL_REJECTED, 400),
        (ErrorCode.QUERY_RESULT_TOO_WIDE, 422),
        (ErrorCode.ROW_TOO_LARGE, 422),
    ],
)
def test_http_query_create_does_not_mark_permanent_errors_as_unavailable(
    error_code: ErrorCode, expected_status: int
) -> None:
    service = QueryService()
    service.query_error_code = error_code

    response = client(service).post("/api/queries", json=query_request())

    assert response.status_code == expected_status
    assert response.json() == {"code": error_code.value, "message": "query rejected"}


def test_http_query_responses_omit_resolved_storage_uris() -> None:
    service = QueryService()
    service.include_resolved_sources = True
    http = client(service)

    create = http.post("/api/queries", json=query_request())
    page = http.post(
        "/api/queries/query_123/pages",
        json={"offset": 0},
        headers={"X-HIFLD-Query-Token": "signed"},
    )
    serialized = f"{create.text}\n{page.text}"

    assert create.status_code == 200
    assert page.status_code == 200
    assert "resolved_sources" not in serialized
    assert "gs://secret-bucket/roads.parquet" not in serialized
    assert "s3://secret/roads.parquet" not in serialized


def test_http_query_page_requires_token_and_binds_path_before_execution() -> None:
    service = QueryService()
    http = client(service)
    missing = http.post("/api/queries/query_123/pages", json={"offset": 0})
    assert missing.status_code == 400
    assert missing.json()["code"] == "query_token_invalid"

    service.identity_error = True
    rejected = http.post(
        "/api/queries/query_123/pages",
        json={"offset": 0, "page_size": 4},
        headers={"X-HIFLD-Query-Token": "other-signed-token"},
    )
    assert rejected.status_code == 400
    assert rejected.json() == {
        "code": "query_token_invalid",
        "message": "The query token is invalid or expired",
    }
    assert service.calls == ["validate:other-signed-token:query_123"]


def test_http_query_page_validates_bounds_and_dispatches_a_bound_request() -> None:
    service = QueryService()
    http = client(service)
    invalid = http.post(
        "/api/queries/query_123/pages",
        json={"offset": -1},
        headers={"X-HIFLD-Query-Token": "signed"},
    )
    assert invalid.status_code == 422

    response = http.post(
        "/api/queries/query_123/pages",
        json={"offset": 4, "page_size": 5},
        headers={"X-HIFLD-Query-Token": "signed"},
    )
    assert response.status_code == 200
    assert response.json()["offset"] == 4
    assert service.calls == ["validate:signed:query_123", "page:signed:4:5"]


def test_http_query_bounds_requires_a_bound_token_and_returns_result_extent() -> None:
    service = QueryService()
    http = client(service)

    missing = http.get("/api/queries/query_123/bounds")
    assert missing.status_code == 400

    response = http.get(
        "/api/queries/query_123/bounds",
        headers={"X-HIFLD-Query-Token": "signed"},
    )

    assert response.status_code == 200
    assert response.json() == {"bounds": [-122.4, 37.0, -121.4, 37.8]}
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["vary"] == "X-HIFLD-Query-Token"
    assert service.calls == ["validate:signed:query_123", "bounds:signed"]


def test_http_query_tile_reflects_only_configured_origin_and_preserves_mvt_behavior() -> None:
    service = QueryService()
    http = client(service)
    headers = {"X-HIFLD-Query-Token": "signed", "Origin": "https://webapp.example.test"}
    tile = http.get("/api/queries/query_123/tiles/4/3/6.mvt", headers=headers)

    assert tile.status_code == 200
    assert tile.content == b"mvt"
    assert tile.headers["content-type"] == "application/vnd.mapbox-vector-tile"
    assert tile.headers["access-control-allow-origin"] == "https://webapp.example.test"
    assert tile.headers["vary"] == "Origin, X-HIFLD-Query-Token"
    assert service.calls == [
        "validate:signed:query_123",
        "tile:signed:4:3:6:10.0",
    ]

    denied = http.get(
        "/api/queries/query_123/tiles/4/3/6.mvt",
        headers={"X-HIFLD-Query-Token": "signed", "Origin": "https://untrusted.example.test"},
    )
    assert "access-control-allow-origin" not in denied.headers

    options = http.options(
        "/api/queries/query_123/tiles/4/3/6.mvt",
        headers={"Origin": "https://webapp.example.test"},
    )
    assert options.status_code == 204
    assert options.headers["access-control-allow-methods"] == "GET, OPTIONS"
    assert options.headers["access-control-allow-headers"] == "X-HIFLD-Query-Token"


def test_http_query_tile_returns_empty_tiles_and_rejects_identity_before_rendering() -> None:
    service = QueryService()
    service.tile = WorkerTile(b"", 1.0, 0, 0)
    http = client(service)
    empty = http.get(
        "/api/queries/query_123/tiles/0/0/0.mvt",
        headers={"X-HIFLD-Query-Token": "signed"},
    )
    assert empty.status_code == 204

    service.identity_error = True
    rejected = http.get(
        "/api/queries/query_123/tiles/0/0/0.mvt",
        headers={"X-HIFLD-Query-Token": "signed"},
    )
    assert rejected.status_code == 400
    assert service.calls[-1] == "validate:signed:query_123"


def test_http_query_transport_observability_emits_bounded_events_without_secrets() -> None:
    metrics = InMemoryMetricSink()
    logs = InMemoryStructuredLogSink()
    observer = QueryObservability(metrics=metrics, logs=logs)
    service = QueryService()
    http = client(service, observer)
    sentinel_values = (
        "sql-sentinel-never-log",
        "source_sentinel_never_log",
        "query-id-sentinel-never-log",
        "token-sentinel-never-log",
    )

    create = http.post(
        "/api/queries",
        json={
            **query_request(),
            "sources": [{**query_request()["sources"][0], "alias": sentinel_values[1]}],
            "sql": f"SELECT '{sentinel_values[0]}' FROM roads",
        },
    )
    page = http.post(
        f"/api/queries/{sentinel_values[2]}/pages",
        json={"offset": 0},
        headers={"X-HIFLD-Query-Token": sentinel_values[3]},
    )
    tile = http.get(
        f"/api/queries/{sentinel_values[2]}/tiles/0/0/0.mvt",
        headers={"X-HIFLD-Query-Token": sentinel_values[3]},
    )

    assert [response.status_code for response in (create, page, tile)] == [200, 200, 200]
    assert len(metrics.events) == 3
    assert [event.labels for event in metrics.events] == [
        (("transport", "webapp_http"),),
        (("transport", "webapp_http"),),
        (("transport", "webapp_http"),),
    ]
    assert len(logs.events) == 3
    serialized = "\n".join(event.as_json() for event in logs.events)
    for sentinel in sentinel_values:
        assert sentinel not in serialized
