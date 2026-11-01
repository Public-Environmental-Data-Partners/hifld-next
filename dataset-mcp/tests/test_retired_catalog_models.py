import pytest
from pydantic import ValidationError

from app.catalog.models import Format, StorageLocation


@pytest.mark.parametrize("format_type", ["geoserver", "GeoServer"])
def test_catalog_rejects_retired_geoserver_formats(format_type: str) -> None:
    with pytest.raises(ValidationError):
        Format.model_validate({"format_type": format_type, "name": "GeoServer"})


def test_catalog_accepts_unknown_formats() -> None:
    format_ = Format.model_validate({"format_type": "openfema-json", "name": "OpenFEMA JSON"})
    assert format_.format_type == "openfema-json"


def test_catalog_rejects_retired_geoserver_storage_configuration() -> None:
    with pytest.raises(ValidationError):
        StorageLocation.model_validate(
            {
                "name": "Retired server",
                "backend_type": "geoserver",
                "config": {
                    "type": "geoserver",
                    "base_url": "https://retired.example.test",
                    "workspace": "hifld",
                },
            }
        )
