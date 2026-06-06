import { describe, expect, test } from "vitest";
import type { DatasetFormat, DatasetSource, StorageLocation } from "@/lib/api-client";
import {
  concreteParquetPreviewOptions,
  defaultParquetPreviewSelection,
  parquetPreviewOptionsForSelection,
} from "../parquetPreviewOptions";

const createdAt = "2026-01-01T00:00:00Z";

function storageLocation(id: number, name: string): StorageLocation {
  return {
    id,
    name,
    backend_type: "s3",
    config: {
      version: "1",
      base_url: "http://localhost:8333",
      bucket: "datasets",
    },
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function source(id: number, path: string, version: string, location = storageLocation(4, "SeaweedFS")): DatasetSource {
  return {
    id,
    version,
    source_type: "file",
    location: {
      version: "1",
      path,
    },
    storage_location: location,
  };
}

function geoparquetFormat(sources: DatasetSource[]): DatasetFormat {
  return {
    format: {
      id: 1,
      format_type: "geoparquet",
      name: "GeoParquet",
      created_at: createdAt,
      updated_at: createdAt,
    },
    dataset_format: {
      id: 1,
      dataset_id: 1,
      format_id: 1,
      created_at: createdAt,
      updated_at: createdAt,
    },
    sources,
  };
}

describe("parquetPreviewOptions", () => {
  test("only returns concrete parquet files and excludes glob sources", () => {
    const options = concreteParquetPreviewOptions(
      geoparquetFormat([
        source(1, "gs://bucket/hospitals/v1.0.0/geoparquet/**/*.parquet", "v1.0.0"),
        source(2, "gs://bucket/hospitals/v1.0.0/geoparquet/part-000.parquet", "v1.0.0"),
        source(3, "gs://bucket/hospitals/v1.0.0/geoparquet/readme.txt", "v1.0.0"),
      ]),
    );

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      sourceId: 2,
      fileName: "part-000.parquet",
      version: "v1.0.0",
      storageLocationId: 4,
      storageLocationName: "SeaweedFS",
    });
  });

  test("filters preview options by selected location and version", () => {
    const local = storageLocation(4, "SeaweedFS");
    const remote = storageLocation(7, "GCS");
    const format = geoparquetFormat([
      source(1, "gs://bucket/hospitals/v1.0.0/geoparquet/part-000.parquet", "v1.0.0", local),
      source(2, "gs://bucket/hospitals/v1.1.0/geoparquet/part-000.parquet", "v1.1.0", local),
      source(3, "gs://bucket/hospitals/v1.1.0/geoparquet/part-000.parquet", "v1.1.0", remote),
    ]);

    expect(
      parquetPreviewOptionsForSelection(format, {
        storageLocationId: 4,
        version: "v1.1.0",
      }).map((option) => option.sourceId),
    ).toEqual([2]);
  });

  test("orders versions with the shared semver and numeric-ish comparison rules", () => {
    const options = concreteParquetPreviewOptions(
      geoparquetFormat([
        source(1, "gs://bucket/hospitals/v2/geoparquet/part-000.parquet", "v2"),
        source(2, "gs://bucket/hospitals/v10/geoparquet/part-000.parquet", "v10"),
        source(3, "gs://bucket/hospitals/v1.10.0/geoparquet/part-000.parquet", "v1.10.0"),
        source(4, "gs://bucket/hospitals/v1.2.0/geoparquet/part-000.parquet", "v1.2.0"),
      ]),
    );

    expect(options.map((option) => option.version)).toEqual(["v2", "v10", "v1.10.0", "v1.2.0"]);
  });

  test("defaults to the current selected source when it is a concrete parquet file", () => {
    const format = geoparquetFormat([
      source(1, "gs://bucket/hospitals/v1.0.0/geoparquet/part-000.parquet", "v1.0.0"),
      source(2, "gs://bucket/hospitals/v1.1.0/geoparquet/part-000.parquet", "v1.1.0"),
    ]);

    expect(
      defaultParquetPreviewSelection(
        format,
        source(2, "gs://bucket/hospitals/v1.1.0/geoparquet/part-000.parquet", "v1.1.0"),
      ),
    ).toMatchObject({
      storageLocationId: 4,
      version: "v1.1.0",
      sourceId: 2,
    });
  });

  test("falls back to the first concrete option when selected source is outside the format entry", () => {
    const format = geoparquetFormat([
      source(1, "gs://bucket/hospitals/v1.0.0/geoparquet/part-000.parquet", "v1.0.0"),
      source(2, "gs://bucket/hospitals/v1.1.0/geoparquet/part-000.parquet", "v1.1.0"),
    ]);

    expect(
      defaultParquetPreviewSelection(
        format,
        source(99, "gs://bucket/schools/v9.0.0/geoparquet/part-000.parquet", "v9.0.0"),
      ),
    ).toMatchObject({
      storageLocationId: 4,
      version: "v1.1.0",
      sourceId: 2,
    });
  });
});
