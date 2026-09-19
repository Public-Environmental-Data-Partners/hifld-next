import pytest

from app.catalog.models import QuerySourceRef, StacVersionCollection
from app.catalog.shaping import shape_file_metadata
from app.tools.inspection import inspect_query_source
from tests.test_query_tools import Service


def test_query_references_are_deduplicated_and_partition_values_preserve_zeroes() -> None:
    shaped = shape_file_metadata(
        StacVersionCollection.model_validate(
            {
                "type": "Collection",
                "stac_version": "1.1.0",
                "id": "hifld/roads/roads/v1",
                "description": "roads",
                "license": "other",
                "links": [],
                "extent": {"spatial": {"bbox": []}, "temporal": {"interval": [[None, None]]}},
                "assets": {
                    "geoparquet": {
                        "href": "s3://bucket/roads/region=01/part.parquet",
                        "type": "application/vnd.apache.parquet",
                        "title": "GeoParquet",
                        "roles": ["data"],
                    }
                },
                "table:columns": [],
            }
        )
    )
    assert len(shaped["query_sources"]) == 1
    assert shaped["query_hints"][0]["partition_fields"] == [
        {"name": "region", "observed_values": ["01"], "values_truncated": False}
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bbox_type",
    [
        "STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)",
        "Tuple(xmin Float64, ymin Float64, xmax Float64, ymax Float64)",
    ],
)
async def test_inspection_uses_zero_row_probe_and_never_returns_query_tokens(bbox_type) -> None:
    class InspectionService(Service):
        async def query(self, sources, sql, limit, geometry_column, result_crs):
            assert sql == 'SELECT * FROM "roads" LIMIT 0'
            assert limit == 1
            assert self.validated
            return {
                "columns": [
                    {"name": "shape", "type": "GEOMETRY('EPSG:4269')", "nullable": True},
                    {
                        "name": "bounds",
                        "type": bbox_type,
                        "nullable": True,
                    },
                    {"name": "region", "type": "VARCHAR", "nullable": True},
                ],
                "query_token": "secret",
                "rows": [],
            }

    result = await inspect_query_source(
        InspectionService(),
        QuerySourceRef(
            alias="roads",
            collection_slug="hifld",
            dataset_slug="roads",
            file_slug="roads",
            version="v1",
            asset_key="geoparquet",
        ),
    )
    assert result.structured_content["geometry_fields"] == [{"name": "shape", "crs": "EPSG:4269"}]
    assert result.structured_content["bbox_candidates"] == [
        {
            "xmin": ["bounds", "xmin"],
            "ymin": ["bounds", "ymin"],
            "xmax": ["bounds", "xmax"],
            "ymax": ["bounds", "ymax"],
        }
    ]
    assert "secret" not in result.text
