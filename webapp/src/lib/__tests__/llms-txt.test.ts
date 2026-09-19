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
    expect(body).toContain("GET /api/collections/{slug}/datasets");
    expect(body).toContain("STAC Catalog");
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
    expect(body).toContain("table:columns");
    expect(body).toContain("exact aliases");
    expect(body).toContain("{format}-{hash}");
    expect(body).toContain("hifld:*");
    expect(body).toContain("GeoParquet");
    expect(body).toContain("no `/items`, `/features`");
    expect(body).toContain("read-only");
    expect(body).toContain("JSON API remains read-only");
    expect(body).toContain("current browser workspace");
    expect(body).toContain("collection-first");
    expect(body).toContain("not a STAC Item Search FeatureCollection");
    expect(body).toContain("Numeric legacy IDs are invalid");
    expect(body).not.toContain("latest schema-capable version");
  });

  it("lists the bounded contextual WebMCP surface without schemas", () => {
    const body = readFileSync(llmsPath, "utf8");
    const tools = [
      "list_collections",
      "get_collection",
      "search_datasets",
      "get_dataset",
      "get_dataset_file",
      "get_dataset_file_schema",
      "compare_file_versions",
      "get_map_state",
      "add_dataset_layer",
      "remove_map_layer",
      "set_layer_visibility",
      "set_layer_style",
      "reorder_map_layers",
      "set_map_camera",
      "set_basemap",
      "get_map_selection",
      "clear_map_selection",
      "run_dataset_query",
      "set_result_page",
    ];
    expect(tools).toHaveLength(19);
    for (const tool of tools) expect(body).toContain(`\`${tool}\``);
    expect(body).not.toContain("tool input schema");
  });

  it("documents the bounded same-origin query resources", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body).toContain("POST /api/queries");
    expect(body).toContain("POST /api/queries/{query_id}/pages");
    expect(body).toContain("X-HIFLD-Query-Token");
    expect(body).toContain("query_id");
    expect(body).toContain("page_size");
    expect(body).toContain("application/problem+json");
    expect(body).toContain("MVT");
  });

  it("documents the explicit collection dataset-listing route", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body).toContain("**GET /api/collections/{slug}/datasets**");
    expect(body).not.toContain("This API is **not** OGC API-Features or STAC");
  });

  it("documents scanner discovery, endpoint override, and native fallback", () => {
    const body = readFileSync(llmsPath, "utf8");
    expect(body).toContain("/.well-known/mcp/server-card.json");
    expect(body).toContain("/.well-known/ai-catalog.json");
    expect(body).toContain("/mcp");
    expect(body).toContain("DATASET_MCP_PUBLIC_ENDPOINT");
    expect(body).toContain("document.modelContext");
    expect(body).toContain("navigator.modelContext");
    expect(body).toContain("not a polyfill");
    expect(body).toContain("Scanner acceptance");
  });
});
