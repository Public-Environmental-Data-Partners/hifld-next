import { describe, expect, it } from "vitest";

import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import {
  compareVersionValues,
  getComparableLocations,
  getDefaultCompareVersionPair,
  getComparableVersionSources,
  getVersionSourcesForLocation,
  hasAnyComparableLocations,
} from "../compareSources";

function makeSource(
  id: number,
  version: string,
  locationId: number,
  locationName: string,
  path = `test/file/${version}/geoparquet/data.parquet`,
): DatasetSource {
  return {
    id,
    version,
    source_type: "file",
    location: {
      version: "v1",
      path,
    },
    storage_location: {
      id: locationId,
      name: locationName,
      backend_type: "s3",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

function makeFormat(sources: DatasetSource[], formatType = "geoparquet", name = "GeoParquet"): DatasetFormat {
  return {
    format: {
      id: 1,
      format_type: formatType,
      name,
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
  it("sorts semantic versions newest first", () => {
    expect(compareVersionValues("v1.10.0", "v1.9.0")).toBeLessThan(0);
    expect(compareVersionValues("v1.9.0", "v1.10.0")).toBeGreaterThan(0);
    expect(compareVersionValues("v2.0.0", "v1.99.99")).toBeLessThan(0);
  });

  it("preserves date and numeric version ordering", () => {
    expect(compareVersionValues("2026-02-14", "2026-01-01")).toBeLessThan(0);
    expect(compareVersionValues(10, 2)).toBeLessThan(0);
  });

  it("orders location versions with semantic versions first", () => {
    const formatEntry = makeFormat([
      makeSource(1, "v1.9.0", 10, "prod"),
      makeSource(2, "v1.10.0", 10, "prod"),
      makeSource(3, "v2.0.0", 10, "prod"),
    ]);

    const versionSources = getVersionSourcesForLocation(formatEntry, 10);

    expect(versionSources.map((source) => String(source.version))).toEqual([
      "v2.0.0",
      "v1.10.0",
      "v1.9.0",
    ]);
  });

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

  it("only exposes locations with enough history", () => {
    const formatEntry = makeFormat([
      makeSource(1, "v20260214", 10, "prod"),
      makeSource(2, "v20260101", 10, "prod"),
      makeSource(3, "v20251231", 20, "backup"),
    ]);

    expect(hasAnyComparableLocations(formatEntry)).toBe(true);
    expect(getComparableLocations(formatEntry)).toEqual([{ id: 10, name: "prod" }]);
  });

  it("groups comparable metadata sources by version across formats and locations", () => {
    const geoparquet = makeFormat([
      makeSource(1, "v1.1.0", 10, "prod"),
      makeSource(2, "v1.0.0", 10, "prod"),
    ]);
    const pmtiles = makeFormat(
      [
        makeSource(3, "v1.1.0", 10, "prod", "test/file/v1.1.0/pmtiles/data.pmtiles"),
        makeSource(4, "v1.0.0", 10, "prod", "test/file/v1.0.0/pmtiles/data.pmtiles"),
      ],
      "pmtiles",
      "PMTiles",
    );

    const versionSources = getComparableVersionSources([pmtiles, geoparquet]);

    expect(versionSources.map((source) => source.id)).toEqual([1, 2]);
    expect(versionSources.map((source) => String(source.version))).toEqual(["v1.1.0", "v1.0.0"]);
  });

  it("falls back to another source when a version has no GeoParquet source", () => {
    const pmtiles = makeFormat(
      [
        makeSource(3, "v1.1.0", 10, "prod", "test/file/v1.1.0/pmtiles/data.pmtiles"),
        makeSource(4, "v1.0.0", 10, "prod", "test/file/v1.0.0/pmtiles/data.pmtiles"),
      ],
      "pmtiles",
      "PMTiles",
    );

    const versionSources = getComparableVersionSources([pmtiles]);

    expect(versionSources.map((source) => source.id)).toEqual([3, 4]);
  });

  it("defaults compare direction to older version on the left and newer version on the right", () => {
    const versionSources = [
      makeSource(1, "v1.2.0", 10, "prod"),
      makeSource(2, "v1.1.0", 10, "prod"),
      makeSource(3, "v1.0.0", 10, "prod"),
    ];

    const pair = getDefaultCompareVersionPair(versionSources);

    expect(pair.left?.version).toBe("v1.0.0");
    expect(pair.right?.version).toBe("v1.2.0");
  });
});
