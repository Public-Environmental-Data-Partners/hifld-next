"""Database schema - re-export for backwards compatibility."""

from models.dataset import (
    Collection,
    Dataset,
    DatasetFormat,
    DatasetSource,
    StorageLocation,
)
from sqlmodel import SQLModel

__all__ = [
    "SQLModel",
    "Collection",
    "Dataset",
    "DatasetFormat",
    "DatasetSource",
    "StorageLocation",
]
