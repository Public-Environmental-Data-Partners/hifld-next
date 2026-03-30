"""Dataset API endpoints - nested under collections."""

import io
import json
import logging
import mimetypes
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload

from database.db import get_db
from services.datasets import DatasetService
from services.collections import CollectionService
from models.dataset import (
    Collection,
    File,
    FileFormat,
    FileSource,
    FileLocation,
    SpatialDatasetFileMetadata,
)
from storage.storage_client import create_storage_client, create_storage_client_from_location

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/api/collections/{collection_id}/datasets", tags=["datasets"]
)


class DatasetVersionFileUpsert(BaseModel):
    """File-level version payload for dataset promotion."""

    file_slug: str
    path: str
    format_type: str = "geoparquet"
    source_type: Literal["file"] = "file"
    source_metadata: Optional[dict[str, Any]] = None


class DatasetVersionUpsertRequest(BaseModel):
    """Version payload for promoted dataset files."""

    version: str
    storage_location_id: Optional[int] = None
    storage_location_name: Optional[str] = None
    files: list[DatasetVersionFileUpsert] = Field(default_factory=list)
    overwrite_existing: bool = False

    @model_validator(mode="after")
    def validate_storage_location(self):
        if self.storage_location_id is None and not self.storage_location_name:
            raise ValueError(
                "Either storage_location_id or storage_location_name must be provided"
            )
        if not self.files:
            raise ValueError("At least one file entry is required")
        return self


def _metadata_to_dict(source_metadata: Any) -> dict[str, Any]:
    if isinstance(source_metadata, dict):
        return dict(source_metadata)
    if source_metadata and hasattr(source_metadata, "model_dump"):
        return source_metadata.model_dump()
    return {}


def _source_location_dict(file_source: FileSource) -> dict[str, Any]:
    location = file_source.location
    if isinstance(location, dict):
        return location
    if location and hasattr(location, "model_dump"):
        return location.model_dump()
    return {}


def _combine_bounds(bounds_list: list[list[float]]) -> Optional[list[float]]:
    if not bounds_list:
        return None
    min_x = min(b[0] for b in bounds_list)
    min_y = min(b[1] for b in bounds_list)
    max_x = max(b[2] for b in bounds_list)
    max_y = max(b[3] for b in bounds_list)
    return [min_x, min_y, max_x, max_y]


async def _compute_quality_for_source(file_source: FileSource) -> dict[str, Any]:
    """Compute quality metadata for an existing published source."""
    storage_location = file_source.storage_location
    if not storage_location:
        raise ValueError("FileSource has no storage location")

    storage_client = create_storage_client_from_location(storage_location)
    if not storage_client:
        raise ValueError("Storage location is not bucket-backed")

    location = _source_location_dict(file_source)
    source_path = location.get("path")
    if not source_path:
        raise ValueError("FileSource location has no path")

    remote_paths: list[str]
    if "*" in source_path:
        remote_paths = await storage_client.expand_glob_pattern(source_path)
    elif source_path.lower().endswith(".shp"):
        folder_prefix = source_path.rsplit("/", 1)[0] + "/" if "/" in source_path else ""
        stem = Path(source_path).stem
        candidates = await storage_client.list_files(folder_prefix)
        remote_paths = [
            p for p in candidates if Path(p).stem == stem and not p.endswith("/")
        ]
    else:
        remote_paths = [source_path]

    if not remote_paths:
        raise ValueError("No files found for source path")

    import geopandas as gpd

    with tempfile.TemporaryDirectory(prefix="dq_source_") as tmpdir:
        temp_dir = Path(tmpdir)
        local_paths: list[Path] = []
        for remote_path in remote_paths:
            local_path = temp_dir / Path(remote_path).name
            await storage_client.download_file(remote_path, local_path)
            local_paths.append(local_path)

        datasets: list[gpd.GeoDataFrame] = []
        for local_path in local_paths:
            name = local_path.name.lower()
            if name.endswith(".parquet"):
                datasets.append(gpd.read_parquet(local_path))
            elif name.endswith(".zip"):
                extract_dir = temp_dir / f"extract_{local_path.stem}"
                extract_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(local_path, "r") as zf:
                    zf.extractall(extract_dir)
                shp_candidates = list(extract_dir.rglob("*.shp"))
                gpkg_candidates = list(extract_dir.rglob("*.gpkg"))
                if shp_candidates:
                    datasets.append(gpd.read_file(shp_candidates[0]))
                elif gpkg_candidates:
                    datasets.append(gpd.read_file(gpkg_candidates[0]))
            elif name.endswith((".shp", ".gpkg", ".geojson", ".json")):
                datasets.append(gpd.read_file(local_path))

        if not datasets:
            raise ValueError("No supported geospatial file found for quality compute")

        row_count = 0
        invalid_geometry_count = 0
        geometry_types: set[str] = set()
        bounds_list: list[list[float]] = []

        for gdf in datasets:
            row_count += len(gdf)
            if len(gdf) == 0:
                continue
            if hasattr(gdf, "geometry") and gdf.geometry is not None:
                valid = gdf.geometry.is_valid
                invalid_geometry_count += int((~valid).sum())
                geometry_types.update(
                    {
                        str(g)
                        for g in gdf.geometry.geom_type.dropna().unique().tolist()
                        if g
                    }
                )
                if gdf.total_bounds is not None:
                    bounds_list.append([float(v) for v in gdf.total_bounds.tolist()])

        total_size = 0
        for remote_path in remote_paths:
            total_size += await storage_client.get_file_size(remote_path)

        geometry_type = None
        if len(geometry_types) == 1:
            geometry_type = next(iter(geometry_types))
        elif len(geometry_types) > 1:
            geometry_type = "Mixed"

        extension = Path(remote_paths[0]).suffix.lower()
        mime_type = mimetypes.types_map.get(extension) or "application/octet-stream"

        return {
            "version": "v1",
            "feature_count": row_count,
            "invalid_geometry_count": invalid_geometry_count,
            "quality_check_passed": invalid_geometry_count == 0,
            "geometry_type": geometry_type,
            "bounds": _combine_bounds(bounds_list),
            "size_bytes": total_size,
            "mime_type": mime_type,
        }


def get_dataset_service(db: Session = Depends(get_db)) -> DatasetService:
    """Dependency to get dataset service."""
    return DatasetService(db)


def get_collection_service(db: Session = Depends(get_db)) -> CollectionService:
    """Dependency to get collection service."""
    return CollectionService(db)


def verify_collection_exists(
    collection_id: int,
    collection_service: CollectionService = Depends(get_collection_service),
) -> Collection:
    """Dependency to verify collection exists."""
    collection = collection_service.get_collection_by_id(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


@router.get("")
async def list_datasets(
    collection_id: int,
    search: Optional[str] = Query(
        None, max_length=500, description="Search query (max 500 characters)"
    ),
    include_urls: bool = Query(
        False, description="Include full URLs constructed from storage location"
    ),
    limit: Optional[int] = Query(
        None, ge=1, le=1000, description="Maximum number of datasets to return"
    ),
    offset: Optional[int] = Query(None, ge=0, description="Number of datasets to skip"),
    tag_filters: Optional[str] = Query(
        None,
        description="JSON object with tag filters, e.g. {'geometry_type': 'Point', 'categories': ['Boundaries']}",
    ),
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """List datasets in a collection with optional search, tag filters, and pagination."""
    try:
        # Validate and sanitize search query
        if search:
            # Trim whitespace
            search = search.strip()
            # If empty after trimming, treat as None
            if not search:
                search = None
            # Limit length to prevent DoS
            elif len(search) > 500:
                raise HTTPException(
                    status_code=400, detail="Search query too long (max 500 characters)"
                )

        # Parse tag filters from JSON string
        parsed_tag_filters = None
        if tag_filters:
            try:
                parsed_tag_filters = json.loads(tag_filters)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=400, detail="Invalid tag_filters JSON format"
                )

        # Get total count for pagination metadata
        total = service.count_datasets(
            search=search,
            collection_id=collection_id,
            tag_filters=parsed_tag_filters,
        )

        # Get paginated datasets
        datasets = service.get_datasets(
            search=search,
            collection_id=collection_id,
            limit=limit,
            offset=offset,
            tag_filters=parsed_tag_filters,
        )

        if include_urls:
            # Return datasets with computed URLs from formats
            result = []
            for dataset in datasets:
                # Get dataset ID before any operations that might affect the session
                dataset_id = dataset.id
                try:
                    dataset_dict = service.get_dataset_with_urls(dataset_id)
                    if dataset_dict:
                        result.append(dataset_dict)
                except Exception as e:
                    # Log error but continue with other datasets

                    # Use the stored dataset_id instead of accessing dataset.id
                    # which might trigger a lazy load on a rolled-back session
                    logger.error(
                        f"Error getting URLs for dataset {dataset_id}: {e}",
                        exc_info=True,
                    )
                    # Fallback: return dataset without URLs
                    # Use model_dump() which should work even if session is rolled back
                    # since the object was already loaded
                    try:
                        result.append(dataset.model_dump())
                    except Exception as dump_error:
                        # If model_dump() also fails due to session issues,
                        # create a minimal dict with just the ID
                        logger.warning(
                            f"Could not dump dataset {dataset_id}, using minimal dict: {dump_error}"
                        )
                        result.append({"id": dataset_id})

            # Return paginated response with metadata
            return {
                "items": result,
                "total": total,
                "limit": limit,
                "offset": offset or 0,
            }

        # Return paginated response with metadata
        return {
            "items": datasets,
            "total": total,
            "limit": limit,
            "offset": offset or 0,
        }
    except Exception as e:

        logger.error(
            f"Error listing datasets for collection {collection_id}: {e}", exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{dataset_id}/files/{file_id}")
async def get_dataset_file_by_id(
    collection_id: int,
    dataset_id: int,
    file_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get a single file with URLs for a dataset by ID."""
    logger.info(
        "API endpoint called: get_dataset_file_by_id collection_id=%s dataset_id=%s file_id=%s",
        collection_id,
        dataset_id,
        file_id,
    )
    try:
        # Verify dataset belongs to collection
        dataset = service.get_dataset_by_id(dataset_id)
        if not dataset or dataset.collection_id != collection_id:
            raise HTTPException(
                status_code=404, detail="Dataset not found in this collection"
            )

        result = await service.get_dataset_file_with_urls_by_id(
            dataset_id=dataset_id,
            file_id=file_id,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Dataset file not found")
        return result
    except HTTPException:
        raise
    except Exception as e:

        logger.error(
            f"Error getting file {file_id} for dataset {dataset_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/by-slug/{dataset_slug}")
async def get_dataset_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get basic dataset metadata by slug (no files, no URLs)."""
    dataset = service.get_dataset_by_slug(
        collection_id=collection_id, slug=dataset_slug
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.get("/by-slug/{dataset_slug}/files")
async def get_dataset_with_files_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset with files list by slug (no URLs). Used for file tree display."""
    dataset = service.get_dataset_by_slug(
        collection_id=collection_id, slug=dataset_slug
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_dict = service.get_dataset_with_files(dataset.id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/by-slug/{dataset_slug}/urls")
async def get_dataset_with_urls_by_slug(
    collection_id: int,
    dataset_slug: str,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset with full URLs by slug. Used for file detail pages."""
    dataset = service.get_dataset_by_slug(
        collection_id=collection_id, slug=dataset_slug
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_dict = service.get_dataset_with_urls(dataset.id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/by-slug/{dataset_slug}/files/{file_slug}")
async def get_dataset_file_by_slug(
    collection_id: int,
    dataset_slug: str,
    file_slug: str,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get a single file with URLs for a dataset by slug."""
    logger.info(
        "API endpoint called: get_dataset_file_by_slug collection_id=%s dataset_slug=%s file_slug=%s",
        collection_id,
        dataset_slug,
        file_slug,
    )
    try:
        result = await service.get_dataset_file_with_urls(
            collection_id=collection_id,
            dataset_slug=dataset_slug,
            file_slug=file_slug,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Dataset file not found")
        return result
    except HTTPException:
        raise
    except Exception as e:

        logger.error(
            f"Error getting file {file_slug} for dataset {dataset_slug}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/stats")
async def get_collection_stats(
    collection_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset statistics for a collection."""
    # Use count_datasets() instead of loading all datasets into memory
    total = service.count_datasets(collection_id=collection_id)
    return {
        "total": total,
        "collection_id": collection_id,
    }


@router.get("/tags")
async def get_collection_tag_values(
    collection_id: int,
    tag_key: Optional[str] = Query(None, description="Optional tag key to filter by"),
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get available tag values for datasets in a collection."""
    try:
        tag_values = service.get_available_tag_values(
            collection_id=collection_id, tag_key=tag_key
        )
        return tag_values
    except Exception as e:

        logger.error(
            f"Error getting tag values for collection {collection_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{dataset_id}")
async def get_dataset(
    collection_id: int,
    dataset_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get basic dataset metadata (no files, no URLs)."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Verify dataset belongs to collection
    if dataset.collection_id != collection_id:
        raise HTTPException(
            status_code=404, detail="Dataset not found in this collection"
        )

    return dataset


@router.get("/{dataset_id}/files")
async def get_dataset_with_files(
    collection_id: int,
    dataset_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset with files list (no URLs). Used for file tree display."""
    # Verify dataset belongs to collection
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.collection_id != collection_id:
        raise HTTPException(
            status_code=404, detail="Dataset not found in this collection"
        )

    dataset_dict = service.get_dataset_with_files(dataset_id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get("/{dataset_id}/urls")
async def get_dataset_with_urls(
    collection_id: int,
    dataset_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset with full URLs. Used for file detail pages."""
    # Verify dataset belongs to collection
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if dataset.collection_id != collection_id:
        raise HTTPException(
            status_code=404, detail="Dataset not found in this collection"
        )

    dataset_dict = service.get_dataset_with_urls(dataset_id)
    if not dataset_dict:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset_dict


@router.get(
    "/by-slug/{dataset_slug}/files/{file_slug}/sources/{source_id}/download-zip"
)
async def download_shapefile_zip(
    collection_id: int,
    dataset_slug: str,
    file_slug: str,
    source_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
    db: Session = Depends(get_db),
):
    """Download all files in a shapefile folder as a zip file.

    This endpoint is specifically for shapefile formats, which consist of multiple
    files (.shp, .shx, .dbf, .prj, etc.) that need to be downloaded together.
    """
    try:
        # Verify dataset and file exist
        result = await service.get_dataset_file_with_urls(
            collection_id=collection_id,
            dataset_slug=dataset_slug,
            file_slug=file_slug,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Dataset file not found")

        # Find the file source with relationships loaded
        from sqlmodel import select
        from sqlalchemy.orm import selectinload

        statement = (
            select(FileSource)
            .where(FileSource.id == source_id)
            .options(
                selectinload(FileSource.file_format).selectinload(FileFormat.format),
                selectinload(FileSource.storage_location),
            )
        )
        file_source = db.exec(statement).first()
        if not file_source:
            raise HTTPException(status_code=404, detail="File source not found")

        # Verify the source belongs to a shapefile format
        if not file_source.file_format or not file_source.file_format.format:
            raise HTTPException(
                status_code=400, detail="File source format information not available"
            )

        if file_source.file_format.format.format_type != "shapefile":
            raise HTTPException(
                status_code=400, detail="This endpoint is only for shapefile formats"
            )

        # Get storage location and client
        storage_location = file_source.storage_location
        if not storage_location:
            raise HTTPException(status_code=404, detail="Storage location not found")

        logger.info(
            f"Creating shapefile zip for source {source_id}, "
            f"storage_location: {storage_location.name}, "
            f"backend_type: {storage_location.backend_type}"
        )

        # Create storage client
        # For SeaweedFS, backend_type is "s3" but we need to use "seaweedfs" for create_storage_client
        # Check the config to determine the actual storage type
        config = dict(storage_location.config)
        storage_type = config.get("type", storage_location.backend_type)
        if storage_type == "s3" and "base_url" in config:
            # This is SeaweedFS (S3-compatible)
            storage_type = "seaweedfs"

        storage_client = create_storage_client(storage_type=storage_type, **config)

        # Extract the folder path from the source path
        location = file_source.location
        if not location or location.get("type") != "file":
            raise HTTPException(status_code=400, detail="Invalid file source location")

        source_path = location.get("path", "")
        if not source_path:
            raise HTTPException(status_code=400, detail="Source path is empty")

        # Extract folder path (remove filename, keep directory)
        # e.g., "dataset/shapefile/file.shp" -> "dataset/shapefile/"
        path_parts = source_path.rsplit("/", 1)
        if len(path_parts) == 2:
            folder_path = path_parts[0] + "/"
        else:
            # If no slash, assume it's just a filename in root
            folder_path = ""

        logger.info(f"Listing files in folder: {folder_path}")

        # List all files in the folder
        try:
            all_files = await storage_client.list_files(folder_path)
            logger.info(f"Found {len(all_files)} files in folder: {folder_path}")
        except Exception as e:
            logger.error(
                f"Error listing files in folder {folder_path}: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail=f"Error listing files in storage: {str(e)}"
            )

        if not all_files:
            logger.warning(f"No files found in folder: {folder_path}")
            raise HTTPException(
                status_code=404, detail=f"No files found in folder: {folder_path}"
            )

        # Create a temporary zip file in memory
        zip_buffer = io.BytesIO()
        files_added = 0

        try:
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
                # Download each file and add to zip
                with tempfile.TemporaryDirectory() as temp_dir:
                    for file_path in all_files:
                        try:
                            logger.debug(f"Downloading file: {file_path}")
                            # Download file to temp location
                            local_file = Path(temp_dir) / Path(file_path).name
                            await storage_client.download_file(file_path, local_file)

                            if not local_file.exists():
                                logger.warning(f"File was not downloaded: {file_path}")
                                continue

                            # Add to zip with just the filename (not full path)
                            zip_file.write(local_file, Path(file_path).name)
                            files_added += 1
                            logger.debug(f"Added {file_path} to zip")
                        except Exception as e:
                            logger.warning(
                                f"Failed to add {file_path} to zip: {e}", exc_info=True
                            )
                            continue

            if files_added == 0:
                raise HTTPException(
                    status_code=500,
                    detail="No files were successfully added to the zip archive",
                )

            logger.info(f"Created zip with {files_added} files")
        except Exception as e:
            logger.error(f"Error creating zip file: {e}", exc_info=True)
            raise HTTPException(
                status_code=500, detail=f"Error creating zip file: {str(e)}"
            )

        # Prepare zip file for download
        zip_buffer.seek(0)

        # Generate filename from dataset and file slugs
        zip_filename = f"{dataset_slug}_{file_slug}_shapefile.zip"

        # Use iter to stream the bytes
        def generate():
            zip_buffer.seek(0)
            while True:
                chunk = zip_buffer.read(8192)  # Read in 8KB chunks
                if not chunk:
                    break
                yield chunk

        return StreamingResponse(
            generate(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_filename}"',
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error creating shapefile zip for source {source_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/by-slug/{dataset_slug}/versions")
async def upsert_dataset_version(
    collection_id: int,
    dataset_slug: str,
    request: DatasetVersionUpsertRequest,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Upsert published version records and source metadata for dataset files."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    storage_location = None
    if request.storage_location_id is not None:
        storage_location = service.get_storage_location(request.storage_location_id)
    elif request.storage_location_name:
        storage_location = service.get_storage_location_by_name(
            request.storage_location_name
        )
    if not storage_location:
        raise HTTPException(status_code=404, detail="Storage location not found")

    created_sources = []
    updated_sources = []
    skipped_sources = []

    for file_entry in request.files:
        file_obj = service.get_file_by_slug(dataset.id, file_entry.file_slug)
        if not file_obj:
            # Create missing file rows for first-time promotions.
            file_obj = File(
                dataset_id=dataset.id,
                slug=file_entry.file_slug,
                name=file_entry.file_slug.replace("_", " "),
                description=dataset.description,
            )
            service.db.add(file_obj)
            service.db.commit()
            service.db.refresh(file_obj)

        try:
            file_format = service.get_or_create_file_format_for_file(
                file_obj.id, file_entry.format_type
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        metadata_dict = file_entry.source_metadata or {}
        if metadata_dict and "version" not in metadata_dict:
            metadata_dict["version"] = "v1"
        if metadata_dict:
            metadata_dict = SpatialDatasetFileMetadata(**metadata_dict).model_dump()

        location_dict = FileLocation(path=file_entry.path).model_dump()

        existing = service.get_format_source_by_location(
            file_format.id, storage_location.id, request.version
        )
        if existing and not request.overwrite_existing:
            skipped_sources.append(
                {
                    "file_slug": file_entry.file_slug,
                    "source_id": existing.id,
                    "reason": "already_exists",
                }
            )
            continue

        if existing:
            updated = service.update_format_source(
                existing.id,
                location_dict,
                metadata_dict,
            )
            updated_sources.append(
                {
                    "file_slug": file_entry.file_slug,
                    "source_id": updated.id if updated else existing.id,
                }
            )
            continue

        created = service.add_format_source(
            file_format_id=file_format.id,
            storage_location_id=storage_location.id,
            source_type=file_entry.source_type,
            location=location_dict,
            source_metadata=metadata_dict,
            version=request.version,
        )
        created_sources.append({"file_slug": file_entry.file_slug, "source_id": created.id})

    return {
        "dataset_slug": dataset_slug,
        "version": request.version,
        "storage_location_id": storage_location.id,
        "created": created_sources,
        "updated": updated_sources,
        "skipped": skipped_sources,
    }


@router.post("/by-slug/{dataset_slug}/files/{file_slug}/sources/{source_id}/compute-quality")
async def compute_source_quality(
    collection_id: int,
    dataset_slug: str,
    file_slug: str,
    source_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
    db: Session = Depends(get_db),
):
    """Compute quality metadata from a published file source and persist it."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    file_obj = service.get_file_by_slug(dataset.id, file_slug)
    if not file_obj:
        raise HTTPException(status_code=404, detail="File not found")

    statement = (
        select(FileSource)
        .where(FileSource.id == source_id)
        .join(FileFormat, FileSource.file_format_id == FileFormat.id)
        .where(FileFormat.file_id == file_obj.id)
        .options(selectinload(FileSource.storage_location))
    )
    file_source = db.exec(statement).first()
    if not file_source:
        raise HTTPException(status_code=404, detail="File source not found")

    try:
        quality = await _compute_quality_for_source(file_source)
        updated = service.update_source_metadata(file_source.id, quality)
    except Exception as exc:
        logger.error("Failed to compute source quality for %s: %s", source_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compute quality: {exc}") from exc

    return {
        "dataset_slug": dataset_slug,
        "file_slug": file_slug,
        "source_id": source_id,
        "version": file_source.version,
        "source_metadata": _metadata_to_dict(updated.source_metadata if updated else file_source.source_metadata),
    }


@router.get("/by-slug/{dataset_slug}/quality")
async def get_dataset_quality_comparison(
    collection_id: int,
    dataset_slug: str,
    file_slug: Optional[str] = Query(None),
    format_type: Optional[str] = Query(None),
    storage_location_id: Optional[int] = Query(None),
    storage_location_name: Optional[str] = Query(None),
    compute_if_missing: bool = Query(False),
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
    db: Session = Depends(get_db),
):
    """Return latest and original published quality snapshots for comparison."""
    dataset = service.get_dataset_by_slug(collection_id=collection_id, slug=dataset_slug)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    files_statement = select(File).where(File.dataset_id == dataset.id)
    if file_slug:
        files_statement = files_statement.where(File.slug == file_slug)
    files = list(db.exec(files_statement).all())
    if not files:
        raise HTTPException(status_code=404, detail="No matching files found")

    selected_storage_id = storage_location_id
    if storage_location_name and not selected_storage_id:
        storage = service.get_storage_location_by_name(storage_location_name)
        if not storage:
            raise HTTPException(status_code=404, detail="Storage location not found")
        selected_storage_id = storage.id

    results = []
    for file_obj in files:
        format_stmt = (
            select(FileFormat)
            .where(FileFormat.file_id == file_obj.id)
            .options(selectinload(FileFormat.format))
        )
        file_formats = list(db.exec(format_stmt).all())
        for file_format in file_formats:
            if format_type and (
                not file_format.format
                or file_format.format.format_type != format_type
            ):
                continue

            source_stmt = (
                select(FileSource)
                .where(FileSource.file_format_id == file_format.id)
                .options(selectinload(FileSource.storage_location))
                .order_by(FileSource.version.desc())
            )
            if selected_storage_id:
                source_stmt = source_stmt.where(
                    FileSource.storage_location_id == selected_storage_id
                )
            sources = list(db.exec(source_stmt).all())
            if not sources:
                continue

            latest = sources[0]
            original = sources[-1]

            for candidate in [latest, original]:
                metadata = _metadata_to_dict(candidate.source_metadata)
                if compute_if_missing and "feature_count" not in metadata:
                    computed = await _compute_quality_for_source(candidate)
                    service.update_source_metadata(candidate.id, computed)

            latest_meta = _metadata_to_dict(
                service.db.get(FileSource, latest.id).source_metadata
            )
            original_meta = _metadata_to_dict(
                service.db.get(FileSource, original.id).source_metadata
            )

            latest_count = latest_meta.get("feature_count")
            original_count = original_meta.get("feature_count")
            row_delta = (
                latest_count - original_count
                if isinstance(latest_count, int) and isinstance(original_count, int)
                else None
            )

            results.append(
                {
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
            )

    return {
        "dataset_slug": dataset_slug,
        "file_slug": file_slug,
        "results": results,
    }


# Write endpoints removed - use scripts/import_datasets.py for dataset ingestion
