import json

import pytest

from app.catalog.models import DatasetFileResponse, QuerySourceRef
from app.catalog.shaping import shape_file_metadata
from app.tools.inspection import inspect_query_source
from tests.test_query_tools import Service


def test_query_references_are_deduplicated_and_partition_values_preserve_zeroes() -> None:
    from pathlib import Path

    payload = json.loads(
        (Path(__file__).parent / "contract_fixtures/file_response.json").read_text()
    )
    entry = payload["file"]["formats"][0]
    original = entry["sources"][0]
    original["storage_location"] = {"id": 3, "name": "GCS", "backend_type": "s3"}
    original["location"]["path"] = "data/**/*.parquet"
    entry["sources"] = [
        original,
        {**original, "location": {"type": "file", "path": "data/region=01/part.parquet"}},
    ]
    shaped = shape_file_metadata(DatasetFileResponse.model_validate(payload))
    assert len(shaped["query_sources"]) == 1
    assert shaped["query_hints"][0]["partition_fields"] == [
        {"name": "region", "observed_values": ["01"], "values_truncated": False}
    ]


@pytest.mark.asyncio
async def test_inspection_uses_zero_row_probe_and_never_returns_query_tokens() -> None:
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
                        "type": "STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)",
                        "nullable": True,
                    },
                    {"name": "region", "type": "VARCHAR", "nullable": True},
                ],
                "query_token": "secret",
                "rows": [],
            }

    result = await inspect_query_source(
        InspectionService(),
        QuerySourceRef(alias="roads", collection_id=1, dataset_id=2, file_id=3, file_source_id=4),
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
