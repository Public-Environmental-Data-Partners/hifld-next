"""Capture the public production catalog for later semantic parity checks."""

import argparse
import json
from pathlib import Path
from urllib.request import urlopen


def get(url: str):
    with urlopen(url, timeout=90) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    origin = "https://hifld.publicenvirodata.org"
    collections = get(f"{origin}/api/collections")
    (args.output / "production-collections.json").write_text(
        json.dumps(collections, indent=2) + "\n"
    )
    datasets = []
    offset = 0
    seen = set()
    while True:
        response = get(
            f"{origin}/api/collections/hifld?include_urls=true&limit=100&offset={offset}"
        )
        page = response.get("datasets")
        if not isinstance(page, list):
            raise TypeError("Unexpected production dataset envelope")
        if not page:
            break
        for dataset in page:
            if dataset["slug"] in seen:
                raise ValueError("Production pagination repeated a dataset")
            seen.add(dataset["slug"])
            datasets.append(dataset)
        offset += len(page)
        print(f"Production datasets: {len(datasets)}", flush=True)
    (args.output / "production-datasets.json").write_text(
        json.dumps(datasets, indent=2) + "\n"
    )
    files = [file for dataset in datasets for file in dataset.get("files", [])]
    print(json.dumps({"datasets": len(datasets), "files": len(files)}))


if __name__ == "__main__":
    main()
