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
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema"]).toBeDefined();
    expect(doc.paths?.["/api/datasets/{id}"]).toBeDefined();
    expect(doc.paths?.["/api/openapi"]).toBeDefined();
    expect(String(doc.info?.description)).toContain("GET /api");
    expect(String(doc.info?.description)).toContain("GET /api/datasets/{id}");
    expect(String(doc.info?.description)).toContain("problem+json");
  });

  it("documents global dataset detail by numeric id", () => {
    const doc = buildOpenApiDocument();
    const path = doc.paths?.["/api/datasets/{id}"];
    const operation = path?.get;

    expect(operation).toMatchObject({
      summary: "Dataset detail by numeric id",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DatasetByIdResponse" },
            },
          },
        },
        400: { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        404: { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        502: { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } },
      },
    });
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer" },
        }),
      ]),
    );
    expect(operation?.responses?.[400]).toMatchObject({
      content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
    });
    expect(doc.components?.schemas?.DatasetByIdResponse).toMatchObject({
      type: "object",
      properties: {
        links: { $ref: "#/components/schemas/DatasetByIdLinks" },
        dataset: {
          type: "object",
          properties: {
            id: { type: "number" },
            slug: { type: "string" },
            files: {
              type: "array",
              items: { $ref: "#/components/schemas/DatasetFile" },
            },
          },
        },
      },
      required: ["links", "dataset"],
    });
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

  it("documents bounded schema paging and response fields", () => {
    const doc = buildOpenApiDocument();
    const path = doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema"];
    const operation = path?.get;

    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "column_offset", in: "query", required: false }),
        expect.objectContaining({ name: "column_limit", in: "query", required: false }),
      ]),
    );
    expect(doc.components?.schemas?.DatasetFileSchemaResponse).toMatchObject({
      properties: {
        total_columns: { type: "integer" },
        column_offset: { type: "integer" },
        column_limit: { type: "integer", maximum: 50 },
        has_more: { type: "boolean" },
      },
    });
  });

  it("documents bounded query creation, page, and extent contracts", () => {
    const doc = buildOpenApiDocument();
    const create = doc.paths?.["/api/queries"]?.post;
    const page = doc.paths?.["/api/queries/{query_id}/pages"]?.post;
    const bounds = doc.paths?.["/api/queries/{query_id}/bounds"]?.get;

    expect(create).toBeDefined();
    expect(page).toBeDefined();
    expect(bounds).toBeDefined();
    expect(create?.requestBody).toMatchObject({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/QueryRequest" } } },
    });
    expect(page?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "query_id", in: "path", required: true }),
        expect.objectContaining({ name: "X-HIFLD-Query-Token", in: "header", required: true }),
      ]),
    );
    expect(bounds?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "query_id", in: "path", required: true }),
        expect.objectContaining({ name: "X-HIFLD-Query-Token", in: "header", required: true }),
      ]),
    );
    expect(page?.requestBody).toMatchObject({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/QueryPageRequest" } } },
    });
    expect(doc.components?.schemas?.QueryRequest).toMatchObject({
      properties: { sources: { maxItems: 8 }, sql: { maxLength: 8192 }, limit: { maximum: 1000 } },
    });
    expect(create?.responses).toHaveProperty("422");
    expect(create?.responses).toHaveProperty("504");
    expect(create?.responses).not.toHaveProperty("201");
    expect(page?.responses).toHaveProperty("422");
    expect(page?.responses).toHaveProperty("504");
  });
});
