import { describe, expect, it } from "vitest";

import { vi } from "vitest";
import { getVectorLayersForSource } from "@/components/viewer/useMapInitialization";
import { buildLoadedMapLayer } from "../multiLayerSources";
import type { SourceDescriptor } from "../sourceDescriptors";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

const descriptor: SourceDescriptor = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals",
  fileSlug: "hospitals",
  formatType: "pmtiles",
  storageLocationId: 4,
  version: "v1.1.0",
  sourceId: 7,
};

describe("multi-layer map helpers", () => {
  it("keeps stable loaded-layer ids separate from vector layer ids", () => {
    const loadedLayer = buildLoadedMapLayer({
      descriptor,
      name: "Hospitals",
      storageLocationName: "Production GCS",
      pmtilesUrl: "https://example.test/hospitals.pmtiles",
    });

    expect(loadedLayer.id).toContain("hifld:hospitals:hospitals:pmtiles:4:v1.1.0:7");
    expect(loadedLayer.mapSourceId).toBe(`source-${loadedLayer.id}`);
    expect(loadedLayer.storageLocationName).toBe("Production GCS");
  });

  it("prefixes vector layers with source metadata for styling and picking", () => {
    const loadedLayer = buildLoadedMapLayer({
      descriptor,
      name: "Hospitals",
      pmtilesUrl: "https://example.test/hospitals.pmtiles",
      sourceMetadata: {
        version: "v1.1.0",
        geometry_type: "Point",
        columns: [
          { name: "name", type: "string", nullable: false },
          { name: "beds", type: "float", nullable: false, min: 1, max: 100 },
        ],
      },
    });

    expect(
      getVectorLayersForSource(
        {
          vector_layers: [{ id: "default", fields: { name: "String", beds: "Number" } }],
        },
        loadedLayer,
      ),
    ).toEqual([
      {
        id: `${loadedLayer.id}:default`,
        sourceLayerId: "default",
        loadedLayerId: loadedLayer.id,
        mapSourceId: loadedLayer.mapSourceId,
        mapLayerBaseId: `${loadedLayer.mapSourceId}-default`,
        fields: ["name", "beds"],
        numericFields: [{ name: "beds", min: 1, max: 100 }],
        geometryType: "Point",
      },
    ]);
  });
});
