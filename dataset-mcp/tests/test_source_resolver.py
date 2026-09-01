from pathlib import Path

import pytest

from app.catalog.models import (
    BucketStorageConfig,
    DatasetFileResponse,
    QuerySourceRef,
    StorageLocation,
)
from app.catalog.source_resolver import SourceResolver

FIXTURE = Path(__file__).parent / "contract_fixtures" / "file_response.json"


class FakeCatalog:
    def __init__(self, response: DatasetFileResponse) -> None:
        self.response = response

    async def get_dataset_file(
        self, collection: int | str, dataset: int | str, file: int | str
    ) -> DatasetFileResponse:
        del collection, dataset, file
        return self.response


class NullCatalog:
    async def get_dataset_file(
        self, collection: int | str, dataset: int | str, file: int | str
    ) -> None:
        del collection, dataset, file
        return None


@pytest.mark.asyncio
async def test_resolver_requires_catalog_source_identity() -> None:
    resolver = SourceResolver(NullCatalog())
    with pytest.raises(AttributeError):
        await resolver.resolve(
            QuerySourceRef(
                collection_id=1, dataset_id=2, file_id=3, file_source_id=4, alias="roads"
            )
        )


def _response_with_sources(
    *, glob_pattern: str | None, storage_uris: tuple[str, ...]
) -> DatasetFileResponse:
    response = DatasetFileResponse.model_validate_json(FIXTURE.read_text())
    source = response.file.formats[0].sources[0]
    source.storage_location = StorageLocation(
        id=3,
        slug="public-gcs",
        name="Public GCS",
        backend_type="s3",
        config=BucketStorageConfig(
            type="gcs",
            base_url="https://storage.googleapis.com/catalog",
            bucket="catalog",
        ),
    )
    source.glob_pattern = glob_pattern
    source.storage_uri = storage_uris[0]
    duplicates = [source.model_copy(deep=True)]
    for uri in storage_uris[1:]:
        duplicate = source.model_copy(deep=True)
        duplicate.storage_uri = uri
        duplicates.append(duplicate)
    response.file.formats[0].sources = duplicates
    return response


@pytest.mark.asyncio
async def test_resolver_groups_expanded_sources_and_prefers_glob_pattern() -> None:
    response = _response_with_sources(
        glob_pattern="s3://catalog/roads/**/*.parquet",
        storage_uris=("s3://catalog/roads/a.parquet", "s3://catalog/roads/b.parquet"),
    )
    resolver = SourceResolver(FakeCatalog(response))
    resolved = await resolver.resolve(
        QuerySourceRef(collection_id=1, dataset_id=12, file_id=99, file_source_id=88, alias="roads")
    )
    assert resolved.object_uris == ("s3://catalog/roads/**/*.parquet",)
    assert resolved.storage_config.type == "gcs"


@pytest.mark.asyncio
async def test_resolver_collects_concrete_storage_uris_for_expanded_sources() -> None:
    response = _response_with_sources(
        glob_pattern=None,
        storage_uris=("s3://catalog/roads/a.parquet", "s3://catalog/roads/b.parquet"),
    )
    resolver = SourceResolver(FakeCatalog(response))
    resolved = await resolver.resolve(
        QuerySourceRef(collection_id=1, dataset_id=12, file_id=99, file_source_id=88, alias="roads")
    )
    assert resolved.object_uris == (
        "s3://catalog/roads/a.parquet",
        "s3://catalog/roads/b.parquet",
    )
