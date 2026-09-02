import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSourceDescriptor, encodeSourceDescriptorList, type SourceDescriptor } from "@/components/map/sourceDescriptors";
import type { LoadedMapLayer } from "@/components/map/multiLayerSources";
import type { Collection, Dataset, DatasetFile, DatasetSource, DatasetWithUrls, PaginatedResponse } from "@/lib/api-client";
import * as apiClient from "@/lib/api-client";
import {
  DATASET_SEARCH_LIST_CLASSNAME,
  DATASET_SEARCH_PANEL_CLASSNAME,
  IMPORT_LAYER_CARD_CLASSNAME,
  IMPORT_SELECT_TRIGGER_CLASSNAME,
  IMPORT_SELECT_VALUE_CLASSNAME,
  MAP_CANVAS_DESKTOP_DEFAULT_SIZE,
  MAP_SELECTED_FEATURES_DESKTOP_DEFAULT_SIZE,
  newMapImportEvents,
  MOBILE_SETTINGS_SCROLL_CLASSNAME,
  Route as CollectionMapRoute,
  closeMapPopup,
  popupProperties,
  type ResolvedDescriptor,
  resolvedToMapLayer,
  searchDatasetsForMapImport,
} from "../collections.$collectionSlug.map";

vi.mock("@/lib/api-client", () => ({
  getCollectionBySlug: vi.fn(),
  getCollectionDatasets: vi.fn(),
  getDatasetFileBySlug: vi.fn(),
}));

vi.mock("@/components/viewer/useMapInitialization", () => ({
  useMultiLayerMapInitialization: () => ({
    mapRef: { current: null },
    setHoverFeature: vi.fn(),
    clearHoverFeature: vi.fn(),
  }),
}));

vi.mock("@/components/viewer/useLayerStyling", () => ({
  useLayerStyling: vi.fn(),
}));

const collection: Collection = {
  id: 1,
  slug: "hifld",
  name: "HIFLD",
  description: "Test collection",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const dataset: Dataset = {
  id: 2,
  slug: "hospitals",
  name: "Hospitals",
  description: "Hospital locations",
  collection_id: collection.id,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const source: DatasetSource = {
  id: 15,
  version: "v1.0.0",
  url: "https://example.test/hospitals.pmtiles",
  source_type: "file",
  location: {
    version: "v1.0.0",
    path: "hospitals.pmtiles",
  },
  storage_location: {
    id: 4,
    name: "Production GCS",
    backend_type: "s3",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
};

const sourceV2: DatasetSource = {
  ...source,
  id: 16,
  version: "v1.1.0",
  url: "https://example.test/hospitals-v110.pmtiles",
  location: {
    version: "v1.1.0",
    path: "hospitals-v110.pmtiles",
  },
};

const descriptor: SourceDescriptor = {
  collectionSlug: collection.slug,
  datasetSlug: dataset.slug,
  fileSlug: "hospitals",
  formatType: "pmtiles",
  storageLocationId: 4,
  version: "v1.0.0",
  sourceId: source.id,
};

const descriptorV2: SourceDescriptor = {
  ...descriptor,
  version: "v1.1.0",
  sourceId: sourceV2.id,
};

const file: DatasetFile = {
  id: 3,
  dataset_id: dataset.id,
  name: "Hospitals",
  slug: "hospitals",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  formats: [
    {
      format: {
        id: 9,
        format_type: "pmtiles",
        name: "PMTiles",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
      dataset_format: {
        id: 10,
        dataset_id: dataset.id,
        format_id: 9,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
      sources: [source, sourceV2],
    },
  ],
};

function emptyDatasetPage(): PaginatedResponse<DatasetWithUrls> {
  return {
    items: [],
    total: 0,
    limit: 12,
    offset: 0,
  };
}

function createTestRouter() {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/collections/$collectionSlug/map",
    validateSearch: CollectionMapRoute.options.validateSearch,
    loaderDeps: CollectionMapRoute.options.loaderDeps,
    loader: CollectionMapRoute.options.loader,
    component: CollectionMapRoute.options.component,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([route]),
    defaultPreload: "intent",
  });
}

describe("collection map route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getCollectionBySlug).mockResolvedValue(collection);
    vi.mocked(apiClient.getCollectionDatasets).mockResolvedValue(emptyDatasetPage());
    vi.mocked(apiClient.getDatasetFileBySlug).mockResolvedValue({ dataset, file });
  });

  it("opens the desktop selected-features drawer larger by default", () => {
    expect(MAP_CANVAS_DESKTOP_DEFAULT_SIZE).toBe("45%");
    expect(MAP_SELECTED_FEATURES_DESKTOP_DEFAULT_SIZE).toBe("55%");
  });

  it("resolves an initial source search param on the canonical map URL", async () => {
    const encodedSource = encodeSourceDescriptor(descriptor);
    const router = createTestRouter();

    await router.navigate({
      to: "/collections/hifld/map",
      search: { source: encodedSource },
    });

    await waitFor(() => {
      expect(apiClient.getDatasetFileBySlug).toHaveBeenCalledWith({
        data: {
          collectionSlug: "hifld",
          datasetSlug: "hospitals",
          fileSlug: "hospitals",
        },
      });
    });
  });

  it("resolves multiple initial source descriptors on the canonical map URL", async () => {
    const encodedSources = encodeSourceDescriptorList([descriptor, descriptorV2]);
    const router = createTestRouter();

    await router.navigate({
      to: "/collections/hifld/map",
      search: { sources: encodedSources },
    });

    await waitFor(() => {
      expect(apiClient.getDatasetFileBySlug).toHaveBeenCalledTimes(2);
    });
  });

  it("does not use the dataset search query as a map route loader dependency", () => {
    const deps = CollectionMapRoute.options.loaderDeps?.({
      search: {
        source: "encoded-source",
        query: "hospitals",
        offset: 24,
      },
    });

    expect(deps).toEqual({ source: "encoded-source", sources: undefined });
  });

  it("searches importable datasets with lightweight collection results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        datasets: [dataset],
        total: 1,
        limit: 12,
        offset: 0,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchDatasetsForMapImport({
        collectionSlug: collection.slug,
        query: "hospitals",
      }),
    ).resolves.toEqual({
      items: [dataset],
      total: 1,
      limit: 12,
      offset: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/collections/hifld?limit=12&offset=0&omit=description&search=hospitals");
    expect(apiClient.getCollectionDatasets).not.toHaveBeenCalled();
  });

  it("keeps dataset search results constrained and touch-scrollable on mobile", () => {
    expect(DATASET_SEARCH_PANEL_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining(["absolute", "top-full", "right-0", "left-0", "z-30"]),
    );
    expect(DATASET_SEARCH_PANEL_CLASSNAME).not.toContain("radix");
    expect(DATASET_SEARCH_LIST_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining([
        "max-h-[min(18rem,calc(100dvh-14rem))]",
        "touch-pan-y",
        "overflow-y-auto",
        "overscroll-contain",
        "[-webkit-overflow-scrolling:touch]",
      ]),
    );
    expect(DATASET_SEARCH_LIST_CLASSNAME).not.toContain("overflow-hidden");
  });

  it("keeps the mobile import picker card inside the settings drawer", () => {
    expect(MOBILE_SETTINGS_SCROLL_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "overflow-y-auto",
        "overflow-x-hidden",
        "overscroll-contain",
        "[-webkit-overflow-scrolling:touch]",
      ]),
    );
    expect(IMPORT_LAYER_CARD_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining(["box-border", "w-full", "max-w-full", "min-w-0", "overflow-hidden"]),
    );
    expect(IMPORT_LAYER_CARD_CLASSNAME).toContain("[contain:inline-size]");
    expect(IMPORT_SELECT_TRIGGER_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining(["w-full", "max-w-full", "min-w-0", "overflow-hidden"]),
    );
    expect(IMPORT_SELECT_VALUE_CLASSNAME.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "truncate", "text-left"]),
    );
  });

  it("clears pinned and hover popup state when closing the map popup", () => {
    const setPinnedPopupInfo = vi.fn();
    const setHoverInfo = vi.fn();
    const clearHoverFeature = vi.fn();

    closeMapPopup({ setPinnedPopupInfo, setHoverInfo, clearHoverFeature });

    expect(setPinnedPopupInfo).toHaveBeenCalledWith(null);
    expect(setHoverInfo).toHaveBeenCalledWith(null);
    expect(clearHoverFeature).toHaveBeenCalledTimes(1);
  });

  it("does not expose server-generated query MVT properties in feature popups", () => {
    const queryLayer: LoadedMapLayer = {
      kind: "query_mvt",
      id: "query:q-popup",
      name: "Query layer",
      label: "Query layer",
      queryId: "q-popup",
      sourceAliases: ["stations"],
      geometryColumn: "geom",
      tileTemplate: "https://query.example.test/tiles/{z}/{x}/{y}.mvt",
      sourceLayerId: "hifld",
      scalarFields: [],
      bounds: null,
      status: "ready",
      mapSourceId: "query-source",
      visible: true,
      opacity: 0.82,
    };
    expect(
      popupProperties({
        x: 10,
        y: 20,
        selectedIndex: 0,
        features: [
          {
            type: "Feature",
            source: "query-source",
            sourceLayer: "hifld",
            properties: {
              NAME: "Station",
              __hifld_feature_key: "station-1",
              __hifld_feature_hash: "123",
              __hifld_centroid_lng: -77,
              __hifld_centroid_lat: 38,
              _mcp_feature_id: 123,
            },
            geometry: { type: "Point", coordinates: [-77, 38] },
            layer: { id: "query-layer", type: "circle", source: "query-source" },
            state: {},
          },
        ],
      }, [queryLayer]),
    ).toEqual([["NAME", "Station"]]);
  });

  it("preserves same-named catalog properties in feature popups", () => {
    const catalogLayer = resolvedToMapLayer({ descriptor, dataset, file, source });
    if (!catalogLayer) throw new Error("catalog layer fixture is required");

    expect(
      popupProperties(
        {
          x: 10,
          y: 20,
          selectedIndex: 0,
          features: [
            {
              type: "Feature",
              source: catalogLayer.mapSourceId,
              sourceLayer: "hifld",
              properties: {
                NAME: "Hospital",
                __hifld_feature_key: "legitimate-catalog-value",
              },
              geometry: { type: "Point", coordinates: [-77, 38] },
              layer: { id: "catalog-layer", type: "circle", source: catalogLayer.mapSourceId },
              state: {},
            },
          ],
        },
        [catalogLayer],
      ),
    ).toEqual([
      ["__hifld_feature_key", "legitimate-catalog-value"],
      ["NAME", "Hospital"],
    ]);
  });

  it("turns a resolved initial source into a loaded map layer", () => {
    const resolved: ResolvedDescriptor = {
      descriptor,
      dataset,
      file,
      source,
    };

    expect(resolvedToMapLayer(resolved)).toMatchObject({
      name: "Hospitals / v1.0.0",
      datasetName: "Hospitals",
      storageLocationName: "Production GCS",
      pmtilesUrl: "https://example.test/hospitals.pmtiles",
      visible: true,
    });
  });

  it("derives one route import and one picker import without duplicates after synchronization", () => {
    const initialLayer = resolvedToMapLayer({ descriptor, dataset, file, source });
    const pickerLayer = resolvedToMapLayer({ descriptor: descriptorV2, dataset, file, source: sourceV2 });
    expect(initialLayer).not.toBeNull();
    expect(pickerLayer).not.toBeNull();
    if (!initialLayer || !pickerLayer) return;

    const trackedSourceDescriptorIds = new Set<string>();
    const routeSourceDescriptorIds = new Set([initialLayer.id]);
    const routeEvents = newMapImportEvents({
      loadedLayers: [initialLayer],
      routeSourceDescriptorIds,
      trackedSourceDescriptorIds,
    });

    expect(routeEvents).toEqual([
      {
        sourceDescriptorId: initialLayer.id,
        properties: {
          collection_slug: "hifld",
          dataset_slug: "hospitals",
          file_slug: "hospitals",
          source_id: 15,
          version: "v1.0.0",
          import_source: "route",
          loaded_layer_count: 1,
        },
      },
    ]);
    routeEvents.forEach((event) => trackedSourceDescriptorIds.add(event.sourceDescriptorId));

    const pickerEvents = newMapImportEvents({
      loadedLayers: [initialLayer, pickerLayer],
      routeSourceDescriptorIds,
      trackedSourceDescriptorIds,
    });
    expect(pickerEvents).toEqual([
      {
        sourceDescriptorId: pickerLayer.id,
        properties: {
          collection_slug: "hifld",
          dataset_slug: "hospitals",
          file_slug: "hospitals",
          source_id: 16,
          version: "v1.1.0",
          import_source: "picker",
          loaded_layer_count: 2,
        },
      },
    ]);
    pickerEvents.forEach((event) => trackedSourceDescriptorIds.add(event.sourceDescriptorId));

    expect(
      newMapImportEvents({
        loadedLayers: [initialLayer, pickerLayer],
        routeSourceDescriptorIds,
        trackedSourceDescriptorIds,
      }),
    ).toEqual([]);
  });

  it("deduplicates repeated source descriptors in one loaded-layer batch", () => {
    const initialLayer = resolvedToMapLayer({ descriptor, dataset, file, source });
    expect(initialLayer).not.toBeNull();
    if (!initialLayer) return;

    expect(
      newMapImportEvents({
        loadedLayers: [initialLayer, initialLayer],
        routeSourceDescriptorIds: new Set([initialLayer.id]),
        trackedSourceDescriptorIds: new Set(),
      }),
    ).toEqual([
      {
        sourceDescriptorId: initialLayer.id,
        properties: {
          collection_slug: "hifld",
          dataset_slug: "hospitals",
          file_slug: "hospitals",
          source_id: 15,
          version: "v1.0.0",
          import_source: "route",
          loaded_layer_count: 2,
        },
      },
    ]);
  });
});
