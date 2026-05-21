"""Route and startup tests for the Dataset API."""

import sys
from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from database.db import get_db
from main import app
from models.dataset import Collection, Dataset, File
from services.dataset import DatasetService


HTTP_OK = 200


def test_geoserver_routes_are_not_registered() -> None:
    """Verify the expected behavior."""
    routes = {getattr(route, "path", "") for route in app.routes if getattr(route, "path", "")}

    assert not any(path.startswith("/api/geoserver") for path in routes)


def test_dataset_service_module_exports_public_service() -> None:
    """Verify dataset service code is exported from the dataset module."""
    assert DatasetService.__name__ == "DatasetService"


def test_startup_database_setup_logs_revision_and_initializes_db(monkeypatch: MonkeyPatch) -> None:
    """Verify the expected behavior."""
    calls: list[str] = []

    class FakeCommand:
        """Test helper FakeCommand."""

        @staticmethod
        def current(_cfg: object) -> None:
            """Test helper for current."""
            calls.append("current-before")

        @staticmethod
        def upgrade(_cfg: object, target: str) -> None:
            """Test helper for upgrade."""
            calls.append(f"upgrade-{target}")

    monkeypatch.setattr(main, "alembic_command", FakeCommand)
    monkeypatch.setattr(main, "init_db", lambda: calls.append("init-db"))

    main.run_startup_database_setup()

    assert calls == ["current-before", "upgrade-head", "current-before", "init-db"]


def test_dynamic_dataset_routes_do_not_infer_recursive_response_models() -> None:
    """Verify dynamic dataset payload routes serialize without response model inference."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        collection = Collection(slug="hifld", name="HIFLD")
        session.add(collection)
        session.commit()
        session.refresh(collection)

        dataset = Dataset(
            slug="nfhl",
            name="NFHL",
            description="National Flood Hazard Layer",
            collection_id=collection.id,
            tags={"categories": ["Natural Hazards"]},
        )
        session.add(dataset)
        session.commit()
        session.refresh(dataset)

        file_obj = File(dataset_id=dataset.id, slug="alluvial-fans", name="Alluvial Fans")
        session.add(file_obj)
        session.commit()

    def override_get_db() -> Session:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        list_response = client.get("/api/collections/1/datasets", params={"limit": 100, "offset": 0})
        detail_response = client.get("/api/collections/1/datasets/by-slug/nfhl/urls")
    finally:
        app.dependency_overrides.clear()

    assert list_response.status_code == HTTP_OK
    assert list_response.json()["items"][0]["slug"] == "nfhl"
    assert detail_response.status_code == HTTP_OK
    assert detail_response.json()["files"][0]["slug"] == "alluvial-fans"
