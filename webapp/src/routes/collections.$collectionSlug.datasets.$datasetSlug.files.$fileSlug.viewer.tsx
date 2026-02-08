import { createFileRoute, notFound } from "@tanstack/react-router";
import { useRef, useState, useEffect, useMemo } from "react";
import type { DatasetFile } from "@/lib/api-client";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileById,
  getDatasetFileBySlug,
} from "@/lib/api-client";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import { MapControls } from "@/components/viewer/MapControls";
import { FeatureHoverPopup } from "@/components/viewer/FeatureHoverPopup";
import { MapLegend } from "@/components/viewer/MapLegend";
import { LayerStylingEditor } from "@/components/viewer/LayerStylingEditor";
import { useMapInitialization } from "@/components/viewer/useMapInitialization";
import { useLayerStyling } from "@/components/viewer/useLayerStyling";
import type { VectorLayerInfo, LayerStyle, HoverInfo } from "@/components/viewer/types";
import {
  parseBreaks,
  getColorRamp,
  getLegendItems,
  computeQuantileBreaks,
  getSampledValues,
  DEFAULT_BREAK_COUNT,
} from "@/components/viewer/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FormatSourceSelector } from "@/components/dataset/FormatSourceSelector";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const Route = createFileRoute(
  "/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/viewer"
)({
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
  ssr: false,
});

function FileViewerPage() {
  const { dataset, file } = Route.useLoaderData();
  const { collectionSlug, datasetSlug } = Route.useParams();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  
  const [vectorLayers, setVectorLayers] = useState<VectorLayerInfo[]>([]);
  const [layerStyles, setLayerStyles] = useState<Record<string, LayerStyle>>({});
  const [colorSectionOpen, setColorSectionOpen] = useState(true);
  const [sizeSectionOpen, setSizeSectionOpen] = useState(true);
  const [legendVisible, setLegendVisible] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [selectedSources, setSelectedSources] = useState<
    Record<string, { storageLocationId: number; version: string | number }>
  >({});

  // Initialize selected sources from file formats
  useEffect(() => {
    const initial: Record<
      string,
      { storageLocationId: number; version: string | number }
    > = {};
    file.formats?.forEach((formatEntry) => {
      const formatType = formatEntry.format.format_type;
      if (formatEntry.sources && formatEntry.sources.length > 0) {
        type SourceType = NonNullable<DatasetFile["formats"]>[0]["sources"][0];
        type SourceEntry = { source: SourceType; version: string | number };
        const sourcesByLocation: Record<number, SourceEntry> = {};

        formatEntry.sources.forEach((source: SourceType) => {
          const locId = source.storage_location?.id;
          const version = source.version || "1";
          if (locId) {
            const existing = sourcesByLocation[locId];
            if (!existing) {
              sourcesByLocation[locId] = { source, version };
            } else if (String(version) > String(existing.version)) {
              sourcesByLocation[locId] = { source, version };
            }
          }
        });

        const firstEntry = Object.values(sourcesByLocation)[0];
        if (firstEntry?.source.storage_location?.id) {
          initial[formatType] = {
            storageLocationId: firstEntry.source.storage_location.id,
            version: firstEntry.version,
          };
        }
      }
    });
    setSelectedSources(initial);
  }, [file]);

  const getSelectedSource = (
    formatType: string
  ): NonNullable<DatasetFile["formats"]>[0]["sources"][0] | null => {
    const selection = selectedSources[formatType];
    if (!selection) return null;

    const formatEntry = file.formats?.find(
      (entry) => entry.format.format_type === formatType
    );
    if (!formatEntry || !formatEntry.sources) return null;

    return (
      formatEntry.sources.find(
        (source) =>
          source.storage_location?.id === selection.storageLocationId &&
          String(source.version || "1") === String(selection.version)
      ) || null
    );
  };

  const pmtilesSource = getSelectedSource("pmtiles");
  const pmtilesUrl = pmtilesSource?.url || null;
  const pmtilesFormatEntry = file.formats?.find(
    (entry) => entry.format.format_type === "pmtiles"
  );

  // Map initialization hook
  const {
    mapRef,
    setHoverFeature,
    clearHoverFeature,
  } = useMapInitialization(
    mapContainerRef,
    pmtilesUrl,
    setVectorLayers,
    setHoverInfo
  );

  // Layer styling hook
  useLayerStyling(mapRef, vectorLayers, layerStyles, setLayerStyles);

  // Auto-compute breaks when color property changes
  useEffect(() => {
    if (!mapRef.current) return;
    vectorLayers.forEach((layer) => {
      const style = layerStyles[layer.id];
      if (!style?.colorProperty || style.breaksText) return;
      const values = getSampledValues(
        mapRef.current!,
        layer.id,
        style.colorProperty
      );
      const breaks = computeQuantileBreaks(values, DEFAULT_BREAK_COUNT);
      const nextText = breaks.join(", ");
      if (!nextText) return;
      setLayerStyles((prev) => ({
        ...prev,
        [layer.id]: {
          ...prev[layer.id],
          breaksText: nextText,
        },
      }));
    });
  }, [layerStyles, vectorLayers, mapRef, setLayerStyles]);

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
  }, [hoverInfo?.selectedIndex, hoverInfo?.features, setHoverFeature, clearHoverFeature]);

  // Computed values for active layer
  const activeLayer = vectorLayers[0] || null;
  const activeLayerId = activeLayer?.id || null;
  const activeStyle = activeLayerId ? layerStyles[activeLayerId] : null;
  const activeBreaks = activeStyle ? parseBreaks(activeStyle.breaksText) : [];
  const activeColors = activeStyle
    ? getColorRamp(activeStyle.colorScheme, activeBreaks.length + 1)
    : [];
  const legendItems = useMemo(
    () => getLegendItems(activeBreaks, activeColors),
    [activeBreaks, activeColors]
  );

  const selectedFeature = hoverInfo?.features[hoverInfo.selectedIndex] || null;
  const selectedProperties = selectedFeature?.properties || {};
  const propertyEntries = Object.entries(selectedProperties).sort(([a], [b]) =>
    a.localeCompare(b)
  );

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
      hoverInfo={hoverInfo}
      setHoverInfo={setHoverInfo}
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
  activeLayer,
  activeStyle,
  activeBreaks,
  activeColors,
  legendItems,
  propertyEntries,
}: {
  collectionSlug: string;
  datasetSlug: string;
  dataset: any;
  file: DatasetFile;
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.RefObject<any>;
  pmtilesUrl: string | null;
  pmtilesFormatEntry: any;
  selectedSources: Record<string, { storageLocationId: number; version: string | number }>;
  setSelectedSources: React.Dispatch<React.SetStateAction<Record<string, { storageLocationId: number; version: string | number }>>>;
  setLayerStyles: React.Dispatch<React.SetStateAction<Record<string, LayerStyle>>>;
  colorSectionOpen: boolean;
  setColorSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sizeSectionOpen: boolean;
  setSizeSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  legendVisible: boolean;
  setLegendVisible: React.Dispatch<React.SetStateAction<boolean>>;
  hoverInfo: HoverInfo | null;
  setHoverInfo: React.Dispatch<React.SetStateAction<HoverInfo | null>>;
  activeLayer: VectorLayerInfo | null;
  activeStyle: LayerStyle | null;
  activeBreaks: number[];
  activeColors: string[];
  legendItems: Array<{ label: string; color: string }>;
  propertyEntries: Array<[string, any]>;
}) {
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(false);
  const editorPanelRef = useRef<PanelImperativeHandle | null>(null);

  const toggleEditorPanel = () => {
    if (!editorPanelRef.current) return;
    if (editorPanelRef.current.isCollapsed()) {
      editorPanelRef.current.expand();
      setIsEditorCollapsed(false);
    } else {
      editorPanelRef.current.collapse();
      setIsEditorCollapsed(true);
    }
  };

  const mapContent = pmtilesUrl ? (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mapContainerRef} className="h-full w-full" />
      <MapControls
        mapRef={mapRef}
        onToggleEditor={toggleEditorPanel}
        isEditorCollapsed={isEditorCollapsed}
      />
      {hoverInfo && hoverInfo.features.length > 0 && (
        <FeatureHoverPopup
          hoverInfo={hoverInfo}
          selectedIndex={hoverInfo.selectedIndex}
          propertyEntries={propertyEntries}
          onIndexChange={(index) =>
            setHoverInfo((prev) =>
              prev ? { ...prev, selectedIndex: index } : prev
            )
          }
        />
      )}
      {activeStyle && (
        <MapLegend
          items={legendItems}
          visible={legendVisible}
          onToggle={() => setLegendVisible(!legendVisible)}
        />
      )}
    </div>
  ) : (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      No PMTiles available for this file.
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden">
      <ViewerHeader
        collectionSlug={collectionSlug}
        datasetSlug={datasetSlug}
        file={file}
        datasetName={dataset.name}
      />
      
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1 min-h-0 w-full"
      >
        <ResizablePanel
          defaultSize="34%"
          minSize="34%"
          maxSize="50%"
          collapsible
          collapsedSize="0%"
          panelRef={editorPanelRef}
          onResize={(panelSize) =>
            setIsEditorCollapsed(panelSize.asPercentage === 0)
          }
          className="min-w-0 flex flex-col overflow-hidden"
        >
          <ScrollArea className="flex-1 overflow-auto">
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
                              version: Number(selectedSources.pmtiles.version),
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
                    <div className="text-sm text-muted-foreground">
                      PMTiles format not available for this file.
                    </div>
                  )}
                  {pmtilesUrl && (
                    <div className="w-full min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-xs break-all">
                      {pmtilesUrl}
                    </div>
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
          </ScrollArea>
        </ResizablePanel>
        
        <ResizableHandle withHandle className="z-20" />
        
        <ResizablePanel
          defaultSize="70%"
          className="min-w-0 flex flex-col overflow-hidden"
          onResize={() => {
            mapRef.current?.resize();
          }}
        >
          <div className="relative flex-1 w-full overflow-hidden">
            {mapContent}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

