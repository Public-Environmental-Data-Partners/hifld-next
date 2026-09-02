import { describe, expect, it } from "vitest";
import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import {
  comparisonMapPath,
  comparisonSourcesForVersions,
  pmtilesDescriptorForVersion,
} from "../collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.compare";

function source(id: number, version: string): DatasetSource {
  return {
    id,
    version,
    source_type: "file",
    location: {
      version,
      path: `hospitals/${version}/source-${id}`,
    },
    storage_location: {
      id: 4,
      name: "SeaweedFS",
      backend_type: "s3",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

function format(formatType: DatasetFormat["format"]["format_type"], sources: DatasetSource[]): DatasetFormat {
  return {
    format: {
      id: formatType === "pmtiles" ? 1 : 2,
      format_type: formatType,
      name: formatType,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    dataset_format: {
      id: formatType === "pmtiles" ? 11 : 12,
      dataset_id: 1,
      format_id: formatType === "pmtiles" ? 1 : 2,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    sources,
  };
}

describe("file compare route helpers", () => {
  it("validates requested versions against the route's advertised source options", () => {
    const sources = [source(100, "v1.0.0"), source(101, "v1.1.0")];

    expect(comparisonSourcesForVersions(sources, "v1.0.0", "v1.1.0")).toEqual({
      left: sources[0],
      right: sources[1],
    });
    expect(comparisonSourcesForVersions(sources, "v0.9.0", "v1.1.0")).toBeNull();
  });

  it("returns a canonical map path only when both PMTiles descriptors are present", () => {
    const left = pmtilesDescriptorForVersion({
      collectionSlug: "hifld",
      datasetSlug: "hospitals-3",
      fileSlug: "hospitals-3",
      formats: [format("pmtiles", [source(19, "v1.0.0")])],
      source: source(19, "v1.0.0"),
    });
    const right = pmtilesDescriptorForVersion({
      collectionSlug: "hifld",
      datasetSlug: "hospitals-3",
      fileSlug: "hospitals-3",
      formats: [format("pmtiles", [source(20, "v1.1.0")])],
      source: source(20, "v1.1.0"),
    });

    if (!left || !right) throw new Error("expected PMTiles descriptors");
    expect(comparisonMapPath("hifld", [left, right])).toMatch(
      /^\/collections\/hifld\/map\?sources=/,
    );
    expect(comparisonMapPath("hifld", [left])).toBeUndefined();
  });

  it("finds the matching PMTiles source for a selected comparison version", () => {
    const selectedMetadataSource = source(101, "v1.1.0");
    const descriptor = pmtilesDescriptorForVersion({
      collectionSlug: "hifld",
      datasetSlug: "hospitals-3",
      fileSlug: "hospitals-3",
      formats: [format("geoparquet", [source(100, "v1.1.0")]), format("pmtiles", [source(19, "v1.1.0")])],
      source: selectedMetadataSource,
    });

    expect(descriptor).toMatchObject({
      collectionSlug: "hifld",
      datasetSlug: "hospitals-3",
      fileSlug: "hospitals-3",
      formatType: "pmtiles",
      version: "v1.1.0",
      sourceId: 19,
    });
  });

  it("returns null when a selected comparison version has no PMTiles source", () => {
    expect(
      pmtilesDescriptorForVersion({
        collectionSlug: "hifld",
        datasetSlug: "hospitals-3",
        fileSlug: "hospitals-3",
        formats: [format("geoparquet", [source(100, "v1.1.0")])],
        source: source(100, "v1.1.0"),
      }),
    ).toBeNull();
  });
});
