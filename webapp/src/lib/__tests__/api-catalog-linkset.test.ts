import { describe, expect, it } from "vitest";
import {
  API_CATALOG_CONTENT_TYPE,
  RFC9727_LINKSET_PROFILE,
  buildApiCatalogLinkset,
} from "../api-catalog-linkset";

describe("RFC 9727 api-catalog linkset", () => {
  it("buildApiCatalogLinkset has anchor, service-desc, service-doc, status", () => {
    const doc = buildApiCatalogLinkset("https://catalog.example");
    expect(Array.isArray(doc.linkset)).toBe(true);
    expect(doc.linkset).toHaveLength(1);
    const entry = doc.linkset[0]!;
    expect(entry.anchor).toBe("https://catalog.example/api");

    expect(entry["service-desc"]).toEqual([
      {
        href: "https://catalog.example/api/openapi",
        type: "application/json",
      },
    ]);

    expect(entry["service-doc"]?.map((l) => l.href)).toEqual([
      "https://catalog.example/llms.txt",
      "https://catalog.example/about",
    ]);

    expect(entry.status).toEqual([
      {
        href: "https://catalog.example/api/health",
        type: "application/json",
      },
    ]);
  });

  it("Content-Type includes RFC 9727 profile parameter", () => {
    expect(API_CATALOG_CONTENT_TYPE).toContain("application/linkset+json");
    expect(API_CATALOG_CONTENT_TYPE).toContain(RFC9727_LINKSET_PROFILE);
  });
});
