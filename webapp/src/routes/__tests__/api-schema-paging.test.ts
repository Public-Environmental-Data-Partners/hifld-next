import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.schema";

const mocks = vi.hoisted(() => ({ file: vi.fn(), fetch: vi.fn<typeof fetch>() }));
vi.mock("@/env/server", () => ({ env: { CATALOG_SQLITE_URL: "http://storage.test/published/_catalog/catalog.sqlite" } }));
vi.mock("@/lib/catalog-api", () => ({ sqliteCatalogApi: async () => ({ generation: "one", file: mocks.file }) }));

describe("schema STAC alias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.file.mockResolvedValue({ stac_href: "hifld/roads/roads/v1.0.0/collection.json" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns selected-version Collection bytes including table:columns", async () => {
    const body = JSON.stringify({ type: "Collection", id: "hifld/roads/roads/v1.0.0", "table:columns": [{ name: "road_id", type: "string" }] });
    mocks.fetch.mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    const handler = Route.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing schema handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/hifld/datasets/roads/files/roads/schema?version=v1.0.0&column_limit=1"), params: { collectionSlug: "hifld", datasetSlug: "roads", fileSlug: "roads" } });
    expect(await response.text()).toBe(body);
    expect(mocks.file).toHaveBeenCalledWith("hifld", "roads", "roads", "v1.0.0");
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("http://storage.test/published/hifld/roads/roads/v1.0.0/collection.json?__catalog_request="), expect.anything());
  });

  it("defaults to latest and returns 404 without STAC metadata", async () => {
    mocks.file.mockResolvedValue({ stac_href: null });
    const handler = Route.options.server?.handlers?.GET;
    if (!handler) throw new Error("Missing schema handler");
    const response = await handler({ request: new Request("http://app.test/api/collections/hifld/datasets/roads/files/roads/schema"), params: { collectionSlug: "hifld", datasetSlug: "roads", fileSlug: "roads" } });
    expect(response.status).toBe(404);
    expect(mocks.file).toHaveBeenCalledWith("hifld", "roads", "roads", undefined);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
