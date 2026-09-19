"""Generation-pinned, no-overwrite GCS copy with checksum verification.

Only the two dedicated Portolan migration buckets are accepted as targets.
Run with the datasets publisher's uv environment and ADC credentials.
"""

from __future__ import annotations

import argparse
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote

import google.auth
from google.auth.transport.requests import AuthorizedSession
from requests.exceptions import RequestException

SOURCE = "hifld-next-datasets-prod"
TARGETS = {"hifld-next-portolan-staging", "hifld-next-portolan-published"}
_local = threading.local()


def session() -> AuthorizedSession:
    if not hasattr(_local, "session"):
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        _local.session = AuthorizedSession(credentials)
    return _local.session


def verify(source: dict, target: dict) -> None:
    for field in ("size", "crc32c", "md5Hash"):
        if field in source and str(source[field]) != str(target.get(field)):
            raise ValueError(f"Checksum/size mismatch for {source['name']}: {field}")


def copy_object(target_bucket: str, source: dict) -> dict:
    if target_bucket not in TARGETS:
        raise ValueError("Copies are restricted to the dedicated migration buckets")
    key = source["name"]
    target_key = f"hifld/{key}"
    target_url = f"https://storage.googleapis.com/storage/v1/b/{target_bucket}/o/{quote(target_key, safe='')}"
    response = session().get(target_url, timeout=60)
    if response.status_code == 200:
        target = response.json()
        verify(source, target)
        return {
            "source": key,
            "source_generation": source["generation"],
            "target": target_key,
            "bucket": target_bucket,
            "status": "verified_existing",
            "metadata": target,
        }
    if response.status_code != 404:
        response.raise_for_status()
    url = (
        f"https://storage.googleapis.com/storage/v1/b/{SOURCE}/o/{quote(key, safe='')}"
        f"/rewriteTo/b/{target_bucket}/o/{quote(target_key, safe='')}"
    )
    params = {"sourceGeneration": source["generation"], "ifGenerationMatch": "0"}
    while True:
        response = session().post(url, params=params, json={}, timeout=120)
        response.raise_for_status()
        result = response.json()
        if result["done"]:
            target = result["resource"]
            verify(source, target)
            return {
                "source": key,
                "source_generation": source["generation"],
                "target": target_key,
                "bucket": target_bucket,
                "status": "copied",
                "metadata": target,
            }
        params["rewriteToken"] = result["rewriteToken"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    objects = json.loads(args.inventory.read_text())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    with (
        args.report.open("w") as report,
        ThreadPoolExecutor(max_workers=args.workers) as pool,
    ):
        futures = {
            pool.submit(copy_object, args.target, item): item["name"]
            for item in objects
        }
        for count, future in enumerate(as_completed(futures), start=1):
            try:
                result = future.result()
            except (OSError, ValueError, KeyError, RequestException) as error:
                result = {
                    "source": futures[future],
                    "error": f"{type(error).__name__}: {error}",
                }
                errors.append(result)
            report.write(json.dumps(result) + "\n")
            report.flush()
            if count % 100 == 0 or count == len(objects):
                print(
                    f"{args.target}: {count}/{len(objects)} checked; {len(errors)} errors",
                    flush=True,
                )
    print(
        json.dumps(
            {"target": args.target, "objects": len(objects), "errors": len(errors)}
        )
    )
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
