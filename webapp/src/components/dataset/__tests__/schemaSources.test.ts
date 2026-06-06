import { describe, expect, it } from "vitest";
import type { DatasetFormat, DatasetSource, FormatType } from "@/lib/api-client";
import {
  getBestSchemaSourceForVersion,
  getLatestSchemaVersion,
  getSchemaSummary,
  getSchemaVersionOptions,
  hasSchemaMetadata,
} from "../schemaSources";

const createdAt = "2026-01-01T00:00:00Z";

function source({
  id,
  version,
  columns,
  formatType = "geoparquet",
  featureCount,
}: {
  id: number;
  version: string;
  columns?: DatasetSource["source_metadata"]["columns"];
  formatType?: FormatType;
  featureCount?: number | undefined;
}): DatasetSource {
  return {
    id,
    version,
    source_type: "file",
    location: { version: "1", path: `dataset/layer/${version}/${formatType}/data` },
    storage_location: {
      id: formatType === "geoparquet" ? 4 : 5,
      name: formatType === "geoparquet" ? "SeaweedFS" : "Tiles",
      backend_type: "s3",
      created_at: createdAt,
      updated_at: createdAt,
    },
    source_metadata: {
      version: "v1",
      feature_count: featureCount,
      geometry_type: "Point",
      invalid_geometry_count: 0,
      quality_check_passed: true,
      columns_hash: `hash-${id}`,
      columns,
    },
  };
}

function format(formatType: FormatType, sources: DatasetSource[]): DatasetFormat {
  return {
    format: {
      id: formatType === "geoparquet" ? 1 : 2,
      format_type: formatType,
      name: formatType,
      created_at: createdAt,
      updated_at: createdAt,
    },
    dataset_format: {
      id: formatType === "geoparquet" ? 1 : 2,
      dataset_id: 1,
      format_id: formatType === "geoparquet" ? 1 : 2,
      created_at: createdAt,
      updated_at: createdAt,
    },
    sources,
  };
}

const columns = [
  {
    name: "NAME",
    type: "string",
    description: "Facility name",
    nullable: false,
  },
];

describe("schema source helpers", () => {
  it("prefers schema-capable GeoParquet sources for a version", () => {
    const pmtilesSource = source({ id: 10, version: "v1.0.0", columns, formatType: "pmtiles" });
    const geoparquetSource = source({ id: 11, version: "v1.0.0", columns, formatType: "geoparquet" });

    const best = getBestSchemaSourceForVersion([
      format("pmtiles", [pmtilesSource]),
      format("geoparquet", [geoparquetSource]),
    ], "v1.0.0");

    expect(best?.source.id).toBe(11);
    expect(best?.formatType).toBe("geoparquet");
  });

  it("returns only versions that have data dictionary columns and picks latest by default", () => {
    const formats = [
      format("geoparquet", [
        source({ id: 1, version: "v1.0.0", columns }),
        source({ id: 2, version: "v1.1.0", columns: [] }),
        source({ id: 3, version: "v1.2.0", columns }),
      ]),
    ];

    expect(getSchemaVersionOptions(formats)).toEqual(["v1.2.0", "v1.0.0"]);
    expect(getLatestSchemaVersion(formats)).toBe("v1.2.0");
    expect(hasSchemaMetadata(formats)).toBe(true);
  });

  it("summarizes schema metadata without requiring optional quality fields", () => {
    const summary = getSchemaSummary({
      version: "v1",
      feature_count: 12,
      columns,
    });

    expect(summary).toEqual({
      columnCount: 1,
      featureCount: 12,
      geometryType: null,
      invalidGeometryCount: null,
      qualityCheckPassed: null,
      columnsHash: null,
    });
  });
});
