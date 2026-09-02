import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogTools } from "../catalogTools";
import { createModelContextFake, installModelContextFake } from "../modelContextFake";

const collection = {
  id: 1,
  slug: "hifld",
  name: "HIFLD",
  description: "Catalog",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const dataset = {
  id: 2,
  slug: "roads",
  name: "Roads",
  description: "Road network",
  collection_id: 1,
  tags: { geometry_type: "LineString" },
  created_at: collection.created_at,
  updated_at: collection.updated_at,
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

  it("updates URL-backed search state after the bounded search response resolves", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    const applySearch = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          collection,
          datasets: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      ),
    );
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
  });

  it("accepts linked datasets returned by the collection search route", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          links: { self: "/api/collections/hifld" },
          collection,
          datasets: [{ ...dataset, links: { self: "/api/collections/hifld/datasets/roads" } }],
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
      data: { datasets: [{ id: 2, slug: "roads", name: "Roads" }] },
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
        return Response.json({ collection, datasets: [], total: 0, limit: 20, offset: 0 });
      }),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("get_collection", { slug: "hifld" })).resolves.toMatchObject({
      ok: true,
      data: { collection: { slug: "hifld" }, tags: { geometry_type: ["LineString"] } },
    });
  });

  it("summarizes dataset files without validating unused detail fields", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          links: { self: "/api/collections/hifld/datasets/roads" },
          collection,
          dataset: {
            ...dataset,
            files: [
              {
                id: 4,
                dataset_id: dataset.id,
                slug: "roads",
                name: "Roads",
                description: null,
                layer_name: null,
                source_file_path: null,
                file_metadata: null,
                created_at: collection.created_at,
                updated_at: collection.updated_at,
                formats: [{ format_count: 4 }],
                links: { self: "/api/collections/hifld/datasets/roads/files/roads" },
              },
            ],
          },
        }),
      ),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    await expect(fake.execute("get_dataset", { collection: "hifld", dataset: "roads" })).resolves.toMatchObject({
      ok: true,
      data: { files: [{ id: 4, slug: "roads", name: "Roads" }] },
    });
  });

  it("removes physical source locations from file metadata output", async () => {
    const fake = createModelContextFake();
    installModelContextFake(fake);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          links: { self: "/api/file" },
          collection,
          dataset: { ...collection, collection_id: 1, tags: {} },
          file: {
            id: 4,
            dataset_id: 2,
            slug: "roads",
            name: "Roads",
            description: "Roads",
            layer_name: "roads",
            created_at: collection.created_at,
            updated_at: collection.updated_at,
            formats: [
              {
                format: { id: 1, format_type: "geoparquet", name: "GeoParquet", created_at: collection.created_at, updated_at: collection.updated_at },
                dataset_format: { id: 1, dataset_id: 2, format_id: 1, created_at: collection.created_at, updated_at: collection.updated_at },
                sources: [
                  {
                    id: 10,
                    version: "v1",
                    source_type: "file",
                    location: { version: "v1", path: "private/roads.parquet" },
                    storage_uri: "s3://private/roads.parquet",
                    source_metadata: { version: "v1", columns: [] },
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    render(<CatalogTools applySearch={vi.fn(async () => undefined)} enabled />);
    await waitFor(() => expect(fake.toolNames()).toHaveLength(6));

    const result = await fake.execute("get_dataset_file", { collection: "hifld", dataset: "roads", file: "roads" });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("private/roads.parquet");
    expect(JSON.stringify(result)).not.toContain("s3://");
  });
});
