import subprocess
from pathlib import Path

CHART = Path(__file__).resolve().parents[2] / "charts" / "feature-server"


def render_chart() -> str:
    result = subprocess.run(
        ["helm", "template", "feature-server", str(CHART)],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def test_chart_matches_feature_server_runtime_contract() -> None:
    rendered = render_chart()
    assert "name: FEATURE_SERVER_CATALOG_URL" in rendered
    assert "name: FEATURE_SERVER_CATALOG_POINTER_URL" in rendered
    assert "name: FEATURE_SERVER_CATALOG_POLL_SECONDS" in rendered
    assert "name: FEATURE_SERVER_STORAGE_LOCATIONS" in rendered
    assert "name: FEATURE_SERVER_CATALOG_CACHE_DIRECTORY" in rendered
    assert "name: FEATURE_SERVER_TEMP_DIRECTORY" in rendered
    assert "name: TMPDIR" in rendered
    assert "path: /healthz" in rendered
    assert "path: /readyz" in rendered
    assert "readOnlyRootFilesystem: true" in rendered
    assert "sizeLimit: 1Gi" in rendered
    assert "sizeLimit: 2Gi" in rendered


def test_chart_can_limit_external_health_check_ingress() -> None:
    rendered = subprocess.run(
        [
            "helm",
            "template",
            "feature-server",
            str(CHART),
            "--set-string",
            "networkPolicy.ingressCidrs[0]=35.191.0.0/16",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert 'cidr: "35.191.0.0/16"' in rendered
