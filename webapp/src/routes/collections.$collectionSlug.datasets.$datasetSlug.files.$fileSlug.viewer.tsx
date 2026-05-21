import { createFileRoute, notFound } from "@tanstack/react-router";
import type maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { FormatSourceSelector } from "@/components/dataset/FormatSourceSelector";
import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import { compareVersionValues } from "@/components/dataset/versionLabel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/page-loader";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useMapInitialization } from "@/components/viewer/useMapInitialization";
import {
  computeQuantileBreaks,
  DEFAULT_BREAK_COUNT,
  getColorRamp,
  getLegendItems,
  getSampledValues,
  parseBreaks,
} from "@/components/viewer/utils";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import type { Dataset, DatasetFile, DatasetFormat, DatasetSource } from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileById, getDatasetFileBySlug } from "@/lib/api-client";

interface SourceSelection {
  storageLocationId: number;
  version: string | number;
}

interface SelectedSourcesByFormat {
  pmtiles?: SourceSelection;
  [formatType: string]: SourceSelection | undefined;
}

interface SourceEntry {
  source: DatasetSource;
  version: string | number;
}

interface SourcesByLocationId {
  [storageLocationId: number]: SourceEntry | undefined;
}

function initialSourceSelection(formatEntry: DatasetFormat): SourceSelection | undefined {
  const sourcesByLocation: SourcesByLocationId = {};

  for (const source of formatEntry.sources ?? []) {
    const storageLocationId = source.storage_location?.id;
    if (storageLocationId === undefined) {
      continue;
    }

    const version = source.version ?? "1";
    const existing = sourcesByLocation[storageLocationId];
    if (!existing || compareVersionValues(version, existing.version) < 0) {
      sourcesByLocation[storageLocationId] = { source, version };
    }
  }

  const firstEntry = Object.values(sourcesByLocation)[0];
  const storageLocationId = firstEntry?.source.storage_location?.id;
  if (storageLocationId === undefined || !firstEntry) {
    return undefined;
  }

  return {
    storageLocationId,
    version: firstEntry.version,
  };
}

function initialSelectedSources(file: DatasetFile): SelectedSourcesByFormat {
  const selectedSources: SelectedSourcesByFormat = {};

  for (const formatEntry of file.formats ?? []) {
    const selection = initialSourceSelection(formatEntry);
    if (selection) {
      selectedSources[formatEntry.format.format_type] = selection;
    }
  }

  return selectedSources;
}

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/viewer")({
  loader: async ({ params }) => {
    const collection = await getCollectionBySlug({
      data: { slug: params.collectionSlug },
    });
    if (!collection) {
      throw notFound();
    }

    const dataset = await getDatasetBySlug({
      data: {
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        includeUrls: false,
      },
    });
    if (!dataset) {
      throw notFound();
    }

    const file = dataset.files?.find((entry) => entry.slug === params.fileSlug);
    if (file?.id && dataset.id) {
      const result = await getDatasetFileById({
        data: {
          collectionId: collection.id,
          datasetId: dataset.id,
          fileId: file.id,
        },
      });
      if (!result) {
        throw notFound();
      }
      return { collection, dataset: result.dataset, file: result.file };
    }

    const result = await getDatasetFileBySlug({
      data: {
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        fileSlug: params.fileSlug,
      },
    });
    if (!result) {
      throw notFound();
    }
    return { collection, dataset: result.dataset, file: result.file };
  },
  component: FileViewerPage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
  pendingMs: 200,
  ssr: false,
});

function FileViewerPage() {
  const { dataset, file } = Route.useLoaderData();
  const { collectionSlug, datasetSlug } = Route.useParams();
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const [vectorLayers, setVectorLayers] = useState<VectorLayerInfo[]>([]);
  const [layerStyles, setLayerStyles] = useState<LayerStylesById>({});
  const [colorSectionOpen, setColorSectionOpen] = useState(true);
  const [sizeSectionOpen, setSizeSectionOpen] = useState(true);
  const [legendVisible, setLegendVisible] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [pinnedPopupInfo, setPinnedPopupInfo] = useState<HoverInfo | null>(null);
  const [selectedSources, setSelectedSources] = useState<SelectedSourcesByFormat>({});

  // Initialize selected sources from file formats
  useEffect(() => {
    setSelectedSources(initialSelectedSources(file));
  }, [file]);

  const getSelectedSource = (formatType: string): DatasetSource | null => {
    const selection = selectedSources[formatType];
    if (!selection) return null;

    const formatEntry = file.formats?.find((entry) => entry.format.format_type === formatType);
    if (!formatEntry?.sources) return null;

    return (
      formatEntry.sources.find(
        (source) =>
          source.storage_location?.id === selection.storageLocationId &&
          String(source.version || "1") === String(selection.version),
      ) || null
    );
  };

  const pmtilesSource = getSelectedSource("pmtiles");
  const pmtilesUrl = pmtilesSource ? buildSourceFileUrl(pmtilesSource) : null;
  const pmtilesFormatEntry = file.formats?.find((entry) => entry.format.format_type === "pmtiles");

  // Map initialization hook
  const { mapRef, setHoverFeature, clearHoverFeature } = useMapInitialization(
    mapContainerRef,
    pmtilesUrl,
    setVectorLayers,
    setHoverInfo,
    setPinnedPopupInfo,
  );

  // Layer styling hook
  useLayerStyling(mapRef, vectorLayers, layerStyles, setLayerStyles);

  // Auto-compute breaks when color property changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of vectorLayers) {
      const style = layerStyles[layer.id];
      if (!style?.colorProperty || style.breaksText) continue;
      const values = getSampledValues(map, layer.id, style.colorProperty);
      const breaks = computeQuantileBreaks(values, DEFAULT_BREAK_COUNT);
      const nextText = breaks.join(", ");
      if (!nextText) continue;
      setLayerStyles((prev) => ({
        ...prev,
        [layer.id]: {
          ...style,
          breaksText: nextText,
        },
      }));
    }
  }, [layerStyles, vectorLayers, mapRef]);

  // Update hover feature when hover info changes
  useEffect(() => {
    if (!hoverInfo || hoverInfo.features.length === 0) {
      clearHoverFeature();
      return;
    }
    const feature = hoverInfo.features[hoverInfo.selectedIndex];
    if (feature) {
      setHoverFeature(feature);
    } else {
      clearHoverFeature();
    }
  }, [hoverInfo, setHoverFeature, clearHoverFeature]);

  // Update pinned popup position when map moves/zooms
  useEffect(() => {
    if (!mapRef.current || !pinnedPopupInfo?.lngLat) return;

    const map = mapRef.current;
    const lngLat = pinnedPopupInfo.lngLat;

    const updatePopupPosition = () => {
      if (!mapRef.current || !lngLat) return;

      const point = mapRef.current.project(lngLat);
      setPinnedPopupInfo((prev) => {
        if (!prev?.lngLat || prev.lngLat.lng !== lngLat.lng || prev.lngLat.lat !== lngLat.lat) {
          return prev;
        }
        return {
          ...prev,
          x: point.x,
          y: point.y,
        };
      });
    };

    map.on("move", updatePopupPosition);
    map.on("zoom", updatePopupPosition);

    // Update immediately in case map moved before this effect ran
    updatePopupPosition();

    return () => {
      map.off("move", updatePopupPosition);
      map.off("zoom", updatePopupPosition);
    };
  }, [mapRef, pinnedPopupInfo]);

  // Computed values for active layer
  const activeLayer = vectorLayers[0] || null;
  const activeLayerId = activeLayer?.id || null;
  const activeStyle = activeLayerId ? (layerStyles[activeLayerId] ?? null) : null;
  const activeBreaks = activeStyle ? parseBreaks(activeStyle.breaksText) : [];
  const activeColors = activeStyle ? getColorRamp(activeStyle.colorScheme, activeBreaks.length + 1) : [];
  const legendItems = useMemo(() => getLegendItems(activeBreaks, activeColors), [activeBreaks, activeColors]);

  // Determine which popup to show (pinned takes precedence)
  const activePopupInfo = pinnedPopupInfo || (pinnedPopupInfo === null ? hoverInfo : null);
  const selectedFeature = activePopupInfo?.features?.[activePopupInfo?.selectedIndex ?? 0] || null;
  const selectedProperties = selectedFeature?.properties;
  const propertyEntries: PopupPropertyEntry[] = selectedProperties
    ? Object.entries(selectedProperties)
        .map(([key, value]) => [key, String(value)] satisfies PopupPropertyEntry)
        .sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <FileViewerContent
      collectionSlug={collectionSlug}
      datasetSlug={datasetSlug}
      dataset={dataset}
      file={file}
      mapContainerRef={mapContainerRef}
      mapRef={mapRef}
      pmtilesUrl={pmtilesUrl}
      pmtilesFormatEntry={pmtilesFormatEntry}
      selectedSources={selectedSources}
      setSelectedSources={setSelectedSources}
      setLayerStyles={setLayerStyles}
      colorSectionOpen={colorSectionOpen}
      setColorSectionOpen={setColorSectionOpen}
      sizeSectionOpen={sizeSectionOpen}
      setSizeSectionOpen={setSizeSectionOpen}
      legendVisible={legendVisible}
      setLegendVisible={setLegendVisible}
      hoverInfo={activePopupInfo}
      setHoverInfo={setHoverInfo}
      setPinnedPopupInfo={setPinnedPopupInfo}
      activeLayer={activeLayer}
      activeStyle={activeStyle}
      activeBreaks={activeBreaks}
      activeColors={activeColors}
      legendItems={legendItems}
      propertyEntries={propertyEntries}
    />
  );
}

function FileViewerContent({
  collectionSlug,
  datasetSlug,
  dataset,
  file,
  mapContainerRef,
  mapRef,
  pmtilesUrl,
  pmtilesFormatEntry,
  selectedSources,
  setSelectedSources,
  setLayerStyles,
  colorSectionOpen,
  setColorSectionOpen,
  sizeSectionOpen,
  setSizeSectionOpen,
  legendVisible,
  setLegendVisible,
  hoverInfo,
  setHoverInfo,
  setPinnedPopupInfo,
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  legendItems,
  propertyEntries,
}: {
  collectionSlug: string;
  datasetSlug: string;
  dataset: Dataset;
  file: DatasetFile;
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.RefObject<maplibregl.Map | null>;
  pmtilesUrl: string | null;
  pmtilesFormatEntry: DatasetFormat | undefined;
  selectedSources: SelectedSourcesByFormat;
  setSelectedSources: React.Dispatch<React.SetStateAction<SelectedSourcesByFormat>>;
  setLayerStyles: React.Dispatch<React.SetStateAction<LayerStylesById>>;
  colorSectionOpen: boolean;
  setColorSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sizeSectionOpen: boolean;
  setSizeSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  legendVisible: boolean;
  setLegendVisible: React.Dispatch<React.SetStateAction<boolean>>;
  hoverInfo: HoverInfo | null;
  setHoverInfo: React.Dispatch<React.SetStateAction<HoverInfo | null>>;
  setPinnedPopupInfo: React.Dispatch<React.SetStateAction<HoverInfo | null>>;
  activeLayer: VectorLayerInfo | null;
  activeStyle: LayerStyle | null;
  activeBreaks: number[];
  activeColors: string[];
  legendItems: Array<{ label: string; color: string }>;
  propertyEntries: PopupPropertyEntry[];
}) {
  const isMobileInitial = typeof window !== "undefined" && window.innerWidth < 768;
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(isMobileInitial);
  const editorPanelRef = useRef<PanelImperativeHandle | null>(null);

  const toggleEditorPanel = () => {
    if (!editorPanelRef.current) return;
    if (editorPanelRef.current.isCollapsed()) {
      editorPanelRef.current.expand();
    } else {
      editorPanelRef.current.collapse();
    }
  };

  const sidebarContent = (
    <div className="p-4 space-y-4 w-full min-w-0 overflow-hidden [&_[data-slot=select-trigger]]:w-full [&_input]:w-full">
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle className="text-base">PMTiles Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pmtilesFormatEntry ? (
            <FormatSourceSelector
              formatType="pmtiles"
              formatEntry={pmtilesFormatEntry}
              selectedSource={
                selectedSources.pmtiles
                  ? {
                      storageLocationId: selectedSources.pmtiles.storageLocationId,
                      version: selectedSources.pmtiles.version,
                    }
                  : null
              }
              onSourceChange={(storageLocationId, version) => {
                setSelectedSources((prev) => ({
                  ...prev,
                  pmtiles: { storageLocationId, version },
                }));
              }}
            />
          ) : (
            <div className="text-sm text-muted-foreground">PMTiles format not available for this file.</div>
          )}
          {pmtilesUrl && (
            <div className="w-full min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-xs break-all">{pmtilesUrl}</div>
          )}
        </CardContent>
      </Card>

      <LayerStylingEditor
        activeLayer={activeLayer}
        activeStyle={activeStyle}
        activeBreaks={activeBreaks}
        activeColors={activeColors}
        mapRef={mapRef}
        colorSectionOpen={colorSectionOpen}
        setColorSectionOpen={setColorSectionOpen}
        sizeSectionOpen={sizeSectionOpen}
        setSizeSectionOpen={setSizeSectionOpen}
        onStyleChange={(style) => {
          if (activeLayer) {
            setLayerStyles((prev) => ({
              ...prev,
              [activeLayer.id]: style,
            }));
          }
        }}
      />
    </div>
  );

  const mapContent = pmtilesUrl ? (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mapContainerRef} className="h-full w-full" />
      <MapControls mapRef={mapRef} />
      {hoverInfo && hoverInfo.features.length > 0 && (
        <FeatureHoverPopup
          hoverInfo={hoverInfo}
          selectedIndex={hoverInfo.selectedIndex}
          propertyEntries={propertyEntries}
          onIndexChange={(index) => {
            if (hoverInfo.isPinned) {
              setPinnedPopupInfo((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
            } else {
              setHoverInfo((prev) => (prev ? { ...prev, selectedIndex: index } : prev));
            }
          }}
          onClose={() => setPinnedPopupInfo(null)}
        />
      )}
      {activeStyle && (
        <MapLegend items={legendItems} visible={legendVisible} onToggle={() => setLegendVisible(!legendVisible)} />
      )}
    </div>
  ) : (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      No PMTiles available for this file.
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-3.5rem)] w-full flex-col overflow-hidden">
      <ViewerHeader
        collectionSlug={collectionSlug}
        datasetSlug={datasetSlug}
        file={file}
        datasetName={dataset.name}
        onToggleEditor={toggleEditorPanel}
        isEditorCollapsed={isEditorCollapsed}
      />

      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0 w-full">
        <ResizablePanel
          defaultSize={isMobileInitial ? "0%" : "34%"}
          minSize={isMobileInitial ? "75%" : "34%"}
          maxSize={isMobileInitial ? "90%" : "50%"}
          collapsible
          collapsedSize="0%"
          panelRef={editorPanelRef}
          onResize={(panelSize) => setIsEditorCollapsed(panelSize.asPercentage === 0)}
          className="min-w-0 flex flex-col overflow-hidden"
        >
          <ScrollArea className="flex-1 overflow-auto">{sidebarContent}</ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20" />

        <ResizablePanel
          defaultSize={isMobileInitial ? "100%" : "66%"}
          className="min-w-0 flex flex-col overflow-hidden"
          onResize={() => {
            mapRef.current?.resize();
          }}
        >
          <div className="relative flex-1 w-full overflow-hidden">{mapContent}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
