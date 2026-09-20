from app.provider.ids import FeatureId, FeatureIdError


def test_feature_id_round_trip_preserves_full_relative_path() -> None:
    identifier = FeatureId(
        asset_key="geoparquet",
        relative_path="state=NY/part-000.parquet",
        checksum="a" * 64,
        row_number=42,
    )

    assert FeatureId.decode(identifier.encode()) == identifier


def test_feature_id_rejects_traversal_and_bad_checksum() -> None:
    for encoded in ("v1.bad", "v1.Z2VvcGFycXVldA.Li4vcGFydA." + "YQ" * 32 + ".0"):
        try:
            FeatureId.decode(encoded)
        except FeatureIdError:
            continue
        raise AssertionError("invalid identifiers must fail closed")
