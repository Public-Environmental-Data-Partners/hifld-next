import { describe, expect, it } from "vitest";
import type { DatasetSource } from "@/lib/api-client";
import { hasUsablePmtilesAsset } from "../mapEligibility";

function source(overrides: Partial<DatasetSource>): DatasetSource {
  return {
    id: "1",
    source_type: "file",
    location: { version: "1", path: "datasets/hospitals.pmtiles" },
    ...overrides,
  };
}

describe("hasUsablePmtilesAsset", () => {
  it("accepts a concrete pmtiles URL", () => {
    expect(
      hasUsablePmtilesAsset(
        source({
          url: "https://example.test/hospitals.pmtiles",
          storage_location: {
            id: "storage",
            name: "GCS",
            backend_type: "s3",
            config: { version: "1", base_url: "https://example.test", bucket: "datasets" },
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing, glob, and non-pmtiles assets", () => {
    expect(
      hasUsablePmtilesAsset(
        source({
          url: "https://example.test/datasets/*.pmtiles",
          location: { version: "1", path: "datasets/*.pmtiles" },
        }),
      ),
    ).toBe(false);
    expect(hasUsablePmtilesAsset(source({ url: "https://example.test/hospitals.geojson" }))).toBe(false);
    expect(hasUsablePmtilesAsset(source({ location: { version: "1", path: "datasets/hospitals.pmtiles" } }))).toBe(false);
  });
});
