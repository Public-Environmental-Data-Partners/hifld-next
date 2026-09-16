import json

import pytest


def test_geoparquet_omitted_crs_is_crs84_but_explicit_null_is_unknown():
    from query_engine.metadata import parse_geo

    fields = parse_geo(
        json.dumps(
            {
                "columns": {
                    "shape": {"encoding": "WKB"},
                    "unknown": {"encoding": "WKB", "crs": None},
                }
            }
        )
    )
    assert fields[0].crs == "OGC:CRS84"
    assert fields[1].crs is None


def test_metadata_reads_authority_and_covering_paths():
    from query_engine.metadata import parse_geo

    fields = parse_geo(
        json.dumps(
            {
                "columns": {
                    "shape": {
                        "encoding": "WKB",
                        "crs": {"id": {"authority": "EPSG", "code": 3857}},
                        "covering": {
                            "bbox": {k: ["bounds", k] for k in ("xmin", "ymin", "xmax", "ymax")}
                        },
                    }
                }
            }
        )
    )
    assert fields[0].name == "shape"
    assert fields[0].crs == "EPSG:3857"
    assert fields[0].covering is not None
    assert fields[0].covering.xmin == ("bounds", "xmin")


def test_metadata_rejects_non_wkb_geometry_encoding():
    from query_engine.client import ClickHouseError
    from query_engine.metadata import parse_geo

    with pytest.raises(ClickHouseError):
        parse_geo('{"columns":{"geometry":{"encoding":"point"}}}')
