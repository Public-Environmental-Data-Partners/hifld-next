import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../spec";

describe("buildOpenApiDocument", () => {
  it("identifies the separate STAC API without claiming the custom /api routes are STAC API endpoints", () => {
    const description = buildOpenApiDocument().info.description;
    expect(description).toContain("/stac");
    expect(description).toContain("STAC API Core and Collections");
    expect(description).not.toContain("proxy dataset-api");
  });
  it("returns OpenAPI 3.1 with core paths", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths?.["/api"]).toBeDefined();
    expect(doc.paths?.["/api/collections"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{slug}"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{slug}/datasets"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}"]).toBeDefined();
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema"]).toBeDefined();
    expect(doc.paths?.["/api/datasets/{id}"]).toBeDefined();
    expect(doc.paths?.["/api/openapi"]).toBeDefined();
    expect(String(doc.info?.description)).toContain("GET /api");
    expect(String(doc.info?.description)).toContain("GET /api/datasets/{id}");
    expect(String(doc.info?.description)).toContain("problem+json");
  });

  it("documents raw STAC collection catalogs separately from dataset search", () => {
    const doc = buildOpenApiDocument();
    const root = doc.paths?.["/api/collections"]?.get;
    const collection = doc.paths?.["/api/collections/{slug}"]?.get;
    const datasets = doc.paths?.["/api/collections/{slug}/datasets"]?.get;

    expect(root?.responses?.[200]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/STACCatalog" } } },
    });
    expect(collection?.responses?.[200]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/STACCatalog" } } },
    });
    expect(collection?.parameters).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ in: "query", name: "search" })]),
    );
    expect(datasets?.summary).toContain("datasets");
    expect(datasets?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "search" }),
        expect.objectContaining({ in: "query", name: "limit" }),
        expect.objectContaining({ in: "query", name: "offset" }),
      ]),
    );
    expect(doc.components?.schemas?.STACCatalog).toMatchObject({
      type: "object",
      properties: {
        type: { type: "string", enum: ["Catalog"] },
        stac_version: { type: "string" },
        id: { type: "string" },
        links: { type: "array" },
      },
      required: ["type", "stac_version", "id", "description", "links"],
    });
  });

  it("documents raw STAC dataset/file responses and exact metadata aliases", () => {
    const doc = buildOpenApiDocument();
    const dataset = doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}"]?.get;
    const file = doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}"]?.get;
    const schema = doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema"]?.get;
    expect(dataset?.responses?.[200]).toMatchObject({ content: { "application/json": { schema: { $ref: "#/components/schemas/STACCatalog" } } } });
    expect(file?.responses?.[200]).toMatchObject({ content: { "application/json": { schema: { $ref: "#/components/schemas/STACCollection" } } } });
    expect(schema?.responses?.[200]).toEqual(file?.responses?.[200]);
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/metadata"]?.get?.responses?.[200]).toMatchObject({ content: dataset?.responses?.[200]?.content });
    expect(doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/metadata"]?.get?.responses?.[200]).toMatchObject({ content: file?.responses?.[200]?.content });
    expect(doc.components?.schemas?.STACCollection).toMatchObject({ properties: { assets: { type: "object" }, "table:columns": { type: "array" } } });
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

  it("documents schema as an unwrapped selected-version STAC alias", () => {
    const doc = buildOpenApiDocument();
    const path = doc.paths?.["/api/collections/{collectionSlug}/datasets/{datasetSlug}/files/{fileSlug}/schema"];
    const operation = path?.get;

    expect(operation?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "version" })]));
    expect(operation?.parameters).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "column_limit" })]));
    expect(operation?.responses?.[200]).toMatchObject({ content: { "application/json": { schema: { $ref: "#/components/schemas/STACCollection" } } } });
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
