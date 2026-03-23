"""Collection API endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from database.db import get_db
from models.dataset import Collection
from services.collections import CollectionService

router = APIRouter(prefix="/api/collections", tags=["collections"])


def get_collection_service(db: Session = Depends(get_db)) -> CollectionService:
    """Dependency to get collection service."""
    return CollectionService(db)


@router.get("")
async def list_collections(
    service: CollectionService = Depends(get_collection_service),
):
    """List all collections."""
    return service.get_collections()


@router.get("/{collection_id}")
async def get_collection(
    collection_id: int,
    service: CollectionService = Depends(get_collection_service),
):
    """Get a single collection by ID."""
    collection = service.get_collection_by_id(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


# Write endpoints removed - use scripts/import_datasets.py for dataset ingestion

