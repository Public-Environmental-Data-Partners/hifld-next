"""Dataset API endpoints - nested under collections."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from database.db import get_db
from services.datasets import DatasetService
from services.collections import CollectionService
from models.dataset import Dataset, Collection
from sqlmodel import Session, SQLModel

router = APIRouter(prefix="/api/collections/{collection_id}/datasets", tags=["datasets"])


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
    search: Optional[str] = Query(None),
    include_urls: bool = Query(False, description="Include full URLs constructed from storage location"),
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """List all datasets in a collection with optional search."""
    datasets = service.get_datasets(search=search, collection_id=collection_id)
    
    if include_urls:
        # Return datasets with computed URLs from formats
        result = []
        for dataset in datasets:
            dataset_dict = service.get_dataset_with_urls(dataset.id)
            if dataset_dict:
                result.append(dataset_dict)
        return result
    
    return datasets


@router.get("/stats")
async def get_collection_stats(
    collection_id: int,
    _collection: Collection = Depends(verify_collection_exists),
    service: DatasetService = Depends(get_dataset_service),
):
    """Get dataset statistics for a collection."""
    datasets = service.get_datasets(collection_id=collection_id)
    return {
        "total": len(datasets),
        "collection_id": collection_id,
    }


@router.get("/{dataset_id}")
async def get_dataset(
    collection_id: int,
    dataset_id: int,
    include_urls: bool = Query(False, description="Include full URLs constructed from storage location"),
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
            status_code=404, 
            detail="Dataset not found in this collection"
        )
    
    if include_urls:
        dataset_dict = service.get_dataset_with_urls(dataset_id)
        if not dataset_dict:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return dataset_dict
    
    return dataset


# Write endpoints removed - use scripts/import_inventory.py for dataset creation
