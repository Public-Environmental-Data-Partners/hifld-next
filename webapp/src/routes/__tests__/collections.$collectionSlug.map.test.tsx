import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSourceDescriptor, type SourceDescriptor } from "@/components/map/sourceDescriptors";
import type { Collection, Dataset, DatasetFile, DatasetSource, DatasetWithUrls, PaginatedResponse } from "@/lib/api-client";
import * as apiClient from "@/lib/api-client";
import { Route as CollectionMapRoute, type ResolvedDescriptor, resolvedToMapLayer } from "../collections.$collectionSlug.map";

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

const descriptor: SourceDescriptor = {
  collectionSlug: collection.slug,
  datasetSlug: dataset.slug,
  fileSlug: "hospitals",
  formatType: "pmtiles",
  storageLocationId: 4,
  version: "v1.0.0",
  sourceId: source.id,
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
      sources: [source],
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
});
