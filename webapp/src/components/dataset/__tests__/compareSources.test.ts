import { describe, expect, it } from "vitest";

import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import {
  buildCompareSearchForLocation,
  getComparableLocations,
  getVersionSourcesForLocation,
  hasAnyComparableLocations,
} from "../compareSources";

function makeSource(id: number, version: string, locationId: number, locationName: string): DatasetSource {
  return {
    id,
    version,
    source_type: "file",
    location: {
      version: "v1",
      path: `test/file/${version}/geoparquet/data.parquet`,
    },
    storage_location: {
      id: locationId,
      name: locationName,
      backend_type: "gcs",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

function makeFormat(sources: DatasetSource[]): DatasetFormat {
  return {
    format: {
      id: 1,
      format_type: "geoparquet",
      name: "GeoParquet",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    dataset_format: {
      id: 1,
      dataset_id: 1,
      format_id: 1,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    sources,
  };
}

describe("compareSources helpers", () => {
  it("filters comparable versions by location", () => {
    const formatEntry = makeFormat([
      makeSource(1, "v20260214", 10, "prod"),
      makeSource(2, "v20260101", 10, "prod"),
      makeSource(3, "v20251231", 20, "backup"),
    ]);

    const versionSources = getVersionSourcesForLocation(formatEntry, 10);

    expect(versionSources.map((source) => String(source.version))).toEqual([
      "v20260214",
      "v20260101",
    ]);
    expect(versionSources.every((source) => source.storage_location?.id === 10)).toBe(true);
  });

  it("only exposes locations with enough history and builds deep-link search", () => {
    const formatEntry = makeFormat([
      makeSource(1, "v20260214", 10, "prod"),
      makeSource(2, "v20260101", 10, "prod"),
      makeSource(3, "v20251231", 20, "backup"),
    ]);

    expect(hasAnyComparableLocations(formatEntry)).toBe(true);
    expect(getComparableLocations(formatEntry)).toEqual([{ id: 10, name: "prod" }]);
    expect(buildCompareSearchForLocation(formatEntry, 10)).toEqual({
      format: "geoparquet",
      location: 10,
      v1: "v20260214",
      v2: "v20260101",
    });
    expect(buildCompareSearchForLocation(formatEntry, 20)).toBeNull();
  });
});
