import { describe, expect, it } from "vitest";
import {
  buildCatalogSitemapEntries,
  buildCatalogSitemapPaths,
  buildSitemapXmlFromEntries,
  buildSitemapXmlFromPaths,
  toLastmod,
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

  it("emits lastmod from catalog updated_at timestamps", () => {
    const entries = buildCatalogSitemapEntries([
      {
        collection: { id: 1, slug: "hifld", name: "HIFLD", updated_at: "2026-02-13T02:52:43.921817" },
        datasets: [
          {
            id: 10,
            slug: "hospitals-3",
            name: "Hospitals",
            updated_at: "2026-05-19T21:53:21.876276",
            files: [{ id: 20, slug: "hospitals-3", name: "hospitals-3", updated_at: "2026-06-01T00:00:00" }],
          },
        ],
      },
    ]);

    const datasetEntry = entries.find((entry) => entry.path === "/collections/hifld/datasets/hospitals-3");
    const fileEntry = entries.find((entry) => entry.path === "/collections/hifld/datasets/hospitals-3/files/hospitals-3");
    expect(datasetEntry?.lastmod).toBe("2026-05-19");
    expect(fileEntry?.lastmod).toBe("2026-06-01");

    const xml = buildSitemapXmlFromEntries("https://example.org", entries);
    expect(xml).toContain("<loc>https://example.org/collections/hifld/datasets/hospitals-3</loc>");
    expect(xml).toContain("<lastmod>2026-05-19</lastmod>");
  });

  it("normalizes timestamps to a W3C date and ignores empty values", () => {
    expect(toLastmod("2026-05-19T21:53:21.876276")).toBe("2026-05-19");
    expect(toLastmod(undefined)).toBeUndefined();
    expect(toLastmod("")).toBeUndefined();
    expect(toLastmod("not-a-date")).toBeUndefined();
  });

  it("escapes URLs in sitemap XML", () => {
    const xml = buildSitemapXmlFromPaths("https://example.org", ["/collections/hifld?query=power&offset=100"]);

    expect(xml).toContain("<loc>https://example.org/collections/hifld?query=power&amp;offset=100</loc>");
  });

});
