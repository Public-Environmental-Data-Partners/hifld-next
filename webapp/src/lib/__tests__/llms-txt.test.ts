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
});
