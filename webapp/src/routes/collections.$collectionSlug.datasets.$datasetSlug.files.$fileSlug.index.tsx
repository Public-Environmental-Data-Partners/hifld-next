import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Table } from "lucide-react";
import { useEffect, useState } from "react";
import { FileFormatTree } from "@/components/dataset/FileFormatTree";
import { ParquetViewerPanel } from "@/components/dataset/ParquetViewerPanel";
import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import { compareVersionValues } from "@/components/dataset/versionLabel";
import { descriptorForSource, encodeSourceDescriptor } from "@/components/map/sourceDescriptors";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import type { DatasetFile } from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileById, getDatasetFileBySlug } from "@/lib/api-client";

type FileFormat = NonNullable<DatasetFile["formats"]>[number];
type FileSource = FileFormat["sources"][number];

interface SelectedSource {
  storageLocationId: number;
  version: string | number;
}

interface SelectedSourcesByFormat {
  [formatType: string]: SelectedSource;
}

interface ParquetFilePreview {
  url: string;
  fileName: string;
}

function latestSourcesByLocation(sources: FileSource[]): Map<number, { source: FileSource; version: string | number }> {
  const sourcesByLocation = new Map<number, { source: FileSource; version: string | number }>();
  for (const source of sources) {
    const locId = source.storage_location?.id;
    const version = source.version || "1";
    if (!locId) {
      continue;
    }

    const existing = sourcesByLocation.get(locId);
    if (!existing || compareVersionValues(version, existing.version) < 0) {
      sourcesByLocation.set(locId, { source, version });
    }
  }
  return sourcesByLocation;
}

function initialSelectedSources(file: DatasetFile): SelectedSourcesByFormat {
  const initial: SelectedSourcesByFormat = {};
  for (const formatEntry of file.formats ?? []) {
    const firstEntry = Array.from(latestSourcesByLocation(formatEntry.sources).values())[0];
    const storageLocationId = firstEntry?.source.storage_location?.id;
    if (firstEntry && storageLocationId !== undefined && storageLocationId !== 0) {
      initial[formatEntry.format.format_type] = {
        storageLocationId,
        version: firstEntry.version,
      };
    }
  }
  return initial;
}

function sourcePath(source: FileSource): string | undefined {
  return "path" in source.location ? source.location.path : undefined;
}

function parquetPreviewFromSource(source: FileSource | null): ParquetFilePreview | null {
  if (!source) {
    return null;
  }

  const url = buildSourceFileUrl(source);
  const path = sourcePath(source);
  if (!url || !path || path.includes("*")) {
    return null;
  }

  return {
    url,
    fileName: path.split("/").pop() || "data.parquet",
  };
}

function firstParquetFilePreview(file: DatasetFile, selectedSource: FileSource | null): ParquetFilePreview | null {
  const selectedPreview = parquetPreviewFromSource(selectedSource);
  if (selectedPreview) {
    return selectedPreview;
  }

  const geoparquetFormat = file.formats?.find((f) => f.format.format_type === "geoparquet");
  for (const source of geoparquetFormat?.sources ?? []) {
    const preview = parquetPreviewFromSource(source);
    if (preview) {
      return preview;
    }
  }

  return null;
}

function FileDetailPending() {
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  );
}

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/")({
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
  pendingComponent: FileDetailPending,
  pendingMs: 200,
});

function FileDetailPage() {
  const { collection, dataset, file } = Route.useLoaderData();
  const { collectionSlug, datasetSlug, fileSlug } = Route.useParams();
  const [selectedSources, setSelectedSources] = useState<SelectedSourcesByFormat>({});
  const [parquetViewer, setParquetViewer] = useState<{
    url: string;
    fileName: string;
  } | null>(null);

  // Initialize selected sources with the latest version for each format
  useEffect(() => {
    setSelectedSources(initialSelectedSources(file));
  }, [file]);

  // Helper to get selected source for a format
  const getSelectedSource = (formatType: string): FileSource | null => {
    const selection = selectedSources[formatType];
    if (!selection) return null;

    const formatEntry = file.formats?.find((f) => f.format.format_type === formatType);
    if (!formatEntry?.sources) return null;

    return (
      formatEntry.sources.find(
        (s) =>
          s.storage_location?.id === selection.storageLocationId &&
          String(s.version || "1") === String(selection.version),
      ) || null
    );
  };

  // Helper to get URL from a source
  const getUrlFromSource = (source: FileSource | null): string | null => {
    return source ? buildSourceFileUrl(source) : null;
  };

  // Get selected sources for each format
  const geoparquetSource = getSelectedSource("geoparquet");
  const pmtilesSource = getSelectedSource("pmtiles");

  // Extract URLs from selected sources
  const pmtilesUrl = getUrlFromSource(pmtilesSource);
  const pmtilesDescriptor = pmtilesSource
    ? descriptorForSource({
        collectionSlug,
        datasetSlug,
        fileSlug,
        formatType: "pmtiles",
        source: pmtilesSource,
      })
    : null;
  const mapSearch = {
    ...(pmtilesDescriptor ? { source: encodeSourceDescriptor(pmtilesDescriptor) } : {}),
  };

  // Extract metadata from selected source
  const featureCount = geoparquetSource?.source_metadata?.feature_count;

  const firstParquetFile = firstParquetFilePreview(file, geoparquetSource);

  const cleanDescription = file.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  const content = (
    <div className="max-w-4xl mx-auto space-y-8 p-4 sm:p-6 md:p-8">
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
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold tracking-tight break-words">
              {file.name}
            </h1>
            {file.layer_name && (
              <p className="text-muted-foreground mt-2 break-words">
                Layer: <code className="text-sm">{file.layer_name}</code>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 min-w-0 sm:min-w-[200px]">
            <Button variant="outline" asChild className="font-mono w-full">
              <a
                href={`/api/collections/${collectionSlug}/datasets/${datasetSlug}/files/${fileSlug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Metadata
              </a>
            </Button>
            <Button asChild className="w-full">
              <Link to="/collections/$collectionSlug/map" params={{ collectionSlug }} search={mapSearch}>
                Map Viewer
              </Link>
            </Button>
            {firstParquetFile && (
              <Button variant="outline" onClick={() => setParquetViewer(firstParquetFile)} className="w-full">
                <Table className="h-4 w-4 mr-2 shrink-0" />
                Data Table
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {cleanDescription && (
          <>
            <div>
              <h4 className="font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground break-words">{cleanDescription}</p>
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
              <p className="font-mono text-xs">[{file.file_metadata.bounds.join(", ")}]</p>
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
          pmtilesUrl={pmtilesUrl}
          collectionId={collection.id}
          collectionSlug={collectionSlug}
          datasetSlug={datasetSlug}
          fileSlug={fileSlug}
        />

        <Separator />

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Created: {new Date(file.created_at).toLocaleString()}</p>
          <p>Updated: {new Date(file.updated_at).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {parquetViewer ? (
        <ResizablePanelGroup orientation="vertical" className="min-h-[calc(100vh-4rem)]">
          <ResizablePanel defaultSize="70%" minSize="40%" className="min-h-0 overflow-y-auto">
            {content}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="30%"
            minSize="20%"
            maxSize="60%"
            className="min-h-[240px] overflow-hidden flex flex-col"
          >
            <ParquetViewerPanel
              url={parquetViewer.url}
              fileName={parquetViewer.fileName}
              onClose={() => setParquetViewer(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        content
      )}
    </div>
  );
}
