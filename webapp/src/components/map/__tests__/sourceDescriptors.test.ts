import { describe, expect, it } from "vitest";

import type { DatasetFile, DatasetFormat, DatasetSource } from "@/lib/api-client";
import {
  decodeSourceDescriptor,
  encodeSourceDescriptor,
  findPmtilesSourceForCatalogSource,
  findSourceForDescriptor,
  firstSourceDescriptorForFormat,
  sourceDescriptorId,
  type SourceDescriptor,
} from "../sourceDescriptors";

const descriptor: SourceDescriptor = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals",
  fileSlug: "hospitals",
  assetKey: "geoparquet",
  storageLocationSlug: "prod-4",
  version: "v1.1.0",
};

function source(id: number, formatVersion: string, locationId: number, assetKey = "geoparquet"): DatasetSource {
  return {
    asset_key: assetKey,
    version: formatVersion,
    source_type: "file",
    location: { version: "v1", path: `/download/${id}` },
    storage_location: {
      id: locationId,
      slug: `prod-${locationId}`,
      name: "prod",
      backend_type: "s3",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

function format(formatType: DatasetFormat["format"]["format_type"], sources: DatasetSource[]): DatasetFormat {
  return {
    format: {
      id: 1,
      format_type: formatType,
      name: formatType,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    sources,
  };
}

function file(formats: DatasetFormat[]): DatasetFile {
  return {
    id: 10,
    dataset_id: 1,
    file_slug: "hospitals",
    slug: "hospitals",
    name: "Hospitals",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    formats,
  };
}

describe("source descriptors", () => {
  it("round-trips encoded query state", () => {
    const encoded = encodeSourceDescriptor(descriptor);

    expect(decodeSourceDescriptor(encoded)).toEqual(descriptor);
    expect(sourceDescriptorId(descriptor)).toBe("hifld:hospitals:hospitals:v1.1.0:geoparquet:prod-4");
  });

  it("returns null for malformed query state", () => {
    expect(decodeSourceDescriptor("%7Bbad-json")).toBeNull();
    expect(decodeSourceDescriptor("")).toBeNull();
  });

  it("rejects legacy numeric descriptors instead of resolving them accidentally", () => {
    expect(decodeSourceDescriptor(encodeURIComponent(JSON.stringify({
      collectionSlug: "hifld",
      datasetSlug: "hospitals",
      fileSlug: "hospitals",
      formatType: "geoparquet",
      storageLocationId: 4,
      version: "v1.1.0",
      sourceId: 42,
    })))).toBeNull();
  });

  it("selects a concrete source for a descriptor", () => {
    const selected = findSourceForDescriptor(
      file([format("geoparquet", [source(1, "v1.0.0", 4), source(42, "v1.1.0", 4)])]),
      descriptor,
    );

    expect(selected?.asset_key).toBe("geoparquet");
  });

  it("builds a descriptor for the newest available format source", () => {
    const selected = firstSourceDescriptorForFormat({
      collectionSlug: "hifld",
      datasetSlug: "hospitals",
      fileSlug: "hospitals",
      formatEntry: format("pmtiles", [source(1, "v1.0.0", 4, "pmtiles"), source(2, "v1.1.0", 4, "pmtiles")]),
    });

    expect(selected).toMatchObject({
      version: "v1.1.0",
      assetKey: "pmtiles",
      storageLocationSlug: "prod-4",
    });
  });

  it("selects the same-version PMTiles source for a discovered GeoParquet source", () => {
    const selected = findPmtilesSourceForCatalogSource(
      file([
        format("geoparquet", [source(42, "v1.1.0", 4)]),
        format("pmtiles", [source(50, "v1.0.0", 4, "pmtiles"), source(51, "v1.1.0", 4, "pmtiles")]),
      ]),
      source(42, "v1.1.0", 4),
    );

    expect(selected?.asset_key).toBe("pmtiles");
  });
});
