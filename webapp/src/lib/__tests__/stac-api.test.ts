import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStacCollection,
  buildStacCollectionsPage,
  buildStacLanding,
  decodeStacCursor,
  encodeStacCursor,
  stacCollectionUrl,
} from "@/lib/stac-api";

const origin = "https://hifld.test";
const id = "hifld/hospitals-3/hospitals-3/v1.0.0";
const collection = {
  type: "Collection" as const,
  stac_version: "1.1.0",
  id,
  description: "Hospitals",
  links: [
    { rel: "self", href: "https://storage.test/release/hifld/hospitals-3/hospitals-3/v1.0.0/collection.json" },
    { rel: "root", href: "https://storage.test/release/catalog.json" },
    { rel: "parent", href: "https://storage.test/release/hifld/hospitals-3/hospitals-3/catalog.json" },
    { rel: "license", href: "https://storage.test/release/LICENSE.md" },
  ],
  assets: { geoparquet: { href: "https://storage.test/data.parquet", type: "application/vnd.apache.parquet" } },
};

afterEach(() => vi.unstubAllGlobals());

describe("STAC API adapter", () => {
  it("advertises only Core and Collections from the API landing page", () => {
    const root = {
      type: "Catalog" as const,
      stac_version: "1.1.0",
      id: "hifld-next",
      description: "HIFLD Next",
      links: [
        { rel: "self", href: "https://storage.test/release/catalog.json" },
        { rel: "child", href: "https://storage.test/release/hifld/catalog.json" },
      ],
    };
    const result = buildStacLanding(root, origin);
    expect(result.conformsTo).toEqual([
      "https://api.stacspec.org/v1.0.0/core",
      "https://api.stacspec.org/v1.0.0/collections",
    ]);
    expect(result.links).toContainEqual({ rel: "self", href: `${origin}/stac`, type: "application/json" });
    expect(result.links).toContainEqual({ rel: "root", href: `${origin}/stac`, type: "application/json" });
    expect(result.links).toContainEqual({ rel: "data", href: `${origin}/stac/collections`, type: "application/json" });
    expect(result.links).toContainEqual({ rel: "service-desc", href: `${origin}/stac/api`, type: "application/vnd.oai.openapi+json;version=3.1" });
    expect(result.links.some((link) => link.rel === "service-doc")).toBe(false);
    expect(result.links.some((link) => link.rel === "child")).toBe(false);
    expect(result.links.some((link) => link.rel === "search" || link.rel === "items")).toBe(false);
  });

  it("keeps the published Collection identity and assets while adapting API navigation", () => {
    const result = buildStacCollection(collection, origin);
    expect(stacCollectionUrl(origin, id)).toBe(`${origin}/stac/collections/hifld%2Fhospitals-3%2Fhospitals-3%2Fv1.0.0`);
    expect(result.id).toBe(id);
    expect(result.assets).toEqual(collection.assets);
    expect(result.links).toContainEqual({ rel: "self", href: stacCollectionUrl(origin, id), type: "application/json" });
    expect(result.links).toContainEqual({ rel: "root", href: `${origin}/stac`, type: "application/json" });
    expect(result.links).toContainEqual({ rel: "parent", href: `${origin}/stac`, type: "application/json" });
    expect(result.links).toContainEqual({ rel: "license", href: "https://storage.test/release/LICENSE.md" });
  });

  it("rejects invalid and stale listing cursors", () => {
    const encoded = encodeStacCursor({ generation: "generation-1", after: id });
    expect(decodeStacCursor(encoded, "generation-1")).toBe(id);
    expect(() => decodeStacCursor(encoded, "generation-2")).toThrow("stale");
    expect(() => decodeStacCursor("!!!", "generation-1")).toThrow("Invalid");
  });

  it("emits a bounded Collections page with a next link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(collection), { status: 200 })),
    );
    const entries = Array.from({ length: 51 }, () => ({
      version_path: id,
      collection_href: "hifld/hospitals-3/hospitals-3/v1.0.0/collection.json",
    }));
    const page = await buildStacCollectionsPage({
      entries,
      catalogUrl: "https://storage.test/release/_catalog/catalog.sqlite",
      origin,
      generation: "generation-1",
      after: null,
    });
    expect(page.collections).toHaveLength(50);
    expect(page.links.find((link) => link.rel === "next")?.href).toContain("cursor=");
    expect(page.links).toContainEqual({ rel: "root", href: `${origin}/stac`, type: "application/json" });
  });
});
