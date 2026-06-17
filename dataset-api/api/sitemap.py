"""Sitemap inventory endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, col, select

from database.db import get_db
from models.dataset import Collection, Dataset, File


router = APIRouter(prefix="/api", tags=["sitemap"])

DBSessionDep = Annotated[Session, Depends(get_db)]


class SitemapEntry(BaseModel):
    """A sitemap-relevant catalog URL inventory row."""

    collection_slug: str
    dataset_slug: str
    file_slug: str | None = None


@router.get("/sitemap-entries")
async def list_sitemap_entries(db: DBSessionDep) -> list[SitemapEntry]:
    """List collection, dataset, and file slugs for sitemap generation.

    This endpoint is intentionally compact and URL-oriented so the webapp can
    build sitemap.xml without issuing one request per dataset to discover files.
    """
    statement = (
        select(Collection, Dataset, File)
        .join(Dataset, col(Dataset.collection_id) == col(Collection.id))
        .outerjoin(File, col(File.dataset_id) == col(Dataset.id))
        .order_by(col(Collection.slug), col(Dataset.slug), col(File.slug))
    )
    rows = db.exec(statement).all()

    return [
        SitemapEntry(
            collection_slug=collection.slug,
            dataset_slug=dataset.slug,
            file_slug=file_obj.slug if file_obj else None,
        )
        for collection, dataset, file_obj in rows
    ]
