import { describe, expect, it } from "vitest";

import { vi } from "vitest";
import { getVectorLayersForSource } from "@/components/viewer/useMapInitialization";
import { buildLoadedMapLayer, buildQueryMvtLayer } from "../multiLayerSources";
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
  version: "v1.1.0",
  assetKey: "pmtiles",
  storageLocationSlug: "production-gcs",
};

describe("multi-layer map helpers", () => {
  it("tags catalog layers and builds query MVT layers with stable query identities", () => {
    const catalogLayer = buildLoadedMapLayer({
      descriptor,
      name: "Hospitals",
      pmtilesUrl: "https://example.test/hospitals.pmtiles",
    });
    const queryLayer = buildQueryMvtLayer({
      queryId: "q-123",
      label: "Hospitals query",
      sourceAliases: ["hospitals"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [
        { name: "beds", logicalType: "double", nullable: false, min: 1, max: 100 },
      ],
      bounds: [-78, 38, -76, 40],
      status: "ready",
    });

    expect(catalogLayer.kind).toBe("catalog_pmtiles");
    expect(queryLayer).toMatchObject({
      kind: "query_mvt",
      id: "query:q-123",
      queryId: "q-123",
      label: "Hospitals query",
      sourceAliases: ["hospitals"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [{ name: "beds", logicalType: "double", nullable: false, min: 1, max: 100 }],
      bounds: [-78, 38, -76, 40],
      status: "ready",
    });
    expect("descriptor" in queryLayer).toBe(false);
    expect("queryToken" in queryLayer).toBe(false);
  });

  it("keeps stable loaded-layer ids separate from vector layer ids", () => {
    const loadedLayer = buildLoadedMapLayer({
      descriptor,
      name: "Hospitals",
      storageLocationName: "Production GCS",
      pmtilesUrl: "https://example.test/hospitals.pmtiles",
    });

    expect(loadedLayer.id).toContain("hifld:hospitals:hospitals:v1.1.0:pmtiles:production-gcs");
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
          { name: "name", type: "string", nullable: false, possible_values: ["General", "Children"] },
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
        scalarFields: [{ name: "name", type: "string", values: ["General", "Children"] }, { name: "beds", type: "number", values: [] }],
        geometryType: "Point",
      },
    ]);
  });
});
