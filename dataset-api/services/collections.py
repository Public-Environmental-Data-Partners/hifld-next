"""Collection service for CRUD operations."""

import logging
from datetime import datetime
from re import sub

from sqlmodel import Session, select

from models.dataset import Collection


logger = logging.getLogger(__name__)


class CollectionService:
    """Service for collection operations."""

    def __init__(self, db: Session) -> None:
        """Create a collection service."""
        self.db = db

    def get_collections(self) -> list[Collection]:
        """Get all collections."""
        statement = select(Collection).order_by(Collection.name)
        return list(self.db.exec(statement).all())

    def get_collection_by_id(self, collection_id: int) -> Collection | None:
        """Get a single collection by ID."""
        return self.db.get(Collection, collection_id)

    def get_collection_by_name(self, name: str) -> Collection | None:
        """Get a single collection by name."""
        statement = select(Collection).where(Collection.name == name)
        return self.db.exec(statement).first()

    def create_collection(
        self,
        name: str,
        description: str | None = None,
        slug: str | None = None,
    ) -> Collection:
        """Create a new collection."""
        collection = Collection(
            slug=slug or sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
            name=name,
            description=description,
        )
        self.db.add(collection)
        self.db.commit()
        self.db.refresh(collection)
        return collection

    def update_collection(
        self,
        collection_id: int,
        name: str | None = None,
        description: str | None = None,
        slug: str | None = None,
    ) -> Collection | None:
        """Update a collection."""
        collection = self.get_collection_by_id(collection_id)
        if not collection:
            return None

        if name is not None:
            collection.name = name
        if description is not None:
            collection.description = description
        if slug is not None:
            collection.slug = slug

        collection.updated_at = datetime.utcnow()
        self.db.add(collection)
        self.db.commit()
        self.db.refresh(collection)
        return collection

    def delete_collection(self, collection_id: int) -> bool:
        """Delete a collection."""
        collection = self.get_collection_by_id(collection_id)
        if not collection:
            return False

        self.db.delete(collection)
        self.db.commit()
        return True
