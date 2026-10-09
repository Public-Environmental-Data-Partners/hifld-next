import pytest
from pydantic import ValidationError

from app.catalog.models import Format, StorageLocation


def test_catalog_rejects_retired_geoserver_formats() -> None:
    with pytest.raises(ValidationError):
        Format.model_validate({"format_type": "geoserver", "name": "GeoServer"})


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
