import os
import signal
import subprocess
from pathlib import Path

from app.dev_cli import arguments_with_dev_port, development_ui_builder


def test_fastapi_dev_defaults_to_port_8001() -> None:
    assert arguments_with_dev_port(["fastapi", "dev"], {}) == [
        "fastapi",
        "dev",
        "--port",
        "8001",
    ]


def test_fastapi_dev_preserves_explicit_port_configuration() -> None:
    assert arguments_with_dev_port(["fastapi", "dev", "--port", "9000"], {}) == [
        "fastapi",
        "dev",
        "--port",
        "9000",
    ]
    assert arguments_with_dev_port(["fastapi", "dev"], {"PORT": "9000"}) == [
        "fastapi",
        "dev",
    ]


def test_fastapi_run_keeps_upstream_default() -> None:
    assert arguments_with_dev_port(["fastapi", "run"], {}) == ["fastapi", "run"]


def test_fastapi_dev_builds_then_watches_the_ui(
    tmp_path: Path,
    monkeypatch,
) -> None:
    events: list[str] = []
    ui_directory = tmp_path / "ui"
    ui_directory.mkdir()

    def run(command: list[str], *, cwd: Path, check: bool) -> subprocess.CompletedProcess[bytes]:
        assert command == ["npm", "run", "build"]
        assert cwd == ui_directory
        assert check is True
        events.append("build")
        return subprocess.CompletedProcess(command, 0)

    class WatchProcess:
        pid = 4242

        def poll(self) -> None:
            return None

        def wait(self, timeout: float | None = None) -> int:
            assert timeout == 5
            events.append("wait")
            return 0

    def popen(command: list[str], *, cwd: Path, start_new_session: bool) -> WatchProcess:
        assert command == [
            "npm",
            "run",
            "build",
            "--",
            "--watch",
            "--emptyOutDir=false",
        ]
        assert cwd == ui_directory
        assert start_new_session is True
        events.append("watch")
        return WatchProcess()

    def killpg(process_group_id: int, sent_signal: signal.Signals) -> None:
        assert process_group_id == 4242
        assert sent_signal == signal.SIGTERM
        events.append("terminate")

    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(os, "killpg", killpg)

    with development_ui_builder(["fastapi", "dev", "--port", "8001"], ui_directory=ui_directory):
        events.append("serve")

    assert events == ["build", "watch", "serve", "terminate", "wait"]


def test_fastapi_run_does_not_build_or_watch_the_ui(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def unexpected_command(*args, **kwargs) -> None:
        raise AssertionError(f"unexpected subprocess call: {args}, {kwargs}")

    monkeypatch.setattr(subprocess, "run", unexpected_command)
    monkeypatch.setattr(subprocess, "Popen", unexpected_command)

    with development_ui_builder(["fastapi", "run"], ui_directory=tmp_path / "ui"):
        pass
