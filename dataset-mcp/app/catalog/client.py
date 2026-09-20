"""Typed client for the webapp's public slug-based catalog API."""

import logging
import re
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from time import perf_counter
from urllib.parse import quote, urlsplit

import httpx
from pydantic import BaseModel, ValidationError

from app.catalog.models import (
    Collection,
    Dataset,
    DatasetFile,
    DatasetFileSchema,
    DatasetFileSchemaResult,
    DatasetFileSummary,
    DatasetPage,
    DatasetSearchRequest,
    DatasetWithFiles,
    FileLocation,
    FileSource,
    SchemaSummary,
    SpatialDatasetFileMetadata,
    StacCatalog,
    StacDatasetPage,
    StacVersionCollection,
)


class CatalogClientError(RuntimeError):
    """Stable, safe catalog failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$")
_LOGGER = logging.getLogger("uvicorn.error.catalog")
type _ReadKey = tuple[httpx.AsyncClient, str, type[BaseModel], tuple[tuple[str, str | int], ...]]
_request_reads: ContextVar[dict[_ReadKey, BaseModel] | None] = ContextVar(
    "catalog_request_reads", default=None
)


@contextmanager
def catalog_request_scope() -> Generator[None]:
    """Reuse validated STAC reads within one inbound request only."""
    reads: dict[_ReadKey, BaseModel] = {}
    token = _request_reads.set(reads)
    try:
        yield
    finally:
        reads.clear()
        _request_reads.reset(token)


def _path_slug(value: str, field: str) -> str:
    """Validate a catalog slug before putting it in a single URL path segment."""
    if not _SLUG_PATTERN.fullmatch(value) or value in {".", ".."}:
        raise CatalogClientError("catalog_identity_invalid", f"{field} identity is invalid")
    return quote(value, safe="")


def _child_slug(href: str) -> str:
    path_parts = [part for part in urlsplit(href).path.split("/") if part]
    if len(path_parts) < 2 or path_parts[-1] != "catalog.json":
        raise CatalogClientError("catalog_contract_invalid", "catalog child link is invalid")
    slug = path_parts[-2]
    _path_slug(slug, "collection")
    return slug


class CatalogClient:
    """Call the webapp catalog API and validate each response at the HTTP boundary."""

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
        reads = _request_reads.get()
        key: _ReadKey = (
            self._client,
            f"{self._base_url}{path}",
            model,
            tuple(sorted((params or {}).items())),
        )
        if reads is not None and key in reads:
            _LOGGER.info("catalog_read model=%s cache_hit=true elapsed_ms=0", model.__name__)
            return reads[key].model_copy(deep=True)
        started = perf_counter()
        try:
            response = await self._client.get(f"{self._base_url}{path}", params=params)
        except httpx.HTTPError as exc:
            raise CatalogClientError("catalog_unavailable", "catalog request failed") from exc
        finally:
            _LOGGER.info(
                "catalog_read model=%s cache_hit=false elapsed_ms=%.2f",
                model.__name__,
                (perf_counter() - started) * 1000,
            )
        if response.status_code == 404:
            raise CatalogClientError("catalog_not_found", "catalog resource was not found")
        if response.is_error:
            raise CatalogClientError("catalog_unavailable", "catalog request failed")
        try:
            validated = model.model_validate(response.json())
            if reads is not None and len(reads) < 32:
                reads[key] = validated.model_copy(deep=True)
            return validated
        except (ValueError, ValidationError) as exc:
            raise CatalogClientError(
                "catalog_contract_invalid", "catalog response did not match its contract"
            ) from exc

    async def list_collections(self) -> list[Collection]:
        root_model = await self._get_model("/api/collections", StacCatalog)
        root = StacCatalog.model_validate(root_model)
        collections: list[Collection] = []
        for link in root.links:
            if link.rel != "child":
                continue
            slug = _child_slug(link.href)
            catalog_model = await self._get_model(
                f"/api/collections/{_path_slug(slug, 'collection')}", StacCatalog
            )
            catalog = StacCatalog.model_validate(catalog_model)
            if catalog.id != slug:
                raise CatalogClientError(
                    "catalog_contract_invalid",
                    "collection catalog identity did not match its route",
                )
            collections.append(
                Collection(
                    slug=slug,
                    name=catalog.title or catalog.id,
                    description=catalog.description,
                )
            )
        return collections

    async def resolve_collection(self, identity: str) -> Collection:
        for collection in await self.list_collections():
            if collection.slug == identity:
                return collection
        raise CatalogClientError("catalog_not_found", "collection was not found")

    async def search_datasets(self, request: DatasetSearchRequest) -> DatasetPage:
        collection = await self.resolve_collection(request.collection)
        model = await self._get_model(
            f"/api/collections/{_path_slug(collection.slug, 'collection')}/datasets",
            StacDatasetPage,
            request.to_query_params(),
        )
        envelope = StacDatasetPage.model_validate(model)
        return DatasetPage(
            items=[_dataset_from_catalog(item, collection.slug) for item in envelope.datasets],
            total=envelope.total,
            limit=envelope.limit,
            offset=envelope.offset,
        )

    async def get_dataset(self, collection: str, dataset: str) -> DatasetWithFiles:
        path = (
            f"/api/collections/{_path_slug(collection, 'collection')}"
            f"/datasets/{_path_slug(dataset, 'dataset')}"
        )
        model = await self._get_model(path, StacCatalog)
        catalog = StacCatalog.model_validate(model)
        expected = f"{collection}/{dataset}"
        if catalog.id != expected:
            raise CatalogClientError(
                "catalog_contract_invalid", "dataset catalog identity did not match its route"
            )
        files = [
            _file_from_child(link.href, expected, link.title)
            for link in catalog.links
            if link.rel == "child"
        ]
        return DatasetWithFiles(
            slug=dataset,
            name=catalog.title or dataset,
            description=catalog.description,
            tags=catalog.hifld_tags,
            files=files,
        )

    async def get_dataset_file(
        self,
        collection: str,
        dataset: str,
        file: str,
        *,
        version: str | None = None,
        asset_key: str | None = None,
        storage_location_slug: str | None = None,
    ) -> StacVersionCollection:
        path = (
            f"/api/collections/{_path_slug(collection, 'collection')}"
            f"/datasets/{_path_slug(dataset, 'dataset')}"
            f"/files/{_path_slug(file, 'file')}"
        )
        params: dict[str, str | int] = {}
        if version is not None:
            params["version"] = version
        del asset_key, storage_location_slug
        model = await self._get_model(path, StacVersionCollection, params)
        collection_model = StacVersionCollection.model_validate(model)
        prefix = f"{collection}/{dataset}/{file}/"
        if not collection_model.id.startswith(prefix) or collection_model.id.count("/") != 3:
            raise CatalogClientError(
                "catalog_contract_invalid", "file collection identity did not match its route"
            )
        return collection_model

    async def get_dataset_file_schema(
        self,
        collection: str,
        dataset: str,
        file: str,
        version: str | int | None = None,
    ) -> DatasetFileSchemaResult:
        selected = await self.get_dataset_file(
            collection, dataset, file, version=str(version) if version is not None else None
        )
        selected_version = selected.id.rsplit("/", 1)[-1]
        quality = selected.quality
        metadata = SpatialDatasetFileMetadata(
            feature_count=selected.feature_count,
            bounds=selected.extent.spatial.bbox[0] if selected.extent.spatial.bbox else None,
            geometry_type=selected.geometry_type,
            invalid_geometry_count=quality.invalid_geometry_count if quality else None,
            quality_check_passed=quality.passed if quality else None,
            columns_hash=quality.columns_hash if quality else None,
            columns=selected.table_columns,
            crs=selected.native_crs,
        )
        asset_key, asset = next(
            (
                (key, value)
                for key, value in selected.assets.items()
                if key.startswith("geoparquet-") or key == "geoparquet"
            ),
            (None, None),
        )
        schema = None
        if asset_key is not None and asset is not None:
            source = FileSource(
                asset_key=asset_key,
                version=selected_version,
                source_type="file",
                location=FileLocation(path=asset.href),
                source_metadata=metadata,
            )
            schema = DatasetFileSchema(
                version=selected_version,
                format_type="geoparquet",
                format_name="GeoParquet",
                source=source,
                source_metadata=metadata,
                summary=SchemaSummary(
                    columnCount=len(selected.table_columns),
                    featureCount=selected.feature_count,
                    geometryType=selected.geometry_type,
                    invalidGeometryCount=quality.invalid_geometry_count if quality else None,
                    qualityCheckPassed=quality.passed if quality else None,
                    columnsHash=quality.columns_hash if quality else None,
                ),
                columns=selected.table_columns,
            )
        return DatasetFileSchemaResult(
            collection=Collection(slug=collection, name=collection),
            dataset=Dataset(slug=dataset, name=dataset),
            file=DatasetFile(slug=file, name=selected.title or file),
            versions=[selected_version],
            selected_version=selected_version,
            schema=schema,
        )


def _dataset_from_catalog(catalog: StacCatalog, collection: str) -> Dataset:
    prefix = f"{collection}/"
    if not catalog.id.startswith(prefix) or catalog.id.count("/") != 1:
        raise CatalogClientError(
            "catalog_contract_invalid", "dataset catalog identity did not match its collection"
        )
    slug = catalog.id.removeprefix(prefix)
    _path_slug(slug, "dataset")
    return Dataset(
        slug=slug,
        name=catalog.title or slug,
        description=catalog.description,
        tags=catalog.hifld_tags,
    )


def _file_from_child(href: str, dataset_id: str, title: str | None) -> DatasetFileSummary:
    parts = [part for part in urlsplit(href).path.split("/") if part]
    if len(parts) < 2 or parts[-1] != "catalog.json":
        raise CatalogClientError("catalog_contract_invalid", "dataset child link is invalid")
    slug = parts[-2]
    _path_slug(slug, "file")
    return DatasetFileSummary(slug=slug, name=title or slug)
