"""Read-only production inventory and GeoParquet footer conformance spike.

Run with the publisher's uv environment. This does not claim full Portolan
validation: spatial ordering, visual styles and catalog metadata need separate
validation. No production objects are modified.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import fsspec
import google.auth
import pyarrow.parquet as pq
from google.auth.transport.requests import AuthorizedSession


def inventory(bucket: str) -> list[dict]:
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/devstorage.read_only"]
    )
    session = AuthorizedSession(credentials)
    objects = []
    params = {
        "maxResults": 1000,
        "fields": "nextPageToken,items(name,size,generation,md5Hash,crc32c,contentType,updated)",
    }
    while True:
        response = session.get(
            f"https://storage.googleapis.com/storage/v1/b/{bucket}/o",
            params=params,
            timeout=60,
        )
        response.raise_for_status()
        page = response.json()
        objects.extend(page.get("items", []))
        print(f"Inventory: {len(objects)} objects", flush=True)
        token = page.get("nextPageToken")
        if not token:
            return objects
        params["pageToken"] = token


def inspect_parquet(bucket: str, item: dict) -> dict:
    result = {"key": item["name"], "generation": item["generation"], "issues": []}
    url = f"https://storage.googleapis.com/{bucket}/{quote(item['name'], safe='/')}?generation={item['generation']}"
    try:
        with fsspec.open(url, "rb", block_size=65536, cache_type="bytes") as source:
            parquet = pq.ParquetFile(source)
            footer = parquet.metadata
            raw = (parquet.schema_arrow.metadata or {}).get(b"geo")
            geo = json.loads(raw) if raw else {}
            column = geo.get("columns", {}).get(geo.get("primary_column"), {})
            result.update(
                rows=footer.num_rows,
                row_groups=footer.num_row_groups,
                geo_version=geo.get("version"),
                primary_column=geo.get("primary_column"),
                geometry_types=column.get("geometry_types"),
                crs=column.get("crs"),
                bbox=column.get("bbox"),
                covering=column.get("covering"),
                schema=[
                    {"name": field.name, "type": str(field.type)}
                    for field in parquet.schema_arrow
                ],
            )
            if not geo:
                result["issues"].append(
                    "no_geo_metadata: classify as nonspatial or repair spatial metadata"
                )
            elif geo.get("version") not in {"1.1.0", "2.0.0"}:
                result["issues"].append("geoparquet_version_below_required_1.1")
            maximum = max(
                (footer.row_group(i).num_rows for i in range(footer.num_row_groups)),
                default=0,
            )
            result["max_row_group_rows"] = maximum
            if maximum > 150000:
                result["issues"].append("row_group_exceeds_150000")
            covering = column.get("covering", {}).get("bbox", {})
            if not result.get("bbox") and covering:
                bounds = {name: [] for name in ("xmin", "ymin", "xmax", "ymax")}
                for i in range(footer.num_row_groups):
                    group = footer.row_group(i)
                    statistics = {
                        group.column(j).path_in_schema: group.column(j).statistics
                        for j in range(group.num_columns)
                    }
                    for name, values in bounds.items():
                        statistic = statistics.get(".".join(covering.get(name, [])))
                        if statistic is not None and statistic.has_min_max:
                            values.append(
                                statistic.min if name.endswith("min") else statistic.max
                            )
                if all(bounds.values()):
                    result["bbox"] = [
                        min(bounds["xmin"]),
                        min(bounds["ymin"]),
                        max(bounds["xmax"]),
                        max(bounds["ymax"]),
                    ]
                    result["bbox_provenance"] = "parquet_row_group_covering_statistics"
            if geo and geo.get("version", "").startswith("1."):
                if not covering:
                    result["issues"].append("missing_bbox_covering")
                else:
                    required = {".".join(path) for path in covering.values()}
                    for i in range(footer.num_row_groups):
                        group = footer.row_group(i)
                        present = {
                            group.column(j).path_in_schema
                            for j in range(group.num_columns)
                            if group.column(j).statistics is not None
                            and group.column(j).statistics.has_min_max
                        }
                        if not required <= present:
                            result["issues"].append(
                                "missing_covering_min_max_statistics"
                            )
                            break
            result["spatial_ordering"] = "not_verified_by_footer_spike"
    except (OSError, ValueError, TypeError, KeyError) as error:
        result["error"] = f"{type(error).__name__}: {error}"
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", default="hifld-next-datasets-prod")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-inventory", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    inventory_path = args.output / "inventory.json"
    objects = (
        json.loads(inventory_path.read_text())
        if args.reuse_inventory
        else inventory(args.bucket)
    )
    inventory_path.write_text(json.dumps(objects, indent=2) + "\n")
    data = [item for item in objects if not item["name"].startswith("_")]
    parquet = [
        item
        for item in data
        if "/geoparquet/" in item["name"] and item["name"].endswith(".parquet")
    ]
    results = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(
            lambda item: inspect_parquet(args.bucket, item), parquet
        ):
            results.append(result)
            if len(results) % 100 == 0 or len(results) == len(parquet):
                print(f"Parquet footers: {len(results)}/{len(parquet)}", flush=True)
    (args.output / "parquet-spike.json").write_text(
        json.dumps(results, indent=2) + "\n"
    )
    versions = {
        "/".join(item["name"].split("/")[:3])
        for item in data
        if len(item["name"].split("/")) >= 5
        and item["name"].split("/")[2].startswith("v")
    }
    summary = {
        "bucket": args.bucket,
        "objects": len(objects),
        "bytes": sum(int(item["size"]) for item in objects),
        "versions": len(versions),
        "parquet_files": len(parquet),
        "footer_errors": sum("error" in item for item in results),
        "footer_issues": dict(
            Counter(issue for item in results for issue in item["issues"])
        ),
        "full_portolan_conformance": "not_established",
    }
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
