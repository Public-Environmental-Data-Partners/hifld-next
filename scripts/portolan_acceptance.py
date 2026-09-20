"""Probe real catalog/OGC services after each SeaweedFS promotion wave.

This command never publishes, changes production, or deletes fixtures. Use the
publisher's bootstrap/promotion commands first; preserve the initial report to
check that a live additive update did not change baseline feature results.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]


def json_value(value: object) -> JsonValue:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        return {str(key): json_value(item) for key, item in value.items()}
    raise ValueError("Invalid JSON response")


def json_object(value: JsonValue) -> dict[str, JsonValue]:
    if not isinstance(value, dict):
        raise ValueError("Expected JSON object")
    return value


def string_field(value: dict[str, JsonValue], *names: str) -> str:
    for name in names:
        result = value.get(name)
        if isinstance(result, str) and result:
            return result
    raise ValueError(f"Missing string field: {' / '.join(names)}")


def collection_id(collection: str, dataset: str, file: str, version: str) -> str:
    parts = (collection, dataset, file, version)
    if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", part) for part in parts):
        raise ValueError("Invalid catalog identity")
    return "~".join(parts)


@dataclass(frozen=True)
class Case:
    collection: str
    dataset: str
    file: str
    version: str

    @property
    def identifier(self) -> str:
        return collection_id(self.collection, self.dataset, self.file, self.version)


def manifest_cases(manifest: dict[str, JsonValue], wave: str) -> list[Case]:
    entries = manifest.get("fixtures")
    if not isinstance(entries, list):
        raise ValueError("Fixture manifest requires a fixtures list")
    cases = []
    for entry in entries:
        item = json_object(entry)
        if wave != "all" and item.get("wave") != wave:
            continue
        cases.append(Case(string_field(item, "collection", "collection_slug"),
                          string_field(item, "dataset", "dataset_slug"),
                          string_field(item, "file", "file_slug"),
                          string_field(item, "version")))
    if not cases:
        raise ValueError("No fixtures selected")
    return cases


def feature_fingerprint(body: dict[str, JsonValue]) -> str:
    features = body.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Expected a nonempty feature page")
    encoded = json.dumps(features, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


@dataclass(frozen=True)
class Response:
    body: JsonValue
    generation: str


def get(url: str) -> Response:
    request = Request(url, headers={"Accept": "application/geo+json, application/json"})
    with urlopen(request, timeout=30) as response:
        body = json_value(json.loads(response.read(16 * 1024 * 1024)))
        return Response(body, response.headers.get("X-Catalog-Generation", ""))


def wait_ready(webapp: str, feature: str, expected: str | None, timeout: float) -> str:
    deadline = time.monotonic() + timeout
    last_error = "services not ready"
    while time.monotonic() < deadline:
        try:
            catalog = get(webapp + "/api/collections")
            ogc = get(feature + "/collections?f=json")
            if catalog.generation and catalog.generation == ogc.generation:
                if expected is None or expected == catalog.generation:
                    return catalog.generation
            last_error = "consumer generations have not converged"
        except (HTTPError, URLError, TimeoutError, ValueError):
            last_error = "consumer unavailable or returned invalid metadata"
        time.sleep(1)
    raise TimeoutError(last_error)


def probe(case: Case, webapp: str, feature: str, generation: str) -> dict[str, JsonValue]:
    path = f"/api/collections/{case.collection}/datasets/{case.dataset}/files/{case.file}"
    catalog = get(webapp + path)
    if catalog.generation != generation:
        raise AssertionError("Catalog changed during acceptance wave; rerun the probe")
    resource = feature + "/collections/" + case.identifier
    metadata = get(resource + "?f=json")
    queryables = get(resource + "/queryables?f=json")
    page = get(resource + "/items?f=json&limit=2")
    for response in (metadata, queryables, page):
        if response.generation != generation:
            raise AssertionError("Feature service generation changed during acceptance wave")
    page_body = json_object(page.body)
    features = page_body.get("features")
    if not isinstance(features, list) or not features:
        raise AssertionError("Fixture returned no features")
    first = json_object(features[0])
    feature_id = string_field(first, "id")
    by_id = get(resource + "/items/" + quote(feature_id, safe="") + "?f=json")
    if by_id.body != first:
        # Some OGC implementations include response-only links on individual items.
        for field in ("id", "geometry", "properties", "type"):
            if json_object(by_id.body).get(field) != first.get(field):
                raise AssertionError(f"Item-by-ID differs in {field}")
    links = json_object(metadata.body).get("links")
    if not isinstance(links, list) or not any(
        isinstance(link, dict) and isinstance(link.get("href"), str)
        and "collection.json" in str(link["href"]) for link in links
    ):
        raise AssertionError("OGC collection is missing its Portolan link")
    return {"collection": case.identifier, "first_page_sha256": feature_fingerprint(page_body),
            "feature_id": feature_id, "generation": generation}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--wave", choices=("initial", "hot-update", "all"), default="all")
    parser.add_argument("--webapp-url", default="http://localhost:3000")
    parser.add_argument("--feature-url", default="http://localhost:5000")
    parser.add_argument("--expected-generation")
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    manifest = json_object(json_value(json.loads(args.manifest.read_text())))
    cases = manifest_cases(manifest, args.wave)
    started = time.monotonic()
    generation = wait_ready(args.webapp_url.rstrip("/"), args.feature_url.rstrip("/"),
                            args.expected_generation, args.timeout)
    results = [probe(case, args.webapp_url.rstrip("/"), args.feature_url.rstrip("/"), generation)
               for case in cases]
    if args.baseline:
        baseline = json_object(json_value(json.loads(args.baseline.read_text())))
        previous = baseline.get("results")
        if not isinstance(previous, list):
            raise ValueError("Invalid baseline report")
        current = {str(row["collection"]): row for row in results}
        for value in previous:
            row = json_object(value)
            matching = current.get(string_field(row, "collection"))
            if matching is None or matching["first_page_sha256"] != row.get("first_page_sha256"):
                raise AssertionError("An additive update changed or omitted a baseline collection")
    report = {"generation": generation, "elapsed_seconds": time.monotonic() - started,
              "results": results}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
