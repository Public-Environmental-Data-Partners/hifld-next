"""Typed client for the internal dataset catalog API."""

import httpx
from pydantic import BaseModel, ValidationError

from app.catalog.models import (
    Collection,
    Dataset,
    DatasetFileResponse,
    DatasetFileSchema,
    DatasetFileSchemaResult,
    DatasetFileVersionsResponse,
    DatasetFormat,
    DatasetPage,
    DatasetSearchRequest,
    FileSource,
    SchemaSummary,
)


class CatalogClientError(RuntimeError):
    """Stable, safe catalog failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class CatalogClient:
    """Call dataset-api and validate each response at the HTTP boundary."""

    def __init__(
        self, base_url: str, client: httpx.AsyncClient | None = None, timeout: float = 15.0
    ) -> None:
        self._client = client or httpx.AsyncClient(base_url=base_url, timeout=timeout)
        self._base_url = base_url.rstrip("/")
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get_model(
        self, path: str, model: type[BaseModel], params: dict[str, str | int] | None = None
    ) -> BaseModel:
        try:
            response = await self._client.get(f"{self._base_url}{path}", params=params)
        except httpx.HTTPError as exc:
            raise CatalogClientError("catalog_unavailable", "catalog request failed") from exc
        if response.status_code == 404:
            raise CatalogClientError("catalog_not_found", "catalog resource was not found")
        if response.is_error:
            raise CatalogClientError("catalog_unavailable", "catalog request failed")
        try:
            return model.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise CatalogClientError(
                "catalog_contract_invalid", "catalog response did not match its contract"
            ) from exc

    async def _get_list(self, path: str) -> list[Collection]:
        try:
            response = await self._client.get(f"{self._base_url}{path}")
        except httpx.HTTPError as exc:
            raise CatalogClientError("catalog_unavailable", "catalog request failed") from exc
        if response.status_code == 404:
            raise CatalogClientError("catalog_not_found", "catalog resource was not found")
        if response.is_error:
            raise CatalogClientError("catalog_unavailable", "catalog request failed")
        try:
            payload = response.json()
            return [Collection.model_validate(item) for item in payload]
        except (ValueError, TypeError, ValidationError) as exc:
            raise CatalogClientError(
                "catalog_contract_invalid", "catalog response did not match its contract"
            ) from exc

    async def list_collections(self) -> list[Collection]:
        return await self._get_list("/api/collections")

    async def resolve_collection(self, identity: int | str) -> Collection:
        if isinstance(identity, int):
            model = await self._get_model(f"/api/collections/{identity}", Collection)
            return Collection.model_validate(model)
        for collection in await self.list_collections():
            if collection.slug == identity:
                return collection
        raise CatalogClientError("catalog_not_found", "collection was not found")

    async def search_datasets(self, request: DatasetSearchRequest) -> DatasetPage:
        collection = await self.resolve_collection(request.collection)
        model = await self._get_model(
            f"/api/collections/{collection.id}/datasets", DatasetPage, request.to_query_params()
        )
        return DatasetPage.model_validate(model)

    async def get_dataset(self, collection: int | str, dataset: int | str) -> Dataset:
        resolved = await self.resolve_collection(collection)
        path = (
            f"/api/collections/{resolved.id}/datasets/{dataset}/files"
            if isinstance(dataset, int)
            else f"/api/collections/{resolved.id}/datasets/by-slug/{dataset}/files"
        )
        model = await self._get_model(path, Dataset)
        return Dataset.model_validate(model)

    async def get_dataset_file(
        self, collection: int | str, dataset: int | str, file: int | str
    ) -> DatasetFileResponse:
        resolved = await self.resolve_collection(collection)
        if isinstance(dataset, int):
            path = f"/api/collections/{resolved.id}/datasets/{dataset}/files/{file}"
        else:
            path = f"/api/collections/{resolved.id}/datasets/by-slug/{dataset}/files/{file}"
        model = await self._get_model(path, DatasetFileResponse)
        return DatasetFileResponse.model_validate(model)

    async def get_file_versions(
        self, collection: int | str, dataset: int | str, file: int | str
    ) -> DatasetFileVersionsResponse:
        resolved = await self.resolve_collection(collection)
        if isinstance(file, int):
            if not isinstance(dataset, int):
                dataset_page = await self.get_dataset(resolved.id, dataset)
                dataset_id = dataset_page.id
            else:
                dataset_id = dataset
            path = f"/api/collections/{resolved.id}/datasets/{dataset_id}/files/{file}/versions"
        else:
            detail = await self.get_dataset_file(resolved.id, dataset, file)
            dataset_id = detail.dataset.id
            file_id = detail.file.id
            path = f"/api/collections/{resolved.id}/datasets/{dataset_id}/files/{file_id}/versions"
        model = await self._get_model(path, DatasetFileVersionsResponse)
        return DatasetFileVersionsResponse.model_validate(model)

    async def get_dataset_file_schema(
        self,
        collection: int | str,
        dataset: int | str,
        file: int | str,
        version: str | int | None = None,
    ) -> DatasetFileSchemaResult:
        detail = await self.get_dataset_file(collection, dataset, file)
        versions = await self.get_file_versions(collection, detail.dataset.id, detail.file.id)
        candidates: list[tuple[FileSource, DatasetFormat]] = []
        for entry in versions.formats:
            for source in entry.sources:
                if source.source_metadata is not None and source.source_metadata.columns:
                    candidates.append((source, entry))
        if version is not None:
            candidates = [item for item in candidates if str(item[0].version) == str(version)]
            if not candidates:
                raise CatalogClientError("schema_version_not_found", "schema version was not found")
        if not candidates:
            return DatasetFileSchemaResult(
                collection=detail.collection,
                dataset=detail.dataset,
                file=detail.file,
                versions=[source.version for entry in versions.formats for source in entry.sources],
                selected_version=None,
                schema=None,
            )
        candidates.sort(
            key=lambda item: (
                _column_count(item[0]),
                item[1].format.format_type == "geoparquet",
            ),
            reverse=True,
        )
        selected, format_entry = candidates[0]
        metadata = selected.source_metadata
        if metadata is None:
            raise CatalogClientError("schema_not_found", "no schema metadata is available")
        summary = SchemaSummary(
            columnCount=len(metadata.columns) if metadata.columns else 0,
            featureCount=metadata.feature_count,
            geometryType=metadata.geometry_type,
            invalidGeometryCount=metadata.invalid_geometry_count,
            qualityCheckPassed=metadata.quality_check_passed,
            columnsHash=metadata.columns_hash,
        )
        schema = DatasetFileSchema(
            version=selected.version,
            format_type=format_entry.format.format_type if format_entry.format else "geoparquet",
            format_name=format_entry.format.name if format_entry.format else "GeoParquet",
            source_id=selected.id,
            storage_location=selected.storage_location,
            source=selected,
            source_metadata=metadata,
            summary=summary,
            columns=metadata.columns if metadata.columns else [],
        )
        return DatasetFileSchemaResult(
            collection=detail.collection,
            dataset=detail.dataset,
            file=detail.file,
            versions=[source.version for entry in versions.formats for source in entry.sources],
            selected_version=selected.version,
            schema=schema,
        )


def _column_count(source: FileSource) -> int:
    metadata = source.source_metadata
    return len(metadata.columns) if metadata is not None and metadata.columns else 0
