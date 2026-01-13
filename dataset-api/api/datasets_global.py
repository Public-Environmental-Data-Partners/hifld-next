"""Global dataset API endpoints (across all collections) - for backwards compatibility."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from database.db import get_db
from services.datasets import DatasetService
from models.dataset import Dataset
from sqlmodel import Session

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def get_dataset_service(db: Session = Depends(get_db)) -> DatasetService:
    """Dependency to get dataset service."""
    return DatasetService(db)


@router.get("")
async def list_all_datasets(
    search: Optional[str] = Query(None),
    include_urls: bool = Query(False, description="Include full URLs constructed from storage location"),
    service: DatasetService = Depends(get_dataset_service),
):
    """List all datasets across all collections with optional search."""
    datasets = service.get_datasets(search=search, collection_id=None)
    
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
async def get_all_stats(service: DatasetService = Depends(get_dataset_service)):
    """Get dataset statistics across all collections."""
    return service.get_dataset_stats()






