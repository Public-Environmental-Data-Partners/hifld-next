import { createFileRoute, Link, notFound, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Eye,
  EyeOff,
  FileText,
  Layers,
  PanelLeft,
  Plus,
  Trash2,
} from "lucide-react";
import type maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { z } from "zod";
import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import { compareVersionValues, formatVersionLabel } from "@/components/dataset/versionLabel";
import { FeatureTablePanel } from "@/components/map/FeatureTablePanel";
import {
  type FeatureSelectionMode,
  normalizeSelectedFeatures,
  type SelectedMapFeature,
  updateSelectedFeatures,
} from "@/components/map/featureSelection";
import { clearedLayerPickerSelection, layerPickerSelectionAfterLayerRemoval } from "@/components/map/mapWorkspaceState";
import { buildLoadedMapLayer, type LoadedMapLayer } from "@/components/map/multiLayerSources";
import {
  decodeSourceDescriptor,
  decodeSourceDescriptorList,
  descriptorForSource,
  findSourceForDescriptor,
  type SourceDescriptor,
  sourceDescriptorId,
} from "@/components/map/sourceDescriptors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PageLoader } from "@/components/ui/page-loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FeatureHoverPopup } from "@/components/viewer/FeatureHoverPopup";
import { LayerStylingEditor } from "@/components/viewer/LayerStylingEditor";
import { MapControls } from "@/components/viewer/MapControls";
import { MapLegend } from "@/components/viewer/MapLegend";
import type {
  HoverInfo,
  LayerStyle,
  LayerStylesById,
  PopupPropertyEntry,
  VectorLayerInfo,
} from "@/components/viewer/types";
import { useLayerStyling } from "@/components/viewer/useLayerStyling";
import { type BasemapMode, useMultiLayerMapInitialization } from "@/components/viewer/useMapInitialization";
import {
  automaticBreaksForNumericField,
  DEFAULT_BREAK_COUNT,
  getColorRamp,
  getLegendItems,
  getSampledValues,
  parseBreaks,
} from "@/components/viewer/utils";
import type {
  Collection,
  Dataset,
  DatasetFile,
  DatasetSource,
  DatasetWithUrls,
  PaginatedResponse,
} from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileBySlug } from "@/lib/api-client";

type MapSearch = {
  source?: string;
  sources?: string;
};

const MAP_DATASET_PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 500;
const MOBILE_SETTINGS_MEDIA_QUERY = "(max-width: 767.98px)";

const mapSearchSchema = z
  .object({
    source: z.string().optional(),
    sources: z.string().optional(),
  })
  .catch({});

function parseMapSearch(search: z.input<typeof mapSearchSchema>): MapSearch {
  const parsed = mapSearchSchema.parse(search);
  const result: MapSearch = {};
  if (parsed.source !== undefined) result.source = parsed.source;
  if (parsed.sources !== undefined) result.sources = parsed.sources;
  return result;
}

export interface ResolvedDescriptor {
  descriptor: SourceDescriptor;
  dataset: Dataset;
  file: DatasetFile;
  source: DatasetSource;
}

interface MapWorkspaceProps {
  collection: Collection;
  initialLayers: ResolvedDescriptor[];
  initialLayerKey: string | undefined;
}

interface LayerStyleUpdates {
  [layerId: string]: LayerStylesById[string];
}

interface LoadedLayerItemProps {
  layer: LoadedMapLayer;
  vectorLayerCount: number;
  onVisibleChange: (visible: boolean) => void;
  onRemove: () => void;
}

function LoadedLayerItem({ layer, vectorLayerCount, onVisibleChange, onRemove }: LoadedLayerItemProps) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{layer.name}</div>
          <div className="text-xs text-muted-foreground">{vectorLayerCount} vector layers</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
            title={layer.visible ? "Hide layer" : "Show layer"}
            onClick={() => onVisibleChange(!layer.visible)}
          >
            {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Remove ${layer.name}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Button asChild type="button" variant="outline" size="sm" className="mt-3 w-full">
        <Link
          to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
          params={{
            collectionSlug: layer.descriptor.collectionSlug,
            datasetSlug: layer.descriptor.datasetSlug,
            fileSlug: layer.descriptor.fileSlug,
          }}
        >
          <FileText className="h-4 w-4" />
          Open file
        </Link>
      </Button>
    </div>
  );
}

function datasetHasLoadedLayer(
  collectionSlug: string,
  dataset: DatasetWithUrls,
  currentDescriptors: SourceDescriptor[],
): boolean {
  const loadedIds = new Set(currentDescriptors.map(sourceDescriptorId));
  const files = dataset.files ?? [];
  for (const file of files) {
    const formatEntry = pmtilesFormatForFile(file);
    for (const source of formatEntry?.sources ?? []) {
      const descriptor = descriptorForSource({
        collectionSlug,
        datasetSlug: dataset.slug,
        fileSlug: file.slug,
        formatType: "pmtiles",
        source,
      });
      if (!descriptor) continue;
      if (loadedIds.has(sourceDescriptorId(descriptor))) {
        return true;
      }
    }
  }
  return false;
}

function sampledBreakValues(map: maplibregl.Map | null, layer: VectorLayerInfo, property: string): number[] {
  if (!map) {
    return [];
  }
  return getSampledValues(map, layer.sourceLayerId ?? layer.id, property, 5000, layer.mapSourceId);
}

function computeMissingBreakUpdates(
  map: maplibregl.Map | null,
  vectorLayers: VectorLayerInfo[],
  layerStyles: LayerStylesById,
): LayerStyleUpdates {
  const updates: LayerStyleUpdates = {};
  for (const layer of vectorLayers) {
    const style = layerStyles[layer.id];
    if (!style?.colorProperty || style.breakMode !== "auto" || style.breaksText) continue;
    const numericField = layer.numericFields.find((field) => field.name === style.colorProperty);
    const sampledValues = sampledBreakValues(map, layer, style.colorProperty);
    const breaks = automaticBreaksForNumericField({
      field: numericField,
      sampledValues,
      count: DEFAULT_BREAK_COUNT,
    });
    const nextText = breaks.join(", ");
    if (nextText) {
      updates[layer.id] = { ...style, breaksText: nextText };
    }
  }
  return updates;
}

export async function resolveDescriptor(descriptor: SourceDescriptor | null): Promise<ResolvedDescriptor | null> {
  if (!descriptor) return null;
  const response = await getDatasetFileBySlug({
    data: {
      collectionSlug: descriptor.collectionSlug,
      datasetSlug: descriptor.datasetSlug,
      fileSlug: descriptor.fileSlug,
    },
  });
  if (!response) return null;
  const source = findSourceForDescriptor(response.file, descriptor);
  if (!source) return null;
  return {
    descriptor,
    dataset: response.dataset,
    file: response.file,
    source,
  };
}

interface CollectionDatasetSearchApiResponse {
  datasets: DatasetWithUrls[];
  total: number;
  limit: number;
  offset: number;
}

function collectionMapSearchUrl(collectionSlug: string, query: string): string {
  const trimmedQuery = query.trim();
  const params = new URLSearchParams({
    limit: String(MAP_DATASET_PAGE_SIZE),
    offset: "0",
    omit: "description",
  });
  if (trimmedQuery) params.set("search", trimmedQuery);
  return `/api/collections/${encodeURIComponent(collectionSlug)}?${params.toString()}`;
}

export async function searchDatasetsForMapImport({
  collectionSlug,
  query,
}: {
  collectionSlug: string;
  query: string;
}): Promise<PaginatedResponse<DatasetWithUrls>> {
  const response = await fetch(collectionMapSearchUrl(collectionSlug, query));
  if (!response.ok) {
    throw new Error(`Dataset search failed: ${response.status}`);
  }
  const body = (await response.json()) as CollectionDatasetSearchApiResponse;
  return {
    items: body.datasets,
    total: body.total,
    limit: body.limit,
    offset: body.offset,
  };
}

export const Route = createFileRoute("/collections/$collectionSlug/map")({
  validateSearch: parseMapSearch,
  loaderDeps: ({ search }) => ({
    source: search.source,
    sources: search.sources,
  }),
  loader: async ({ deps, params }) => {
    const collection = await getCollectionBySlug({
      data: { slug: params.collectionSlug },
    });
    if (!collection) {
      throw notFound();
    }
    const descriptors = deps.sources?.trim()
      ? decodeSourceDescriptorList(deps.sources)
      : [decodeSourceDescriptor(deps.source)].filter(
          (descriptor): descriptor is SourceDescriptor => descriptor !== null,
        );
    const resolved = (await Promise.all(descriptors.map((descriptor) => resolveDescriptor(descriptor)))).filter(
      (entry): entry is ResolvedDescriptor => entry !== null,
    );
    return {
      collection,
      resolved,
    };
  },
  component: CollectionMapRoutePage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
  ssr: false,
});

function CollectionMapRoutePage() {
  const { collection, resolved } = Route.useLoaderData();
  const search = useSearch({ from: Route.fullPath });
  return (
    <MapWorkspace collection={collection} initialLayers={resolved} initialLayerKey={search.sources ?? search.source} />
  );
}

function popupProperties(hoverInfo: HoverInfo | null): PopupPropertyEntry[] {
  const selectedFeature = hoverInfo?.features?.[hoverInfo.selectedIndex ?? 0] ?? null;
  return Object.entries(selectedFeature?.properties ?? {})
    .map(([key, value]) => [key, String(value)] satisfies PopupPropertyEntry)
    .sort(([left], [right]) => left.localeCompare(right));
}

function selectedFeatureIdFromHoverInfo(hoverInfo: HoverInfo | null, loadedLayers: LoadedMapLayer[]): string | null {
  const hoveredFeature = hoverInfo?.features[hoverInfo.selectedIndex ?? 0] ?? null;
  if (!hoveredFeature) {
    return null;
  }
  return normalizeSelectedFeatures({ features: [hoveredFeature], loadedLayers })[0]?.id ?? null;
}

function selectedMapFeatureFromHoverInfo(
  hoverInfo: HoverInfo | null,
  loadedLayers: LoadedMapLayer[],
): SelectedMapFeature | null {
  const hoveredFeature = hoverInfo?.features[hoverInfo.selectedIndex ?? 0] ?? null;
  if (!hoveredFeature) {
    return null;
  }
  return normalizeSelectedFeatures({ features: [hoveredFeature], loadedLayers })[0] ?? null;
}

export function resolvedToMapLayer(entry: ResolvedDescriptor): LoadedMapLayer | null {
  if (entry.descriptor.formatType !== "pmtiles") return null;
  const url = buildSourceFileUrl(entry.source);
  if (!url) return null;
  return buildLoadedMapLayer({
    descriptor: entry.descriptor,
    name: `${entry.file.name} / ${formatVersionLabel(entry.source.version ?? "1")}`,
    datasetName: entry.dataset.name,
    storageLocationName: entry.source.storage_location?.name,
    sourceMetadata: entry.source.source_metadata,
    pmtilesUrl: url,
  });
}

function pmtilesFormatForFile(file: DatasetFile) {
  return file.formats?.find((formatEntry) => formatEntry.format.format_type === "pmtiles") ?? null;
}

function useIsMobileMapLayout(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(MOBILE_SETTINGS_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_SETTINGS_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return isMobile;
}

function selectablePmtilesFiles(dataset: DatasetWithUrls): DatasetFile[] {
  return (dataset.files ?? []).filter((file) => (pmtilesFormatForFile(file)?.sources.length ?? 0) > 0);
}

function sortedSourcesForFile(file: DatasetFile | null): DatasetSource[] {
  if (!file) return [];
  const sources = pmtilesFormatForFile(file)?.sources ?? [];
  return [...sources].sort((left, right) => compareVersionValues(left.version ?? "1", right.version ?? "1"));
}

function uniqueSourceVersions(sources: DatasetSource[]): string[] {
  const versions = new Set<string>();
  for (const source of sources) {
    versions.add(String(source.version ?? "1"));
  }
  return [...versions].sort(compareVersionValues);
}

function sourceLabel(source: DatasetSource): string {
  const locationLabel = source.storage_location?.name ?? `Location ${source.storage_location?.id ?? source.id}`;
  return `${locationLabel} · source ${source.id}`;
}

interface DatasetSearchComboboxProps {
  datasets: DatasetWithUrls[];
  query: string;
  selectedDataset: DatasetWithUrls | null;
  isLoading: boolean;
  error: string | null;
  currentDescriptors: SourceDescriptor[];
  collectionSlug: string;
  onQueryChange: (query: string) => void;
  onSelectDataset: (dataset: DatasetWithUrls) => void;
}

function DatasetSearchCombobox({
  datasets,
  query,
  selectedDataset,
  isLoading,
  error,
  currentDescriptors,
  collectionSlug,
  onQueryChange,
  onSelectDataset,
}: DatasetSearchComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto min-h-9 w-full min-w-0 justify-between"
        >
          <span className={`min-w-0 truncate ${selectedDataset ? "" : "text-muted-foreground"}`}>
            {selectedDataset?.name ?? "Search datasets..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] min-w-0 p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={onQueryChange} placeholder="Search datasets..." />
          <CommandList>
            {isLoading ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Searching datasets...</div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-sm text-destructive">Dataset search failed.</div>
            ) : (
              <>
                <CommandEmpty>No matching datasets found.</CommandEmpty>
                <CommandGroup>
                  {datasets.map((dataset) => {
                    const isSelected = selectedDataset?.id === dataset.id;
                    const isLoaded = datasetHasLoadedLayer(collectionSlug, dataset, currentDescriptors);
                    return (
                      <CommandItem
                        key={dataset.id}
                        value={String(dataset.id)}
                        onSelect={() => {
                          onSelectDataset(dataset);
                          setOpen(false);
                        }}
                        className="items-start"
                      >
                        <Check className={`mt-0.5 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{dataset.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {dataset.files?.length ? `${dataset.files.length} files` : dataset.slug}
                          </div>
                        </div>
                        {isLoaded && <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">Loaded</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface StyleLayerCardProps {
  layer: VectorLayerInfo;
  loadedLayer: LoadedMapLayer | null;
  style: LayerStyle | null;
  breaks: number[];
  colors: string[];
  getSampledBreaks: (layer: VectorLayerInfo, property: string) => number[];
  colorSectionOpen: boolean;
  setColorSectionOpen: (open: boolean) => void;
  sizeSectionOpen: boolean;
  setSizeSectionOpen: (open: boolean) => void;
  onStyleChange: (style: LayerStyle) => void;
}

function StyleLayerCard({
  layer,
  loadedLayer,
  style,
  breaks,
  colors,
  getSampledBreaks,
  colorSectionOpen,
  setColorSectionOpen,
  sizeSectionOpen,
  setSizeSectionOpen,
  onStyleChange,
}: StyleLayerCardProps) {
  const title = loadedLayer?.name ?? "Style layer";
  const subtitle = loadedLayer?.storageLocationName ?? null;

  return (
    <Collapsible>
      <Card className="w-full max-w-full min-w-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex w-full max-w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{title}</div>
              {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="min-w-0 pt-0">
            <LayerStylingEditor
              activeLayer={layer}
              activeStyle={style}
              activeBreaks={breaks}
              activeColors={colors}
              getSampledBreaks={getSampledBreaks}
              colorSectionOpen={colorSectionOpen}
              setColorSectionOpen={setColorSectionOpen}
              sizeSectionOpen={sizeSectionOpen}
              setSizeSectionOpen={setSizeSectionOpen}
              embedded
              showTitle={false}
              onStyleChange={onStyleChange}
            />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The workspace coordinates map state, source selection, and styling controls.
export function MapWorkspace({ collection, initialLayers, initialLayerKey }: MapWorkspaceProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const pinnedPopupElementRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<PanelImperativeHandle | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const datasetDetailsRequestIdRef = useRef(0);
  const initialLayerKeyRef = useRef(initialLayerKey);
  const selectedDescriptorIdRef = useRef<string | null>(null);
  const [vectorLayers, setVectorLayers] = useState<VectorLayerInfo[]>([]);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [pinnedPopupInfo, setPinnedPopupInfo] = useState<HoverInfo | null>(null);
  const [layerStyles, setLayerStyles] = useState<LayerStylesById>({});
  const [colorSectionOpen, setColorSectionOpen] = useState(true);
  const [sizeSectionOpen, setSizeSectionOpen] = useState(true);
  const [legendVisible, setLegendVisible] = useState(true);
  const [isSettingsCollapsed, setIsSettingsCollapsed] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("street");
  const [searchDraft, setSearchDraft] = useState("");
  const [datasetResults, setDatasetResults] = useState<DatasetWithUrls[]>([]);
  const [isDatasetSearchLoading, setIsDatasetSearchLoading] = useState(false);
  const [datasetSearchError, setDatasetSearchError] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<DatasetWithUrls | null>(null);
  const [isResolvingSelectedDataset, setIsResolvingSelectedDataset] = useState(false);
  const [selectedFileSlug, setSelectedFileSlug] = useState<string | undefined>(undefined);
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(undefined);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(undefined);
  const [addingLayerDescriptorId, setAddingLayerDescriptorId] = useState<string | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<SelectedMapFeature[]>([]);
  const [wasSelectionCapped, setWasSelectionCapped] = useState(false);
  const [s2Level, setS2Level] = useState(16);
  const [loadedLayers, setLoadedLayers] = useState<LoadedMapLayer[]>(() =>
    initialLayers.map(resolvedToMapLayer).filter((entry): entry is LoadedMapLayer => entry !== null),
  );
  const isMobileMapLayout = useIsMobileMapLayout();
  const currentDescriptors = loadedLayers.map((layer) => layer.descriptor);

  useEffect(() => {
    if (!initialLayerKey || initialLayerKeyRef.current === initialLayerKey) return;
    initialLayerKeyRef.current = initialLayerKey;
    setLoadedLayers(initialLayers.map(resolvedToMapLayer).filter((entry): entry is LoadedMapLayer => entry !== null));
  }, [initialLayerKey, initialLayers]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    searchTimeoutRef.current = setTimeout(() => {
      setIsDatasetSearchLoading(true);
      setDatasetSearchError(null);
      void searchDatasetsForMapImport({
        collectionSlug: collection.slug,
        query: searchDraft,
      })
        .then((response) => {
          if (searchRequestIdRef.current !== requestId) return;
          setDatasetResults(response.items);
        })
        .catch((error: Error) => {
          if (searchRequestIdRef.current !== requestId) return;
          setDatasetResults([]);
          setDatasetSearchError(error.message);
        })
        .finally(() => {
          if (searchRequestIdRef.current !== requestId) return;
          setIsDatasetSearchLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [collection.slug, searchDraft]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Shift" || event.repeat) return;
      setIsSelectionActive(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      setIsSelectionActive(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleFeatureSelection = useCallback(
    (features: maplibregl.MapGeoJSONFeature[], mode: FeatureSelectionMode) => {
      const incoming = normalizeSelectedFeatures({ features, loadedLayers });
      setSelectedFeatures((current) => {
        const update = updateSelectedFeatures({ current, incoming, mode });
        setWasSelectionCapped(update.wasCapped);
        return update.rows;
      });
    },
    [loadedLayers],
  );

  const { mapRef, setHoverFeature, clearHoverFeature, clearSelectionBox } = useMultiLayerMapInitialization(
    mapContainerRef,
    loadedLayers,
    setVectorLayers,
    setHoverInfo,
    setPinnedPopupInfo,
    handleFeatureSelection,
    isSelectionActive,
    basemapMode,
    pinnedPopupInfo?.lngLat ?? null,
    pinnedPopupElementRef,
  );

  useLayerStyling(mapRef, vectorLayers, layerStyles, setLayerStyles);

  const getSampledBreaks = useCallback(
    (layer: VectorLayerInfo, property: string) => sampledBreakValues(mapRef.current, layer, property),
    [mapRef],
  );

  const clearSelectedFeatures = useCallback(() => {
    clearSelectionBox();
    setSelectedFeatures([]);
    setWasSelectionCapped(false);
  }, [clearSelectionBox]);

  useEffect(() => {
    const updates = computeMissingBreakUpdates(mapRef.current, vectorLayers, layerStyles);
    if (Object.keys(updates).length === 0) return;
    setLayerStyles((prev) => ({
      ...prev,
      ...updates,
    }));
  }, [layerStyles, vectorLayers, mapRef]);

  useEffect(() => {
    const activeInfo = pinnedPopupInfo ?? hoverInfo;
    const feature = activeInfo?.features[activeInfo.selectedIndex] ?? null;
    if (!feature) {
      clearHoverFeature();
      return;
    }
    setHoverFeature(feature);
  }, [hoverInfo, pinnedPopupInfo, setHoverFeature, clearHoverFeature]);

  useEffect(() => {
    const activeLayerIds = new Set(loadedLayers.map((layer) => layer.id));
    setSelectedFeatures((current) => current.filter((feature) => activeLayerIds.has(feature.loadedLayerId)));
  }, [loadedLayers]);

  useEffect(() => {
    mapRef.current?.resize();
  });

  useEffect(() => {
    if (!isMobileMapLayout) {
      setIsMobileSettingsOpen(false);
    }
  }, [isMobileMapLayout]);

  const activePopupInfo = pinnedPopupInfo ?? hoverInfo;
  const propertyEntries = popupProperties(activePopupInfo);
  const activePopupSelectedFeature = useMemo(
    () => selectedMapFeatureFromHoverInfo(activePopupInfo, loadedLayers),
    [activePopupInfo, loadedLayers],
  );
  const highlightedFeatureId = useMemo(
    () => selectedFeatureIdFromHoverInfo(hoverInfo, loadedLayers),
    [hoverInfo, loadedLayers],
  );
  const zoomToSelectedFeature = useCallback(
    (feature: SelectedMapFeature) => {
      if (!feature.centroid) return;
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        center: [feature.centroid.lng, feature.centroid.lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 500,
      });
    },
    [mapRef],
  );
  const legendGroups = useMemo(
    () =>
      vectorLayers.flatMap((layer) => {
        const style = layerStyles[layer.id];
        if (!style) return [];
        const breaks = parseBreaks(style.breaksText);
        if (style.colorProperty && breaks.length === 0) {
          return [];
        }
        const colors = getColorRamp(style.colorScheme, breaks.length + 1);
        const loadedLayer = loadedLayers.find((entry) => entry.id === layer.loadedLayerId);
        return [
          {
            id: layer.id,
            title: loadedLayer?.name ?? layer.sourceLayerId ?? layer.id,
            field: style.colorProperty ?? undefined,
            items: getLegendItems(breaks, colors),
          },
        ];
      }),
    [layerStyles, loadedLayers, vectorLayers],
  );
  const legendTitle = legendGroups.length === 1 ? legendGroups[0]?.field : undefined;
  const headerLayer = loadedLayers.length === 1 ? loadedLayers[0] : null;
  const headerPrimary =
    headerLayer?.datasetName ?? (loadedLayers.length > 1 ? `${loadedLayers.length} map layers` : collection.name);
  const headerSecondary = headerLayer?.descriptor.fileSlug ?? (loadedLayers.length > 1 ? collection.name : null);

  const selectableFiles = selectedDataset ? selectablePmtilesFiles(selectedDataset) : [];
  const selectedFile = selectableFiles.find((file) => file.slug === selectedFileSlug) ?? selectableFiles[0] ?? null;
  const sourceOptions = sortedSourcesForFile(selectedFile);
  const versionOptions = uniqueSourceVersions(sourceOptions);
  const resolvedVersion =
    selectedVersion && versionOptions.includes(selectedVersion) ? selectedVersion : (versionOptions[0] ?? "");
  const versionSourceOptions = sourceOptions.filter((source) => String(source.version ?? "1") === resolvedVersion);
  const selectedSource =
    versionSourceOptions.find((source) => String(source.id) === selectedSourceId) ?? versionSourceOptions[0] ?? null;
  const selectedDescriptor =
    selectedDataset && selectedFile && selectedSource
      ? descriptorForSource({
          collectionSlug: collection.slug,
          datasetSlug: selectedDataset.slug,
          fileSlug: selectedFile.slug,
          formatType: "pmtiles",
          source: selectedSource,
        })
      : null;
  const selectedDescriptorAlreadyLoaded = selectedDescriptor
    ? currentDescriptors.some((descriptor) => sourceDescriptorId(descriptor) === sourceDescriptorId(selectedDescriptor))
    : false;
  const selectedDescriptorId = selectedDescriptor ? sourceDescriptorId(selectedDescriptor) : null;
  const isAddingSelectedLayer = selectedDescriptorId !== null && addingLayerDescriptorId === selectedDescriptorId;

  useEffect(() => {
    selectedDescriptorIdRef.current = selectedDescriptorId;
  }, [selectedDescriptorId]);

  const selectDataset = (dataset: DatasetWithUrls) => {
    const requestId = datasetDetailsRequestIdRef.current + 1;
    datasetDetailsRequestIdRef.current = requestId;
    setIsResolvingSelectedDataset(true);
    setSelectedDataset(dataset);
    setSelectedFileSlug(undefined);
    setSelectedVersion(undefined);
    setSelectedSourceId(undefined);
    void getDatasetBySlug({
      data: {
        collectionSlug: collection.slug,
        datasetSlug: dataset.slug,
        includeUrls: true,
      },
    })
      .then((resolvedDataset) => {
        if (datasetDetailsRequestIdRef.current !== requestId) return;
        setSelectedDataset(resolvedDataset ?? dataset);
      })
      .catch(() => {
        if (datasetDetailsRequestIdRef.current !== requestId) return;
        setSelectedDataset(dataset);
      })
      .finally(() => {
        if (datasetDetailsRequestIdRef.current !== requestId) return;
        setIsResolvingSelectedDataset(false);
      });
  };

  const selectFile = (fileSlug: string) => {
    setSelectedFileSlug(fileSlug);
    setSelectedVersion(undefined);
    setSelectedSourceId(undefined);
  };

  const selectVersion = (version: string) => {
    setSelectedVersion(version);
    setSelectedSourceId(undefined);
  };

  const applyLayerPickerSelection = ({
    selectedDataset,
    selectedFileSlug,
    selectedVersion,
    selectedSourceId,
  }: {
    selectedDataset: DatasetWithUrls | null;
    selectedFileSlug: string | undefined;
    selectedVersion: string | undefined;
    selectedSourceId: string | undefined;
  }) => {
    setSelectedDataset(selectedDataset);
    setSelectedFileSlug(selectedFileSlug);
    setSelectedVersion(selectedVersion);
    setSelectedSourceId(selectedSourceId);
  };

  const addSelectedLayer = async () => {
    if (!selectedDescriptor || !selectedDescriptorId || selectedDescriptorAlreadyLoaded || isAddingSelectedLayer)
      return;
    const descriptorToAdd = selectedDescriptor;
    const descriptorToAddId = selectedDescriptorId;
    setAddingLayerDescriptorId(descriptorToAddId);
    try {
      const resolved = await resolveDescriptor(descriptorToAdd);
      const layer = resolved ? resolvedToMapLayer(resolved) : null;
      if (!layer) return;
      if (selectedDescriptorIdRef.current !== descriptorToAddId) return;
      setLoadedLayers((prev) => {
        if (prev.some((entry) => entry.id === descriptorToAddId)) {
          return prev;
        }
        return [...prev, layer];
      });
      applyLayerPickerSelection(clearedLayerPickerSelection());
    } finally {
      setAddingLayerDescriptorId((current) => (current === descriptorToAddId ? null : current));
    }
  };

  const removeLoadedLayer = (layer: LoadedMapLayer) => {
    setLoadedLayers((prev) => prev.filter((entry) => entry.id !== layer.id));
    applyLayerPickerSelection(
      layerPickerSelectionAfterLayerRemoval({
        selection: {
          selectedDataset,
          selectedFileSlug,
          selectedVersion,
          selectedSourceId,
        },
        removedLayerDescriptor: layer.descriptor,
      }),
    );
  };

  const toggleSettingsPanel = () => {
    if (!settingsPanelRef.current) return;
    if (settingsPanelRef.current.isCollapsed()) {
      settingsPanelRef.current.expand();
      return;
    }
    settingsPanelRef.current.collapse();
  };

  const settingsPanelContent = (
    <div className="box-border w-full max-w-full min-w-0 overflow-hidden p-3 sm:p-4">
      <Card className="w-full max-w-full min-w-0">
        <CardHeader className="px-4 pb-3 sm:px-6">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <Layers className="h-4 w-4" />
            Layers
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5 px-4 sm:px-6">
          <div className="min-w-0 space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dataset</div>
            <DatasetSearchCombobox
              datasets={datasetResults}
              query={searchDraft}
              selectedDataset={selectedDataset}
              isLoading={isDatasetSearchLoading}
              error={datasetSearchError}
              currentDescriptors={currentDescriptors}
              collectionSlug={collection.slug}
              onQueryChange={setSearchDraft}
              onSelectDataset={selectDataset}
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Loaded</div>
            {loadedLayers.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Add a dataset from the list below to plot its PMTiles layer.
              </div>
            ) : (
              loadedLayers.map((layer) => {
                const layerVectorLayers = vectorLayers.filter((entry) => entry.loadedLayerId === layer.id);
                return (
                  <LoadedLayerItem
                    key={layer.id}
                    layer={layer}
                    vectorLayerCount={layerVectorLayers.length}
                    onVisibleChange={(visible) =>
                      setLoadedLayers((prev) =>
                        prev.map((entry) => (entry.id === layer.id ? { ...entry, visible } : entry)),
                      )
                    }
                    onRemove={() => removeLoadedLayer(layer)}
                  />
                );
              })
            )}
          </div>

          {selectedDataset && (
            <div className="box-border w-full max-w-full min-w-0 space-y-3 overflow-hidden rounded-md border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{selectedDataset.name}</div>
                <div className="text-xs text-muted-foreground">
                  {isResolvingSelectedDataset
                    ? "Loading available sources..."
                    : "Choose a PMTiles layer source to plot."}
                </div>
              </div>
              {selectableFiles.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  This dataset does not have a PMTiles source available for the map.
                </div>
              ) : (
                <div className="min-w-0 space-y-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">File</div>
                    <Select value={selectedFile?.slug ?? ""} onValueChange={selectFile}>
                      <SelectTrigger className="max-w-full">
                        <SelectValue placeholder="Select file" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableFiles.map((file) => (
                          <SelectItem key={file.slug} value={file.slug}>
                            {file.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Version</div>
                    <Select value={resolvedVersion} onValueChange={selectVersion}>
                      <SelectTrigger className="max-w-full">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versionOptions.map((version) => (
                          <SelectItem key={version} value={version}>
                            {formatVersionLabel(version)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Source</div>
                    <Select value={selectedSource ? String(selectedSource.id) : ""} onValueChange={setSelectedSourceId}>
                      <SelectTrigger className="max-w-full">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        {versionSourceOptions.map((source) => (
                          <SelectItem key={source.id} value={String(source.id)}>
                            {sourceLabel(source)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={!selectedDescriptor || selectedDescriptorAlreadyLoaded || isAddingSelectedLayer}
                    onClick={addSelectedLayer}
                  >
                    <Plus className="h-4 w-4" />
                    {isAddingSelectedLayer
                      ? "Adding layer"
                      : selectedDescriptorAlreadyLoaded
                        ? "Layer loaded"
                        : "Add layer"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 min-w-0 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Style layers</div>
        {vectorLayers.length === 0 ? (
          <Card className="w-full min-w-0 border-dashed">
            <CardContent className="p-3 text-sm text-muted-foreground">
              Add a PMTiles layer to edit styling.
            </CardContent>
          </Card>
        ) : (
          vectorLayers.map((layer) => {
            const style = layerStyles[layer.id] ?? null;
            const breaks = style ? parseBreaks(style.breaksText) : [];
            const colors = style ? getColorRamp(style.colorScheme, breaks.length + 1) : [];
            const loadedLayer = loadedLayers.find((entry) => entry.id === layer.loadedLayerId) ?? null;
            return (
              <StyleLayerCard
                key={layer.id}
                layer={layer}
                loadedLayer={loadedLayer}
                style={style}
                breaks={breaks}
                colors={colors}
                getSampledBreaks={getSampledBreaks}
                colorSectionOpen={colorSectionOpen}
                setColorSectionOpen={setColorSectionOpen}
                sizeSectionOpen={sizeSectionOpen}
                setSizeSectionOpen={setSizeSectionOpen}
                onStyleChange={(nextStyle) => {
                  setLayerStyles((prev) => ({
                    ...prev,
                    [layer.id]: nextStyle,
                  }));
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );

  const mapWorkspaceContent = (
    <ResizablePanelGroup orientation="vertical" className="min-h-0">
      <ResizablePanel
        defaultSize={selectedFeatures.length > 0 ? (isMobileMapLayout ? "38%" : "68%") : "100%"}
        minSize={isMobileMapLayout ? "24%" : "40%"}
        className="min-h-0 overflow-hidden"
        onResize={() => mapRef.current?.resize()}
      >
        <div className="relative h-full w-full">
          <div ref={mapContainerRef} className="h-full w-full" />
          <MapControls
            mapRef={mapRef as React.RefObject<maplibregl.Map | null>}
            isSelectionActive={isSelectionActive}
            onToggleSelection={() => setIsSelectionActive((active) => !active)}
            onClearSelection={selectedFeatures.length > 0 ? clearSelectedFeatures : undefined}
            basemapMode={basemapMode}
            onToggleBasemap={() => setBasemapMode((current) => (current === "satellite" ? "street" : "satellite"))}
          />
          {activePopupInfo && activePopupInfo.features.length > 0 && (
            <FeatureHoverPopup
              popupRef={activePopupInfo.isPinned ? pinnedPopupElementRef : undefined}
              hoverInfo={activePopupInfo}
              selectedIndex={activePopupInfo.selectedIndex}
              propertyEntries={propertyEntries}
              selectedMapFeature={activePopupSelectedFeature}
              onIndexChange={(index) => {
                if (activePopupInfo.isPinned) {
                  setPinnedPopupInfo((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
                  return;
                }
                setHoverInfo((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
              }}
              onClose={() => setPinnedPopupInfo(null)}
            />
          )}
          {legendGroups.length > 0 && (
            <MapLegend
              title={legendTitle}
              groups={legendGroups}
              visible={legendVisible}
              onToggle={() => setLegendVisible(!legendVisible)}
            />
          )}
        </div>
      </ResizablePanel>
      {selectedFeatures.length > 0 && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={isMobileMapLayout ? "62%" : "32%"}
            minSize={isMobileMapLayout ? "42%" : "18%"}
            className="min-h-0 overflow-hidden"
            onResize={() => mapRef.current?.resize()}
          >
            <FeatureTablePanel
              features={selectedFeatures}
              highlightedFeatureId={highlightedFeatureId}
              wasSelectionCapped={wasSelectionCapped}
              s2Level={s2Level}
              onS2LevelChange={setS2Level}
              onFeatureClick={zoomToSelectedFeature}
              onClear={() => {
                clearSelectedFeatures();
              }}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            {headerLayer ? (
              <Link
                to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
                params={{
                  collectionSlug: headerLayer.descriptor.collectionSlug,
                  datasetSlug: headerLayer.descriptor.datasetSlug,
                  fileSlug: headerLayer.descriptor.fileSlug,
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            ) : (
              <Link to="/collections/$slug" params={{ slug: collection.slug }}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            )}
          </Button>
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-muted-foreground/30" />
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-base font-medium text-muted-foreground">{headerPrimary}</span>
            {headerSecondary && (
              <>
                <span className="shrink-0 text-base text-muted-foreground">/</span>
                <span className="truncate text-base font-medium">{headerSecondary}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileSettingsOpen(true)}
            title="Show settings"
            className={isMobileSettingsOpen ? "hidden" : "md:hidden"}
          >
            <PanelLeft className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSettingsPanel}
            title={isSettingsCollapsed ? "Show settings" : "Hide settings"}
            className="hidden md:inline-flex"
          >
            <PanelLeft className="mr-2 h-4 w-4" />
            {isSettingsCollapsed ? "Settings" : "Hide"}
          </Button>
        </div>
      </div>

      <Sheet open={isMobileSettingsOpen} onOpenChange={setIsMobileSettingsOpen}>
        <SheetContent
          side="left"
          className="box-border w-[90vw] max-w-[90vw] min-w-0 gap-0 overflow-hidden p-0 sm:max-w-[90vw] md:hidden"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" />
              Settings
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">{settingsPanelContent}</ScrollArea>
        </SheetContent>
      </Sheet>

      {isMobileMapLayout ? (
        <div className="min-h-0 flex-1">{mapWorkspaceContent}</div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            defaultSize="28%"
            minSize="22%"
            maxSize="42%"
            collapsible
            collapsedSize="0%"
            panelRef={settingsPanelRef}
            onResize={(panelSize) => setIsSettingsCollapsed(panelSize.asPercentage === 0)}
            className="min-w-0 overflow-hidden"
          >
            <ScrollArea className="h-full">{settingsPanelContent}</ScrollArea>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="72%"
            minSize="58%"
            className="min-w-0 overflow-hidden"
            onResize={() => mapRef.current?.resize()}
          >
            {mapWorkspaceContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
