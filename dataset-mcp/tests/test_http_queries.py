from __future__ import annotations

from collections.abc import Mapping, Sequence

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import AppError, ErrorCode
from app.http.queries import create_query_router
from app.query.models import JsonValue
from query_worker.protocol import WorkerFailure, WorkerTile


class QueryService:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.identity_error = False
        self.request_error = False
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
        self.calls.append(f"query:{limit}")
        return {"query_id": "query_123", "query_token": "signed", "limit": limit}

    def validate_query_identity(self, token: str, query_id: str) -> None:
        self.calls.append(f"validate:{token}:{query_id}")
        if self.identity_error:
            raise AppError(ErrorCode.QUERY_TOKEN_INVALID, "The query token is invalid or expired")

    async def page(self, token: str, offset: int, limit: int) -> Mapping[str, JsonValue]:
        self.calls.append(f"page:{token}:{offset}:{limit}")
        return {"query_id": "query_123", "query_token": token, "offset": offset, "limit": limit}

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


def client(service: QueryService) -> TestClient:
    app = FastAPI()
    app.include_router(
        create_query_router(
            service,
            webapp_origins=("https://webapp.example.test", "http://localhost:3000"),
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
