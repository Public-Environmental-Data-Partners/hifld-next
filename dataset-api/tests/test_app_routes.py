import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import app
import main


def test_geoserver_routes_are_not_registered():
    routes = {
        getattr(route, "path", "")
        for route in app.routes
        if getattr(route, "path", "")
    }

    assert not any(path.startswith("/api/geoserver") for path in routes)


def test_startup_database_setup_logs_revision_and_initializes_db(monkeypatch):
    calls: list[str] = []

    class FakeCommand:
        @staticmethod
        def current(_cfg):
            calls.append("current-before")

        @staticmethod
        def upgrade(_cfg, target):
            calls.append(f"upgrade-{target}")

    monkeypatch.setattr(main, "alembic_command", FakeCommand)
    monkeypatch.setattr(main, "init_db", lambda: calls.append("init-db"))

    main.run_startup_database_setup()

    assert calls == ["current-before", "upgrade-head", "current-before", "init-db"]
