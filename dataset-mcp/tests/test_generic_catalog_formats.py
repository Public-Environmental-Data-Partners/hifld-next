from app.catalog.models import Format


def test_supporting_asset_formats_are_preserved():
    for format_type in ("json", "xml", "metadata", "custom-binary"):
        value = Format(format_type=format_type, name="Supporting asset")
        assert value.format_type == format_type
