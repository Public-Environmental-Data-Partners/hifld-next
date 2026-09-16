import pytest


def test_tile_envelope_has_xyz_axis_order():
    from query_engine.tiles import tile_bounds

    west, south, east, north = tile_bounds(0, 0, 0)
    assert west == -180 and east == 180
    assert south == pytest.approx(-85.05112878)
    assert north == pytest.approx(85.05112878)


@pytest.mark.parametrize("tile", [(-1, 0, 0), (1, 2, 0), (1, 0, 2)])
def test_invalid_tiles_rejected(tile):
    from query_engine.tiles import tile_bounds

    with pytest.raises(ValueError):
        tile_bounds(*tile)


def test_mvt_sql_uses_working_crs_to_encoder_crs():
    from query_engine.results import ResultColumn
    from query_engine.tiles import mvt_sql

    sql = mvt_sql(
        "SELECT geometry, NAME FROM source",
        [
            ResultColumn(name="geometry", type="Point"),
            ResultColumn(name="NAME", type="Nullable(String)"),
        ],
        "geometry",
        "EPSG:3857",
        10,
        301,
        385,
        100,
    )
    assert "'EPSG:3857', 'EPSG:4326'" in sql
    assert "MVTEncode('hifld'" in sql
    assert "LIMIT 101" in sql
    assert "geometryIntersectCartesian" in sql


def test_nested_limit_is_not_pruned():
    from query_engine.metadata import Covering, GeometryMetadata
    from query_engine.pruning import covering_filter

    field = GeometryMetadata(
        "geometry",
        "EPSG:4326",
        Covering(
            xmin=("bbox", "xmin"),
            ymin=("bbox", "ymin"),
            xmax=("bbox", "xmax"),
            ymax=("bbox", "ymax"),
        ),
    )
    assert (
        covering_filter(
            "SELECT geometry FROM a WHERE id IN (SELECT id FROM a LIMIT 1)",
            "geometry",
            (field,),
            (-1, -1, 1, 1),
        )
        is None
    )


def test_scalar_variant_is_not_geometry():
    from query_engine.executor import is_geometry

    assert not is_geometry("Variant(String, UInt64)")
