import type maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  isComparableFeatureDiffSelection,
  normalizeSelectedFeatures,
  updateSelectedFeatures,
} from "../featureSelection";
import type { LoadedMapLayer } from "../multiLayerSources";
import type { SourceDescriptor } from "../sourceDescriptors";

const descriptor: SourceDescriptor = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals-3",
  fileSlug: "hospitals-3",
  formatType: "pmtiles",
  storageLocationId: 4,
  version: "v1.1.0",
  sourceId: 17,
};

const layer: LoadedMapLayer = {
  id: "loaded-hospitals-v110",
  name: "Hospitals / v1.1.0",
  datasetName: "Hospitals",
  storageLocationName: "SeaweedFS",
  descriptor,
  pmtilesUrl: "http://example.test/hospitals.pmtiles",
  mapSourceId: "source-loaded-hospitals-v110",
  visible: true,
  opacity: 0.82,
};

function feature(
  overrides: Partial<maplibregl.MapGeoJSONFeature> = {},
): maplibregl.MapGeoJSONFeature {
  return {
    type: "Feature",
    id: 42,
    source: layer.mapSourceId,
    sourceLayer: "hospitals-3",
    properties: {
      OBJECTID: 42,
      NAME: "General Hospital",
      empty: null,
      active: true,
    },
    geometry: {
      type: "Point",
      coordinates: [-77.0365, 38.8977],
    },
    layer: {
      id: "source-loaded-hospitals-v110-hospitals-3-circle",
      type: "circle",
      source: layer.mapSourceId,
    },
    state: {},
    ...overrides,
  } as maplibregl.MapGeoJSONFeature;
}

describe("feature selection helpers", () => {
  it("normalizes selected rendered features with source metadata and comparable properties", () => {
    const selected = normalizeSelectedFeatures({
      features: [feature()],
      loadedLayers: [layer],
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: "loaded-hospitals-v110:hospitals-3:42",
      loadedLayerId: layer.id,
      layerName: "Hospitals / v1.1.0",
      collectionSlug: "hifld",
      datasetSlug: "hospitals-3",
      fileSlug: "hospitals-3",
      version: "v1.1.0",
      sourceId: 17,
      sourceLayerId: "hospitals-3",
      featureId: "42",
      centroid: { lng: -77.0365, lat: 38.8977 },
      properties: {
        OBJECTID: "42",
        NAME: "General Hospital",
        empty: "",
        active: "true",
      },
    });
  });

  it("dedupes selected features and caps appended selections at 100 per loaded layer", () => {
    const existing = normalizeSelectedFeatures({
      features: [feature()],
      loadedLayers: [layer],
    });
    const appended = Array.from({ length: 105 }, (_, index) =>
      feature({
        id: index + 1,
        properties: { OBJECTID: index + 1, NAME: `Hospital ${index + 1}` },
      }),
    );

    const result = updateSelectedFeatures({
      current: existing,
      incoming: normalizeSelectedFeatures({ features: appended, loadedLayers: [layer] }),
      mode: "append",
    });

    expect(result.rows).toHaveLength(100);
    expect(result.wasCapped).toBe(true);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(100);
  });

  it("allows each loaded layer to keep up to 100 selected features", () => {
    const secondLayer: LoadedMapLayer = {
      ...layer,
      id: "loaded-hospitals-v100",
      name: "Hospitals / v1.0.0",
      descriptor: {
        ...descriptor,
        version: "v1.0.0",
        sourceId: 15,
      },
      mapSourceId: "source-loaded-hospitals-v100",
    };
    const firstLayerFeatures = Array.from({ length: 100 }, (_, index) =>
      feature({
        id: `first-${index}`,
        source: layer.mapSourceId,
        properties: { OBJECTID: index, NAME: `Current ${index}` },
      }),
    );
    const secondLayerFeatures = Array.from({ length: 100 }, (_, index) =>
      feature({
        id: `second-${index}`,
        source: secondLayer.mapSourceId,
        properties: { OBJECTID: index, NAME: `Previous ${index}` },
      }),
    );

    const result = updateSelectedFeatures({
      current: [],
      incoming: normalizeSelectedFeatures({
        features: [...firstLayerFeatures, ...secondLayerFeatures],
        loadedLayers: [layer, secondLayer],
      }),
      mode: "replace",
    });

    expect(result.rows).toHaveLength(200);
    expect(result.wasCapped).toBe(false);
    expect(result.rows.filter((row) => row.loadedLayerId === layer.id)).toHaveLength(100);
    expect(result.rows.filter((row) => row.loadedLayerId === secondLayer.id)).toHaveLength(100);
  });

  it("uses query identity without inventing catalog slugs", () => {
    const queryLayer: LoadedMapLayer = {
      kind: "query_mvt",
      id: "query:q-123",
      name: "Hospitals query",
      label: "Hospitals query",
      queryId: "q-123",
      sourceAliases: ["hospitals"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [],
      bounds: null,
      status: "ready",
      mapSourceId: "source-query-q-123",
      visible: true,
      opacity: 0.82,
    };

    const selected = normalizeSelectedFeatures({
      features: [
        feature({
          source: queryLayer.mapSourceId,
          sourceLayer: "hifld",
          id: "row-7",
          properties: {
            OBJECTID: 7,
            __hifld_feature_key: "row-7",
          },
        }),
      ],
      loadedLayers: [queryLayer],
    });

    expect(selected[0]).toMatchObject({
      id: "query:q-123:hifld:row-7",
      loadedLayerId: "query:q-123",
      layerName: "Hospitals query",
      queryId: "q-123",
      sourceLayerId: "hifld",
      featureId: "row-7",
    });
    expect(selected[0]).not.toHaveProperty("datasetSlug");
    expect(isComparableFeatureDiffSelection(selected)).toBe(false);
  });

  it("uses query tile identity and WGS84 centroid metadata while hiding server fields", () => {
    const queryLayer: LoadedMapLayer = {
      kind: "query_mvt",
      id: "query:q-456",
      name: "Stations query",
      label: "Stations query",
      queryId: "q-456",
      sourceAliases: ["stations"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [],
      bounds: null,
      status: "ready",
      mapSourceId: "source-query-q-456",
      visible: true,
      opacity: 0.82,
    };

    const selected = normalizeSelectedFeatures({
      features: [
        feature({
          source: queryLayer.mapSourceId,
          sourceLayer: "hifld",
          id: 1,
          properties: {
            NAME: "Station",
            __hifld_feature_key: "station-42",
            __hifld_feature_hash: "123",
            __hifld_centroid_lng: -122.4,
            __hifld_centroid_lat: 37.8,
            _mcp_feature_id: 123,
          },
          geometry: { type: "Point", coordinates: [10, 20] },
        }),
      ],
      loadedLayers: [queryLayer],
    });

    expect(selected[0]).toMatchObject({
      id: "query:q-456:hifld:station-42",
      featureId: "station-42",
      centroid: { lng: -122.4, lat: 37.8 },
      properties: { NAME: "Station" },
    });
    expect(selected[0]?.properties).not.toHaveProperty("__hifld_feature_key");
    expect(selected[0]?.properties).not.toHaveProperty("__hifld_feature_hash");
    expect(selected[0]?.properties).not.toHaveProperty("__hifld_centroid_lng");
    expect(selected[0]?.properties).not.toHaveProperty("__hifld_centroid_lat");
    expect(selected[0]?.properties).not.toHaveProperty("_mcp_feature_id");
  });

  it("uses point geometry only when query centroid metadata is invalid", () => {
    const queryLayer: LoadedMapLayer = {
      kind: "query_mvt",
      id: "query:q-789",
      name: "Stations query",
      label: "Stations query",
      queryId: "q-789",
      sourceAliases: ["stations"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [],
      bounds: null,
      status: "ready",
      mapSourceId: "source-query-q-789",
      visible: true,
      opacity: 0.82,
    };

    const selected = normalizeSelectedFeatures({
      features: [
        feature({
          source: queryLayer.mapSourceId,
          properties: {
            __hifld_feature_key: "station-43",
            __hifld_centroid_lng: 181,
            __hifld_centroid_lat: 37.8,
          },
          geometry: { type: "Point", coordinates: [-80, 40] },
        }),
      ],
      loadedLayers: [queryLayer],
    });

    expect(selected[0]?.centroid).toEqual({ lng: -80, lat: 40 });

    const polygonSelected = normalizeSelectedFeatures({
      features: [
        feature({
          source: queryLayer.mapSourceId,
          properties: {
            __hifld_feature_key: "station-polygon",
            __hifld_centroid_lng: 181,
            __hifld_centroid_lat: 37.8,
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[-80, 40], [-79, 40], [-79, 41], [-80, 40]]],
          },
        }),
      ],
      loadedLayers: [queryLayer],
    });
    expect(polygonSelected[0]?.centroid).toBeNull();
  });

  it("does not select query features without the server feature key", () => {
    const queryLayer: LoadedMapLayer = {
      kind: "query_mvt",
      id: "query:q-missing-key",
      name: "Stations query",
      label: "Stations query",
      queryId: "q-missing-key",
      sourceAliases: ["stations"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [],
      bounds: null,
      status: "ready",
      mapSourceId: "source-query-q-missing-key",
      visible: true,
      opacity: 0.82,
    };

    expect(
      normalizeSelectedFeatures({
        features: [
          feature({
            source: queryLayer.mapSourceId,
            properties: { NAME: "Station", __hifld_feature_key: 42 },
          }),
        ],
        loadedLayers: [queryLayer],
      }),
    ).toEqual([]);
  });
});
