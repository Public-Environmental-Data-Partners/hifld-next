import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as RootRoute } from "../stac/index";
import { Route as DescriptionRoute } from "../stac/api";
import { Route as CollectionsRoute } from "../stac/collections";
import { Route as CollectionRoute } from "../stac/collections.$collectionId";
import { Route as UnescapedCollectionRoute } from "../stac/collections.$";
import { Route as ApiIndexRoute } from "../api/index";

const versionId = "hifld/hospitals-3/hospitals-3/v1.0.0";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  listStacVersions: vi.fn(),
  getStacVersion: vi.fn(),
}));

vi.mock("@/env/server", () => ({ env: { WEBAPP_PUBLIC_ORIGIN: "https://hifld.test" } }));
vi.mock("@/lib/catalog-runtime", () => ({
  activeCatalogLifecycle: async () => ({
    withSnapshot: async (read: (snapshot: {
      repository: { listStacVersions: typeof mocks.listStacVersions; getStacVersion: typeof mocks.getStacVersion };
      catalogUrl: string;
      generation: string;
    }) => Promise<Response>) =>
      read({
        repository: { listStacVersions: mocks.listStacVersions, getStacVersion: mocks.getStacVersion },
        catalogUrl: "https://storage.test/release/_catalog/catalog.sqlite",
        generation: "generation-1",
      }),
  }),
}));

describe("STAC API HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.listStacVersions.mockReturnValue([
      {
        version_path: versionId,
        collection_href: "hifld/hospitals-3/hospitals-3/v1.0.0/collection.json",
      },
    ]);
    mocks.getStacVersion.mockReturnValue({
      version_path: versionId,
      collection_href: "hifld/hospitals-3/hospitals-3/v1.0.0/collection.json",
    });
    mocks.fetch.mockImplementation(async (input) => {
      if (String(input).includes("collection.json")) {
        return new Response(
          JSON.stringify({
            type: "Collection",
            stac_version: "1.1.0",
            id: versionId,
            description: "Hospitals",
            links: [],
            assets: { geoparquet: { href: "https://storage.test/data.parquet" } },
          }),
        );
      }
      return new Response(JSON.stringify({ type: "Catalog", stac_version: "1.1.0", id: "hifld-next", description: "HIFLD Next", links: [] }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves the Core landing page and STAC-specific OpenAPI description", async () => {
    const root = RootRoute.options.server?.handlers?.GET;
    const description = DescriptionRoute.options.server?.handlers?.GET;
    if (!root || !description) throw new Error("Missing STAC API route");
    const response = await root({ request: new Request("https://hifld.test/stac"), params: {} });
    expect(response.headers.get("X-Catalog-Generation")).toBe("generation-1");
    expect(await response.json()).toMatchObject({
      type: "Catalog",
      conformsTo: ["https://api.stacspec.org/v1.0.0/core", "https://api.stacspec.org/v1.0.0/collections"],
    });
    const openapi = await description({ request: new Request("https://hifld.test/stac/api"), params: {} });
    expect(await openapi.json()).toMatchObject({ openapi: "3.1.0", paths: { "/stac/collections": {} } });
  });

  it("links the custom API bootstrap to the STAC API", async () => {
    const handler = ApiIndexRoute.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing API bootstrap");
    const response = await handler({ request: new Request("https://hifld.test/api"), params: {} });
    expect((await response.json()).links.stac).toBe("https://hifld.test/stac");
  });

  it("lists version Collections and opens one using its percent-encoded full ID", async () => {
    const listing = CollectionsRoute.options.server?.handlers?.GET;
    const detail = CollectionRoute.options.server?.handlers?.GET;
    if (!listing || !detail) throw new Error("Missing STAC Collections route");
    const response = await listing({ request: new Request("https://hifld.test/stac/collections"), params: {} });
    const body = await response.json();
    expect(body.collections).toHaveLength(1);
    expect(body.collections[0].id).toBe(versionId);
    const detailResponse = await detail({
      request: new Request(`https://hifld.test/stac/collections/${encodeURIComponent(versionId)}`),
      params: { collectionId: versionId },
    });
    expect(await detailResponse.json()).toMatchObject({ id: versionId, assets: { geoparquet: { href: "https://storage.test/data.parquet" } } });
    expect(mocks.getStacVersion).toHaveBeenCalledWith(versionId);
  });

  it("opens full-path IDs when a STAC client leaves slashes unescaped", async () => {
    const detail = UnescapedCollectionRoute.options.server?.handlers?.GET;
    if (!detail) throw new Error("Missing unescaped Collection route");
    const response = await detail({
      request: new Request(`https://hifld.test/stac/collections/${versionId}`),
      params: { _splat: versionId },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: versionId });
  });

  it("keeps the Collections listing at the bare path when the router selects the splat", async () => {
    const splat = UnescapedCollectionRoute.options.server?.handlers?.GET;
    if (!splat) throw new Error("Missing STAC Collections splat route");
    const response = await splat({ request: new Request("https://hifld.test/stac/collections"), params: { _splat: "" } });
    expect(response.status).toBe(200);
    expect((await response.json()).collections).toHaveLength(1);
  });

  it("rejects an unknown Collection and malformed cursor", async () => {
    mocks.getStacVersion.mockReturnValue(null);
    const detail = CollectionRoute.options.server?.handlers?.GET;
    const listing = CollectionsRoute.options.server?.handlers?.GET;
    if (!detail || !listing) throw new Error("Missing STAC Collections route");
    const missing = await detail({ request: new Request("https://hifld.test/stac/collections/missing"), params: { collectionId: "missing" } });
    expect(missing.status).toBe(404);
    const invalid = await listing({ request: new Request("https://hifld.test/stac/collections?cursor=!!!"), params: {} });
    expect(invalid.status).toBe(400);
  });
});
