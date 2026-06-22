"""Collection API endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, col, select

from database.db import get_db
from models.dataset import Collection, Dataset, File
from schemas.types import APIDict, APIList, model_json_dict
from services.collections import CollectionService


router = APIRouter(prefix="/api/collections", tags=["collections"])


DBSessionDep = Annotated[Session, Depends(get_db)]


def get_collection_service(db: DBSessionDep) -> CollectionService:
    """Dependency to get collection service."""
    return CollectionService(db)


CollectionServiceDep = Annotated[CollectionService, Depends(get_collection_service)]


def parse_collection_include(include: str | None) -> set[str]:
    """Parse optional collection include values."""
    if not include:
        return set()
    values = {part.strip().lower() for part in include.split(",") if part.strip()}
    allowed = {"datasets", "files"}
    unsupported = values - allowed
    if unsupported:
        raise HTTPException(status_code=400, detail=f"Unsupported include values: {', '.join(sorted(unsupported))}")
    if "files" in values:
        values.add("datasets")
    return values


def collection_with_children_rows(db: Session, include_files: bool) -> APIList:
    """Return collections with compact dataset and optional file children."""
    collections: dict[int, APIDict] = {}
    datasets: dict[int, APIDict] = {}
    collection_datasets: dict[int, APIList] = {}
    dataset_files: dict[int, APIList] = {}

    statement = (
        select(Collection, Dataset, File)
        .outerjoin(Dataset, col(Dataset.collection_id) == col(Collection.id))
        .outerjoin(File, col(File.dataset_id) == col(Dataset.id))
        .order_by(col(Collection.name), col(Dataset.name), col(File.name))
    )
    for collection, dataset, file_obj in db.exec(statement).all():
        collection_payload = collections.get(collection.id)
        if collection_payload is None:
            collection_payload = model_json_dict(collection)
            collection_datasets[collection.id] = []
            collection_payload["datasets"] = collection_datasets[collection.id]
            collections[collection.id] = collection_payload

        if dataset is None:
            continue

        dataset_payload = datasets.get(dataset.id)
        if dataset_payload is None:
            dataset_payload = model_json_dict(dataset)
            if include_files:
                dataset_files[dataset.id] = []
                dataset_payload["files"] = dataset_files[dataset.id]
            datasets[dataset.id] = dataset_payload
            collection_datasets[collection.id].append(dataset_payload)

        if include_files and file_obj is not None:
            dataset_files[dataset.id].append(model_json_dict(file_obj))

    return list(collections.values())


@router.get("", response_model=None)
async def list_collections(
    db: DBSessionDep,
    service: CollectionServiceDep,
    include: str | None = Query(None, description="Comma-separated expansions: datasets, files"),
) -> list[Collection] | APIList:
    """List all collections."""
    include_values = parse_collection_include(include)
    if "datasets" in include_values:
        return collection_with_children_rows(db, include_files="files" in include_values)
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
