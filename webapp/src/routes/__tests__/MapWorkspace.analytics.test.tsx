import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDescriptor } from "@/components/map/sourceDescriptors";
import type { Collection, Dataset, DatasetFile, DatasetSource } from "@/lib/api-client";

const { getDatasetBySlug, getDatasetFileBySlug, trackDatasetImportedIntoMap } = vi.hoisted(() => ({
  getDatasetBySlug: vi.fn(),
  getDatasetFileBySlug: vi.fn(),
  trackDatasetImportedIntoMap: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  lazyRouteComponent: () => () => null,
  notFound: () => new Error("Not found"),
  useSearch: () => ({}),
}));

vi.mock("@/lib/analytics", () => ({
  trackDatasetImportedIntoMap,
}));

vi.mock("@/lib/api-client", () => ({
  getCollectionBySlug: vi.fn(),
  getDatasetBySlug,
  getDatasetFileBySlug,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}));

vi.mock("@/components/viewer/useMapInitialization", () => ({
  useMultiLayerMapInitialization: () => ({
    mapRef: { current: null },
    setHoverFeature: vi.fn(),
    clearHoverFeature: vi.fn(),
    clearSelectionBox: vi.fn(),
  }),
}));

vi.mock("@/components/viewer/useLayerStyling", () => ({
  useLayerStyling: vi.fn(),
}));

import { MapWorkspace, type ResolvedDescriptor } from "../collections.$collectionSlug.map";

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
  location: { version: "v1.0.0", path: "hospitals.pmtiles" },
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
  location: { version: "v1.1.0", path: "hospitals-v110.pmtiles" },
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
      sources: [source, sourceV2],
    },
  ],
};

const initialLayer: ResolvedDescriptor = { descriptor, dataset, file, source };

describe("MapWorkspace map-import analytics", () => {
  beforeEach(() => {
    getDatasetBySlug.mockResolvedValue({ ...dataset, files: [file] });
    getDatasetFileBySlug.mockResolvedValue({ dataset, file });
    trackDatasetImportedIntoMap.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ datasets: [{ ...dataset, files: [file] }], total: 1, limit: 12, offset: 0 }),
    }));
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("tracks route and picker imports once, without a duplicate after route synchronization", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MapWorkspace collection={collection} initialLayers={[initialLayer]} initialLayerKey="route" />);

    await waitFor(() => {
      expect(trackDatasetImportedIntoMap).toHaveBeenCalledExactlyOnceWith({
        collection_slug: "hifld",
        dataset_slug: "hospitals",
        file_slug: "hospitals",
        source_id: 15,
        version: "v1.0.0",
        import_source: "route",
        loaded_layer_count: 1,
      });
    });

    await user.click(screen.getByRole("combobox"));
    const hospitalsOption = await screen.findByRole("option", { name: /hospitals/i });
    await user.click(hospitalsOption);

    const selectTriggers = screen.getAllByRole("combobox");
    await user.click(selectTriggers[2]!);
    await user.click(screen.getByRole("option", { name: "v1.1.0" }));
    await user.click(screen.getByRole("button", { name: "Add layer" }));

    await waitFor(() => {
      expect(trackDatasetImportedIntoMap).toHaveBeenLastCalledWith({
        collection_slug: "hifld",
        dataset_slug: "hospitals",
        file_slug: "hospitals",
        source_id: 16,
        version: "v1.1.0",
        import_source: "picker",
        loaded_layer_count: 2,
      });
    });
    expect(trackDatasetImportedIntoMap).toHaveBeenCalledTimes(2);

    rerender(<MapWorkspace collection={collection} initialLayers={[initialLayer]} initialLayerKey="sources" />);

    await waitFor(() => expect(trackDatasetImportedIntoMap).toHaveBeenCalledTimes(2));
  });

  it("tracks a route layer again when it is removed and re-added through the picker", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MapWorkspace collection={collection} initialLayers={[initialLayer]} initialLayerKey="route" />);

    await waitFor(() => {
      expect(trackDatasetImportedIntoMap).toHaveBeenCalledExactlyOnceWith({
        collection_slug: "hifld",
        dataset_slug: "hospitals",
        file_slug: "hospitals",
        source_id: 15,
        version: "v1.0.0",
        import_source: "route",
        loaded_layer_count: 1,
      });
    });

    await user.click(screen.getByRole("button", { name: "Remove Hospitals / v1.0.0" }));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /hospitals/i }));
    await user.click(screen.getAllByRole("combobox")[2]!);
    await user.click(screen.getByRole("option", { name: "v1.0.0" }));
    await user.click(screen.getByRole("button", { name: "Add layer" }));

    await waitFor(() => {
      expect(trackDatasetImportedIntoMap).toHaveBeenLastCalledWith({
        collection_slug: "hifld",
        dataset_slug: "hospitals",
        file_slug: "hospitals",
        source_id: 15,
        version: "v1.0.0",
        import_source: "picker",
        loaded_layer_count: 1,
      });
    });
    expect(trackDatasetImportedIntoMap).toHaveBeenCalledTimes(2);

    rerender(<MapWorkspace collection={collection} initialLayers={[initialLayer]} initialLayerKey="sources" />);

    await waitFor(() => expect(trackDatasetImportedIntoMap).toHaveBeenCalledTimes(2));
  });
});
