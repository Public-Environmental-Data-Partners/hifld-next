import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "charts" / "dataset-discovery"


def render_chart(values: str) -> list[dict]:
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8") as handle:
        handle.write(values)
        handle.flush()
        result = subprocess.run(
            ["helm", "template", "dataset-discovery", str(CHART), "-f", handle.name],
            check=True,
            text=True,
            capture_output=True,
        )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


class DatasetDiscoveryHelmTests(unittest.TestCase):
    def test_renders_one_cronjob_per_enabled_job(self):
        docs = render_chart(
            """
image:
  repository: example.test/dataset-api
serviceAccount:
  name: dataset-discovery
database:
  existingSecret: dataset-discovery-db
jobs:
  hifld-prod:
    enabled: true
    schedule: "*/15 * * * *"
    storageLocationSlug: gcs-hifld-next-datasets-prod
    collectionSlug: hifld
    dryRun: false
    pruneStale: true
  partner-prod:
    enabled: true
    schedule: "0 * * * *"
    storageLocationSlug: partner-bucket
    collectionSlug: partner
    dryRun: true
    prefix: partner/
    limit: 10
  disabled-target:
    enabled: false
    schedule: "0 0 * * *"
    storageLocationSlug: disabled
    collectionSlug: disabled
"""
        )

        cronjobs = [doc for doc in docs if doc["kind"] == "CronJob"]
        self.assertEqual(
            [job["metadata"]["name"] for job in cronjobs],
            ["dataset-discovery-hifld-prod", "dataset-discovery-partner-prod"],
        )

        hifld = cronjobs[0]
        self.assertEqual(hifld["spec"]["schedule"], "*/15 * * * *")
        self.assertEqual(hifld["spec"]["concurrencyPolicy"], "Forbid")

        container = hifld["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]
        self.assertEqual(container["command"], ["uv", "run", "python", "-m", "jobs.discover"])
        env_by_name = {item["name"]: item for item in container["env"]}
        self.assertEqual(
            env_by_name["DATABASE_URL"]["valueFrom"]["secretKeyRef"],
            {"name": "dataset-discovery-db", "key": "DATABASE_URL"},
        )
        self.assertEqual(
            env_by_name["DISCOVER_STORAGE_LOCATION_SLUG"]["value"],
            "gcs-hifld-next-datasets-prod",
        )
        self.assertEqual(env_by_name["DISCOVER_COLLECTION_SLUG"]["value"], "hifld")
        self.assertEqual(env_by_name["DISCOVER_DRY_RUN"]["value"], "false")
        self.assertEqual(env_by_name["DISCOVER_PRUNE_STALE"]["value"], "true")
        self.assertEqual(env_by_name["DISCOVER_PREFIX"]["value"], "")
        self.assertEqual(env_by_name["DISCOVER_LIMIT"]["value"], "")
        self.assertEqual(
            hifld["spec"]["jobTemplate"]["spec"]["template"]["spec"]["serviceAccountName"],
            "dataset-discovery",
        )

        partner_env = {
            item["name"]: item["value"]
            for item in cronjobs[1]["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]["env"]
            if "value" in item
        }
        self.assertEqual(partner_env["DISCOVER_DRY_RUN"], "true")
        self.assertEqual(partner_env["DISCOVER_PRUNE_STALE"], "false")
        self.assertEqual(partner_env["DISCOVER_PREFIX"], "partner/")
        self.assertEqual(partner_env["DISCOVER_LIMIT"], "10")


if __name__ == "__main__":
    unittest.main()
