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


def test_chart_configures_mcp_transport_allowlists() -> None:
    result = subprocess.run(
        [
            "helm",
            "template",
            "dataset-mcp",
            str(CHART),
            "--set",
            "http.allowedHosts[0]=mcp.example.test",
            "--set",
            "webappOrigins[0]=https://web.example.test",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "name: DATASET_MCP_HTTP_ALLOWED_HOSTS" in result.stdout
    assert (
        'value: "dataset-mcp,dataset-mcp.default.svc.cluster.local,mcp.example.test"'
        in result.stdout
    )
    assert "name: DATASET_MCP_WEBAPP_ORIGINS" in result.stdout
    assert 'value: "https://web.example.test"' in result.stdout


def test_chart_includes_ingress_hostname_in_http_allowlist() -> None:
    result = subprocess.run(
        [
            "helm",
            "template",
            "dataset-mcp",
            str(CHART),
            "--set",
            "ingress.enabled=true",
            "--set",
            "ingress.host=mcp.example.test",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert (
        'value: "dataset-mcp,dataset-mcp.default.svc.cluster.local,mcp.example.test"'
        in result.stdout
    )


def test_chart_caps_duckdb_spill_below_the_empty_directory_limit() -> None:
    result = subprocess.run(
        ["helm", "template", "dataset-mcp", str(CHART)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "name: DATASET_MCP_DUCKDB_MAX_TEMP_DIRECTORY_SIZE" in result.stdout
    assert 'value: "3GiB"' in result.stdout
    assert "emptyDir: {sizeLimit: 4Gi}" in result.stdout


def test_chart_allows_gke_node_local_dns() -> None:
    result = subprocess.run(
        ["helm", "template", "dataset-mcp", str(CHART)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert 'cidr: "169.254.20.10/32"' in result.stdout
    assert "port: 53" in result.stdout
