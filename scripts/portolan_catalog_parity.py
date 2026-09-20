"""Compare a generated catalog projection with production API and object baselines."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    inventory = json.loads((args.evidence / "inventory.json").read_text())
    baseline = json.loads((args.evidence / "production-datasets.json").read_text())
    expected_datasets = {dataset["slug"] for dataset in baseline}
    expected_files = {
        (dataset["slug"], file["slug"])
        for dataset in baseline
        for file in dataset["files"]
    }
    expected_objects = {
        "hifld/" + item["name"]
        for item in inventory
        if len(item["name"].split("/")) >= 5
        and item["name"].split("/")[2].startswith("v")
        and item["name"].split("/")[3] != "metadata"
    }
    connection = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    datasets = {
        row[0] for row in connection.execute("SELECT dataset_slug FROM datasets")
    }
    files = set(
        connection.execute(
            "SELECT d.dataset_slug, f.file_slug FROM files f JOIN datasets d USING(dataset_path)"
        )
    )
    objects = {
        row[0] for row in connection.execute("SELECT object_key FROM asset_objects")
    }
    issues = []
    for name, expected, actual in (
        ("datasets", expected_datasets, datasets),
        ("files", expected_files, files),
        ("data_objects", expected_objects, objects),
    ):
        if expected != actual:
            issues.append(
                {
                    "kind": name,
                    "missing": sorted(expected - actual),
                    "extra": sorted(actual - expected),
                }
            )
    title_differences = []
    tag_differences = []
    schema_differences = []
    schemas_checked = 0
    for item in inventory:
        if not item["name"].endswith("/metadata/data_dictionary.json"):
            continue
        identity = f"{item['name']}\0{item['generation']}\0{item.get('md5Hash', '')}"
        cache = (
            args.evidence
            / "source-json-cache"
            / f"{hashlib.sha256(identity.encode()).hexdigest()}.json"
        )
        if not cache.is_file():
            raise ValueError(f"Pinned dictionary cache missing: {item['name']}")
        dictionary = json.loads(cache.read_text())
        expected_columns = [
            (column["name"], column["type"], int(column["nullable"]))
            for column in dictionary["columns"]
        ]
        version_path = "hifld/" + item["name"].removesuffix(
            "/metadata/data_dictionary.json"
        )
        actual_columns = list(
            connection.execute(
                "SELECT name, data_type, nullable FROM columns WHERE version_path = ? ORDER BY ordinal",
                (version_path,),
            )
        )
        schemas_checked += 1
        if expected_columns != actual_columns:
            schema_differences.append(version_path)
    for dataset in baseline:
        row = connection.execute(
            "SELECT title, description FROM datasets WHERE dataset_slug = ?",
            (dataset["slug"],),
        ).fetchone()
        if row and (row[0] != dataset["name"] or row[1] != dataset["description"]):
            title_differences.append(dataset["slug"])
        expected_tags = {
            (key, item)
            for key, value in dataset.get("tags", {}).items()
            for item in (value if isinstance(value, list) else [value])
        }
        actual_tags = set(
            connection.execute(
                "SELECT tag_key, tag_value FROM tags WHERE entity_path = ?",
                (f"hifld/{dataset['slug']}",),
            )
        )
        if expected_tags != actual_tags:
            tag_differences.append(
                {
                    "dataset": dataset["slug"],
                    "missing": sorted(expected_tags - actual_tags),
                    "extra": sorted(actual_tags - expected_tags),
                }
            )
    spatial_missing_bounds = connection.execute(
        "SELECT version_path FROM versions WHERE spatial_status = 'spatial' AND crs84_bbox_json IS NULL"
    ).fetchall()
    if spatial_missing_bounds:
        issues.append(
            {
                "kind": "missing_spatial_bounds",
                "versions": [row[0] for row in spatial_missing_bounds],
            }
        )
    report = {
        "datasets": len(datasets),
        "files": len(files),
        "data_objects": len(objects),
        "versions": connection.execute("SELECT count(*) FROM versions").fetchone()[0],
        "spatial_versions": connection.execute(
            "SELECT count(*) FROM versions WHERE spatial_status = 'spatial'"
        ).fetchone()[0],
        "dataset_metadata_differences": title_differences,
        "tag_differences": tag_differences,
        "schemas_checked": schemas_checked,
        "schema_differences": schema_differences,
        "issues": issues,
        "scope": "catalog coverage only; byte checksums are verified in copy inventories, runtime parity remains separate",
    }
    connection.close()
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
