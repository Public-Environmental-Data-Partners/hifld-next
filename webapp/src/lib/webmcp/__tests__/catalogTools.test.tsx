import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogTools } from "../catalogTools";
import { createModelContextFake, installModelContextFake } from "../modelContextFake";

const collection = {
  id: "hifld",
  slug: "hifld",
  name: "HIFLD",
  description: "Catalog",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const dataset = {
  id: "hifld/roads",
  slug: "roads",
  name: "Roads",
  description: "Road network",
  collection_id: "hifld",
  tags: { geometry_type: "LineString" },
  created_at: collection.created_at,
  updated_at: collection.updated_at,
};

const datasetCatalog = {
  type: "Catalog",
  stac_version: "1.1.0",
  id: "hifld/roads",
  title: "Roads",
  description: "Road network",
  keywords: ["transportation"],
  links: [
    { rel: "self", href: "catalog.json" },
    { rel: "child", href: "roads/catalog.json", title: "Roads layer" },
  ],
};

const fileCollection = {
  type: "Collection",
  stac_version: "1.1.0",
  id: "hifld/roads/roads/v1.0.0",
  title: "Roads layer",
  description: "Road network",
  license: "proprietary",
  extent: { spatial: { bbox: [[-123, 37, -122, 38]] }, temporal: { interval: [[null, null]] } },
  links: [{ rel: "self", href: "collection.json" }],
  assets: {
    "geoparquet-fc1c85bbf3ae": {
      href: "https://storage.invalid/roads.parquet",
      title: "GeoParquet",
      type: "application/vnd.apache.parquet",
      roles: ["data"],
      "hifld:format_key": "geoparquet",
      "hifld:sha256": "fc1c85bbf3ae",
      "hifld:storage_location_slug": "production-gcs",
    },
  },
  "table:columns": [
    { name: "geometry", type: "geometry", description: "Road geometry", nullable: false },
    { name: "road_id", type: "string", nullable: false },
  ],
};

const rootCatalog = {
  type: "Catalog",
  stac_version: "1.1.0",
  id: "hifld-local-published",
  description: "Published catalogs",
  links: [
    { rel: "self", href: "catalog.json", type: "application/json" },
    { rel: "child", href: "hifld/catalog.json", type: "application/json", title: "HIFLD" },
  ],
};

const collectionCatalog = {
  type: "Catalog",
  stac_version: "1.1.0",
  id: "hifld",
  title: "HIFLD",
  description: "Catalog",
  links: [{ rel: "self", href: "catalog.json", type: "application/json" }],
};

describe("global catalog WebMCP tools", () => {
  it("registers exactly six catalog tools", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const fetchMock = vi.fn(async () => Response.json([collection]));
    vi.stubGlobal("fetch", fetchMock);

    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);

    await waitFor(() => {
      expect(fake.toolNames()).toEqual([
        "list_collections",
        "get_collection",
        "search_datasets",
        "get_dataset",
        "get_dataset_file",
        "get_dataset_file_schema",
      ]);
    });
  });

  it("returns a stable upstream error for malformed catalog payloads", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ malformed: true }])));

    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("list_collections", {})).resolves.toMatchObject({
      ok: false,
      error: { code: "upstream_unavailable" },
    });
  });

  it("normalizes STAC child links without fetching their upstream hrefs", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const fetchMock = vi.fn(async () => Response.json(rootCatalog));
    vi.stubGlobal("fetch", fetchMock);

    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("list_collections", {})).resolves.toMatchObject({
      ok: true,
      data: {
        collections: [{ id: "hifld", slug: "hifld", name: "HIFLD", link: "/api/collections/hifld" }],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/collections", expect.anything());
  });

  it("resolves a missing child title through the validated local collection endpoint", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const fetchMock = vi.fn(async (path: string | URL | Request) => {
      if (String(path) === "/api/collections/hifld") return Response.json(collectionCatalog);
      return Response.json({
        ...rootCatalog,
        links: [{ rel: "child", href: "https://upstream.invalid/hifld/catalog.json" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("list_collections", {})).resolves.toMatchObject({
      ok: true,
      data: { collections: [{ slug: "hifld", name: "HIFLD", description: "Catalog" }] },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/collections/hifld", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("https://upstream.invalid/hifld/catalog.json", expect.anything());
  });

  it("updates URL-backed search state after the bounded search response resolves", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const applySearch = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () =>
        Response.json({
          datasets: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<CatalogTools applySearch={applySearch} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(
      fake.execute("search_datasets", {
        collection: "hifld",
        query: "roads",
        tag_filters: { geometry_type: "LineString" },
      }),
    ).resolves.toMatchObject({ ok: true, data: { total: 0 } });
    expect(applySearch).toHaveBeenCalledWith("hifld", {
      query: "roads",
      tag_filters: JSON.stringify({ geometry_type: "LineString" }),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/hifld/datasets?query=roads&tag_filters=%7B%22geometry_type%22%3A%22LineString%22%7D",
      expect.anything(),
    );
  });

  it("accepts linked datasets returned by the collection search route", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          links: { self: "/api/collections/hifld" },
          datasets: [datasetCatalog],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("search_datasets", { collection: "hifld", query: "roads" })).resolves.toMatchObject({
      ok: true,
      data: { datasets: [{ id: "hifld/roads", slug: "roads", name: "Roads", tags: { keywords: ["transportation"] } }] },
    });
  });

  it("accepts collection metadata included by the tags route", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string | URL | Request) => {
        if (String(path).endsWith("/datasets/tags")) {
          return Response.json({
            links: { self: "/api/collections/hifld/datasets/tags" },
            collection: { id: collection.id, slug: collection.slug, name: collection.name },
            tags: { geometry_type: ["LineString"] },
          });
        }
        if (String(path).includes("/datasets")) {
          return Response.json({ datasets: [], total: 0, limit: 20, offset: 0, links: {} });
        }
        return Response.json(collectionCatalog);
      }),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("get_collection", { slug: "hifld" })).resolves.toMatchObject({
      ok: true,
      data: { collection: { slug: "hifld", name: "HIFLD" }, tags: { geometry_type: ["LineString"] } },
    });
  });

  it("summarizes file children from a raw dataset catalog without following their hrefs", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...datasetCatalog,
          links: [{ rel: "child", href: "https://upstream.invalid/roads/catalog.json", title: "Roads layer" }],
        }),
      ),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("get_dataset", { collection: "hifld", dataset: "roads" })).resolves.toMatchObject({
      ok: true,
      data: { dataset: { id: "hifld/roads", slug: "roads" }, files: [{ id: "hifld/roads/roads", slug: "roads", name: "Roads layer" }] },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("normalizes a raw selected-version Collection while preserving query source identities", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(fileCollection)),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    const result = await fake.execute("get_dataset_file", { collection: "hifld", dataset: "roads", file: "roads" });
    expect(result).toMatchObject({ ok: true });
    expect(result).toMatchObject({
      data: {
        file: { slug: "roads", name: "Roads layer" },
        formats: [{ format_type: "geoparquet", sources: [{ asset_key: "geoparquet-fc1c85bbf3ae" }] }],
        query_sources: [{
          alias: "source_0",
          collection_slug: "hifld",
          dataset_slug: "roads",
          file_slug: "roads",
          version: "v1.0.0",
          asset_key: "geoparquet-fc1c85bbf3ae",
          storage_location_slug: "production-gcs",
        }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("storage.invalid");
  });

  it("reads and pages schema columns from the same raw file Collection endpoint", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(fileCollection)),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(
      fake.execute("get_dataset_file_schema", { collection: "hifld", dataset: "roads", file: "roads", version: "v1.0.0", offset: 1, limit: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        selected_version: "v1.0.0",
        schema: { total_columns: 2, column_offset: 1, column_limit: 1, has_more: false, columns: [{ name: "road_id" }] },
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/collections/hifld/datasets/roads/files/roads?version=v1.0.0",
      expect.anything(),
    );
  });
});
