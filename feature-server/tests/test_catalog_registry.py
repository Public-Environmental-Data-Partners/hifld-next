from pathlib import Path

from app.catalog.registry import ApiSnapshot, SnapshotRegistry
from app.catalog.repository import CatalogRepository


def _snapshot(path: Path, generation: str, *, owned: bool) -> ApiSnapshot:
    path.write_bytes(b"candidate")
    repository = CatalogRepository(path, generation)
    return ApiSnapshot(generation, repository, object(), {}, owned_path=owned)


def test_retired_owned_path_is_removed_after_last_reference(tmp_path: Path) -> None:
    first = _snapshot(tmp_path / "first.sqlite", "first", owned=True)
    second = _snapshot(tmp_path / "second.sqlite", "second", owned=True)
    registry = SnapshotRegistry()
    registry.replace(first)

    with registry.acquire():
        registry.replace(second)
        assert first.repository.path.exists()

    assert not first.repository.path.exists()
    assert second.repository.path.exists()


def test_close_removes_owned_active_path_but_preserves_unowned_path(tmp_path: Path) -> None:
    owned = _snapshot(tmp_path / "owned.sqlite", "owned", owned=True)
    registry = SnapshotRegistry()
    registry.replace(owned)
    registry.close()
    assert not owned.repository.path.exists()

    unowned = _snapshot(tmp_path / "fixture.sqlite", "fixture", owned=False)
    registry.replace(unowned)
    registry.close()
    assert unowned.repository.path.exists()
