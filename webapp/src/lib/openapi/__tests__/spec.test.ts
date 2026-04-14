import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../spec";

describe("buildOpenApiDocument", () => {
  it("returns OpenAPI 3.1 with core paths", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths?.["/api"]).toBeDefined();
    expect(doc.paths?.["/api/collections"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{slug}"]).toBeDefined();
    expect(doc.paths?.["/api/openapi"]).toBeDefined();
    expect(String(doc.info?.description)).toContain("GET /api");
    expect(String(doc.info?.description)).toContain("problem+json");
  });
});
