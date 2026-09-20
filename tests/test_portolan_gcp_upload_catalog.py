"""Guard metadata-only refreshes of the dedicated migration buckets."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.portolan_gcp_upload_catalog import upload


class CatalogUploadTests(unittest.TestCase):
    @patch("scripts.portolan_gcp_upload_catalog.session")
    def test_uploads_catalog_license_notice(self, get_session):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "hifld" / "LICENSE.md"
            path.parent.mkdir()
            path.write_text("Public domain notice\n")
            client = get_session.return_value
            client.post.return_value.json.return_value = {
                "size": str(len(path.read_bytes())),
                "metadata": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
            }
            upload("hifld-next-portolan-staging", root, path)
            self.assertEqual(
                client.post.call_args.kwargs["params"]["ifGenerationMatch"], "0"
            )

    @patch("scripts.portolan_gcp_upload_catalog.session")
    def test_default_upload_still_requires_absent_destination(self, get_session):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "catalog.json"
            path.write_text("{}\n")
            client = get_session.return_value
            client.post.return_value.json.return_value = {
                "size": "3",
                "metadata": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
            }
            upload("hifld-next-portolan-published", root, path)
            client.get.assert_not_called()
            self.assertEqual(
                client.post.call_args.kwargs["params"]["ifGenerationMatch"], "0"
            )

    @patch("scripts.portolan_gcp_upload_catalog.session")
    def test_replacement_pins_existing_generation(self, get_session):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "catalog.json"
            path.write_text("{}\n")
            client = get_session.return_value
            client.get.return_value = Mock(status_code=200)
            client.get.return_value.json.return_value = {"generation": "123"}
            client.post.return_value.json.return_value = {
                "size": "3",
                "metadata": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
            }
            upload("hifld-next-portolan-published", root, path, replace_existing=True)
            self.assertEqual(
                client.post.call_args.kwargs["params"]["ifGenerationMatch"], "123"
            )

    @patch("scripts.portolan_gcp_upload_catalog.session")
    def test_identical_metadata_is_not_rewritten(self, get_session):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "catalog.json"
            path.write_text("{}\n")
            existing = {
                "generation": "123",
                "size": "3",
                "metadata": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
            }
            client = get_session.return_value
            client.get.return_value = Mock(status_code=200)
            client.get.return_value.json.return_value = existing
            self.assertEqual(
                upload(
                    "hifld-next-portolan-published", root, path, replace_existing=True
                ),
                existing,
            )
            client.post.assert_not_called()

    @patch("scripts.portolan_gcp_upload_catalog.session")
    def test_data_objects_and_production_bucket_are_rejected(self, get_session):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for key in (
                "data.geojson",
                "hifld/roads/v1/metadata/source_manifest.json",
                "data.parquet",
            ):
                with self.subTest(key=key), self.assertRaises(ValueError):
                    upload("hifld-next-portolan-published", root, root / key)
            with self.assertRaises(ValueError):
                upload("hifld-next-datasets-prod", root, root / "catalog.json")
            get_session.assert_not_called()
