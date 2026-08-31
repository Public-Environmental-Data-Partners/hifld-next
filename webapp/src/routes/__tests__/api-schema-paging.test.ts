import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatasetFileResponse } from "@/lib/api-client";
import * as apiClient from "@/lib/api-client";
import * as schemaSources from "@/components/dataset/schemaSources";
import { schemaSelf } from "@/lib/api-links";
import { parseSchemaPaging, Route } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.schema";

vi.mock("@/lib/api-client", () => ({
  getCollectionBySlug: vi.fn(),
  getDatasetBySlug: vi.fn(),
  getDatasetFileBySlug: vi.fn(),
}));

vi.mock("@/components/dataset/schemaSources", () => ({
  getBestSchemaSourceForVersion: vi.fn(),
  getLatestSchemaVersion: vi.fn(),
  getSchemaSummary: vi.fn(),
  getSchemaVersionOptions: vi.fn(),
}));

describe("schema API paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps paging absent for legacy requests", () => {
    expect(parseSchemaPaging(new URLSearchParams())).toEqual({ paging: null });
  });

  it("defaults a partial paging request to offset zero and limit 25", () => {
    expect(parseSchemaPaging(new URLSearchParams("column_offset=25"))).toEqual({
      paging: { offset: 25, limit: 25 },
    });
    expect(parseSchemaPaging(new URLSearchParams("column_limit=10"))).toEqual({
      paging: { offset: 0, limit: 10 },
    });
  });

  it.each(["column_offset=-1", "column_limit=0", "column_limit=51"])(
    "rejects invalid paging: %s",
    (query) => {
      const result = parseSchemaPaging(new URLSearchParams(query));
      expect(result.paging).toBeNull();
      expect(result.error?.status).toBe(400);
      expect(result.error?.headers.get("content-type")).toContain("application/problem+json");
    },
  );

  it("slices columns only when paging is requested and reports the page at top level", async () => {
    const columns = Array.from({ length: 73 }, (_, index) => ({
      name: `column_${index}`,
      type: "string",
      nullable: true,
    }));
    const source = {
      id: 88,
      version: "2026-01-02",
      source_type: "file" as const,
      location: { version: "v1", path: "sample.parquet" },
      source_metadata: { version: "2026-01-02", columns },
    };
    const result: DatasetFileResponse = {
      dataset: {
        id: 12,
        collection_id: 1,
        slug: "stations",
        name: "Stations",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      file: {
        id: 99,
        dataset_id: 12,
        slug: "stations-file",
        name: "Stations file",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        formats: [
          {
            format: {
              id: 4,
              format_type: "geoparquet",
              name: "GeoParquet",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
            dataset_format: {
              id: 5,
              dataset_id: 12,
              format_id: 4,
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
            sources: [source],
          },
        ],
      },
    };
    vi.mocked(apiClient.getCollectionBySlug).mockResolvedValue({
      id: 1,
      slug: "public-safety",
      name: "Public Safety",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.getDatasetBySlug).mockResolvedValue(result.dataset);
    vi.mocked(apiClient.getDatasetFileBySlug).mockResolvedValue(result);
    vi.mocked(schemaSources.getSchemaVersionOptions).mockReturnValue(["2026-01-02"]);
    vi.mocked(schemaSources.getLatestSchemaVersion).mockReturnValue("2026-01-02");
    vi.mocked(schemaSources.getBestSchemaSourceForVersion).mockReturnValue({
      source,
      formatType: "geoparquet",
      formatName: "GeoParquet",
    });
    vi.mocked(schemaSources.getSchemaSummary).mockReturnValue({
      columnCount: 73,
      featureCount: null,
      geometryType: null,
      invalidGeometryCount: null,
      qualityCheckPassed: null,
      columnsHash: null,
    });

    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();
    if (!handler) return;
    const response = await handler({
      params: { collectionSlug: "public-safety", datasetSlug: "stations", fileSlug: "stations-file" },
      request: new Request(
        "https://catalog.example/api/collections/public-safety/datasets/stations/files/stations-file/schema?column_offset=25&column_limit=25",
      ),
    });
    const body = (await response.json()) as {
      schema: { columns: Array<{ name: string }> };
      total_columns: number;
      column_offset: number;
      column_limit: number;
      has_more: boolean;
    };
    expect(body.schema.columns.map((column) => column.name)).toEqual(
      Array.from({ length: 25 }, (_, index) => `column_${index + 25}`),
    );
    expect(body.total_columns).toBe(73);
    expect(body.column_offset).toBe(25);
    expect(body.column_limit).toBe(25);
    expect(body.has_more).toBe(true);
    expect(
      schemaSelf("https://catalog.example", "public-safety", "stations", "stations-file", {
        version: "2026-01-02",
        column_offset: 25,
        column_limit: 25,
      }),
    ).toBe(
      "https://catalog.example/api/collections/public-safety/datasets/stations/files/stations-file/schema?version=2026-01-02&column_offset=25&column_limit=25",
    );

    const legacyResponse = await handler({
      params: { collectionSlug: "public-safety", datasetSlug: "stations", fileSlug: "stations-file" },
      request: new Request(
        "https://catalog.example/api/collections/public-safety/datasets/stations/files/stations-file/schema",
      ),
    });
    const legacyBody = (await legacyResponse.json()) as {
      schema: { columns: Array<{ name: string }> };
      total_columns?: number;
    };
    expect(legacyBody.schema.columns).toHaveLength(73);
    expect(legacyBody.total_columns).toBeUndefined();
  });
});
