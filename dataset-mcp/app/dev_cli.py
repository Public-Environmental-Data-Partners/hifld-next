"""Repository-local FastAPI CLI defaults for dataset-mcp development."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from pathlib import Path

_UI_DIRECTORY = Path(__file__).resolve().parents[1] / "ui"


def arguments_with_dev_port(arguments: list[str], environment: Mapping[str, str]) -> list[str]:
    """Default only ``fastapi dev`` to port 8001 unless the caller chose one."""
    result = list(arguments)
    if len(result) < 2 or result[1] != "dev" or "PORT" in environment:
        return result
    has_port = any(
        argument == "--port" or argument.startswith("--port=") for argument in result[2:]
    )
    if not has_port:
        result.extend(("--port", "8001"))
    return result


@contextmanager
def development_ui_builder(
    arguments: list[str], *, ui_directory: Path = _UI_DIRECTORY
) -> Generator[None]:
    """Build and watch the embedded UI for the duration of ``fastapi dev``."""
    if len(arguments) < 2 or arguments[1] != "dev":
        yield
        return

    subprocess.run(["npm", "run", "build"], cwd=ui_directory, check=True)
    watcher = subprocess.Popen(
        ["npm", "run", "build", "--", "--watch", "--emptyOutDir=false"],
        cwd=ui_directory,
        start_new_session=True,
    )
    try:
        yield
    finally:
        if watcher.poll() is None:
            os.killpg(watcher.pid, signal.SIGTERM)
            try:
                watcher.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(watcher.pid, signal.SIGKILL)
                watcher.wait()


def main() -> None:
    """Run the upstream FastAPI CLI with repository development defaults."""
    sys.argv[:] = arguments_with_dev_port(sys.argv, os.environ)
    with development_ui_builder(sys.argv):
        from fastapi_cli.cli import app as fastapi_cli

        fastapi_cli()
