import pytest

from app.catalog.client import CatalogClientError
from app.catalog.models import BucketStorageConfig, QuerySourceRef, StacVersionCollection
from app.catalog.source_resolver import SourceResolver


class FakeCatalog:
    def __init__(self, response: StacVersionCollection) -> None:
        self.response = response

    async def get_dataset_file(
        self,
        collection: str,
        dataset: str,
        file: str,
        *,
        version: str | None = None,
        **_: str | None,
    ) -> StacVersionCollection:
        del collection, dataset, file, version
        return self.response


def ref(**updates: str | None) -> QuerySourceRef:
    values: dict[str, str | None] = {
        "alias": "roads",
        "collection_slug": "hifld",
        "dataset_slug": "roads",
        "file_slug": "roads",
        "version": "v1.0.0",
        "asset_key": "geoparquet-abc",
        "storage_location_slug": "local",
    }
    values.update(updates)
    return QuerySourceRef.model_validate(values)


def response(
    *,
    identifier: str = "hifld/roads/roads/v1.0.0",
    href: str = "http://localhost:8333/hifld-local-published/hifld/roads/roads/v1.0.0/geoparquet/roads.parquet",
    native_crs: str = "EPSG:4326",
) -> StacVersionCollection:
    return StacVersionCollection.model_validate(
        {
            "type": "Collection",
            "stac_version": "1.1.0",
            "id": identifier,
            "description": "Roads",
            "license": "other",
            "links": [],
            "extent": {
                "spatial": {"bbox": [[-123, 24, -67, 49]]},
                "temporal": {"interval": [[None, None]]},
            },
            "assets": {
                "geoparquet-abc": {
                    "href": href,
                    "type": "application/vnd.apache.parquet",
                    "title": "GeoParquet",
                    "roles": ["data"],
                    "file:size": 1,
                    "file:checksum": "1220abc",
                }
            },
            "table:columns": [{"name": "id", "type": "int64"}],
            "hifld:native_crs": native_crs,
        }
    )


def locations() -> dict[str, BucketStorageConfig]:
    return {
        "local": BucketStorageConfig(
            type="seaweedfs",
            base_url="http://localhost:8333",
            endpoint_url="http://seaweedfs:8333",
            bucket="hifld-local-published",
        )
    }


@pytest.mark.asyncio
async def test_resolver_verifies_hierarchy_and_maps_trusted_href() -> None:
    resolved = await SourceResolver(FakeCatalog(response()), locations()).resolve(ref())
    assert resolved.object_uris == (
        "s3://hifld-local-published/hifld/roads/roads/v1.0.0/geoparquet/roads.parquet",
    )
    assert resolved.bbox == (-123.0, 24.0, -67.0, 49.0)
    assert resolved.crs == "EPSG:4326"


@pytest.mark.asyncio
async def test_resolver_unquotes_json_string_crs_but_preserves_projjson() -> None:
    quoted = await SourceResolver(
        FakeCatalog(response(native_crs='"OGC:CRS84"')), locations()
    ).resolve(ref())
    projjson = '{"type":"GeographicCRS","name":"WGS 84"}'
    structured = await SourceResolver(
        FakeCatalog(response(native_crs=projjson)), locations()
    ).resolve(ref())

    assert quoted.crs == "OGC:CRS84"
    assert structured.crs == projjson


@pytest.mark.asyncio
async def test_resolver_rejects_wrong_version_or_hierarchy() -> None:
    with pytest.raises(CatalogClientError, match="source_identity_mismatch"):
        await SourceResolver(
            FakeCatalog(response(identifier="hifld/roads/roads/v2.0.0")), locations()
        ).resolve(ref())


@pytest.mark.asyncio
async def test_resolver_rejects_unknown_explicit_storage() -> None:
    with pytest.raises(CatalogClientError, match="source_storage_unknown"):
        await SourceResolver(FakeCatalog(response()), locations()).resolve(
            ref(storage_location_slug="missing")
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "href",
    [
        "http://evil.test/hifld-local-published/a.parquet",
        "http://localhost:8333/other/a.parquet",
        "http://localhost:8333/hifld-local-published/../secret.parquet",
    ],
)
async def test_resolver_rejects_untrusted_or_traversing_asset_href(href: str) -> None:
    with pytest.raises(CatalogClientError, match="source_location_invalid"):
        await SourceResolver(FakeCatalog(response(href=href)), locations()).resolve(ref())


def aliased_gcs_locations() -> dict[str, BucketStorageConfig]:
    config = BucketStorageConfig(
        type="gcs",
        base_url="https://storage.googleapis.com",
        bucket="hifld-next-portolan-published",
    )
    return {"gcs-portolan-published": config, "gcp-portolan-published": config}


GCS_HREF = (
    "https://storage.googleapis.com/hifld-next-portolan-published/"
    "hifld/roads/roads/v1.0.0/geoparquet/roads.parquet"
)


@pytest.mark.asyncio
async def test_resolver_rejects_duplicate_registry_entries_for_one_bucket() -> None:
    # Two slugs for one bucket is a registry error; it must fail loudly, not pick one.
    with pytest.raises(CatalogClientError, match="source_location_invalid"):
        await SourceResolver(FakeCatalog(response(href=GCS_HREF)), aliased_gcs_locations()).resolve(
            ref(storage_location_slug=None)
        )


@pytest.mark.asyncio
async def test_resolver_rejects_distinct_backends_matching_without_explicit_storage() -> None:
    locations = aliased_gcs_locations()
    locations["other-endpoint"] = BucketStorageConfig(
        type="gcs",
        base_url="https://storage.googleapis.com",
        bucket="hifld-next-portolan-published",
        endpoint_url="https://mirror.example.test",
    )
    with pytest.raises(CatalogClientError, match="source_location_invalid"):
        await SourceResolver(FakeCatalog(response(href=GCS_HREF)), locations).resolve(
            ref(storage_location_slug=None)
        )
