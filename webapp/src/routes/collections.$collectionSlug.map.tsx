import { isQueryMvtReservedProperty } from "@hifld/map-core";
import { createFileRoute, Link, notFound, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Check, ChevronDown, ChevronsUpDown, Layers, PanelLeft, Plus } from "lucide-react";
import type maplibregl from "maplibre-gl";
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { MapDataPanelModeControls } from "@/components/map/MapDataPanelModeControls";
import { MapLayerListItem } from "@/components/map/MapLayerListItem";
import { initialMapDataPanelState, reduceMapDataPanelState } from "@/components/map/mapDataPanelState";
import { type DatasetLayerInput, MapWorkspaceCommandError } from "@/components/map/mapWorkspaceCommands";
import { clearedLayerPickerSelection, layerPickerSelectionAfterLayerRemoval } from "@/components/map/mapWorkspaceState";
import { buildLoadedMapLayer, type LoadedMapLayer } from "@/components/map/multiLayerSources";
import { QueryResultPanel } from "@/components/map/QueryResultPanel";
import {
  appendQueryPage,
  canSetQueryResultPage,
  publicQueryPage,
  type QueryResultState,
  queryLayerFromResult,
  queryResultState,
} from "@/components/map/queryResults";
import {
  decodeSourceDescriptor,
  decodeSourceDescriptorList,
  descriptorForSource,
  findPmtilesSourceForCatalogSource,
  findSourceForDescriptor,
  type SourceDescriptor,
  sourceDescriptorId,
} from "@/components/map/sourceDescriptors";
import { useMapWorkspaceCommands } from "@/components/map/useMapWorkspaceCommands";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PageLoader } from "@/components/ui/page-loader";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FeatureHoverPopup } from "@/components/viewer/FeatureHoverPopup";
import { LayerStylingEditor } from "@/components/viewer/LayerStylingEditor";
import { colorMode, resolveLayerColor } from "@/components/viewer/layerColorStyle";
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
  getSampledValues,
  parseBreaks,
} from "@/components/viewer/utils";
import { WebMcpRuntimeConfigContext } from "@/components/WebMcpProvider";
import { type DatasetMapImportInput, trackDatasetImportedIntoMap } from "@/lib/analytics";
import type {
  Collection,
  Dataset,
  DatasetFile,
  DatasetFileResponse,
  DatasetSource,
  DatasetWithUrls,
  PaginatedResponse,
} from "@/lib/api-client";
import {
  getCollectionBySlug,
  getCollectionDatasetsBySlug,
  getDatasetBySlug,
  getDatasetFileBySlug,
} from "@/lib/api-client";
import { createQuery, getQueryBounds, getQueryPage, QueryApiError, type QueryRequest } from "@/lib/query-api";
import { type MapCatalogLayerInput, useMapWebMcpTools } from "@/lib/webmcp/mapTools";
import { type PublicToolQueryPage, type QueryMapPresentation, useQueryWebMcpTools } from "@/lib/webmcp/queryTools";

type MapSearch = {
  source?: string;
  sources?: string;
};

const MAP_DATASET_PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 500;
const MOBILE_SETTINGS_MEDIA_QUERY = "(max-width: 767.98px)";
export const MAP_CANVAS_DESKTOP_DEFAULT_SIZE = "70%";
export const MAP_SELECTED_FEATURES_DESKTOP_DEFAULT_SIZE = "30%";
export const DATASET_SEARCH_PANEL_CLASSNAME =
  "absolute top-full right-0 left-0 z-30 mt-2 min-w-0 rounded-md border bg-popover p-0 text-popover-foreground shadow-md";
export const DATASET_SEARCH_LIST_CLASSNAME =
  "max-h-[min(18rem,calc(100dvh-14rem))] touch-pan-y overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]";
export const MOBILE_SETTINGS_SCROLL_CLASSNAME =
  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [-webkit-overflow-scrolling:touch]";
export const IMPORT_LAYER_CARD_CLASSNAME =
  "box-border w-full max-w-full min-w-0 space-y-3 overflow-hidden rounded-md border p-3 [contain:inline-size]";
export const IMPORT_SELECT_TRIGGER_CLASSNAME = "w-full max-w-full min-w-0 overflow-hidden";
export const IMPORT_SELECT_VALUE_CLASSNAME = "min-w-0 flex-1 truncate text-left";

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
    if (colorMode(layer, style) === "categorical") continue;
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

export async function searchDatasetsForMapImport({
  collectionSlug,
  query,
}: {
  collectionSlug: string;
  query: string;
}): Promise<PaginatedResponse<DatasetWithUrls>> {
  return getCollectionDatasetsBySlug({
    data: {
      collectionSlug,
      search: query.trim(),
      limit: MAP_DATASET_PAGE_SIZE,
      offset: 0,
    },
  });
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

export function popupProperties(
  hoverInfo: HoverInfo | null,
  loadedLayers: readonly LoadedMapLayer[],
): PopupPropertyEntry[] {
  const selectedFeature = hoverInfo?.features?.[hoverInfo.selectedIndex ?? 0] ?? null;
  const mapSourceId = typeof selectedFeature?.source === "string" ? selectedFeature.source : "";
  const isQueryMvt = loadedLayers.some((layer) => layer.mapSourceId === mapSourceId && layer.kind === "query_mvt");
  return Object.entries(selectedFeature?.properties ?? {})
    .filter(([key]) => !isQueryMvt || !isQueryMvtReservedProperty(key))
    .map(([key, value]) => [key, String(value)] satisfies PopupPropertyEntry)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function closeMapPopup({
  setPinnedPopupInfo,
  setHoverInfo,
  clearHoverFeature,
}: {
  setPinnedPopupInfo: (value: HoverInfo | null) => void;
  setHoverInfo: (value: HoverInfo | null) => void;
  clearHoverFeature: () => void;
}) {
  setPinnedPopupInfo(null);
  setHoverInfo(null);
  clearHoverFeature();
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
  const isPmtilesSource = entry.file.formats?.some(
    (formatEntry) =>
      formatEntry.format.format_type === "pmtiles" &&
      formatEntry.sources.some(
        (source) =>
          source.asset_key === entry.source.asset_key &&
          String(source.version ?? "1") === String(entry.source.version ?? "1") &&
          source.storage_location?.slug === entry.source.storage_location?.slug,
      ),
  );
  if (!isPmtilesSource) return null;
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

export function sourceDescriptorFromLayerId(layerId: string): SourceDescriptor | null {
  const values = layerId.split(":");
  if (values.length !== 6) return null;
  const [collectionSlug, datasetSlug, fileSlug, version, assetKey, storageLocationSlug] = values;
  if (!collectionSlug || !datasetSlug || !fileSlug || !version || !assetKey || !storageLocationSlug) return null;
  return {
    collectionSlug,
    datasetSlug,
    fileSlug,
    version,
    assetKey,
    ...(storageLocationSlug === "default" ? {} : { storageLocationSlug }),
  };
}

async function verifiedCatalogCollection(input: MapCatalogLayerInput, current: Collection): Promise<Collection> {
  const resolved =
    input.collection_slug === (current.collection_slug ?? current.slug)
      ? current
      : await getCollectionBySlug({ data: { slug: input.collection_slug } });
  if (!resolved || (resolved.collection_slug ?? resolved.slug) !== input.collection_slug) {
    throw new MapWorkspaceCommandError("The requested catalog collection could not be verified.");
  }
  return resolved;
}

function verifiedCatalogSource(input: MapCatalogLayerInput, response: DatasetFileResponse): DatasetSource {
  if (
    (response.dataset.dataset_slug ?? response.dataset.slug) !== input.dataset_slug ||
    (response.file.file_slug ?? response.file.slug) !== input.file_slug
  ) {
    throw new MapWorkspaceCommandError("The requested catalog file could not be verified.");
  }
  const requested = response.file.formats
    ?.flatMap((entry) => entry.sources)
    .find(
      (source) =>
        source.asset_key === input.asset_key &&
        String(source.version) === input.version &&
        (input.storage_location_slug === undefined || source.storage_location?.slug === input.storage_location_slug),
    );
  const source = requested ? findPmtilesSourceForCatalogSource(response.file, requested) : null;
  if (!source) throw new MapWorkspaceCommandError("A matching PMTiles source is not available.");
  return source;
}

async function catalogMapLayer(input: MapCatalogLayerInput, currentCollection: Collection): Promise<LoadedMapLayer> {
  const collection = await verifiedCatalogCollection(input, currentCollection);
  const response = await getDatasetFileBySlug({
    data: {
      collectionSlug: input.collection_slug,
      datasetSlug: input.dataset_slug,
      fileSlug: input.file_slug,
    },
  });
  if (!response) throw new MapWorkspaceCommandError("The requested catalog file could not be verified.");
  const source = verifiedCatalogSource(input, response);
  const descriptor = descriptorForSource({
    collectionSlug: collection.collection_slug ?? collection.slug,
    datasetSlug: response.dataset.dataset_slug ?? response.dataset.slug,
    fileSlug: response.file.file_slug ?? response.file.slug,
    source,
  });
  if (!descriptor) throw new MapWorkspaceCommandError("The requested PMTiles source could not be verified.");
  const layer = resolvedToMapLayer({ descriptor, dataset: response.dataset, file: response.file, source });
  if (!layer) throw new MapWorkspaceCommandError("The requested PMTiles layer could not be prepared.");
  return layer;
}

export interface MapImportEvent {
  sourceDescriptorId: string;
  properties: DatasetMapImportInput;
}

export function newMapImportEvents({
  loadedLayers,
  routeSourceDescriptorIds,
  trackedSourceDescriptorIds,
}: {
  loadedLayers: LoadedMapLayer[];
  routeSourceDescriptorIds: ReadonlySet<string>;
  trackedSourceDescriptorIds: ReadonlySet<string>;
}): MapImportEvent[] {
  const seenSourceDescriptorIds = new Set(trackedSourceDescriptorIds);

  return loadedLayers.flatMap((layer) => {
    if (layer.kind !== "catalog_pmtiles") return [];
    const descriptorId = sourceDescriptorId(layer.descriptor);
    if (seenSourceDescriptorIds.has(descriptorId)) return [];
    seenSourceDescriptorIds.add(descriptorId);
    return [
      {
        sourceDescriptorId: descriptorId,
        properties: {
          collection_slug: layer.descriptor.collectionSlug,
          dataset_slug: layer.descriptor.datasetSlug,
          file_slug: layer.descriptor.fileSlug,
          version: layer.descriptor.version,
          import_source: routeSourceDescriptorIds.has(descriptorId) ? "route" : "picker",
          loaded_layer_count: loadedLayers.length,
        },
      },
    ];
  });
}

function mapLayersFromResolvedDescriptors(entries: ResolvedDescriptor[]): LoadedMapLayer[] {
  return entries.map(resolvedToMapLayer).filter((entry): entry is LoadedMapLayer => entry !== null);
}

function publicSelectedProperties(properties: SelectedMapFeature["properties"]): SelectedMapFeature["properties"] {
  const publicProperties: SelectedMapFeature["properties"] = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value.startsWith("gs://") || value.startsWith("s3://")) continue;
    publicProperties[key] = value;
  }
  return publicProperties;
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

export function DatasetSearchCombobox({
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
    <div className="relative min-w-0">
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="h-auto min-h-9 w-full min-w-0 justify-between"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`min-w-0 truncate ${selectedDataset ? "" : "text-muted-foreground"}`}>
          {selectedDataset?.name ?? "Search datasets..."}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open ? (
        <div className={DATASET_SEARCH_PANEL_CLASSNAME}>
          <Command className="h-auto overflow-visible" shouldFilter={false}>
            <CommandInput value={query} onValueChange={onQueryChange} placeholder="Search datasets..." />
            <CommandList className={DATASET_SEARCH_LIST_CLASSNAME}>
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
        </div>
      ) : null}
    </div>
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
          <CardContent className="min-w-0 px-3 pt-0">
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
  const runtimeConfig = useContext(WebMcpRuntimeConfigContext);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const pinnedPopupElementRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<PanelImperativeHandle | null>(null);
  const dataPanelRef = useRef<PanelImperativeHandle | null>(null);
  const dataPanelOpenRef = useRef(false);
  const dataPanelHasOpenedRef = useRef(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const datasetDetailsRequestIdRef = useRef(0);
  const initialLayerKeyRef = useRef(initialLayerKey);
  const routeSourceDescriptorIdsRef = useRef(
    new Set(
      mapLayersFromResolvedDescriptors(initialLayers)
        .filter(
          (layer): layer is Extract<LoadedMapLayer, { kind: "catalog_pmtiles" }> => layer.kind === "catalog_pmtiles",
        )
        .map((layer) => sourceDescriptorId(layer.descriptor)),
    ),
  );
  const trackedSourceDescriptorIdsRef = useRef(new Set<string>());
  const selectedDescriptorIdRef = useRef<string | null>(null);
  const queryTokensRef = useRef(new Map<string, string>());
  const queryLayerLabelCounterRef = useRef(0);
  const preparedCatalogLayersRef = useRef(new Map<string, LoadedMapLayer>());
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
  const [queryResult, setQueryResult] = useState<QueryResultState | null>(null);
  const [dataPanelState, dispatchDataPanel] = useReducer(reduceMapDataPanelState, initialMapDataPanelState);
  const [isLoadingQueryPage, setIsLoadingQueryPage] = useState(false);
  const [s2Level, setS2Level] = useState(16);
  const [loadedLayers, setLoadedLayers] = useState<LoadedMapLayer[]>(() =>
    mapLayersFromResolvedDescriptors(initialLayers),
  );
  const isMobileMapLayout = useIsMobileMapLayout();
  const currentDescriptors = loadedLayers.flatMap((layer) =>
    layer.kind === "catalog_pmtiles" ? [layer.descriptor] : [],
  );

  useEffect(() => {
    return () => {
      queryTokensRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!initialLayerKey || initialLayerKeyRef.current === initialLayerKey) return;
    initialLayerKeyRef.current = initialLayerKey;
    const nextLayers = mapLayersFromResolvedDescriptors(initialLayers);
    for (const layer of nextLayers) {
      if (layer.kind === "catalog_pmtiles") {
        routeSourceDescriptorIdsRef.current.add(sourceDescriptorId(layer.descriptor));
      }
    }
    setLoadedLayers(nextLayers);
  }, [initialLayerKey, initialLayers]);

  useEffect(() => {
    const events = newMapImportEvents({
      loadedLayers,
      routeSourceDescriptorIds: routeSourceDescriptorIdsRef.current,
      trackedSourceDescriptorIds: trackedSourceDescriptorIdsRef.current,
    });
    for (const event of events) {
      trackedSourceDescriptorIdsRef.current.add(event.sourceDescriptorId);
      trackDatasetImportedIntoMap(event.properties);
    }
  }, [loadedLayers]);

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
      if (incoming.length > 0) {
        dispatchDataPanel({ type: "features_selected" });
      } else if (mode === "replace") {
        dispatchDataPanel({ type: "features_cleared", hasQueryResults: queryResult !== null });
      }
      setSelectedFeatures((current) => {
        const update = updateSelectedFeatures({ current, incoming, mode });
        setWasSelectionCapped(update.wasCapped);
        return update.rows;
      });
    },
    [loadedLayers, queryResult],
  );

  const handleMapSourceError = useCallback(
    ({ sourceId, queryId, message }: { sourceId: string; queryId?: string | undefined; message: string }) => {
      setLoadedLayers((current) =>
        current.map((layer) =>
          layer.id === sourceId
            ? {
                ...layer,
                loadError: message,
                ...(layer.kind === "query_mvt" ? { status: "error" as const } : {}),
              }
            : layer,
        ),
      );
      if (queryId === undefined) return;
      setQueryResult((current) =>
        current?.page.query_id === queryId
          ? { ...current, status: "error", errorMessage: "The query layer could not be loaded." }
          : current,
      );
    },
    [],
  );

  const handleMapSourceRecovered = useCallback(
    ({ sourceId, queryId }: { sourceId: string; queryId?: string | undefined }) => {
      setLoadedLayers((current) =>
        current.map((layer) =>
          layer.id === sourceId && layer.loadError
            ? {
                ...layer,
                loadError: null,
                ...(layer.kind === "query_mvt" ? { status: "ready" as const } : {}),
              }
            : layer,
        ),
      );
      if (queryId === undefined) return;
      setQueryResult((current) =>
        current?.page.query_id === queryId && current.errorMessage === "The query layer could not be loaded."
          ? { ...current, status: "ready", errorMessage: null }
          : current,
      );
    },
    [],
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
    queryTokensRef.current,
    handleMapSourceError,
    handleMapSourceRecovered,
  );

  const categoryRegistries = useLayerStyling(mapRef, vectorLayers, layerStyles, setLayerStyles);

  const getSampledBreaks = useCallback(
    (layer: VectorLayerInfo, property: string) => sampledBreakValues(mapRef.current, layer, property),
    [mapRef],
  );

  const clearSelectedFeatures = useCallback(() => {
    clearSelectionBox();
    setSelectedFeatures([]);
    setWasSelectionCapped(false);
    dispatchDataPanel({ type: "features_cleared", hasQueryResults: queryResult !== null });
  }, [clearSelectionBox, queryResult]);

  const resolveDatasetLayer = useCallback(async (input: DatasetLayerInput): Promise<LoadedMapLayer | null> => {
    const prepared = preparedCatalogLayersRef.current.get(input.layerId);
    if (prepared) {
      preparedCatalogLayersRef.current.delete(input.layerId);
      return { ...prepared, name: input.label, label: input.label };
    }
    const descriptor = sourceDescriptorFromLayerId(input.layerId);
    if (!descriptor) return null;
    const resolved = await resolveDescriptor(descriptor);
    return resolved ? resolvedToMapLayer(resolved) : null;
  }, []);

  const resolveCatalogLayer = useCallback(
    async (input: MapCatalogLayerInput): Promise<DatasetLayerInput> => {
      const layer = await catalogMapLayer(input, collection);
      preparedCatalogLayersRef.current.set(layer.id, layer);
      return { layerId: layer.id, label: input.label ?? layer.label, kind: layer.kind };
    },
    [collection],
  );

  const resolveLayerBounds = useCallback(async (layer: LoadedMapLayer) => {
    if (layer.bounds !== null) return layer.bounds;
    if (layer.kind !== "query_mvt") return null;
    const token = queryTokensRef.current.get(layer.queryId);
    if (!token) throw new MapWorkspaceCommandError("The query token is unavailable.");
    try {
      const result = await getQueryBounds(layer.queryId, { queryToken: token });
      setLoadedLayers((current) =>
        current.map((candidate) => (candidate.id === layer.id ? { ...candidate, bounds: result.bounds } : candidate)),
      );
      return result.bounds;
    } catch (error) {
      if (error instanceof QueryApiError) {
        throw new MapWorkspaceCommandError("The query layer bounds are unavailable.");
      }
      throw error;
    }
  }, []);

  const commands = useMapWorkspaceCommands({
    mapRef,
    loadedLayers,
    setLoadedLayers,
    vectorLayers,
    layerStyles,
    setLayerStyles,
    selectedFeatures,
    clearSelection: clearSelectedFeatures,
    basemapMode,
    setBasemapMode,
    resolveDatasetLayer,
    resolveLayerBounds,
  });

  const executeQuery = useCallback(
    async (
      input: QueryRequest,
      presentation: QueryMapPresentation,
      signal: AbortSignal,
    ): Promise<PublicToolQueryPage> => {
      const result = await createQuery(input, { signal });
      queryTokensRef.current.set(result.query_id, result.query_token);
      const layer = presentation.showOnMap
        ? queryLayerFromResult(
            result,
            input.sources.map((source) => source.alias),
          )
        : null;
      if (layer) {
        const label = presentation.layerLabel ?? `Query result ${queryLayerLabelCounterRef.current + 1}`;
        if (!presentation.layerLabel) queryLayerLabelCounterRef.current += 1;
        const labeledLayer = { ...layer, name: label, label };
        setLoadedLayers((current) => [...current.filter((entry) => entry.id !== labeledLayer.id), labeledLayer]);
      }
      const state = queryResultState(
        result,
        input.sources.map((source) => source.alias),
        layer?.id ?? null,
      );
      setQueryResult(state);
      dispatchDataPanel({ type: "show_query" });
      return state.page;
    },
    [],
  );

  const executeQueryPage = useCallback(
    async (
      queryId: string,
      input: { offset: number; page_size?: number | undefined },
      signal: AbortSignal,
    ): Promise<PublicToolQueryPage> => {
      const token = queryTokensRef.current.get(queryId);
      if (!token) throw new QueryApiError(404, "not_found", "The requested query was not found.");
      const page = await getQueryPage(queryId, input, { queryToken: token, signal });
      queryTokensRef.current.set(queryId, page.query_token);
      const publicPage = publicQueryPage(page);
      setQueryResult((current) =>
        current?.page.query_id === queryId
          ? {
              ...current,
              page: appendQueryPage(current.page, publicPage),
              status: "ready",
              errorMessage: null,
            }
          : current,
      );
      return publicPage;
    },
    [],
  );

  const mapWebMcpState = useCallback(
    () => ({
      layers: loadedLayers.map((layer) => ({
        map_layer_id: layer.id,
        label: layer.label,
        kind: layer.kind,
        visible: layer.visible,
        status: layer.loadError
          ? ("error" as const)
          : mapRef.current?.getSource(layer.mapSourceId) && mapRef.current.isSourceLoaded(layer.mapSourceId)
            ? ("ready" as const)
            : ("loading" as const),
        ...(layer.loadError ? { error: layer.loadError } : {}),
        ...(layer.kind === "query_mvt" ? { query_id: layer.queryId } : {}),
        style_layers: vectorLayers
          .filter((vectorLayer) => vectorLayer.loadedLayerId === layer.id)
          .map((vectorLayer) => {
            const style = layerStyles[vectorLayer.id];
            return {
              style_layer_id: vectorLayer.id,
              ...(vectorLayer.sourceLayerId === undefined ? {} : { source_layer_id: vectorLayer.sourceLayerId }),
              fields: [...vectorLayer.fields],
              numeric_fields: vectorLayer.numericFields.map((field) => ({
                name: field.name,
                ...(field.min === undefined ? {} : { min: field.min }),
                ...(field.max === undefined ? {} : { max: field.max }),
              })),
              ...(style === undefined
                ? {}
                : {
                    style: {
                      color_property: style.colorProperty,
                      color_scheme: style.colorScheme,
                      color_mode: colorMode(vectorLayer, style),
                      breaks: parseBreaks(style.breaksText),
                      break_mode: style.breakMode,
                      opacity: style.opacity,
                      radius: style.radius,
                      line_width: style.lineWidth,
                      radius_property: style.radiusProperty,
                      line_width_property: style.lineWidthProperty,
                      radius_scale: style.radiusScale,
                      line_width_scale: style.lineWidthScale,
                    },
                  }),
            };
          }),
      })),
      basemap: basemapMode,
      selected_feature_count: selectedFeatures.length,
      camera: mapRef.current
        ? {
            center: [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] as const,
            zoom: mapRef.current.getZoom(),
            bearing: mapRef.current.getBearing(),
            pitch: mapRef.current.getPitch(),
          }
        : null,
      selected_features: selectedFeatures.map((feature) => ({
        id: feature.id,
        loadedLayerId: feature.loadedLayerId,
        sourceLayerId: feature.sourceLayerId,
        featureId: feature.featureId,
        properties: publicSelectedProperties(feature.properties),
        ...(feature.sourceKind === undefined ? {} : { sourceKind: feature.sourceKind }),
        ...(feature.sourceKind === "query_mvt" ? { queryId: feature.queryId } : {}),
      })),
      current_result: queryResult
        ? {
            query_id: queryResult.page.query_id,
            offset: queryResult.page.offset,
            limit: queryResult.page.limit,
            returned_count: queryResult.page.returned_count,
            has_more: queryResult.page.has_more,
            map_layer_id: queryResult.layerId,
          }
        : null,
    }),
    [basemapMode, layerStyles, loadedLayers, mapRef, queryResult, selectedFeatures, vectorLayers],
  );

  useMapWebMcpTools({
    enabled: runtimeConfig?.webMcpEnabled === true,
    commands,
    getState: mapWebMcpState,
    resolveCatalogLayer,
  });
  useQueryWebMcpTools({
    enabled: runtimeConfig?.queryToolsEnabled === true,
    pageEnabled: queryResult !== null && canSetQueryResultPage(queryResult.page),
    executeQuery,
    executePage: executeQueryPage,
  });

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
    const retained = selectedFeatures.filter((feature) => activeLayerIds.has(feature.loadedLayerId));
    if (retained.length === selectedFeatures.length) return;
    setSelectedFeatures(retained);
    if (selectedFeatures.length > 0 && retained.length === 0) {
      dispatchDataPanel({ type: "features_cleared", hasQueryResults: queryResult !== null });
    }
  }, [loadedLayers, queryResult, selectedFeatures]);

  const hasDataPanel = queryResult !== null || selectedFeatures.length > 0;
  const dataPanelShouldBeOpen = hasDataPanel && dataPanelState.isOpen;
  useEffect(() => {
    if (dataPanelOpenRef.current === dataPanelShouldBeOpen) return;
    dataPanelOpenRef.current = dataPanelShouldBeOpen;
    const panel = dataPanelRef.current;
    if (!panel) return;
    if (dataPanelShouldBeOpen) {
      if (dataPanelHasOpenedRef.current) {
        panel.expand();
      } else {
        panel.resize(isMobileMapLayout ? "40%" : MAP_SELECTED_FEATURES_DESKTOP_DEFAULT_SIZE);
        dataPanelHasOpenedRef.current = true;
      }
    } else {
      panel.collapse();
    }
  }, [dataPanelShouldBeOpen, isMobileMapLayout]);

  useEffect(() => {
    mapRef.current?.resize();
  });

  useEffect(() => {
    if (!isMobileMapLayout) {
      setIsMobileSettingsOpen(false);
    }
  }, [isMobileMapLayout]);

  const closeActivePopup = useCallback(() => {
    closeMapPopup({ setPinnedPopupInfo, setHoverInfo, clearHoverFeature });
  }, [clearHoverFeature]);

  const activePopupInfo = pinnedPopupInfo ?? hoverInfo;
  const propertyEntries = popupProperties(activePopupInfo, loadedLayers);
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
        const resolved = resolveLayerColor(layer, style, categoryRegistries[layer.id]);
        const loadedLayer = loadedLayers.find((entry) => entry.id === layer.loadedLayerId);
        return [
          {
            id: layer.id,
            title: loadedLayer?.name ?? layer.sourceLayerId ?? layer.id,
            field: style.colorProperty ?? undefined,
            items: resolved.items,
            notes: resolved.notes,
          },
        ];
      }),
    [layerStyles, loadedLayers, vectorLayers, categoryRegistries],
  );
  const legendTitle = legendGroups.length === 1 ? legendGroups[0]?.field : undefined;
  const headerLayer = loadedLayers.length === 1 && loadedLayers[0]?.kind === "catalog_pmtiles" ? loadedLayers[0] : null;
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
      if (selectedDescriptorIdRef.current !== descriptorToAddId) return;
      await commands.addDatasetLayer({
        layerId: descriptorToAddId,
        label: selectedFile?.name ?? descriptorToAdd.fileSlug,
      });
      applyLayerPickerSelection(clearedLayerPickerSelection());
    } finally {
      setAddingLayerDescriptorId((current) => (current === descriptorToAddId ? null : current));
    }
  };

  const removeLoadedLayer = (layer: LoadedMapLayer) => {
    commands.removeLayer(layer.id);
    if (layer.kind === "catalog_pmtiles") {
      const descriptorId = sourceDescriptorId(layer.descriptor);
      trackedSourceDescriptorIdsRef.current.delete(descriptorId);
      routeSourceDescriptorIdsRef.current.delete(descriptorId);
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
      return;
    }
  };

  const toggleSettingsPanel = () => {
    if (!settingsPanelRef.current) return;
    if (settingsPanelRef.current.isCollapsed()) {
      settingsPanelRef.current.expand();
      return;
    }
    settingsPanelRef.current.collapse();
  };

  const loadNextQueryPage = useCallback(() => {
    const nextOffset = queryResult?.page.next_offset;
    if (!queryResult || nextOffset === undefined || isLoadingQueryPage) return;
    setIsLoadingQueryPage(true);
    void executeQueryPage(
      queryResult.page.query_id,
      { offset: nextOffset, page_size: queryResult.page.limit },
      new AbortController().signal,
    )
      .catch(() => {
        setQueryResult((current) =>
          current ? { ...current, status: "error", errorMessage: "The next query page could not be loaded." } : current,
        );
      })
      .finally(() => setIsLoadingQueryPage(false));
  }, [executeQueryPage, isLoadingQueryPage, queryResult]);

  const queryResultsVisible = dataPanelState.isOpen && dataPanelState.mode === "query";
  const queryResultsButtonVariant = queryResultsVisible ? "secondary" : "outline";
  const queryResultsButtonLabel = queryResultsVisible ? "Hide results" : "View results";

  const settingsPanelContent = (
    <div className="box-border w-full max-w-full min-w-0 overflow-hidden p-3">
      <Card className="w-full max-w-full min-w-0">
        <CardHeader className="px-3 pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <Layers className="h-4 w-4" />
            Layers
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5 px-3">
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
                  <MapLayerListItem
                    key={layer.id}
                    layer={layer}
                    vectorLayerCount={layerVectorLayers.length}
                    onVisibleChange={(visible) => commands.setLayerVisibility(layer.id, visible)}
                    onRemove={() => removeLoadedLayer(layer)}
                  >
                    {layer.kind === "catalog_pmtiles" && (
                      <Button asChild type="button" variant="outline" size="sm" className="mt-3 w-full">
                        <Link
                          to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
                          params={{
                            collectionSlug: layer.descriptor.collectionSlug,
                            datasetSlug: layer.descriptor.datasetSlug,
                            fileSlug: layer.descriptor.fileSlug,
                          }}
                        >
                          Open file
                        </Link>
                      </Button>
                    )}
                    {layer.kind === "query_mvt" && (
                      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                        <div>
                          Status:{" "}
                          {layer.status === "ready" ? "Ready" : layer.status === "loading" ? "Loading" : "Unavailable"}
                        </div>
                        <div>
                          Sources: {layer.sourceAliases.length > 0 ? layer.sourceAliases.join(", ") : "Query result"}
                        </div>
                        <div>Geometry: {layer.geometryColumn}</div>
                        <Button
                          type="button"
                          variant={queryResultsButtonVariant}
                          size="sm"
                          className="w-full"
                          aria-pressed={queryResultsVisible}
                          onClick={() => dispatchDataPanel({ type: "toggle_query_results" })}
                        >
                          {queryResultsButtonLabel}
                        </Button>
                      </div>
                    )}
                  </MapLayerListItem>
                );
              })
            )}
          </div>

          {selectedDataset && (
            <div className={IMPORT_LAYER_CARD_CLASSNAME}>
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
                      <SelectTrigger className={IMPORT_SELECT_TRIGGER_CLASSNAME}>
                        <SelectValue className={IMPORT_SELECT_VALUE_CLASSNAME} placeholder="Select file" />
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
                      <SelectTrigger className={IMPORT_SELECT_TRIGGER_CLASSNAME}>
                        <SelectValue className={IMPORT_SELECT_VALUE_CLASSNAME} placeholder="Select version" />
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
                      <SelectTrigger className={IMPORT_SELECT_TRIGGER_CLASSNAME}>
                        <SelectValue className={IMPORT_SELECT_VALUE_CLASSNAME} placeholder="Select source" />
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
        defaultSize="100%"
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
              onClose={closeActivePopup}
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
      <ResizableHandle
        withHandle
        disabled={!dataPanelShouldBeOpen}
        className={dataPanelShouldBeOpen ? undefined : "hidden"}
      />
      <ResizablePanel
        id="map-data-panel"
        defaultSize="0%"
        minSize={isMobileMapLayout ? "25%" : "15%"}
        collapsible
        collapsedSize="0%"
        panelRef={dataPanelRef}
        className="min-h-0 overflow-hidden"
        onResize={() => mapRef.current?.resize()}
      >
        {dataPanelShouldBeOpen && dataPanelState.mode === "selected" && selectedFeatures.length > 0 ? (
          <FeatureTablePanel
            features={selectedFeatures}
            highlightedFeatureId={highlightedFeatureId}
            wasSelectionCapped={wasSelectionCapped}
            s2Level={s2Level}
            onS2LevelChange={setS2Level}
            onFeatureClick={zoomToSelectedFeature}
            onClear={clearSelectedFeatures}
            panelModeControls={
              queryResult ? (
                <MapDataPanelModeControls
                  mode={dataPanelState.mode}
                  onModeChange={(mode) =>
                    dispatchDataPanel({ type: mode === "query" ? "show_query" : "show_selected" })
                  }
                />
              ) : undefined
            }
            onCollapse={() => dispatchDataPanel({ type: "collapse" })}
          />
        ) : dataPanelShouldBeOpen && queryResult ? (
          <QueryResultPanel
            result={queryResult}
            onLoadMore={loadNextQueryPage}
            isLoadingMore={isLoadingQueryPage}
            panelModeControls={
              selectedFeatures.length > 0 ? (
                <MapDataPanelModeControls
                  mode={dataPanelState.mode}
                  onModeChange={(mode) =>
                    dispatchDataPanel({ type: mode === "query" ? "show_query" : "show_selected" })
                  }
                />
              ) : undefined
            }
            onCollapse={() => dispatchDataPanel({ type: "collapse" })}
          />
        ) : null}
      </ResizablePanel>
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
          <div className={MOBILE_SETTINGS_SCROLL_CLASSNAME}>{settingsPanelContent}</div>
        </SheetContent>
      </Sheet>

      {isMobileMapLayout ? (
        <div className="min-h-0 flex-1">{mapWorkspaceContent}</div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            defaultSize="28%"
            minSize="240px"
            maxSize="42%"
            collapsible
            collapsedSize="0%"
            panelRef={settingsPanelRef}
            onResize={(panelSize) => setIsSettingsCollapsed(panelSize.asPercentage === 0)}
            className="min-w-0 overflow-hidden"
          >
            <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden">{settingsPanelContent}</div>
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
