import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const llmsPath = join(process.cwd(), "public", "llms.txt");

describe("public/llms.txt", () => {
  it("exists and indexes OpenAPI plus primary API paths", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/^#\s/m);
    expect(body).toContain("GET /api");
    expect(body).toContain("/api/openapi");
    expect(body).toContain("/api/collections");
    expect(body).toContain("/items");
    expect(body).toContain("application/problem+json");
    expect(body).toContain("/api/collections/{slug}/datasets/tags");
    expect(body).toContain("/api/datasets");
    expect(body).toContain("/api/datasets/stats");
    expect(body).toContain("/api/datasets/{id}");
  });

  it("documents current read-only agent workflows", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body).toContain("GET /api");
    expect(body).toContain("GET /api/openapi");
    expect(body).toContain("GET /api/collections/{slug}");
    expect(body).toContain("search");
    expect(body).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}",
    );
    expect(body).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}",
    );
    expect(body).toContain(
      "GET /api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema",
    );
    expect(body).toContain("latest schema-capable version");
    expect(body).toContain("source URLs");
    expect(body).toContain("GeoParquet");
    expect(body).toContain("no `/items`, `/features`");
    expect(body).toContain("read-only");
    expect(body).toContain("MCP/action tools");
  });

  it("does not document the stale collection dataset-listing route", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body).not.toContain("**GET /api/collections/{slug}/datasets**");
  });
});
