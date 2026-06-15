import { describe, expect, it, vi } from "vitest";
import {
  buildCatalogSitemapPaths,
  buildSitemapXmlFromPaths,
  fetchSitemapDatasetGroups,
  type SitemapFetchClient,
} from "../sitemap";

describe("sitemap helpers", () => {
  it("includes static routes, collection URLs, dataset detail URLs, and file detail URLs", () => {
    const paths = buildCatalogSitemapPaths([
      {
        collection: { id: 1, slug: "hifld", name: "HIFLD" },
        datasets: [
          {
            id: 10,
            slug: "hospitals-3",
            name: "Hospitals",
            files: [{ id: 20, slug: "hospitals-3", name: "hospitals-3" }],
          },
        ],
      },
    ]);

    expect(paths).toContain("/");
    expect(paths).toContain("/collections");
    expect(paths).toContain("/api/openapi");
    expect(paths).toContain("/.well-known/agent-skills/index.json");
    expect(paths).toContain("/collections/hifld");
    expect(paths).toContain("/collections/hifld/datasets/hospitals-3");
    expect(paths).toContain("/collections/hifld/datasets/hospitals-3/files/hospitals-3");
  });

  it("escapes URLs in sitemap XML", () => {
    const xml = buildSitemapXmlFromPaths("https://example.org", ["/collections/hifld?query=power&offset=100"]);

    expect(xml).toContain("<loc>https://example.org/collections/hifld?query=power&amp;offset=100</loc>");
  });

  it("fetches multiple paginated dataset pages", async () => {
    const client: SitemapFetchClient = {
      fetchCollections: vi.fn().mockResolvedValue([{ id: 1, slug: "hifld", name: "HIFLD" }]),
      fetchDatasetFiles: vi.fn().mockResolvedValue([]),
      fetchDatasetPage: vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: 1, slug: "first", name: "First" }],
          total: 2,
          limit: 500,
          offset: 0,
        })
        .mockResolvedValueOnce({
          items: [{ id: 2, slug: "second", name: "Second" }],
          total: 2,
          limit: 500,
          offset: 1,
        }),
    };

    const groups = await fetchSitemapDatasetGroups(client);

    expect(groups[0]?.datasets.map((dataset) => dataset.slug)).toEqual(["first", "second"]);
    expect(client.fetchDatasetPage).toHaveBeenNthCalledWith(1, 1, 500, 0);
    expect(client.fetchDatasetPage).toHaveBeenNthCalledWith(2, 1, 500, 1);
  });

  it("fetches dataset files when collection dataset pages do not include file summaries", async () => {
    const client: SitemapFetchClient = {
      fetchCollections: vi.fn().mockResolvedValue([{ id: 1, slug: "hifld", name: "HIFLD" }]),
      fetchDatasetPage: vi.fn().mockResolvedValue({
        items: [{ id: 1, slug: "hospitals-3", name: "Hospitals" }],
        total: 1,
        limit: 500,
        offset: 0,
      }),
      fetchDatasetFiles: vi.fn().mockResolvedValue([{ id: 20, slug: "hospitals-3", name: "hospitals-3" }]),
    };

    const groups = await fetchSitemapDatasetGroups(client);

    expect(groups[0]?.datasets[0]?.files?.map((file) => file.slug)).toEqual(["hospitals-3"]);
    expect(client.fetchDatasetFiles).toHaveBeenCalledWith(1, "hospitals-3");
  });
});
