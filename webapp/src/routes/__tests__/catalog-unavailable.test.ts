import { beforeEach, expect, it, vi } from "vitest";

const { catalogApi, stacUrl } = vi.hoisted(() => ({ catalogApi: vi.fn(), stacUrl: vi.fn() }));

vi.mock("@/lib/catalog-api", () => ({
  sqliteCatalogApi: catalogApi,
}));
vi.mock("@/lib/catalog-runtime", () => ({
  activeCatalogLifecycle: async () => { throw new Error("Catalog source is unavailable"); },
  activeCatalogStacUrl: stacUrl,
}));
vi.mock("@/lib/datasets", () => ({
  getDatasetStats: async () => { throw new Error("Catalog source is unavailable"); },
}));

import { Route as CollectionsRoute } from "../api/collections";
import { Route as CollectionRoute } from "../api/collections.$slug";
import { Route as DatasetListRoute } from "../api/collections.$slug.datasets";
import { Route as DatasetRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug";
import { Route as DatasetMetadataRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug.metadata";
import { Route as FileRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug";
import { Route as FileMetadataRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.metadata";
import { Route as FileSchemaRoute } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.schema";
import { Route as GlobalDatasetListRoute } from "../api/datasets";
import { Route as GlobalDatasetRoute } from "../api/datasets.$id";
import { Route as StatsRoute } from "../api/datasets.stats";
import { Route as TagsRoute } from "../api/collections.$collectionSlug.datasets.tags";
import { Route as StacRoute } from "../stac/index";
import { serveStacCollection } from "../stac/collections.$collectionId";
import { serveStacCollections } from "../stac/collections";

beforeEach(() => {
  catalogApi.mockReset().mockRejectedValue(new Error("Catalog source is unavailable"));
  stacUrl.mockReset().mockRejectedValue(new Error("Catalog source is unavailable"));
});

const routes = [
  ["collections", CollectionsRoute],
  ["collection", CollectionRoute],
  ["collection datasets", DatasetListRoute],
  ["dataset", DatasetRoute],
  ["dataset metadata", DatasetMetadataRoute],
  ["file", FileRoute],
  ["file metadata", FileMetadataRoute],
  ["file schema", FileSchemaRoute],
  ["global datasets", GlobalDatasetListRoute],
  ["global dataset", GlobalDatasetRoute],
] as const;

const params = { slug: "hifld", collectionSlug: "hifld", datasetSlug: "sample", fileSlug: "points", id: "hifld/sample" };

it.each(routes)("returns 503 for %s when the catalog and pointer startup fail", async (_name, route) => {
  const handler = route.options.server?.handlers?.GET;
  if (!handler) throw new Error("Missing catalog handler");
  const response = await handler({ request: new Request("https://app.test"), params });
  expect(response.status).toBe(503);
  expect(stacUrl).not.toHaveBeenCalled();
});

it.each(routes)("returns 503 for %s when active STAC URL resolution fails", async (_name, route) => {
  catalogApi.mockResolvedValue({ generation: "test-generation" });
  const handler = route.options.server?.handlers?.GET;
  if (!handler) throw new Error("Missing catalog handler");
  const response = await handler({ request: new Request("https://app.test"), params });
  expect(response.status).toBe(503);
  expect(stacUrl).toHaveBeenCalledOnce();
});

it("returns 503 from catalog and STAC routes when catalog startup fails", async () => {
  const root = CollectionsRoute.options.server?.handlers?.GET;
  const tags = TagsRoute.options.server?.handlers?.GET;
  const stac = StacRoute.options.server?.handlers?.GET;
  const stats = StatsRoute.options.server?.handlers?.GET;
  if (!root || !tags || !stac || !stats) throw new Error("Missing catalog handlers");
  const request = new Request("https://app.test");
  expect((await root({ request, params: {} })).status).toBe(503);
  expect((await tags({ request, params: { collectionSlug: "hifld" } })).status).toBe(503);
  expect((await stac({ request, params: {} })).status).toBe(503);
  expect((await stats({ request, params: {} })).status).toBe(503);
  expect((await serveStacCollections(request)).status).toBe(503);
  expect((await serveStacCollection(request, "hifld/sample/points/v1")).status).toBe(503);
});
