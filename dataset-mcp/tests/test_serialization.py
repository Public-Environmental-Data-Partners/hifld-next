import json
from pathlib import Path

from app.catalog.models import (
    Collection,
    Dataset,
    DatasetFileResponse,
    DatasetFileSchemaResult,
    DatasetPage,
)

FIXTURES = Path(__file__).parent / "contract_fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_catalog_collection_fixture_parses() -> None:
    collections = [
        Collection.model_validate(item) for item in json.loads(fixture("collections.json"))
    ]
    assert collections[0].slug == "public-safety"


def test_catalog_dataset_page_fixture_parses() -> None:
    page = DatasetPage.model_validate_json(fixture("dataset_page.json"))
    assert page.items[0].id == 12


def test_catalog_dataset_fixture_parses() -> None:
    dataset = Dataset.model_validate_json(fixture("dataset.json"))
    assert dataset.files is not None
    assert dataset.files[0].formats[0].sources[0].source_metadata is not None


def test_catalog_file_and_schema_fixtures_parse() -> None:
    file_response = DatasetFileResponse.model_validate_json(fixture("file_response.json"))
    schema = DatasetFileSchemaResult.model_validate_json(fixture("schema_response.json"))
    assert file_response.file.formats[0].sources[0].location.path == "sample.parquet"
    assert schema.schema_ is not None
    assert schema.schema_.columns[0].name == "geometry"
    assert '"schema":' in schema.model_dump_json()
