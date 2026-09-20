from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import duckdb
from starlette.testclient import TestClient

from app import asgi
from app.catalog.registry import SnapshotRegistry


def test_publisher_catalog_serves_collection_page_and_item(tmp_path: Path) -> None:
    parquet = tmp_path / "features.parquet"
    connection = duckdb.connect()
    connection.execute("LOAD spatial")
    connection.execute("CREATE TABLE source (objectid INTEGER, name VARCHAR, geometry BLOB)")
    connection.execute(
        "INSERT INTO source VALUES (7, 'first', ST_AsWKB(ST_Point(0, 0))), "
        "(8, 'second', ST_AsWKB(ST_Point(1, 1)))"
    )
    connection.execute("COPY source TO ? (FORMAT PARQUET)", [str(parquet)])
    connection.close()

    content = parquet.read_bytes()
    catalog = tmp_path / "catalog.sqlite"
    fixture = Path(__file__).parent / "fixtures/publisher_catalog.sql"
    database = sqlite3.connect(catalog)
    database.executescript(fixture.read_text())
    checksum = hashlib.sha256(content).hexdigest()
    database.execute(
        "UPDATE assets SET href = ?, size_bytes = ?, sha256 = ?",
        (str(parquet), len(content), checksum),
    )
    database.execute("UPDATE asset_locations SET href = ?", (str(parquet),))
    database.execute(
        "UPDATE asset_objects SET object_key = ?, relative_path = ?, size_bytes = ?, sha256 = ?",
        (str(parquet), parquet.name, len(content), checksum),
    )
    database.commit()
    database.close()

    asgi.registry = SnapshotRegistry()
    asgi.registry.replace(
        asgi.build_snapshot(
            catalog,
            public_url="https://features.test",
            catalog_url="https://catalog.test/_catalog/catalog.sqlite",
        )
    )
    collection_id = "hifld~sample~points~v1.0.0"
    with TestClient(asgi.app) as client:
        catalog_listing = client.get("/collections?f=json")
        collection = client.get(f"/collections/{collection_id}?f=json")
        queryables = client.get(f"/collections/{collection_id}/queryables?f=json")
        page = client.get(f"/collections/{collection_id}/items?f=json&limit=1")
        second_page = client.get(f"/collections/{collection_id}/items?f=json&limit=1&offset=1")
        bounded_page = client.get(
            f"/collections/{collection_id}/items?f=json&bbox=-0.5,-0.5,0.5,0.5"
        )
        item = client.get(f"/collections/{collection_id}/items/7?f=json")
        html_collection = client.get(
            f"/collections/{collection_id}", headers={"accept": "text/html"}
        )
        html_page = client.get(
            f"/collections/{collection_id}/items?limit=1", headers={"accept": "text/html"}
        )
        conformance = client.get("/conformance?f=json")
        conformance_html = client.get("/conformance", headers={"accept": "text/html"})
        openapi_html = client.get("/openapi", headers={"accept": "text/html"})
        static_css = client.get("/static/css/default.css")
        unsupported_controls = [
            "filter=name='first'",
            "filter-lang=cql2-text",
            "sortby=name",
            "properties=name",
            "skipGeometry=true",
            "datetime=2020-01-01",
            "q=first",
        ]
        unsupported_responses = [
            client.get(f"/collections/{collection_id}/items?f=json&{query}")
            for query in unsupported_controls
        ]
        unknown_response = client.get(
            f"/collections/{collection_id}/items?f=json&not_a_field=value"
        )

    assert catalog_listing.status_code == 200
    assert collection.status_code == 200
    assert collection.json()["extent"]["spatial"]["bbox"] == [[0.0, 0.0, 1.0, 1.0]]
    assert "${FEATURE_SERVER_PUBLIC_URL}" not in collection.text
    assert any(
        link["href"] == "https://catalog.test/hifld/sample/points/v1.0.0/collection.json"
        for link in collection.json()["links"]
    )
    assert queryables.status_code == 200
    assert queryables.json()["properties"]["objectid"]["type"] == "integer"
    assert queryables.json()["properties"]["name"]["type"] == "string"
    assert page.status_code == 200
    assert page.json()["features"][0]["id"] == "7"
    self_link = next(link for link in second_page.json()["links"] if link["rel"] == "self")
    assert "offset=1" in self_link["href"]
    assert bounded_page.status_code == 200
    assert bounded_page.json()["numberMatched"] == 1
    assert item.status_code == 200
    assert item.json()["properties"]["name"] == "first"
    assert item.headers["x-catalog-generation"] == "publisher-generation"
    assert html_collection.status_code == 200
    assert html_collection.headers["content-type"].startswith("text/html")
    assert "mailto:None" not in html_collection.text
    assert 'href="mailto:"' not in html_collection.text
    assert "https://tile.openstreetmap.org/{z}/{x}/{y}.png" in html_collection.text
    assert html_page.status_code == 200
    assert html_page.headers["content-type"].startswith("text/html")
    assert all("cql" not in uri.lower() for uri in conformance.json()["conformsTo"])
    assert all("transactions" not in uri.lower() for uri in conformance.json()["conformsTo"])
    assert all(
        "create-replace-delete" not in uri.lower() for uri in conformance.json()["conformsTo"]
    )
    assert "cql" not in conformance_html.text.lower()
    assert "transactions" not in conformance_html.text.lower()
    assert openapi_html.status_code == 200
    assert openapi_html.headers["content-type"].startswith("text/html")
    assert "/openapi" in openapi_html.text
    assert static_css.status_code == 200
    assert static_css.headers["content-type"].startswith("text/css")
    assert collection.json()["title"].endswith("(v1.0.0)")
    assert all(response.status_code == 400 for response in unsupported_responses)
    assert unknown_response.status_code == 400
