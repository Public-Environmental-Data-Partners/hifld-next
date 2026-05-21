"""Dataset API endpoints - nested under collections."""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session, col, select

from database.db import get_db
from models.dataset import (
    Collection,
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from schemas.types import APIDict, APIList, JSONDict, model_json_dict
from services.collections import CollectionService
from services.dataset import DatasetService, FormatSourceCreate
from services.dataset.downloads import shapefile_zip_response
from services.dataset.quality import compute_quality_for_source, metadata_to_dict


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/collections/{collection_id}/datasets", tags=["datasets"])
DBSessionDep = Annotated[Session, Depends(get_db)]


class DatasetVersionFileUpsert(BaseModel):
    """File-level version payload for dataset promotion."""

    file_slug: str
    path: str
    format_type: str = "geoparquet"
    source_type: Literal["file"] = "file"
    source_metadata: JSONDict | None = None


class DatasetVersionUpsertRequest(BaseModel):
    """Version payload for promoted dataset files."""

    version: str
    storage_location_id: int | None = None
    storage_location_name: str | None = None
    files: list[DatasetVersionFileUpsert] = Field(default_factory=list)
    overwrite_existing: bool = False

    @model_validator(mode="after")
    def validate_storage_location(self) -> "DatasetVersionUpsertRequest":
        """Validate that the version payload has a storage target and files."""
        if self.storage_location_id is None and not self.storage_location_name:
            msg = "Either storage_location_id or storage_location_name must be provided"
            raise ValueError(msg)
        if not self.files:
            msg = "At least one file entry is required"
            raise ValueError(msg)
        return self


MAX_SEARCH_LENGTH = 500


def get_dataset_service(db: DBSessionDep) -> DatasetService:
    """Dependency to get dataset service."""
    return DatasetService(db)


DatasetServiceDep = Annotated[DatasetService, Depends(get_dataset_service)]


def get_collection_service(db: DBSessionDep) -> CollectionService:
    """Dependency to get collection service."""
    return CollectionService(db)


CollectionServiceDep = Annotated[CollectionService, Depends(get_collection_service)]


def verify_collection_exists(
    collection_id: int,
    collection_service: CollectionServiceDep,
) -> Collection:
    """Dependency to verify collection exists."""
    collection = collection_service.get_collection_by_id(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


CollectionDep = Annotated[Collection, Depends(verify_collection_exists)]


@dataclass(slots=True)
class DatasetListQuery:
    """Dataset list query parameters."""

    search: str | None = None
    include_urls: bool = False
    limit: int | None = None
    offset: int | None = None
    tag_filters: str | None = None


def dataset_list_query(
    search: str | None = Query(None, max_length=MAX_SEARCH_LENGTH, description="Search query (max 500 characters)"),
    include_urls: bool = Query(False, description="Include full URLs constructed from storage location"),
    limit: int | None = Query(None, ge=1, le=1000, description="Maximum number of datasets to return"),
    offset: int | None = Query(None, ge=0, description="Number of datasets to skip"),
    tag_filters: str | None = Query(
        None,
        description="JSON object with tag filters, e.g. {'geometry_type': 'Point', 'categories': ['Boundaries']}",
    ),
) -> DatasetListQuery:
    """Build list query parameters."""
    return DatasetListQuery(
        search=search,
        include_urls=include_urls,
        limit=limit,
        offset=offset,
        tag_filters=tag_filters,
    )


DatasetListQueryDep = Annotated[DatasetListQuery, Depends(dataset_list_query)]


@dataclass(slots=True)
class DatasetFileSourceContext:
    """Route context for file source operations."""

    collection_id: int
    dataset_slug: str
    file_slug: str
    source_id: int
    service: DatasetService
    db: Session


def dataset_file_source_context(
    request: Request,
    _collection: CollectionDep,
    service: DatasetServiceDep,
    db: DBSessionDep,
) -> DatasetFileSourceContext:
    """Build file source route context from path params."""
    path_params = request.path_params
    return DatasetFileSourceContext(
        collection_id=int(path_params["collection_id"]),
        dataset_slug=str(path_params["dataset_slug"]),
        file_slug=str(path_params["file_slug"]),
        source_id=int(path_params["source_id"]),
        service=service,
        db=db,
    )


DatasetFileSourceContextDep = Annotated[DatasetFileSourceContext, Depends(dataset_file_source_context)]


@dataclass(slots=True)
class DatasetSlugContext:
    """Route context for dataset slug operations needing a DB session."""

    collection_id: int
    dataset_slug: str
    service: DatasetService
    db: Session


def dataset_slug_context(
    request: Request,
    _collection: CollectionDep,
    service: DatasetServiceDep,
    db: DBSessionDep,
) -> DatasetSlugContext:
    """Build dataset slug context from path params."""
    return DatasetSlugContext(
        collection_id=int(request.path_params["collection_id"]),
        dataset_slug=str(request.path_params["dataset_slug"]),
        service=service,
        db=db,
    )


DatasetSlugContextDep = Annotated[DatasetSlugContext, Depends(dataset_slug_context)]


@dataclass(slots=True)
class QualityQuery:
    """Quality comparison query parameters."""

    file_slug: str | None = None
    format_type: str | None = None
    storage_location_id: int | None = None
    storage_location_name: str | None = None
    compute_if_missing: bool = False


def quality_query(
    file_slug: str | None = Query(None),
    format_type: str | None = Query(None),
    storage_location_id: int | None = Query(None),
    storage_location_name: str | None = Query(None),
    compute_if_missing: bool = Query(False),
) -> QualityQuery:
    """Build quality comparison query parameters."""
    return QualityQuery(
        file_slug=file_slug,
        format_type=format_type,
        storage_location_id=storage_location_id,
        storage_location_name=storage_location_name,
        compute_if_missing=compute_if_missing,
    )


QualityQueryDep = Annotated[QualityQuery, Depends(quality_query)]


def normalize_search(search: str | None) -> str | None:
    """Normalize and validate a dataset search query."""
    if not search:
        return None
    normalized = search.strip()
    if not normalized:
        return None
    if len(normalized) > MAX_SEARCH_LENGTH:
        raise HTTPException(status_code=400, detail="Search query too long (max 500 characters)")
    return normalized


def parse_tag_filters(tag_filters: str | None) -> dict[str, str | list[str]] | None:
    """Parse JSON tag filters from a query string."""
    if not tag_filters:
        return None
    try:
        parsed = json.loads(tag_filters)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid tag_filters JSON format") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="tag_filters must be a JSON object")
    filters: dict[str, str | list[str]] = {}
    for key, value in parsed.items():
        if not isinstance(key, str) or not isinstance(value, (str, list)):
            raise HTTPException(status_code=400, detail="tag_filters values must be strings or string lists")
        if isinstance(value, list) and not all(isinstance(item, str) for item in value):
            raise HTTPException(status_code=400, detail="tag_filters list values must contain only strings")
        filters[key] = value
    return filters


@router.get("", response_model=None)
async def list_datasets(
    collection_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
    query: DatasetListQueryDep,
) -> APIDict:
    """List datasets in a collection with optional search, tag filters, and pagination."""
    search = normalize_search(query.search)
    parsed_tag_filters = parse_tag_filters(query.tag_filters)
    total = service.count_datasets(search=search, collection_id=collection_id, tag_filters=parsed_tag_filters)
    datasets = service.get_datasets(
        search=search,
        collection_id=collection_id,
        limit=query.limit,
        offset=query.offset,
        tag_filters=parsed_tag_filters,
    )
    if query.include_urls:
        return {
            "items": datasets_with_urls(service, datasets),
            "total": total,
            "limit": query.limit,
            "offset": query.offset or 0,
        }
    return {
        "items": [model_json_dict(dataset) for dataset in datasets],
        "total": total,
        "limit": query.limit,
        "offset": query.offset or 0,
    }


def datasets_with_urls(service: DatasetService, datasets: Sequence[Dataset]) -> APIList:
    """Shape dataset list items with URLs when possible."""
    result: APIList = []
    for dataset in datasets:
        dataset_id = dataset.id
        try:
            dataset_dict = service.get_dataset_with_urls(dataset_id)
            if dataset_dict:
                result.append(dataset_dict)
        except Exception as exc:
            logger.error("Error getting URLs for dataset %s: %s", dataset_id, exc, exc_info=True)
            try:
                result.append(model_json_dict(dataset))
            except Exception as dump_error:
                logger.warning("Could not dump dataset %s, using minimal dict: %s", dataset_id, dump_error)
                result.append({"id": dataset_id})
    return result


@router.get("/{dataset_id}/files/{file_id}", response_model=None)
async def get_dataset_file_by_id(
    collection_id: int,
    dataset_id: int,
    file_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get a single file with URLs for a dataset by ID."""
    logger.info(
        "API endpoint called: get_dataset_file_by_id collection_id=%s dataset_id=%s file_id=%s",
        collection_id,
        dataset_id,
        file_id,
    )
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset or dataset.collection_id != collection_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this collection")
    result = await service.get_dataset_file_with_urls_by_id(dataset_id=dataset_id, file_id=file_id)
    if not result:
        raise HTTPException(status_code=404, detail="Dataset file not found")
    return result


@router.get("/{dataset_id}/files/{file_id}/versions", response_model=None)
async def get_dataset_file_versions_by_id(
    collection_id: int,
    dataset_id: int,
    file_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get full version history for a file across all formats and storage locations."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset or dataset.collection_id != collection_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this collection")

    result = await service.get_dataset_file_with_urls_by_id(
        dataset_id=dataset_id,
        file_id=file_id,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Dataset file not found")

    file_payload = result.get("file")
    formats = file_payload.get("formats", []) if isinstance(file_payload, dict) else []
    return {
        "dataset_id": dataset_id,
        "file_id": file_id,
        "formats": formats,
    }


@router.get("/by-slug/{dataset_slug}")
async def get_dataset_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> Dataset:
    """Get basic dataset metadata by slug (no files, no URLs)."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.get("/by-slug/{dataset_slug}/files", response_model=None)
async def get_dataset_with_files_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get dataset with files list by slug (no URLs). Used for file tree display."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_dict = service.get_dataset_with_files(dataset.id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/by-slug/{dataset_slug}/urls", response_model=None)
async def get_dataset_with_urls_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get dataset with full URLs by slug. Used for file detail pages."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_dict = service.get_dataset_with_urls(dataset.id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/by-slug/{dataset_slug}/files/{file_slug}", response_model=None)
async def get_dataset_file_by_slug(
    collection_id: int,
    dataset_slug: str,
    file_slug: str,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get a single file with URLs for a dataset by slug."""
    logger.info(
        "API endpoint called: get_dataset_file_by_slug collection_id=%s dataset_slug=%s file_slug=%s",
        collection_id,
        dataset_slug,
        file_slug,
    )
    result = await service.get_dataset_file_with_urls(
        collection_id=collection_id,
        dataset_slug=dataset_slug,
        file_slug=file_slug,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Dataset file not found")
    return result


@router.get("/stats", response_model=None)
async def get_collection_stats(
    collection_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get dataset statistics for a collection."""
    total = service.count_datasets(collection_id=collection_id)
    return {
        "total": total,
        "collection_id": collection_id,
    }


@router.get("/tags")
async def get_collection_tag_values(
    collection_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
    tag_key: str | None = Query(None, description="Optional tag key to filter by"),
) -> dict[str, list[str]]:
    """Get available tag values for datasets in a collection."""
    return service.get_available_tag_values(collection_id=collection_id, tag_key=tag_key)


@router.get("/{dataset_id}")
async def get_dataset(
    collection_id: int,
    dataset_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> Dataset:
    """Get basic dataset metadata (no files, no URLs)."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.collection_id != collection_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this collection")

    return dataset


@router.get("/{dataset_id}/files", response_model=None)
async def get_dataset_with_files(
    collection_id: int,
    dataset_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get dataset with files list (no URLs). Used for file tree display."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.collection_id != collection_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this collection")

    dataset_dict = service.get_dataset_with_files(dataset_id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/{dataset_id}/urls", response_model=None)
async def get_dataset_with_urls(
    collection_id: int,
    dataset_id: int,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Get dataset with full URLs. Used for file detail pages."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.collection_id != collection_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this collection")

    dataset_dict = service.get_dataset_with_urls(dataset_id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/by-slug/{dataset_slug}/files/{file_slug}/sources/{source_id}/download-zip", response_model=None)
async def download_shapefile_zip(
    context: DatasetFileSourceContextDep,
) -> Response:
    """Download all files in a shapefile folder as a zip file.

    This endpoint is specifically for shapefile formats, which consist of multiple
    files (.shp, .shx, .dbf, .prj, etc.) that need to be downloaded together.
    """
    result = await context.service.get_dataset_file_with_urls(
        collection_id=context.collection_id,
        dataset_slug=context.dataset_slug,
        file_slug=context.file_slug,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Dataset file not found")
    return await shapefile_zip_response(
        db=context.db,
        source_id=context.source_id,
        dataset_slug=context.dataset_slug,
        file_slug=context.file_slug,
    )


@router.post("/by-slug/{dataset_slug}/versions", response_model=None)
async def upsert_dataset_version(
    collection_id: int,
    dataset_slug: str,
    request: DatasetVersionUpsertRequest,
    _collection: CollectionDep,
    service: DatasetServiceDep,
) -> APIDict:
    """Upsert published version records and source metadata for dataset files."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    storage_location = resolve_version_storage_location(service, request)

    created_sources = []
    updated_sources = []
    skipped_sources = []

    for file_entry in request.files:
        outcome = upsert_version_file_source(service, dataset, storage_location, request, file_entry)
        if outcome["status"] == "created":
            created_sources.append(outcome["payload"])
        elif outcome["status"] == "updated":
            updated_sources.append(outcome["payload"])
        else:
            skipped_sources.append(outcome["payload"])

    return {
        "dataset_slug": dataset_slug,
        "version": request.version,
        "storage_location_id": storage_location.id,
        "created": created_sources,
        "updated": updated_sources,
        "skipped": skipped_sources,
    }


def resolve_version_storage_location(
    service: DatasetService,
    request: DatasetVersionUpsertRequest,
) -> StorageLocation:
    """Resolve the storage target for a version upsert request."""
    storage_location = None
    if request.storage_location_id is not None:
        storage_location = service.get_storage_location(request.storage_location_id)
    elif request.storage_location_name:
        storage_location = service.get_storage_location_by_name(request.storage_location_name)
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")
    return storage_location


def upsert_version_file_source(
    service: DatasetService,
    dataset: Dataset,
    storage_location: StorageLocation,
    request: DatasetVersionUpsertRequest,
    file_entry: DatasetVersionFileUpsert,
) -> APIDict:
    """Create, update, or skip one file source for a dataset version."""
    file_obj = get_or_create_version_file(service, dataset, file_entry)
    try:
        file_format = service.get_or_create_file_format_for_file(file_obj.id, file_entry.format_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    source_metadata = version_file_metadata(file_entry)
    location = FileLocation(path=file_entry.path)
    existing = service.get_format_source_by_location(file_format.id, storage_location.id, request.version)
    if existing and not request.overwrite_existing:
        return {
            "status": "skipped",
            "payload": {"file_slug": file_entry.file_slug, "source_id": existing.id, "reason": "already_exists"},
        }
    if existing:
        updated = service.update_format_source(existing.id, location, source_metadata)
        return {
            "status": "updated",
            "payload": {"file_slug": file_entry.file_slug, "source_id": updated.id if updated else existing.id},
        }
    created = service.add_format_source(
        FormatSourceCreate(
            file_format_id=file_format.id,
            storage_location_id=storage_location.id,
            source_type=file_entry.source_type,
            location=location,
            source_metadata=source_metadata,
            version=request.version,
        )
    )
    return {"status": "created", "payload": {"file_slug": file_entry.file_slug, "source_id": created.id}}


def get_or_create_version_file(
    service: DatasetService,
    dataset: Dataset,
    file_entry: DatasetVersionFileUpsert,
) -> File:
    """Return an existing version file or create the catalog row."""
    file_obj = service.get_file_by_slug(dataset.id, file_entry.file_slug)
    if file_obj:
        return file_obj
    file_obj = File(
        dataset_id=dataset.id,
        slug=file_entry.file_slug,
        name=file_entry.file_slug.replace("_", " "),
        description=dataset.description,
    )
    service.db.add(file_obj)
    service.db.commit()
    service.db.refresh(file_obj)
    return file_obj


def version_file_metadata(file_entry: DatasetVersionFileUpsert) -> SpatialDatasetFileMetadata | None:
    """Normalize source metadata from a version file payload."""
    metadata_dict = dict(file_entry.source_metadata or {})
    if metadata_dict and "version" not in metadata_dict:
        metadata_dict["version"] = "v1"
    if not metadata_dict:
        return None
    return SpatialDatasetFileMetadata.model_validate(metadata_dict)


@router.post("/by-slug/{dataset_slug}/files/{file_slug}/sources/{source_id}/compute-quality", response_model=None)
async def compute_source_quality(
    context: DatasetFileSourceContextDep,
) -> APIDict:
    """Compute quality metadata from a published file source and persist it."""
    dataset = context.service.get_dataset_by_slug(collection_id=context.collection_id, slug=context.dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    file_obj = context.service.get_file_by_slug(dataset.id, context.file_slug)
    if not file_obj:
        raise HTTPException(status_code=404, detail="File not found")

    statement = (
        select(FileSource)
        .where(FileSource.id == context.source_id)
        .join(FileFormat, col(FileSource.file_format_id) == col(FileFormat.id))
        .where(FileFormat.file_id == file_obj.id)
    )
    file_source = context.db.exec(statement).first()
    if not file_source:
        raise HTTPException(status_code=404, detail="File source not found")

    try:
        quality = await compute_quality_for_source(file_source)
        updated = context.service.update_source_metadata(file_source.id, quality)
    except Exception as exc:
        logger.error("Failed to compute source quality for %s: %s", context.source_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compute quality: {exc}") from exc

    return {
        "dataset_slug": context.dataset_slug,
        "file_slug": context.file_slug,
        "source_id": context.source_id,
        "version": file_source.version,
        "source_metadata": metadata_to_dict(updated.source_metadata if updated else file_source.source_metadata),
    }


@router.get("/by-slug/{dataset_slug}/quality", response_model=None)
async def get_dataset_quality_comparison(
    context: DatasetSlugContextDep,
    query: QualityQueryDep,
) -> APIDict:
    """Return latest and original published quality snapshots for comparison."""
    dataset = context.service.get_dataset_by_slug(collection_id=context.collection_id, slug=context.dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    results = await quality_comparison_results(context, query, dataset.id)
    return {
        "dataset_slug": context.dataset_slug,
        "file_slug": query.file_slug,
        "results": results,
    }


async def quality_comparison_results(
    context: DatasetSlugContext,
    query: QualityQuery,
    dataset_id: int,
) -> APIList:
    """Build quality comparison rows for a dataset."""
    files_statement = select(File).where(File.dataset_id == dataset_id)
    if query.file_slug:
        files_statement = files_statement.where(File.slug == query.file_slug)
    files = list(context.db.exec(files_statement).all())
    if not files:
        raise HTTPException(status_code=404, detail="No matching files found")

    selected_storage_id = query.storage_location_id
    if query.storage_location_name and not selected_storage_id:
        storage = context.service.get_storage_location_by_name(query.storage_location_name)
        if not storage:
            raise HTTPException(status_code=404, detail="Storage location not found")
        selected_storage_id = storage.id

    results = []
    for file_obj in files:
        results.extend(await quality_rows_for_file(context, query, file_obj, selected_storage_id))
    return results


async def quality_rows_for_file(
    context: DatasetSlugContext,
    query: QualityQuery,
    file_obj: File,
    selected_storage_id: int | None,
) -> APIList:
    """Build quality comparison rows for one file."""
    rows = []
    format_stmt = select(FileFormat).where(col(FileFormat.file_id) == file_obj.id)
    file_formats = list(context.db.exec(format_stmt).all())
    for file_format in file_formats:
        if query.format_type and (not file_format.format or file_format.format.format_type != query.format_type):
            continue
        sources = quality_sources_for_format(context, file_format, selected_storage_id)
        if sources:
            rows.append(await quality_row_for_sources(context, query, file_obj, file_format, sources))
    return rows


def quality_sources_for_format(
    context: DatasetSlugContext,
    file_format: FileFormat,
    selected_storage_id: int | None,
) -> list[FileSource]:
    """Load quality comparison sources for a file format."""
    source_stmt = (
        select(FileSource).where(FileSource.file_format_id == file_format.id).order_by(col(FileSource.version).desc())
    )
    if selected_storage_id:
        source_stmt = source_stmt.where(FileSource.storage_location_id == selected_storage_id)
    return list(context.db.exec(source_stmt).all())


async def quality_row_for_sources(
    context: DatasetSlugContext,
    query: QualityQuery,
    file_obj: File,
    file_format: FileFormat,
    sources: list[FileSource],
) -> APIDict:
    """Build a single quality comparison row from ordered sources."""
    latest = sources[0]
    original = sources[-1]
    for candidate in [latest, original]:
        metadata = metadata_to_dict(candidate.source_metadata)
        if query.compute_if_missing and "feature_count" not in metadata:
            computed = await compute_quality_for_source(candidate)
            context.service.update_source_metadata(candidate.id, computed)

    latest_source = context.service.db.get(FileSource, latest.id) or latest
    original_source = context.service.db.get(FileSource, original.id) or original
    latest_meta = metadata_to_dict(latest_source.source_metadata)
    original_meta = metadata_to_dict(original_source.source_metadata)
    latest_count = latest_meta.get("feature_count")
    original_count = original_meta.get("feature_count")
    row_delta = (
        latest_count - original_count if isinstance(latest_count, int) and isinstance(original_count, int) else None
    )
    return {
        "file_slug": file_obj.slug,
        "format_type": file_format.format.format_type if file_format.format else None,
        "storage_location_id": latest.storage_location_id,
        "latest_published": {
            "source_id": latest.id,
            "version": latest.version,
            "quality": latest_meta,
        },
        "original": {
            "source_id": original.id,
            "version": original.version,
            "quality": original_meta,
        },
        "diff": {"feature_count_delta": row_delta},
    }
