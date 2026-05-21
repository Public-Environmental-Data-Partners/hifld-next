"""Collection API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from database.db import get_db
from models.dataset import Collection
from services.collections import CollectionService


router = APIRouter(prefix="/api/collections", tags=["collections"])


DBSessionDep = Annotated[Session, Depends(get_db)]


def get_collection_service(db: DBSessionDep) -> CollectionService:
    """Dependency to get collection service."""
    return CollectionService(db)


CollectionServiceDep = Annotated[CollectionService, Depends(get_collection_service)]


@router.get("")
async def list_collections(
    service: CollectionServiceDep,
) -> list[Collection]:
    """List all collections."""
    return service.get_collections()


@router.get("/{collection_id}")
async def get_collection(
    collection_id: int,
    service: CollectionServiceDep,
) -> Collection:
    """Get a single collection by ID."""
    collection = service.get_collection_by_id(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


# Write endpoints removed - use scripts/import_datasets.py for dataset ingestion
