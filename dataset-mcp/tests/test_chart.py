import subprocess
from pathlib import Path

CHART = Path(__file__).resolve().parents[2] / "charts" / "dataset-mcp"


def test_chart_uses_release_name_for_primary_resources() -> None:
    result = subprocess.run(
        ["helm", "template", "dataset-mcp", str(CHART)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "kind: Service\nmetadata:\n  name: dataset-mcp\n" in result.stdout
    assert "kind: Deployment\nmetadata:\n  name: dataset-mcp\n" in result.stdout
