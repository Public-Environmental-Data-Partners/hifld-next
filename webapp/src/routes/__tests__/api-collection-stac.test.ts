import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as CollectionsRoute } from "../api/collections";
import { Route as CollectionRoute } from "../api/collections.$slug";
import { Route as DatasetsRoute } from "../api/collections.$slug.datasets";
import { Route as DatasetTagsRoute } from "../api/collections.$collectionSlug.datasets.tags";
import { Route as DatasetRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug";
import { Route as FileRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug";
import { Route as GlobalRoute } from "../api/datasets";
import { Route as GlobalDetailRoute } from "../api/datasets.$id";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  collections: vi.fn(),
  datasets: vi.fn(),
  dataset: vi.fn(),
  file: vi.fn(),
  tags: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/env/server", () => ({
  env: { CATALOG_SQLITE_URL: "http://storage.test/published/_catalog/catalog.sqlite" },
}));
vi.mock("@/lib/catalog-api", () => ({
  sqliteCatalogApi: async () => ({ generation: "generation-1", ...mocks }),
}));

describe("collection STAC responses", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.collections.mockResolvedValue([]);
    mocks.collection.mockResolvedValue({ collection_slug: "hifld", collection_path: "hifld" });
    mocks.datasets.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    mocks.tags.mockResolvedValue({ category: ["Health", "Safety"] });
  });

  it("returns root catalog bytes, not a collection array", async () => {
    const body = '{\n "type": "Catalog", "id": "root", "links": []\n}';
    mocks.fetch.mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    const handler = CollectionsRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing root handler");
    const response = await handler({ request: new Request("http://app.test/api/collections"), params: {} });
    expect(await response.text()).toBe(body);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("http://storage.test/published/catalog.json?__catalog_request="), expect.anything());
    expect(response.headers.get("X-Catalog-Generation")).toBe("generation-1");
  });

  it("returns collection catalog bytes without an expanded dataset wrapper", async () => {
    const body = '{\n "type": "Catalog", "id": "hifld", "links": []\n}';
    mocks.fetch.mockResolvedValue(new Response(body, { headers: { ETag: '"stac-1"' } }));
    const handler = CollectionRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing collection handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/hifld"), params: { slug: "hifld" } });
    expect(await response.text()).toBe(body);
    expect(mocks.datasets).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("http://storage.test/published/hifld/catalog.json?__catalog_request="), expect.anything());
    expect(response.headers.get("etag")).toBe('"stac-1"');
  });

  it("does not fetch a catalog for an unknown collection", async () => {
    mocks.collection.mockResolvedValue(null);
    const handler = CollectionRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing collection handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/missing"), params: { slug: "missing" } });
    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps searchable dataset pages at the explicit datasets endpoint", async () => {
    const handler = DatasetsRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing dataset listing handler");
    const response = await handler({
      request: new Request("http://app.test/api/collections/hifld/datasets?query=water&limit=2"),
      params: { slug: "hifld" },
    });
    expect(mocks.datasets).toHaveBeenCalledWith("hifld", { search: "water", limit: 2, offset: 0 });
    expect(await response.text()).toContain("/api/collections/hifld/datasets?query=water");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("applies typed tag filters to catalog pages", async () => {
    const handler = DatasetsRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing dataset listing handler");
    const filters = encodeURIComponent(JSON.stringify({ category: ["Health", "Safety"], status: "active" }));
    const response = await handler({
      request: new Request(`http://app.test/api/collections/hifld/datasets?tag_filters=${filters}&limit=2`),
      params: { slug: "hifld" },
    });
    expect(response.status).toBe(200);
    expect(mocks.datasets).toHaveBeenCalledWith("hifld", {
      tagFilters: { category: ["Health", "Safety"], status: "active" },
      limit: 2,
      offset: 0,
    });
  });

  it("serves available tag values from the active catalog", async () => {
    const handler = DatasetTagsRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing dataset tags handler");
    const response = await handler({
      request: new Request("http://app.test/api/collections/hifld/datasets/tags?tag_key=category"),
      params: { collectionSlug: "hifld" },
    });
    expect(mocks.tags).toHaveBeenCalledWith("hifld", "category");
    expect(await response.json()).toMatchObject({ tags: { category: ["Health", "Safety"] } });
  });

  it.each(["", "?query=water", "?tag_filters=%7B%22geometry_type%22%3A%22Point%22%7D", "?limit=1&offset=1"])(
    "embeds the same unmodified STAC document for listing %s", async (query) => {
      const document = { type: "Catalog", stac_version: "1.1.0", id: "hifld/water", title: "Source title", description: "Source description", links: [], "hifld:tags": { category: ["Water"] }, "custom:field": { retained: true } };
      mocks.datasets.mockResolvedValue({ items: [{ dataset_slug: "water", name: "Stale DB title", stac_href: "hifld/water/catalog.json" }], total: 2, limit: 1, offset: 0 });
      mocks.fetch.mockImplementation(async () => new Response(JSON.stringify(document)));
      const handler = DatasetsRoute.options.server?.handlers?.GET;
      if (!handler) throw new Error("Missing listing handler");
      const response = await handler({ request: new Request(`http://app.test/api/collections/hifld/datasets${query}`), params: { slug: "hifld" } });
      expect(await response.json()).toMatchObject({ datasets: [document], total: 2 });
      expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("http://storage.test/published/hifld/water/catalog.json?__catalog_request="), expect.anything());
    },
  );

  it("streams dataset metadata rather than the database envelope", async () => {
    const body = '{ "type":"Catalog", "id":"hifld/water", "description":"Source" }';
    mocks.dataset.mockResolvedValue({ stac_href: "hifld/water/catalog.json" });
    mocks.fetch.mockResolvedValue(new Response(body));
    const handler = DatasetRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing dataset handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/hifld/datasets/water"), params: { collectionSlug: "hifld", datasetSlug: "water" } });
    expect(await response.text()).toBe(body);
  });

  it("streams the explicitly selected version STAC from a file detail", async () => {
    const body = '{ "type":"Collection", "id":"hifld/water/points/v1" }';
    mocks.dataset.mockResolvedValue({ stac_href: "hifld/water/catalog.json" });
    mocks.file.mockResolvedValue({ stac_href: "hifld/water/points/v1/collection.json" });
    mocks.fetch.mockResolvedValue(new Response(body));
    const handler = FileRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing file handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/hifld/datasets/water/files/points?version=v1"), params: { collectionSlug: "hifld", datasetSlug: "water", fileSlug: "points" } });
    expect(mocks.file).toHaveBeenCalledWith("hifld", "water", "points", "v1");
    expect(await response.text()).toBe(body);
  });

  it("uses the same STAC listing envelope for the global listing", async () => {
    const document = { type: "Catalog", stac_version: "1.1.0", id: "hifld/water", description: "Source", links: [] };
    mocks.collections.mockResolvedValue([{ collection_slug: "hifld" }]);
    mocks.datasets.mockResolvedValue({ items: [{ stac_href: "hifld/water/catalog.json" }], total: 1, limit: 1, offset: 0 });
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify(document)));
    const handler = GlobalRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing global handler");
    const response = await handler({ request: new Request("http://app.test/api/datasets?query=water&limit=1"), params: {} });
    expect(await response.json()).toMatchObject({ datasets: [document], total: 1, limit: 1, offset: 0 });
  });

  it("returns STAC for the full-path global dataset identity", async () => {
    mocks.dataset.mockResolvedValue({ stac_href: "hifld/water/catalog.json" });
    const body = '{"type":"Catalog","id":"hifld/water"}';
    mocks.fetch.mockResolvedValue(new Response(body));
    const handler = GlobalDetailRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing global detail handler");
    const response = await handler({ request: new Request("http://app.test/api/datasets/hifld%2Fwater"), params: { id: "hifld/water" } });
    expect(await response.text()).toBe(body);
  });
});
