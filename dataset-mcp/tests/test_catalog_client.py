import httpx
import pytest

from app.catalog.client import CatalogClient, CatalogClientError
from app.catalog.models import DatasetSearchRequest
from app.catalog.tool_adapter import CatalogToolAdapter, _identity


def client_for(routes: dict[str, object], requests: list[str] | None = None) -> CatalogClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request.url.path)
        payload = routes.get(request.url.path)
        return httpx.Response(200, json=payload) if payload is not None else httpx.Response(404)

    return CatalogClient(
        "http://catalog.test", httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


@pytest.mark.asyncio
async def test_list_collections_normalizes_stac_child_links() -> None:
    catalog = client_for(
        {
            "/api/collections": {
                "type": "Catalog",
                "id": "root",
                "description": "Published catalogs",
                "stac_version": "1.0.0",
                "links": [
                    {"rel": "self", "href": "catalog.json"},
                    {
                        "rel": "child",
                        "href": "hifld/catalog.json",
                        "title": "HIFLD",
                    },
                ],
            }
        }
    )

    collections = await catalog.list_collections()

    assert [(item.slug, item.name) for item in collections] == [("hifld", "HIFLD")]


@pytest.mark.asyncio
async def test_list_collections_fetches_untitled_child_from_trusted_api_route() -> None:
    requests: list[str] = []
    catalog = client_for(
        {
            "/api/collections": {
                "type": "Catalog",
                "id": "root",
                "description": "Published catalogs",
                "stac_version": "1.0.0",
                "links": [{"rel": "child", "href": "https://evil.test/hifld/catalog.json"}],
            },
            "/api/collections/hifld": {
                "type": "Catalog",
                "id": "hifld",
                "title": "HIFLD",
                "description": "Homeland infrastructure data",
                "stac_version": "1.0.0",
                "links": [],
            },
        },
        requests,
    )

    collections = await catalog.list_collections()

    assert collections[0].description == "Homeland infrastructure data"
    assert requests == ["/api/collections", "/api/collections/hifld"]


@pytest.mark.asyncio
async def test_collection_search_uses_datasets_route_and_webapp_envelope() -> None:
    catalog = client_for(
        {
            "/api/collections": {
                "type": "Catalog",
                "id": "root",
                "description": "Published catalogs",
                "stac_version": "1.0.0",
                "links": [
                    {
                        "rel": "child",
                        "href": "hifld/catalog.json",
                        "title": "HIFLD",
                    }
                ],
            },
            "/api/collections/hifld/datasets": {
                "datasets": [],
                "total": 0,
                "limit": 10,
                "offset": 0,
                "links": {},
            },
        }
    )
    page = await catalog.search_datasets(DatasetSearchRequest(collection="hifld", limit=10))
    assert page.total == 0


@pytest.mark.asyncio
async def test_collection_search_normalizes_stable_catalog_identity_keys() -> None:
    catalog = client_for(
        {
            "/api/collections": {
                "type": "Catalog",
                "id": "root",
                "description": "Published catalogs",
                "stac_version": "1.0.0",
                "links": [
                    {
                        "rel": "child",
                        "href": "hifld/catalog.json",
                        "title": "HIFLD",
                    }
                ],
            },
            "/api/collections/hifld/datasets": {
                "datasets": [
                    {
                        "type": "Catalog",
                        "stac_version": "1.1.0",
                        "id": "hifld/agricultural-minerals-operations",
                        "title": "Agricultural Minerals Operations",
                        "description": "Minerals",
                        "links": [],
                        "hifld:tags": {"theme": "energy"},
                    }
                ],
                "total": 1,
                "limit": 1,
                "offset": 0,
                "links": {},
            },
        }
    )

    page = await catalog.search_datasets(
        DatasetSearchRequest(collection="hifld", search="agricultural", limit=1)
    )

    assert page.items[0].slug == "agricultural-minerals-operations"


@pytest.mark.asyncio
async def test_file_request_uses_full_slug_hierarchy_and_asset_selectors() -> None:
    path = "/api/collections/hifld/datasets/roads/files/roads"
    catalog = client_for({path: version_collection()})
    response = await catalog.get_dataset_file(
        "hifld", "roads", "roads", version="v1.0.0", asset_key="geoparquet"
    )
    assert response.id == "hifld/roads/roads/v1.0.0"


@pytest.mark.asyncio
async def test_tool_adapter_exposes_and_resolves_pmtiles_with_slug_identity() -> None:
    path = "/api/collections/hifld/datasets/roads/files/roads"
    payload = version_collection()
    assets = payload["assets"]
    assert isinstance(assets, dict)
    assets["pmtiles"] = {
        "href": "https://tiles.example/hifld/roads.pmtiles",
        "type": "application/vnd.pmtiles",
        "title": "Vector tiles",
        "roles": ["data"],
    }
    adapter = CatalogToolAdapter(client_for({path: payload}))

    result = await adapter.get_dataset_file("hifld", "roads", "roads")

    assert result["map_sources"] == [
        {
            "type": "catalog",
            "collection_slug": "hifld",
            "dataset_slug": "roads",
            "file_slug": "roads",
            "version": "v1.0.0",
            "asset_key": "pmtiles",
        }
    ]
    assert await adapter.resolve_map_source("hifld", "roads", "roads", "v1.0.0", "pmtiles") == {
        "type": "pmtiles",
        "url": "https://tiles.example/hifld/roads.pmtiles",
    }


@pytest.mark.asyncio
async def test_file_request_parses_canonical_versioned_catalog_response() -> None:
    path = "/api/collections/hifld/datasets/roads/files/roads"
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json=version_collection(),
        )

    catalog = CatalogClient(
        "http://catalog.test", httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    response = await catalog.get_dataset_file(
        "hifld",
        "roads",
        "roads",
        version="v1.0.0",
        asset_key="geoparquet-abc",
        storage_location_slug="seaweedfs-local-published",
    )

    assert seen[0].url.path == path
    assert dict(seen[0].url.params) == {"version": "v1.0.0"}
    assert response.id == "hifld/roads/roads/v1.0.0"
    assert response.assets["geoparquet-abc"].file_size == 123
    assert response.table_columns[0].type == "int64"


@pytest.mark.asyncio
async def test_path_traversal_slug_is_rejected() -> None:
    with pytest.raises(CatalogClientError, match="catalog_identity_invalid"):
        await client_for({}).get_dataset_file("hifld", "../secret", "roads")


def test_tool_identity_accepts_only_slugs() -> None:
    assert _identity("hifld", "collection") == "hifld"
    with pytest.raises(ValueError, match="slug"):
        _identity(12, "collection")


def version_collection() -> dict[str, object]:
    return {
        "type": "Collection",
        "stac_version": "1.1.0",
        "id": "hifld/roads/roads/v1.0.0",
        "title": "Roads",
        "description": "Roads",
        "license": "other",
        "links": [],
        "extent": {
            "spatial": {"bbox": [[-123.0, 24.0, -67.0, 49.0]]},
            "temporal": {"interval": [[None, None]]},
        },
        "assets": {
            "geoparquet-abc": {
                "href": "http://localhost:8333/hifld-local-published/hifld/roads/roads/v1.0.0/geoparquet/roads.parquet",
                "type": "application/vnd.apache.parquet",
                "title": "GeoParquet",
                "roles": ["data"],
                "file:size": 123,
                "file:checksum": "1220abc",
            }
        },
        "table:columns": [{"name": "OBJECTID", "type": "int64", "nullable": False}],
        "hifld:feature_count": 5,
        "hifld:native_crs": "EPSG:4326",
        "hifld:geometry_type": "Point",
        "hifld:quality": {"passed": True, "invalid_geometry_count": 0, "columns_hash": "abc"},
    }
