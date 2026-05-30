import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../spec";

describe("buildOpenApiDocument", () => {
  it("returns OpenAPI 3.1 with core paths", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths?.["/api"]).toBeDefined();
    expect(doc.paths?.["/api/collections"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{slug}"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}"]).toBeDefined();
    expect(doc.paths?.["/api/openapi"]).toBeDefined();
    expect(String(doc.info?.description)).toContain("GET /api");
    expect(String(doc.info?.description)).toContain("problem+json");
  });

  it("documents source lifecycle and source metadata fields exposed by file metadata", () => {
    const doc = buildOpenApiDocument();
    const sourceSchema = doc.components?.schemas?.DatasetSource;
    const metadataSchema = doc.components?.schemas?.SpatialDatasetFileMetadata;

    expect(sourceSchema).toMatchObject({
      type: "object",
      properties: {
        created_at: { type: "string" },
        updated_at: { type: "string" },
        storage_uri: { type: ["string", "null"] },
        glob_pattern: { type: ["string", "null"] },
      },
    });
    expect(metadataSchema).toMatchObject({
      type: "object",
      properties: {
        description: { type: ["string", "null"] },
        size_bytes: { type: ["number", "null"] },
      },
    });
  });
});
