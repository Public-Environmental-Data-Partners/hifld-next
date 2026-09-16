from __future__ import annotations

import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from shapely import from_wkb, to_wkb
from shapely.geometry import GeometryCollection, Point, Polygon

SCRIPT = Path(__file__).parents[2] / "ops" / "clickhouse" / "hifld_reproject_wkb.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("hifld_reproject_wkb", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _project(geometry, source_crs: str, target_crs: str = "EPSG:4326"):
    module = _load_module()
    return from_wkb(
        bytes.fromhex(module.reproject_wkb(to_wkb(geometry, hex=True), source_crs, target_crs))
    )


def test_reprojects_web_mercator_point_to_wgs84() -> None:
    result = _project(Point(-8575663.95249602, 4707028.55080514), "EPSG:3857")
    assert result.x == pytest.approx(-77.0365, abs=1e-6)
    assert result.y == pytest.approx(38.8977, abs=1e-6)


def test_reprojects_nad83_polygon_to_wgs84() -> None:
    source = Polygon([(-75, 40), (-74, 40), (-74, 41), (-75, 40)])
    result = _project(source, "EPSG:4269")
    assert result.geom_type == "Polygon"
    assert result.bounds == pytest.approx((-75, 40, -74, 41), abs=1e-7)


def test_wgs84_input_is_unchanged() -> None:
    source = Point(-77.035278, 38.889444)
    assert to_wkb(_project(source, "EPSG:4326")) == to_wkb(source)


def test_reprojects_to_requested_working_crs() -> None:
    result = _project(Point(-77.0365, 38.8977), "EPSG:4326", "EPSG:3857")
    assert result.x == pytest.approx(-8575663.95249602, abs=1e-6)
    assert result.y == pytest.approx(4707028.55080514, abs=1e-6)


def test_empty_geometry_is_supported() -> None:
    result = _project(GeometryCollection(), "OGC:CRS84")
    assert result.is_empty


def test_geometry_bounds_returns_point_and_polygon_extents() -> None:
    module = _load_module()
    assert module.geometry_bounds(to_wkb(Point(-77, 38), hex=True)) == [-77, 38, -77, 38]
    polygon = Polygon([(-75, 40), (-74, 40), (-74, 41), (-75, 40)])
    assert module.geometry_bounds(to_wkb(polygon, hex=True)) == [-75, 40, -74, 41]


def test_geometry_bounds_returns_empty_array_for_empty_geometry() -> None:
    module = _load_module()
    assert module.geometry_bounds(to_wkb(GeometryCollection(), hex=True)) == []


def test_geometry_bounds_rejects_nonfinite_coordinates() -> None:
    module = _load_module()
    with pytest.raises(ValueError, match="finite"):
        module.geometry_bounds(to_wkb(Point(math.inf, 0), hex=True))


@pytest.mark.parametrize(
    "crs",
    ["+proj=pipeline +step +proj=axisswap +order=2,1", "EPSG:4326; id", "file:///etc/passwd"],
)
def test_rejects_crs_expressions_and_shell_input(crs: str) -> None:
    module = _load_module()
    with pytest.raises(ValueError, match="unsupported source CRS"):
        module.reproject_wkb(to_wkb(Point(0, 0), hex=True), crs, "EPSG:4326")


def test_rejects_target_crs_expressions() -> None:
    module = _load_module()
    with pytest.raises(ValueError, match="unsupported target CRS"):
        module.reproject_wkb(to_wkb(Point(0, 0), hex=True), "EPSG:4326", "+proj=merc")


def test_rejects_nonfinite_output() -> None:
    module = _load_module()
    with pytest.raises(ValueError, match="finite"):
        module.reproject_wkb(to_wkb(Point(math.inf, 0), hex=True), "EPSG:4326", "EPSG:4326")


def test_json_each_row_batch_has_no_partial_success() -> None:
    valid = {
        "hex_wkb": to_wkb(Point(0, 0), hex=True),
        "source_crs": "EPSG:4326",
        "target_crs": "EPSG:4326",
    }
    invalid = {"hex_wkb": "00", "source_crs": "EPSG:4326", "target_crs": "EPSG:4326"}
    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=f"2\n{json.dumps(valid)}\n{json.dumps(invalid)}\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode != 0
    assert completed.stdout == ""
    assert "invalid WKB" in completed.stderr


def test_rejects_oversized_rows() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input="1\n"
        + json.dumps(
            {
                "hex_wkb": "00" * (33 * 1024 * 1024),
                "source_crs": "EPSG:4326",
                "target_crs": "EPSG:4326",
            }
        )
        + "\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode != 0
    assert completed.stdout == ""
    assert "input row exceeds" in completed.stderr
