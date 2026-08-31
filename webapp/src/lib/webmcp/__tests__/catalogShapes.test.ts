import { describe, expect, it } from "vitest";
import {
  type CatalogDatasetFileShapeInput,
  CatalogDatasetFileResponseSchema,
  QuerySourceRefSchema,
  shapeDatasetFileResponse,
} from "../catalogShapes";
function makeResponse(): CatalogDatasetFileShapeInput {
  const columns = Array.from({ length: 80 }, (_, index) => ({
    name: `column_${index}`,
    type: "string",
    description: "This description must not cross the catalog boundary",
    nullable: true,
  }));
  return {
    collection: {
      id: 1,
      slug: "public-safety",
      name: "Public Safety",
      description: "A very long collection description that must be omitted",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    dataset: {
      id: 12,
      collection_id: 1,
      slug: "stations",
      name: "Stations",
      description: "A very long dataset description that must be omitted",
      tags: { category: ["public safety"] },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    file: {
      id: 99,
      dataset_id: 12,
      slug: "stations-file",
      name: "Stations file",
      description: "A very long file description that must be omitted",
      layer_name: "stations",
      source_file_path: "/private/path/stations.parquet",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      file_metadata: {
        version: "2026-01-02",
        description: "A metadata description that must be omitted",
        size_bytes: 123,
        feature_count: 80,
        bounds: [-1, -2, 3, 4],
        geometry_type: "Point",
        columns,
      },
      formats: [
        {
          format: {
            id: 4,
            format_type: "geoparquet",
            name: "GeoParquet",
            description: "Format description that must be omitted",
            mime_type: "application/octet-stream",
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
          sources: [
            {
              id: 88,
              version: "2026-01-02",
              source_type: "file",
              location: { version: "v1", path: "private/stations.parquet" },
              url: "https://storage.example/stations.parquet",
              storage_uri: "s3://private/stations.parquet",
              glob_pattern: "private/*.parquet",
              storage_location: {
                id: 7,
                name: "private storage",
                backend_type: "s3",
                config: { version: "v1", base_url: "https://private.example", bucket: "private" },
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
              source_metadata: {
                version: "2026-01-02",
                feature_count: 80,
                geometry_type: "Point",
                columns,
              },
            },
          ],
        },
      ],
    },
  };
}

describe("catalog shaping", () => {
  it("exposes only safe identities, summaries, query refs, and same-origin links", () => {
    const shaped = shapeDatasetFileResponse(makeResponse(), "https://catalog.example", "public-safety", "stations", "stations-file");
    const parsed = CatalogDatasetFileResponseSchema.parse(shaped);
    const serialized = JSON.stringify(parsed);

    expect(parsed.query_sources).toEqual([
      {
        alias: "source_0",
        collection_id: 1,
        dataset_id: 12,
        file_id: 99,
        file_source_id: 88,
      },
    ]);
    expect(serialized).not.toContain("storage_uri");
    expect(serialized).not.toContain("glob_pattern");
    expect(serialized).not.toContain("private/stations");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("must be omitted");
    expect(parsed.links.self).toBe("https://catalog.example/api/collections/public-safety/datasets/stations/files/stations-file");
    expect(serialized.length <= 1500 || parsed.truncated === true).toBe(true);
  });

  it("validates query source aliases and positive catalog IDs", () => {
    expect(() => QuerySourceRefSchema.parse({
      alias: "source_0",
      collection_id: 1,
      dataset_id: 2,
      file_id: 3,
      file_source_id: 4,
    })).not.toThrow();
    expect(() => QuerySourceRefSchema.parse({
      alias: "bad-alias",
      collection_id: 1,
      dataset_id: 2,
      file_id: 3,
      file_source_id: 4,
    })).toThrow();
    expect(() => QuerySourceRefSchema.parse({
      alias: "source_0",
      collection_id: 0,
      dataset_id: 2,
      file_id: 3,
      file_source_id: 4,
    })).toThrow();
  });
});
