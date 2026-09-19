"""Protect byte-preserving, no-overwrite migration copy behavior."""

import unittest
from unittest.mock import Mock, patch

from scripts.portolan_gcp_copy import copy_object, verify


class CopyTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "name": "roads/roads/v1/geoparquet/roads.parquet",
            "generation": "123",
            "size": "100",
            "crc32c": "crc",
            "md5Hash": "md5",
        }

    def test_checksum_mismatch_is_rejected(self):
        for field in ("size", "crc32c", "md5Hash"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                verify(self.source, {**self.source, field: "changed"})

    @patch("scripts.portolan_gcp_copy.session")
    def test_production_cannot_be_a_copy_target(self, get_session):
        with self.assertRaises(ValueError):
            copy_object("hifld-next-datasets-prod", self.source)
        get_session.assert_not_called()

    @patch("scripts.portolan_gcp_copy.session")
    def test_matching_existing_object_is_not_rewritten(self, get_session):
        client = get_session.return_value
        client.get.return_value = Mock(status_code=200)
        client.get.return_value.json.return_value = self.source
        result = copy_object("hifld-next-portolan-staging", self.source)
        self.assertEqual(result["status"], "verified_existing")
        client.post.assert_not_called()

    @patch("scripts.portolan_gcp_copy.session")
    def test_changed_existing_object_is_not_overwritten(self, get_session):
        client = get_session.return_value
        client.get.return_value = Mock(status_code=200)
        client.get.return_value.json.return_value = {
            **self.source,
            "md5Hash": "changed",
        }
        with self.assertRaises(ValueError):
            copy_object("hifld-next-portolan-staging", self.source)
        client.post.assert_not_called()

    @patch("scripts.portolan_gcp_copy.session")
    def test_copy_pins_source_generation_and_requires_absent_destination(
        self, get_session
    ):
        client = get_session.return_value
        client.get.return_value = Mock(status_code=404)
        client.post.return_value.json.return_value = {
            "done": True,
            "resource": self.source,
        }
        result = copy_object("hifld-next-portolan-staging", self.source)
        self.assertEqual(result["status"], "copied")
        self.assertEqual(
            client.post.call_args.kwargs["params"],
            {"sourceGeneration": "123", "ifGenerationMatch": "0"},
        )


if __name__ == "__main__":
    unittest.main()
