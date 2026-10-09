import { afterEach, expect, it, vi } from "vitest";

const { catalog } = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock("@/env/server", () => ({ env: { DATASET_API_URL: "https://retired.example" } }));
vi.mock("@/lib/catalog-api", () => ({ sqliteCatalogApi: catalog }));

import { Route } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.sources.$sourceId.download-zip";

afterEach(() => vi.restoreAllMocks());

async function requestZip() {
  const handler = Route.options.server?.handlers?.GET;
  if (!handler) throw new Error("Missing ZIP handler");
  return handler({
    request: new Request("https://app.test/download-zip"),
    params: { collectionSlug: "hifld", datasetSlug: "hospitals", fileSlug: "hospitals", sourceId: "7" },
  });
}

it("returns not found for a numeric ZIP source without contacting the retired API", async () => {
  catalog.mockResolvedValue({ file: async () => ({ assets: [] }) });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ id: 42, slug: "hifld" }]));
  expect((await requestZip()).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

it("fails closed when the published ZIP catalog is unavailable", async () => {
  catalog.mockRejectedValue(new Error("Published catalog is unavailable"));
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await requestZip()).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
