"""Dataset API endpoints - nested under collections."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from database.db import get_db
from services.datasets import DatasetService
from services.collections import CollectionService
from models.dataset import Collection
from sqlmodel import Session
import json

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
                    import logging

                    logger = logging.getLogger(__name__)
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
        import logging

        logger = logging.getLogger(__name__)
        logger.error(
            f"Error listing datasets for collection {collection_id}: {e}", exc_info=True
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
        import logging

        logger = logging.getLogger(__name__)
        logger.error(
            f"Error getting tag values for collection {collection_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{dataset_id}")
async def get_dataset(
    collection_id: int,
    dataset_id: int,
    include_urls: bool = Query(
        False, description="Include full URLs constructed from storage location"
    ),
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get a single dataset by ID from a collection."""
    dataset = service.get_dataset_by_id(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Verify dataset belongs to collection
    if dataset.collection_id != collection_id:
        raise HTTPException(
            status_code=404, detail="Dataset not found in this collection"
        )

    if include_urls:
        dataset_dict = service.get_dataset_with_urls(dataset_id)
        if not dataset_dict:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return dataset_dict

    return dataset


# Write endpoints removed - use scripts/import_inventory.py for dataset creation
