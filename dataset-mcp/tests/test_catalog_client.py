import json
from pathlib import Path

import httpx
import pytest

from app.catalog.client import CatalogClient
from app.catalog.models import DatasetSearchRequest
from app.catalog.tool_adapter import CatalogToolAdapter, _identity, _tag_filters
from app.tools import discovery

FIXTURES = Path(__file__).parent / "contract_fixtures"


def client_for(routes: dict[str, object]) -> CatalogClient:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = routes.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"detail": "not found"})
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)
    return CatalogClient("http://catalog.test", httpx.AsyncClient(transport=transport))


@pytest.mark.asyncio
async def test_slug_collection_is_resolved_by_exact_list_match() -> None:
    catalog = client_for(
        {"/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}]}
    )
    collection = await catalog.resolve_collection("public-safety")
    assert collection.id == 3


@pytest.mark.asyncio
async def test_search_resolves_slug_then_uses_numeric_dataset_route() -> None:
    catalog = client_for(
        {
            "/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}],
            "/api/collections/3/datasets": {"items": [], "total": 0, "limit": 10, "offset": 0},
        }
    )
    page = await catalog.search_datasets(DatasetSearchRequest(collection="public-safety", limit=10))
    assert page.total == 0


@pytest.mark.asyncio
async def test_get_dataset_parses_dataset_with_files_route() -> None:
    payload = json.loads((FIXTURES / "dataset.json").read_text())
    catalog = client_for(
        {
            "/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}],
            "/api/collections/3/datasets/by-slug/stations/files": payload,
        }
    )
    dataset = await catalog.get_dataset("public-safety", "stations")
    assert dataset.id == 12
    assert dataset.files is not None
    assert dataset.files[0].id == 99


@pytest.mark.asyncio
async def test_404_is_stable_catalog_not_found_error() -> None:
    catalog = client_for({})
    with pytest.raises(Exception, match="catalog_not_found"):
        await catalog.resolve_collection(42)


@pytest.mark.asyncio
async def test_tool_adapter_exposes_json_mapping_for_discovery_tools() -> None:
    catalog = client_for(
        {"/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}]}
    )
    adapter = CatalogToolAdapter(catalog)
    result = await adapter.list_collections()
    items = result["items"]
    assert isinstance(items, list)
    assert items[0]["id"] == 3
    assert items[0]["slug"] == "public-safety"


def test_tool_adapter_normalizes_numeric_identities() -> None:
    assert _identity("12", "identity") == 12
    assert _identity("public-safety", "identity") == "public-safety"
    with pytest.raises(ValueError, match="positive"):
        _identity("0", "identity")


def test_tool_adapter_encodes_repeated_key_value_tags_as_catalog_json() -> None:
    assert _tag_filters(["theme=safety", "theme=transport", "state=NY"]) == (
        '{"state":"NY","theme":["safety","transport"]}'
    )
    with pytest.raises(ValueError, match="key=value"):
        _tag_filters(["theme"])


@pytest.mark.asyncio
async def test_tool_adapter_file_shape_has_query_sources_and_no_nested_columns() -> None:
    file_payload = json.loads((FIXTURES / "file_response.json").read_text())
    dataset_payload = json.loads((FIXTURES / "dataset.json").read_text())
    source_metadata = dataset_payload["files"][0]["formats"][0]["sources"][0]["source_metadata"]
    file_payload["file"]["formats"][0]["sources"][0]["source_metadata"] = source_metadata
    file_payload["file"]["formats"][0]["sources"][0]["storage_location"] = {
        "id": 3,
        "slug": "public-gcs",
        "name": "Public GCS",
        "backend_type": "s3",
    }
    catalog = client_for(
        {
            "/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}],
            "/api/collections/3/datasets/by-slug/stations/files/stations-file": file_payload,
        }
    )
    result = await discovery.get_dataset_file(
        CatalogToolAdapter(catalog), "public-safety", "stations", "stations-file"
    )
    payload = result.structured_content
    assert isinstance(payload["query_sources"], list)
    assert len(payload["query_sources"]) == 1
    source = payload["file"]["formats"][0]["sources"][0]
    assert "columns" not in source["source_metadata"]


@pytest.mark.asyncio
async def test_tool_adapter_schema_shape_exposes_paginated_columns() -> None:
    file_payload = json.loads((FIXTURES / "file_response.json").read_text())
    dataset_payload = json.loads((FIXTURES / "dataset.json").read_text())
    source_metadata = dataset_payload["files"][0]["formats"][0]["sources"][0]["source_metadata"]
    file_payload["file"]["formats"][0]["sources"][0]["source_metadata"] = source_metadata
    versions_payload = {
        "dataset_id": 12,
        "file_id": 99,
        "formats": file_payload["file"]["formats"],
    }
    catalog = client_for(
        {
            "/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}],
            "/api/collections/3/datasets/by-slug/stations/files/stations-file": file_payload,
            "/api/collections/3/datasets/12/files/99/versions": versions_payload,
        }
    )
    result = await discovery.get_dataset_file_schema(
        CatalogToolAdapter(catalog),
        "public-safety",
        "stations",
        "stations-file",
        column_limit=1,
    )
    payload = result.structured_content
    assert payload["available_versions"] == ["2026-01-02"]
    assert payload["columns"][0]["name"] == "geometry"
    assert payload["columns"][0]["type"] == "geometry"
    assert payload["columns"][0]["nullable"] is True
    assert payload["total"] == 1


@pytest.mark.asyncio
async def test_schema_without_column_metadata_is_a_valid_empty_schema_result() -> None:
    file_payload = json.loads((FIXTURES / "file_response.json").read_text())
    versions_payload = {
        "dataset_id": 12,
        "file_id": 99,
        "formats": file_payload["file"]["formats"],
    }
    catalog = client_for(
        {
            "/api/collections": [{"id": 3, "slug": "public-safety", "name": "Public Safety"}],
            "/api/collections/3/datasets/by-slug/stations/files/stations-file": file_payload,
            "/api/collections/3/datasets/12/files/99/versions": versions_payload,
        }
    )
    result = await catalog.get_dataset_file_schema("public-safety", "stations", "stations-file")
    assert result.schema_ is None
    assert result.selected_version is None
    assert result.versions == ["2026-01-02"]
    with pytest.raises(Exception, match="schema_version_not_found"):
        await catalog.get_dataset_file_schema(
            "public-safety", "stations", "stations-file", version="2026-01-02"
        )
