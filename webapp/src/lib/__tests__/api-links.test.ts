import { describe, expect, it } from "vitest";
import {
  collectionDatasetsListUrl,
  collectionDatasetsPaginationLinks,
  collectionSelf,
  datasetSelf,
  fileSelf,
  requestOrigin,
  sourceDownloadZip,
} from "../api-links";

describe("requestOrigin", () => {
  it("parses origin from request URL", () => {
    const r = new Request("https://example.org:8443/foo/bar?x=1");
    expect(requestOrigin(r)).toBe("https://example.org:8443");
  });
});

describe("path URLs", () => {
  const o = "https://h.example";

  it("encodes collection slug", () => {
    expect(collectionSelf(o, "hifld")).toBe("https://h.example/api/collections/hifld");
    expect(collectionSelf(o, "a b")).toBe("https://h.example/api/collections/a%20b");
  });

  it("builds dataset and file URLs", () => {
    expect(datasetSelf(o, "hifld", "my-ds")).toBe(
      "https://h.example/api/collections/hifld/datasets/my-ds"
    );
    expect(datasetSelf(o, "hifld", "my-ds", { include_urls: true })).toContain(
      "include_urls=true"
    );
    expect(fileSelf(o, "hifld", "my-ds", "f1")).toBe(
      "https://h.example/api/collections/hifld/datasets/my-ds/files/f1"
    );
    expect(sourceDownloadZip(o, "hifld", "my-ds", "f1", 42)).toBe(
      "https://h.example/api/collections/hifld/datasets/my-ds/files/f1/sources/42/download-zip"
    );
  });
});

describe("collectionDatasetsListUrl", () => {
  const o = "https://x.test";

  it("round-trips query params", () => {
    const href = collectionDatasetsListUrl(o, "c", {
      query: "water",
      include_urls: true,
      limit: 10,
      offset: 20,
      tag_filters: '{"k":"v"}',
      omit: "description",
    });
    const u = new URL(href);
    expect(u.pathname).toBe("/api/collections/c");
    expect(u.searchParams.get("query")).toBe("water");
    expect(u.searchParams.get("include_urls")).toBe("true");
    expect(u.searchParams.get("limit")).toBe("10");
    expect(u.searchParams.get("offset")).toBe("20");
    expect(u.searchParams.get("tag_filters")).toBe('{"k":"v"}');
    expect(u.searchParams.get("omit")).toBe("description");
  });
});

describe("collectionDatasetsPaginationLinks", () => {
  const o = "https://x.test";
  const base = { include_urls: false, omit: "description" as const };

  it("includes next when another page exists", () => {
    const links = collectionDatasetsPaginationLinks(
      o,
      "hifld",
      base,
      { total: 100, limit: 10, offset: 0 }
    );
    expect(links.first).toContain("offset=0");
    expect(links.self).toContain("offset=0");
    expect(links.next).toContain("offset=10");
    expect(links.prev).toBeUndefined();
    expect(links.last).toContain("offset=90");
  });

  it("includes prev when not on first page", () => {
    const links = collectionDatasetsPaginationLinks(
      o,
      "hifld",
      base,
      { total: 100, limit: 10, offset: 50 }
    );
    expect(links.prev).toContain("offset=40");
    expect(links.next).toContain("offset=60");
  });

  it("returns empty when limit invalid", () => {
    expect(
      Object.keys(
        collectionDatasetsPaginationLinks(o, "hifld", base, {
          total: 10,
          limit: 0,
          offset: 0,
        })
      ).length
    ).toBe(0);
  });
});
