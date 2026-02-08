"""Dataset API endpoints - nested under collections."""

import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from database.db import get_db
from services.datasets import DatasetService
from services.collections import CollectionService
from models.dataset import Collection

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/api/collections/{collection_id}/datasets", tags=["datasets"]
)


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


# Write endpoints removed - use scripts/import_inventory.py for dataset creation
