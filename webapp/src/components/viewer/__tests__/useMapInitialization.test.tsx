import type { RefObject } from "react";
import type maplibregl from "maplibre-gl";
import { PMTiles } from "pmtiles";
import { describe, expect, it, vi } from "vitest";
import {
  type BasemapMode,
  getVectorLayers,
  handleMapClick,
  syncPinnedPopupPosition,
  removeInactiveMapSources,
  selectionBoxFeature,
  syncBasemapVisibility,
  syncExistingRenderedLayers,
  syncBasemapVisibilityAfterStyleLoad,
  queryVectorSourceSpecification,
  transformQueryTileRequest,
  getVectorLayersForSource,
  syncRenderedLayerOrder,
  syncLoadedMapSources,
  runWhenMapStyleReady,
} from "../useMapInitialization";
import type { CatalogPmtilesLayer, QueryMvtLayer } from "@/components/map/multiLayerSources";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    addProtocol: vi.fn(),
  },
}));

function mockMapWithFeatures(features: unknown[]) {
  return {
    getSource: vi.fn(() => undefined),
    queryRenderedFeatures: vi.fn(() => features),
  };
}

interface MockMap {
  addLayer: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  dragPan: {
    disable: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
  };
  getCanvas: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getStyle: ReturnType<typeof vi.fn>;
  isStyleLoaded: ReturnType<typeof vi.fn>;
  loaded: ReturnType<typeof vi.fn>;
  moveLayer: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setFeatureState: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
}

function createMockMap(): MockMap {
  const layerIds = new Set<string>();
  return {
    addLayer: vi.fn((layer: { id: string }) => {
      layerIds.add(layer.id);
    }),
    addSource: vi.fn(),
    dragPan: {
      disable: vi.fn(),
      enable: vi.fn(),
    },
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
    getLayer: vi.fn((layerId: string) => layerIds.has(layerId)),
    getSource: vi.fn(() => undefined),
    getStyle: vi.fn(() => ({
      layers: [
        { id: "background", type: "background" },
        { id: "water", type: "fill", source: "openmaptiles" },
      ],
    })),
    isStyleLoaded: vi.fn(() => false),
    loaded: vi.fn(() => false),
    moveLayer: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    remove: vi.fn(),
    resize: vi.fn(),
    setFeatureState: vi.fn(),
    setLayoutProperty: vi.fn(),
  };
}

describe("useMapInitialization helpers", () => {
  it("loads data sources as soon as the style is ready without waiting for basemap tiles", () => {
    const map = createMockMap();
    const loadSources = vi.fn();
    map.isStyleLoaded.mockReturnValue(true);
    map.loaded.mockReturnValue(false);

    runWhenMapStyleReady(map as maplibregl.Map, loadSources);

    expect(loadSources).toHaveBeenCalledOnce();
    expect(map.once).not.toHaveBeenCalled();
  });

  it("remembers the initial style event even while map loading APIs remain false", () => {
    const map = createMockMap();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    runWhenMapStyleReady(map as maplibregl.Map, firstCallback);
    const styleListener = map.once.mock.calls[0]?.[1] as (() => void) | undefined;
    styleListener?.();
    map.isStyleLoaded.mockReturnValue(false);
    map.loaded.mockReturnValue(false);

    runWhenMapStyleReady(map as maplibregl.Map, secondCallback);

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledOnce();
  });

  it("recovers PMTiles metadata and rendered layers when a cancelled load already added the source", async () => {
    vi.spyOn(PMTiles.prototype, "getMetadata").mockResolvedValue({
      vector_layers: [{ id: "stations", fields: { name: "String" } }],
    });
    const map = createMockMap();
    map.getSource.mockReturnValue({});
    const source: CatalogPmtilesLayer = {
      kind: "catalog_pmtiles",
      id: "amtrak",
      name: "Amtrak",
      label: "Amtrak",
      descriptor: {
        collectionSlug: "hifld",
        datasetSlug: "amtrak-stations",
        fileSlug: "amtrak-stations",
        formatType: "pmtiles",
        storageLocationId: 2,
        version: "v1.0.0",
        sourceId: 8,
      },
      pmtilesUrl: "http://localhost:8888/amtrak.pmtiles",
      mapSourceId: "source-amtrak",
      visible: true,
      opacity: 0.82,
      bounds: null,
    };

    const result = await syncLoadedMapSources({
      map: map as maplibregl.Map,
      protocol: null,
      sources: [source],
      managedSourceIds: new Set(),
      vectorLayersBySource: {},
      shouldContinue: () => true,
    });

    expect(result?.layers).toEqual([
      expect.objectContaining({
        id: "amtrak:stations",
        sourceLayerId: "stations",
      }),
    ]);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalledTimes(3);
  });

  it("updates visibility for an already-loaded catalog PMTiles source", async () => {
    vi.spyOn(PMTiles.prototype, "getMetadata").mockResolvedValue({
      vector_layers: [{ id: "stations", fields: { name: "String" } }],
    });
    const map = createMockMap();
    map.getSource.mockReturnValue({});
    map.getLayer.mockReturnValue(true);
    map.getStyle.mockReturnValue({
      layers: [
        { id: "source-amtrak-stations-fill", type: "fill", source: "source-amtrak" },
        { id: "source-amtrak-stations-line", type: "line", source: "source-amtrak" },
        { id: "source-amtrak-stations-circle", type: "circle", source: "source-amtrak" },
      ],
    });
    const source: CatalogPmtilesLayer = {
      kind: "catalog_pmtiles",
      id: "amtrak",
      name: "Amtrak",
      label: "Amtrak",
      descriptor: {
        collectionSlug: "hifld",
        datasetSlug: "amtrak-stations",
        fileSlug: "amtrak-stations",
        formatType: "pmtiles",
        storageLocationId: 2,
        version: "v1.0.0",
        sourceId: 8,
      },
      pmtilesUrl: "http://localhost:8888/amtrak.pmtiles",
      mapSourceId: "source-amtrak",
      visible: false,
      opacity: 0.82,
      bounds: null,
    };

    const result = await syncLoadedMapSources({
      map: map as maplibregl.Map,
      protocol: null,
      sources: [source],
      managedSourceIds: new Set([source.mapSourceId]),
      vectorLayersBySource: {},
      shouldContinue: () => true,
    });

    expect(result?.interactiveLayerIds).toEqual([]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-amtrak-stations-fill", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-amtrak-stations-line", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-amtrak-stations-circle", "visibility", "none");
  });

  it("identifies the catalog layer that failed during source synchronization", async () => {
    vi.spyOn(PMTiles.prototype, "getMetadata").mockRejectedValue(new Error("PMTiles metadata unavailable"));
    const map = createMockMap();
    const source: CatalogPmtilesLayer = {
      kind: "catalog_pmtiles", id: "amtrak", name: "Amtrak", label: "Amtrak",
      descriptor: {
        collectionSlug: "hifld", datasetSlug: "amtrak-stations", fileSlug: "amtrak-stations",
        formatType: "pmtiles", storageLocationId: 2, version: "v1.0.0", sourceId: 8,
      },
      pmtilesUrl: "http://localhost:8888/amtrak.pmtiles", mapSourceId: "source-amtrak",
      visible: true, opacity: 0.82, bounds: null,
    };
    await expect(syncLoadedMapSources({
      map: map as maplibregl.Map, protocol: null, sources: [source], managedSourceIds: new Set(),
      vectorLayersBySource: {}, shouldContinue: () => true,
    })).rejects.toMatchObject({ sourceId: "amtrak", message: "PMTiles metadata unavailable" });
  });

  it("reorders all rendered style layers in source order without moving the basemap", () => {
    const map = {
      getLayer: vi.fn((id: string) => ({
        "source-query-b-one-fill": true,
        "source-query-b-one-line": true,
        "source-query-a-one-fill": true,
        "source-query-a-one-line": true,
      })[id]),
      moveLayer: vi.fn(),
    };
    const sources = [
      { id: "query:b", mapSourceId: "source-query-b", kind: "query_mvt" },
      { id: "query:a", mapSourceId: "source-query-a", kind: "query_mvt" },
    ];
    const vectorLayersBySource = {
      "query:b": [
        { id: "query-b:one", mapLayerBaseId: "source-query-b-one", fields: [], numericFields: [] },
      ],
      "query:a": [
        { id: "query-a:one", mapLayerBaseId: "source-query-a-one", fields: [], numericFields: [] },
      ],
    };

    syncRenderedLayerOrder(map, sources, vectorLayersBySource);

    expect(map.moveLayer).toHaveBeenCalledWith("source-query-b-one-fill");
    expect(map.moveLayer).toHaveBeenCalledWith("source-query-b-one-line");
    expect(map.moveLayer).toHaveBeenCalledWith("source-query-a-one-fill");
    expect(map.moveLayer).toHaveBeenCalledWith("source-query-a-one-line");
    expect(map.moveLayer).not.toHaveBeenCalledWith("osm-base");
  });
  it("describes query MVT sources from server metadata without exposing tokens", () => {
    const queryLayer: QueryMvtLayer = {
      kind: "query_mvt",
      id: "query:q-123",
      name: "Query result",
      label: "Query result",
      queryId: "q-123",
      sourceAliases: ["hospitals"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/api/queries/q-123/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [{ name: "beds", logicalType: "double", nullable: false, min: 1, max: 100 }],
      bounds: null,
      status: "ready",
      mapSourceId: "source-query-q-123",
      visible: true,
      opacity: 0.82,
    };

    expect(queryVectorSourceSpecification(queryLayer)).toEqual({
      type: "vector",
      tiles: [queryLayer.tileTemplate],
    });
    expect(getVectorLayersForSource({}, queryLayer)).toEqual([
      expect.objectContaining({
        id: "query:q-123:hifld",
        sourceLayerId: "hifld",
        fields: ["beds"],
        numericFields: [{ name: "beds", min: 1, max: 100 }],
      }),
    ]);
  });

  it("attaches only the private token for known query tile paths", () => {
    const tokens = new Map([["q-123", "signed-token"]]);
    expect(
      transformQueryTileRequest(
        "https://query.example.test/api/queries/q-123/tiles/4/5/6.mvt",
        tokens,
      ),
    ).toEqual({
      url: "https://query.example.test/api/queries/q-123/tiles/4/5/6.mvt",
      headers: { "X-HIFLD-Query-Token": "signed-token" },
    });
    expect(transformQueryTileRequest("https://query.example.test/api/queries/q-999/tiles/4/5/6.mvt", tokens)).toEqual({
      blocked: true,
      queryId: "q-999",
      reason: "unknown_query",
    });
    expect(transformQueryTileRequest("https://query.example.test/api/queries/q-123/pages", tokens)).toBeNull();
    expect(transformQueryTileRequest("https://query.example.test/api/queries/q-123/tiles/4/5/6.mvt?token=secret", tokens)).toEqual({
      url: "https://query.example.test/api/queries/q-123/tiles/4/5/6.mvt",
      headers: { "X-HIFLD-Query-Token": "signed-token" },
    });
  });

  it("extracts vector layer metadata", () => {
    expect(
      getVectorLayers({
        vector_layers: [
          { id: "test-layer", fields: { name: "String", id: "Number" } },
          { fields: { ignored: "String" } },
        ],
      }),
    ).toEqual([{ id: "test-layer", fields: ["name", "id"], numericFields: [{ name: "id" }] }]);
  });

  it("builds a geographic selection box polygon", () => {
    expect(selectionBoxFeature({ lng: -77, lat: 39 }, { lng: -76, lat: 38 })).toEqual({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-77, 39],
            [-76, 39],
            [-76, 38],
            [-77, 38],
            [-77, 39],
          ],
        ],
      },
    });
  });

  it("toggles street and satellite basemap visibility", () => {
    const map = {
      getLayer: vi.fn((layerId: string) => layerId === "osm-base" || layerId === "satellite-base"),
      getStyle: vi.fn(() => ({
        layers: [
          { id: "background", type: "background" },
          { id: "water", type: "fill", source: "openmaptiles" },
          { id: "road", type: "line", source: "openmaptiles" },
          { id: "place-label", type: "symbol", source: "openfreemap" },
          { id: "source-layer-fill", type: "fill", source: "source-layer" },
        ],
      })),
      setLayoutProperty: vi.fn(),
    };

    syncBasemapVisibility(map, "satellite");

    expect(map.setLayoutProperty).toHaveBeenCalledWith("water", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("road", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("place-label", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("background", "visibility", "none");
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith("source-layer-fill", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("osm-base", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("satellite-base", "visibility", "visible");
  });

  it("skips OpenMapTiles layer sync when the style has not loaded yet", () => {
    const map = {
      getLayer: vi.fn(() => false),
      getStyle: vi.fn(() => undefined),
      setLayoutProperty: vi.fn(),
    };

    expect(() => syncBasemapVisibility(map, "street")).not.toThrow();
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });

  it("uses the latest basemap mode when the remote style finishes loading", () => {
    const map = createMockMap();
    const basemapModeRef: RefObject<BasemapMode> = { current: "street" };

    basemapModeRef.current = "satellite";
    syncBasemapVisibilityAfterStyleLoad(map as maplibregl.Map, basemapModeRef);

    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "satellite-base",
        source: "esri-world-imagery",
      }),
      "background",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith("background", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("water", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("satellite-base", "visibility", "visible");
  });

  it("pins a popup when clicking a rendered feature", () => {
    const onPinnedPopup = vi.fn();
    const features = [
      {
        type: "Feature",
        properties: { name: "Test" },
        layer: { id: "test-layer" },
      },
    ];
    const map = mockMapWithFeatures(features);

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup,
    });

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 100, y: 200 }, { layers: ["test-layer"] });
    expect(onPinnedPopup).toHaveBeenCalledWith({
      x: 100,
      y: 200,
      features,
      selectedIndex: 0,
      isPinned: true,
      lngLat: { lng: 0, lat: 1 },
    });
  });

  it("clears pinned popup when clicking empty map space", () => {
    const onPinnedPopup = vi.fn();
    const selectionSource = { setData: vi.fn() };
    const map = {
      ...mockMapWithFeatures([]),
      getSource: vi.fn(() => selectionSource),
    };

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup,
    });

    expect(onPinnedPopup).toHaveBeenCalledWith(null);
    expect(selectionSource.setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("does nothing when no pinned callback is provided", () => {
    const map = mockMapWithFeatures([{ type: "Feature" }]);

    handleMapClick({
      map,
      point: { x: 100, y: 200 },
      lngLat: { lng: 0, lat: 1 },
      interactiveLayerIds: ["test-layer"],
      onPinnedPopup: undefined,
    });

    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it("syncs pinned popup element position from its geographic anchor", () => {
    const element = document.createElement("div");
    const map = {
      project: vi.fn(() => ({ x: 42, y: 84 })),
    };

    syncPinnedPopupPosition({
      map,
      lngLat: { lng: -77.03, lat: 38.9 },
      element,
    });

    expect(map.project).toHaveBeenCalledWith({ lng: -77.03, lat: 38.9 });
    expect(element.style.left).toBe("54px");
    expect(element.style.top).toBe("96px");
  });

  it("hides existing rendered layers with map layout visibility", () => {
    const map = {
      getStyle: vi.fn(() => ({
        layers: [
          { id: "source-layer-fill", type: "fill", source: "source-layer" },
          { id: "source-layer-line", type: "line", source: "source-layer" },
          { id: "osm-base", type: "raster", source: "osm-tiles" },
        ],
      })),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
    };

    const interactiveLayerIds = syncExistingRenderedLayers(map, {
      id: "layer",
      name: "Layer",
      descriptor: {
        collectionSlug: "hifld",
        datasetSlug: "dataset",
        fileSlug: "file",
        formatType: "pmtiles",
        storageLocationId: 1,
        version: "v1.0.0",
        sourceId: 1,
      },
      pmtilesUrl: "https://example.test/layer.pmtiles",
      mapSourceId: "source-layer",
      visible: false,
      opacity: 0.82,
    });

    expect(interactiveLayerIds).toEqual([]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-layer-fill", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("source-layer-line", "visibility", "none");
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith("osm-base", "visibility", "none");
  });

  it("removes inactive managed rendered layers and sources without touching active or base sources", () => {
    const managedSourceIds = new Set(["source-active", "source-stale"]);
    const map = {
      getLayer: vi.fn((layerId: string) => layerId !== "missing-layer"),
      getSource: vi.fn((sourceId: string) => (sourceId === "source-stale" || sourceId === "source-active" ? {} : undefined)),
      getStyle: vi.fn(() => ({
        sources: {
          "osm-tiles": { type: "raster" },
          "source-active": { type: "vector" },
          "source-stale": { type: "vector" },
          "external-source": { type: "vector" },
        },
        layers: [
          { id: "osm-base", type: "raster", source: "osm-tiles" },
          { id: "active-fill", type: "fill", source: "source-active" },
          { id: "stale-fill", type: "fill", source: "source-stale" },
          { id: "stale-line", type: "line", source: "source-stale" },
          { id: "external-fill", type: "fill", source: "external-source" },
        ],
      })),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
    };

    removeInactiveMapSources(map, new Set(["source-active"]), managedSourceIds);

    expect(map.removeLayer).toHaveBeenCalledWith("stale-fill");
    expect(map.removeLayer).toHaveBeenCalledWith("stale-line");
    expect(map.removeLayer).not.toHaveBeenCalledWith("active-fill");
    expect(map.removeLayer).not.toHaveBeenCalledWith("osm-base");
    expect(map.removeLayer).not.toHaveBeenCalledWith("external-fill");
    expect(map.removeSource).toHaveBeenCalledWith("source-stale");
    expect(map.removeSource).not.toHaveBeenCalledWith("source-active");
    expect(map.removeSource).not.toHaveBeenCalledWith("osm-tiles");
    expect(map.removeSource).not.toHaveBeenCalledWith("external-source");
    expect(managedSourceIds).toEqual(new Set(["source-active"]));
  });

});
