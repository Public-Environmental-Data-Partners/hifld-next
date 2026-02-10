import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDatasetFileById, getDatasetFileBySlug, getCollectionBySlug, getDatasetBySlug } from "@/lib/api-client";
import type { DatasetFile } from "@/lib/api-client";
import { FileFormatTree } from "@/components/dataset/FileFormatTree";
import { ParquetViewerPanel } from "@/components/dataset/ParquetViewerPanel";
import {
  getOgcFeaturesUrl,
  getFullLayerName,
  getGeoPackageUrl,
  getGeoJsonUrl,
  getShapefileUrl,
} from "@/lib/api-client";

const GEOSERVER_EXPORT_SIZE_LIMIT_MB = 250;

export const Route = createFileRoute(
  "/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/"
)({
  loader: async ({ params }) => {
    try {
      const collection = await getCollectionBySlug({
        data: { slug: params.collectionSlug },
      });
      if (!collection) {
        throw notFound();
      }
      
      // Try to get dataset to find file ID (for optimization)
      // If files are already loaded (e.g., from parent route), we can use IDs
      const dataset = await getDatasetBySlug({
        data: {
          collectionSlug: params.collectionSlug,
          datasetSlug: params.datasetSlug,
          includeUrls: false, // We don't need full URLs here, just to find the file ID
        },
      });
      if (!dataset) {
        throw notFound();
      }
      
      // If dataset has files loaded, find file by slug and use ID-based endpoint
      const file = dataset.files?.find((f) => f.slug === params.fileSlug);
      if (file?.id && dataset.id) {
        // Use ID-based endpoint for better performance (no slug lookups needed)
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
      
      // Fallback to slug-based lookup if file not found in dataset files
      // (This happens when includeUrls=false doesn't return files)
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
    } catch (error) {
      console.error("Error in file detail loader:", error);
      throw error;
    }
  },
  component: FileDetailPage,
});

function FileDetailPage() {
  const { dataset, file } = Route.useLoaderData();
  const { collectionSlug, datasetSlug, fileSlug } = Route.useParams();
  const [selectedSources, setSelectedSources] = useState<
    Record<string, { storageLocationId: number; version: string | number }>
  >({});
  const [parquetViewer, setParquetViewer] = useState<{
    url: string;
    fileName: string;
  } | null>(null);

  // Initialize selected sources with the latest version for each format
  useEffect(() => {
    const initial: Record<
      string,
      { storageLocationId: number; version: string | number }
    > = {};
    file.formats?.forEach((formatEntry) => {
      const formatType = formatEntry.format.format_type;
      if (formatEntry.sources && formatEntry.sources.length > 0) {
        // Find the latest version for each storage location, then pick the first one
        type SourceType = NonNullable<
          DatasetFile["formats"]
        >[0]["sources"][0];
        type SourceEntry = { source: SourceType; version: string | number };
        const sourcesByLocation: Record<number, SourceEntry> = {};
        formatEntry.sources.forEach((source: SourceType) => {
          const locId = source.storage_location?.id;
          const version = source.version || "1";
          if (locId) {
            const existing = sourcesByLocation[locId];
            if (!existing) {
              sourcesByLocation[locId] = { source, version };
            } else {
              // Compare versions: dates (YYYY-MM-DD) or numbers
              const existingVersion = String(existing.version);
              const currentVersion = String(version);
              if (existingVersion.match(/^\d{4}-\d{2}-\d{2}$/) && currentVersion.match(/^\d{4}-\d{2}-\d{2}$/)) {
                // Both are dates, compare as strings (descending)
                if (currentVersion > existingVersion) {
                  sourcesByLocation[locId] = { source, version };
                }
              } else {
                const existingNum = Number(existingVersion);
                const currentNum = Number(currentVersion);
                if (!isNaN(existingNum) && !isNaN(currentNum)) {
                  if (currentNum > existingNum) {
                    sourcesByLocation[locId] = { source, version };
                  }
                } else if (currentVersion > existingVersion) {
                  sourcesByLocation[locId] = { source, version };
                }
              }
            }
          }
        });
        // Use the first storage location's latest version
        const firstEntry = Object.values(sourcesByLocation)[0] as
          | SourceEntry
          | undefined;
        if (firstEntry && firstEntry.source.storage_location?.id) {
          initial[formatType] = {
            storageLocationId: firstEntry.source.storage_location.id,
            version: firstEntry.version,
          };
        }
      }
    });
    setSelectedSources(initial);
  }, [file]);

  // Helper to get selected source for a format
  const getSelectedSource = (
    formatType: string
  ): NonNullable<DatasetFile["formats"]>[0]["sources"][0] | null => {
    const selection = selectedSources[formatType];
    if (!selection) return null;

    const formatEntry = file.formats?.find(
      (f) => f.format.format_type === formatType
    );
    if (!formatEntry || !formatEntry.sources) return null;

    return (
      formatEntry.sources.find(
        (s) =>
          s.storage_location?.id === selection.storageLocationId &&
          String(s.version || "1") === String(selection.version)
      ) || null
    );
  };

  // Helper to get URL from a source
  const getUrlFromSource = (
    source: NonNullable<DatasetFile["formats"]>[0]["sources"][0] | null
  ): string | null => {
    return source?.url || null;
  };

  // Get selected sources for each format
  const geoparquetSource = getSelectedSource("geoparquet");
  const pmtilesSource = getSelectedSource("pmtiles");
  const geoserverSource = getSelectedSource("geoserver");
  const geoserverStorageLocation = geoserverSource?.storage_location;
  const geoserverTotalSizeBytes = geoserverSource?.source_metadata?.size_bytes;
  const geoserverExportsEnabled =
    typeof geoserverTotalSizeBytes !== "number"
      ? true
      : geoserverTotalSizeBytes <=
        GEOSERVER_EXPORT_SIZE_LIMIT_MB * 1024 * 1024;

  // Extract URLs from selected sources
  const pmtilesUrl = getUrlFromSource(pmtilesSource);

  // URLs for the selected GeoServer source
  const ogcFeaturesUrl =
    geoserverSource && geoserverStorageLocation
      ? getOgcFeaturesUrl(geoserverSource, geoserverStorageLocation)
      : null;
  const fullLayerName = geoserverSource
    ? getFullLayerName(geoserverSource)
    : null;
  const geopackageUrl =
    geoserverExportsEnabled && geoserverSource && geoserverStorageLocation
      ? getGeoPackageUrl(geoserverSource, geoserverStorageLocation)
      : null;
  const geojsonUrl =
    geoserverExportsEnabled && geoserverSource && geoserverStorageLocation
      ? getGeoJsonUrl(geoserverSource, geoserverStorageLocation)
      : null;
  const shapefileUrl =
    geoserverExportsEnabled && geoserverSource && geoserverStorageLocation
      ? getShapefileUrl(geoserverSource, geoserverStorageLocation)
      : null;

  // Extract metadata from selected source
  const featureCount = geoparquetSource?.source_metadata?.feature_count;

  const cleanDescription = file.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  return (
    <div className="p-8 min-h-screen">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-[calc(100vh-4rem)]"
      >
        <ResizablePanel
          defaultSize={parquetViewer ? "70%" : "100%"}
          minSize="40%"
          className="min-h-0"
        >
          <ScrollArea className="h-full">
            <div className="max-w-4xl mx-auto space-y-8 pb-8">
              {/* Header */}
              <div>
                <Button variant="ghost" asChild className="mb-4">
                  <Link
                    to="/collections/$collectionSlug/datasets/$datasetSlug"
                    params={{
                      collectionSlug,
                      datasetSlug,
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to {dataset.name}
                  </Link>
                </Button>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h1 className="text-4xl font-mono font-bold tracking-tight break-words">
                      {file.name}
                    </h1>
                    {file.layer_name && (
                      <p className="text-muted-foreground mt-2">
                        Layer: <code className="text-sm">{file.layer_name}</code>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" asChild className="font-mono">
                      <a
                        href={`/api/collections/${collectionSlug}/datasets/${datasetSlug}/files/${fileSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View Metadata
                      </a>
                    </Button>
                    <Button asChild>
                      <Link
                        to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/viewer"
                        params={{
                          collectionSlug,
                          datasetSlug,
                          fileSlug,
                        }}
                      >
                        Open Map Viewer
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {cleanDescription && (
                  <>
                    <div>
                      <h4 className="font-medium mb-2">Description</h4>
                      <p className="text-sm text-muted-foreground break-words">
                        {cleanDescription}
                      </p>
                    </div>
                    <Separator />
                  </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {featureCount && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Features</p>
                      <p className="font-medium">{featureCount.toLocaleString()}</p>
                    </div>
                  )}
                  {file.file_metadata?.geometry_type && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Geometry Type</p>
                      <p className="font-medium">{file.file_metadata.geometry_type}</p>
                    </div>
                  )}
                  {file.file_metadata?.bounds && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Bounds</p>
                      <p className="font-mono text-xs">
                        [{file.file_metadata.bounds.join(", ")}]
                      </p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Filesystem-like format tree */}
                <FileFormatTree
                  file={file}
                  selectedSources={selectedSources}
                  onSourceChange={(formatType, storageLocationId, version) => {
                    setSelectedSources((prev) => ({
                      ...prev,
                      [formatType]: { storageLocationId, version },
                    }));
                  }}
                  onViewParquet={(url, fileName) => {
                    setParquetViewer({ url, fileName });
                  }}
                  ogcFeaturesUrl={ogcFeaturesUrl}
                  fullLayerName={fullLayerName}
                  geopackageUrl={geopackageUrl}
                  geojsonUrl={geojsonUrl}
                  shapefileUrl={shapefileUrl}
                  geoserverExportsEnabled={geoserverExportsEnabled}
                  pmtilesUrl={pmtilesUrl}
                />

                <Separator />

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Created: {new Date(file.created_at).toLocaleString()}</p>
                  <p>Updated: {new Date(file.updated_at).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </ResizablePanel>

        {parquetViewer && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              defaultSize="30%"
              minSize="20%"
              maxSize="60%"
              className="min-h-[240px]"
            >
              <ParquetViewerPanel
                url={parquetViewer.url}
                fileName={parquetViewer.fileName}
                onClose={() => setParquetViewer(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

