import type { MapGeoJSONFeature } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  type HighlightedQueryLayer,
  MAX_HIGHLIGHTED_FEATURES,
  normalizeHighlightedFeatures,
  snapshotMapHighlights,
} from "../src/components/mapSelection";

const roads: HighlightedQueryLayer = {
  mapSourceId: "hifld-query-0",
  queryId: "roadsquery1234567890ABCD",
  layerName: "Roads",
  sourceLayerId: "hifld",
};

const bridges: HighlightedQueryLayer = {
  mapSourceId: "hifld-query-1",
  queryId: "bridgesquery123456789AB",
  layerName: "Bridges",
  sourceLayerId: "hifld",
};

function feature(
  overrides: Partial<MapGeoJSONFeature> = {},
): MapGeoJSONFeature {
  return {
    type: "Feature",
    id: "road-1",
    properties: {
      name: "Main Street",
      lanes: 2,
      open: true,
      absent: null,
      query_token: "signed-roads",
      tile_url: "https://maps.example/tiles/private.mvt",
      sql: "SELECT * FROM roads",
      geometry: "private geometry",
      statement: "SELECT road_id FROM roads",
      endpoint: "https://maps.example/tiles/roads/{z}/{x}/{y}.mvt",
      shape_text: '{"type":"LineString","coordinates":[[-77,38],[-75,40]]}',
      wkt_with_srid: "SRID=4326;POINT(-77 38)",
      empty_wkt: "POLYGON EMPTY",
      relative_tile: "/tiles/roads/{z}/{x}/{y}.mvt",
      __hifld_feature_key: "roads:road-1",
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-77, 38],
        [-75, 40],
      ],
    },
    source: roads.mapSourceId,
    sourceLayer: roads.sourceLayerId,
    layer: {
      id: "hifld-query-0-lines",
      type: "line",
      source: roads.mapSourceId,
    },
    state: {},
    ...overrides,
  } as MapGeoJSONFeature;
}

describe("map selection helpers", () => {
  it("normalizes rendered features without retaining geometry or private map inputs", () => {
    const selected = normalizeHighlightedFeatures({
      features: [feature()],
      layers: [roads],
    });

    expect(selected.features).toEqual([
      {
        id: "query:roadsquery1234567890ABCD:hifld:roads:road-1",
        queryId: "roadsquery1234567890ABCD",
        layerName: "Roads",
        sourceLayerId: "hifld",
        featureId: "roads:road-1",
        centroid: null,
        properties: {
          name: "Main Street",
          lanes: "2",
          open: "true",
          absent: "",
        },
      },
    ]);
  });

  it("uses reserved MVT centroids and never exposes them as properties", () => {
    const selected = normalizeHighlightedFeatures({
      features: [
        feature({
          properties: {
            ...feature().properties,
            __hifld_centroid_lng: -77.0365,
            __hifld_centroid_lat: 38.8977,
          },
        }),
      ],
      layers: [roads],
    });

    expect(selected.features[0]?.centroid).toEqual([-77.0365, 38.8977]);
    expect(selected.features[0]?.properties).not.toHaveProperty(
      "__hifld_centroid_lng",
    );
    expect(selected.features[0]?.properties).not.toHaveProperty(
      "__hifld_centroid_lat",
    );
  });

  it("omits rendered features without a stable MVT feature ID", () => {
    const selected = normalizeHighlightedFeatures({
      features: [feature({ id: undefined })],
      layers: [roads],
    });

    expect(selected).toEqual({ features: [], wasCapped: false });
  });

  it("omits rendered features without a reserved MVT feature key", () => {
    const baseProperties = feature().properties;
    const { __hifld_feature_key: _featureKey, ...properties } = baseProperties;
    const selected = normalizeHighlightedFeatures({
      features: [feature({ properties })],
      layers: [roads],
    });

    expect(selected).toEqual({ features: [], wasCapped: false });
  });

  it("keeps colliding MapLibre IDs distinct when their internal keys differ", () => {
    const first = feature({
      id: 1,
      properties: { ...feature().properties, __hifld_feature_key: "roads:a" },
    });
    const second = feature({
      id: 1,
      properties: { ...feature().properties, __hifld_feature_key: "roads:b" },
    });

    const selected = normalizeHighlightedFeatures({
      features: [first, second],
      layers: [roads],
    });

    expect(selected.features.map((candidate) => candidate.featureId)).toEqual([
      "roads:a",
      "roads:b",
    ]);
  });

  it("deduplicates rendered fragments with the same internal feature key", () => {
    const first = feature({
      id: 1,
      properties: {
        ...feature().properties,
        __hifld_feature_key: "roads:shared",
      },
    });
    const second = feature({
      id: 2,
      properties: {
        ...feature().properties,
        __hifld_feature_key: "roads:shared",
      },
    });

    const selected = normalizeHighlightedFeatures({
      features: [first, second],
      layers: [roads],
    });

    expect(selected.features).toHaveLength(1);
    expect(selected.features[0]?.featureId).toBe("roads:shared");
  });

  it("uses Point coordinates only when MVT does not provide an internal centroid", () => {
    const selected = normalizeHighlightedFeatures({
      features: [
        feature({
          geometry: { type: "Point", coordinates: [-77.1, 38.9] },
        }),
      ],
      layers: [roads],
    });

    expect(selected.features[0]?.centroid).toEqual([-77.1, 38.9]);
  });

  it("deduplicates overlapping render layers and caps each query layer", () => {
    const features = Array.from(
      { length: MAX_HIGHLIGHTED_FEATURES + 2 },
      (_, index) =>
        feature({
          id: `road-${index}`,
          properties: {
            ...feature().properties,
            __hifld_feature_key: `roads:${index}`,
          },
        }),
    );
    const firstFeature = features[0];
    if (!firstFeature) throw new Error("test fixture must include a feature");

    const selected = normalizeHighlightedFeatures({
      features: [firstFeature, ...features],
      layers: [roads],
    });

    expect(selected.features).toHaveLength(MAX_HIGHLIGHTED_FEATURES);
    expect(selected.wasCapped).toBe(true);
    expect(selected.features[0]?.featureId).toBe("roads:0");
  });

  it("caps each query layer independently and marks only overflow as capped", () => {
    const roadsAtLimit = Array.from(
      { length: MAX_HIGHLIGHTED_FEATURES },
      (_, index) =>
        feature({
          id: `road-${index}`,
          properties: {
            ...feature().properties,
            __hifld_feature_key: `roads:${index}`,
          },
        }),
    );
    const bridgesAtLimit = Array.from(
      { length: MAX_HIGHLIGHTED_FEATURES },
      (_, index) =>
        feature({
          id: `bridge-${index}`,
          source: bridges.mapSourceId,
          properties: {
            ...feature().properties,
            __hifld_feature_key: `bridges:${index}`,
          },
        }),
    );

    expect(
      normalizeHighlightedFeatures({
        features: [...roadsAtLimit, ...bridgesAtLimit],
        layers: [roads, bridges],
      }),
    ).toMatchObject({
      features: { length: MAX_HIGHLIGHTED_FEATURES * 2 },
      wasCapped: false,
    });

    const overflow = normalizeHighlightedFeatures({
      features: [
        ...roadsAtLimit,
        ...bridgesAtLimit,
        feature({
          id: "road-100",
          properties: {
            ...feature().properties,
            __hifld_feature_key: "roads:100",
          },
        }),
      ],
      layers: [roads, bridges],
    });
    expect(overflow.features).toHaveLength(MAX_HIGHLIGHTED_FEATURES * 2);
    expect(overflow.wasCapped).toBe(true);
  });

  it("builds a secret-free snapshot with exact selected-feature count", () => {
    const selected = normalizeHighlightedFeatures({
      features: [feature()],
      layers: [roads],
    });
    const snapshot = snapshotMapHighlights({
      mapTitle: "Transportation comparison",
      features: selected.features,
      wasCapped: selected.wasCapped,
      selectionBounds: [-77.2, 38.7, -76.8, 39.1],
    });

    expect(snapshot.selected_feature_count).toBe(1);
    expect(snapshot.selected_features[0]).toMatchObject({
      query_id: roads.queryId,
      layer_name: "Roads",
      feature_id: "roads:road-1",
    });
    expect(JSON.stringify(snapshot)).not.toContain("geometry");
    expect(JSON.stringify(snapshot)).not.toContain("query_token");
    expect(JSON.stringify(snapshot)).not.toContain("tile_url");
  });
});
