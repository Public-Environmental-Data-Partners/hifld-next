from __future__ import annotations

import unittest

from scripts.portolan_acceptance import collection_id, feature_fingerprint, manifest_cases


class AcceptanceContractTests(unittest.TestCase):
    def test_version_id_is_collection_scoped(self) -> None:
        self.assertEqual(collection_id("hifld", "roads", "roads", "v1.0.0"),
                         "hifld~roads~roads~v1.0.0")
        with self.assertRaises(ValueError):
            collection_id("hifld", "../roads", "roads", "v1.0.0")

    def test_fingerprint_ignores_envelope_but_not_source_properties(self) -> None:
        first = {"features": [{"id": "abc", "type": "Feature", "properties": {"id": 9}, "geometry": None}], "numberReturned": 1}
        second = {**first, "links": [{"href": "different-next-page"}]}
        self.assertEqual(feature_fingerprint(first), feature_fingerprint(second))
        second["features"] = [{"id": "abc", "type": "Feature", "properties": {"id": 10}, "geometry": None}]
        self.assertNotEqual(feature_fingerprint(first), feature_fingerprint(second))

    def test_manifest_wave_selection_does_not_hide_baseline_cases(self) -> None:
        cases = manifest_cases({"fixtures": [
            {"collection": "hifld", "dataset": "a", "file": "a", "version": "v1.0.0", "wave": "initial"},
            {"collection": "hifld", "dataset": "b", "file": "b", "version": "v1.0.0", "wave": "hot-update"},
        ]}, "all")
        self.assertEqual(len(cases), 2)


if __name__ == "__main__":
    unittest.main()
