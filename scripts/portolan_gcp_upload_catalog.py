"""Upload generated catalog documents to dedicated migration buckets, SQLite last."""

import argparse
import hashlib
import json
import mimetypes
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

from portolan_gcp_copy import TARGETS, session


def upload(
    bucket: str, root: Path, path: Path, *, replace_existing: bool = False
) -> dict:
    if bucket not in TARGETS:
        raise ValueError("Uploads are restricted to the dedicated migration buckets")
    key = path.relative_to(root).as_posix()
    if any(part.startswith(".") for part in path.relative_to(root).parts):
        raise ValueError("Private build-control files must not be published")
    if not (
        path.name
        in {"catalog.json", "collection.json", "README.md", "AGENTS.md", "LICENSE.md"}
        or key == "_catalog/catalog.sqlite"
    ):
        raise ValueError(f"Not a generated catalog document: {key}")
    body = path.read_bytes()
    checksum = hashlib.sha256(body).hexdigest()
    generation = "0"
    if replace_existing:
        current = session().get(
            f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{quote(key, safe='')}",
            timeout=60,
        )
        if current.status_code == 200:
            existing = current.json()
            if (
                int(existing.get("size", -1)) == len(body)
                and existing.get("metadata", {}).get("sha256") == checksum
            ):
                return existing
            generation = existing["generation"]
        elif current.status_code != 404:
            current.raise_for_status()
    metadata = {
        "name": key,
        "contentType": mimetypes.guess_type(key)[0] or "application/octet-stream",
        "cacheControl": "no-cache",
        "metadata": {"sha256": checksum},
    }
    boundary = uuid.uuid4().hex
    payload = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
        + json.dumps(metadata).encode()
        + f"\r\n--{boundary}\r\nContent-Type: {metadata['contentType']}\r\n\r\n".encode()
        + body
        + f"\r\n--{boundary}--\r\n".encode()
    )
    response = session().post(
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o",
        params={"uploadType": "multipart", "ifGenerationMatch": generation},
        headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        data=payload,
        timeout=120,
    )
    response.raise_for_status()
    result = response.json()
    if (
        int(result["size"]) != len(body)
        or result.get("metadata", {}).get("sha256") != checksum
    ):
        raise ValueError(f"Uploaded catalog metadata differs: {key}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Refresh generated metadata using generation-conditional writes",
    )
    args = parser.parse_args()
    database = args.root / "_catalog/catalog.sqlite"
    if not database.is_file():
        raise ValueError("Catalog database must exist before uploading any documents")
    files = sorted(
        path
        for path in args.root.rglob("*")
        if path.is_file()
        and path != database
        and not any(part.startswith(".") for part in path.relative_to(args.root).parts)
    )
    results = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        for result in pool.map(
            lambda path: upload(
                args.target, args.root, path, replace_existing=args.replace_existing
            ),
            files,
        ):
            results.append(result)
            if len(results) % 250 == 0:
                print(f"Catalog documents: {len(results)}/{len(files)}", flush=True)
    results.append(
        upload(args.target, args.root, database, replace_existing=args.replace_existing)
    )
    args.report.write_text(json.dumps(results, indent=2) + "\n")
    print(f"Uploaded {len(results)} documents; SQLite published last")


if __name__ == "__main__":
    main()
