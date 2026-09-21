import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, FileJson, GitCompare, MapIcon, MessageSquareWarning, Table } from "lucide-react";
import { useEffect, useState } from "react";
import { hasComparableVersions } from "@/components/dataset/compareSources";
import { DataQualityFeedbackDialog } from "@/components/dataset/DataQualityFeedbackDialog";
import { FileFormatTree } from "@/components/dataset/FileFormatTree";
import { findSelectedParquetOption, ParquetPreviewDrawer } from "@/components/dataset/ParquetPreviewDrawer";
import {
  concreteParquetPreviewOptions,
  defaultParquetPreviewSelection,
  type ParquetPreviewOption,
  type ParquetPreviewSelection,
} from "@/components/dataset/parquetPreviewOptions";
import { hasSchemaMetadata } from "@/components/dataset/schemaSources";
import { buildSourceFileUrl } from "@/components/dataset/sourceUrls";
import { compareVersionValues } from "@/components/dataset/versionLabel";
import { hasUsablePmtilesAsset } from "@/components/map/mapEligibility";
import { descriptorForSource, encodeSourceDescriptor } from "@/components/map/sourceDescriptors";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import type { DatasetFile, SourceDates, SourceDatesByVersion } from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileBySlug } from "@/lib/api-client";
import { buildDatasetJsonLd, datasetKeywords, pageTitle, plainTextForSeo, seoDescription } from "@/lib/seo";

type FileFormat = NonNullable<DatasetFile["formats"]>[number];
type FileSource = FileFormat["sources"][number];

interface SelectedSource {
  storageLocationId: string;
  version: string | number;
}

interface SelectedSourcesByFormat {
  [formatType: string]: SelectedSource;
}

export function fileSourceDateEntries(sourceDates: SourceDates | undefined): Array<{ label: string; value: string }> {
  const entries = [
    { label: "Source issued", value: sourceDates?.issued },
    { label: "Source modified", value: sourceDates?.modified },
  ];
  return entries.flatMap((entry) => (entry.value ? [{ label: entry.label, value: entry.value }] : []));
}

function datedValue(value: string | undefined): { value: string; timestamp: number } | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : { value, timestamp };
}

export function fileSourceDateHistoryEntries(
  sourceDatesByVersion: SourceDatesByVersion | undefined,
): Array<{ label: string; value: string }> {
  const versions = Object.values(sourceDatesByVersion ?? {}).flatMap((dates) => (dates ? [dates] : []));
  const issued = versions.flatMap((dates) => {
    const value = datedValue(dates.issued);
    return value ? [value] : [];
  });
  const activity = versions.flatMap((dates) =>
    [dates.issued, dates.modified].flatMap((candidate) => {
      const value = datedValue(candidate);
      return value ? [value] : [];
    }),
  );
  const firstIssued = issued.sort((left, right) => left.timestamp - right.timestamp)[0]?.value;
  const latestActivity = activity.sort((left, right) => right.timestamp - left.timestamp)[0]?.value;
  return [
    { label: "First issued", value: firstIssued },
    { label: "Latest source activity", value: latestActivity },
  ].flatMap((entry) => (entry.value ? [{ label: entry.label, value: entry.value }] : []));
}

function latestSourcesByLocation(sources: FileSource[]): Map<string, { source: FileSource; version: string | number }> {
  const sourcesByLocation = new Map<string, { source: FileSource; version: string | number }>();
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
    if (firstEntry && storageLocationId) {
      initial[formatEntry.format.format_type] = {
        storageLocationId,
        version: firstEntry.version,
      };
    }
  }
  return initial;
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
  head: ({ loaderData, params }) => {
    const dataset = loaderData?.dataset;
    const file = loaderData?.file;
    const fileName = file?.name ?? params.fileSlug;
    const title = pageTitle(dataset?.name ? `${fileName} | ${dataset.name}` : fileName);
    // Fall back to the parent dataset description so the JSON-LD/meta are not empty
    // when a file carries no description of its own.
    const description = seoDescription(file?.description ?? dataset?.description);
    const canonical = `/collections/${encodeURIComponent(params.collectionSlug)}/datasets/${encodeURIComponent(
      params.datasetSlug,
    )}/files/${encodeURIComponent(params.fileSlug)}`;
    const metadataUrl = `/api/collections/${encodeURIComponent(params.collectionSlug)}/datasets/${encodeURIComponent(
      params.datasetSlug,
    )}/files/${encodeURIComponent(params.fileSlug)}/metadata`;

    const jsonLd = buildDatasetJsonLd({
      name: fileName,
      description: file?.description ?? dataset?.description,
      url: canonical,
      metadataUrl,
      keywords: datasetKeywords(dataset?.tags),
      isPartOf: dataset?.name ? { type: "Dataset", name: dataset.name } : undefined,
    });

    return {
      meta: [
        { title },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: title },
        ...(description ? [{ property: "og:description", content: description }] : []),
      ],
      links: [
        { rel: "canonical", href: canonical },
        {
          rel: "alternate",
          type: "application/json",
          href: metadataUrl,
          title: "File metadata JSON",
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    };
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
  const [parquetSelection, setParquetSelection] = useState<ParquetPreviewSelection | null>(null);

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
  const geoparquetFormat = file.formats?.find((f) => f.format.format_type === "geoparquet");
  const parquetPreviewOptions = concreteParquetPreviewOptions(geoparquetFormat);

  // Extract URLs from selected sources
  const pmtilesUrl = getUrlFromSource(pmtilesSource);
  const hasMapAsset = hasUsablePmtilesAsset(pmtilesSource);
  const pmtilesDescriptor =
    hasMapAsset && pmtilesSource
      ? descriptorForSource({
          collectionSlug,
          datasetSlug,
          fileSlug,
          source: pmtilesSource,
        })
      : null;
  const mapSearch = {
    ...(pmtilesDescriptor ? { source: encodeSourceDescriptor(pmtilesDescriptor) } : {}),
  };

  // Extract metadata from selected source
  const featureCount = geoparquetSource?.source_metadata?.feature_count;

  const canCompareVersions = hasComparableVersions(file.formats);
  const canViewSchema = hasSchemaMetadata(file.formats);
  const selectParquetOption = (option: ParquetPreviewOption) => {
    setParquetSelection({
      storageLocationId: option.storageLocationId,
      version: option.version,
      sourceId: option.sourceId,
    });
    setSelectedSources((prev) => ({
      ...prev,
      geoparquet: {
        storageLocationId: option.storageLocationId,
        version: option.version,
      },
    }));
    setParquetViewer({ url: option.url, fileName: option.fileName });
  };

  const openParquetDrawer = () => {
    const selection = defaultParquetPreviewSelection(geoparquetFormat, geoparquetSource);
    const option = findSelectedParquetOption(parquetPreviewOptions, selection);
    if (option) {
      selectParquetOption(option);
    }
  };

  const cleanDescription = plainTextForSeo(file.description);

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
        <div className="space-y-5">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold tracking-tight break-words">
              {file.name}
            </h1>
            {file.layer_name && (
              <p className="text-muted-foreground mt-2 break-words">
                Layer: <code className="text-sm">{file.layer_name}</code>
              </p>
            )}
          </div>
          <div className="space-y-3 border-y py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {hasMapAsset && (
                <Button asChild className="h-12 justify-start px-4 sm:justify-center">
                  <Link to="/collections/$collectionSlug/map" params={{ collectionSlug }} search={mapSearch}>
                    <MapIcon className="h-4 w-4 mr-2 shrink-0" />
                    Map Viewer
                  </Link>
                </Button>
              )}
              {parquetPreviewOptions.length > 0 && (
                <Button
                  variant="outline"
                  onClick={openParquetDrawer}
                  className="h-12 justify-start px-4 sm:justify-center"
                >
                  <Table className="h-4 w-4 mr-2 shrink-0" />
                  Data Table
                </Button>
              )}
            </div>
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-10 justify-start px-3 font-normal text-muted-foreground"
              >
                <a
                  href={`/api/collections/${encodeURIComponent(collectionSlug)}/datasets/${encodeURIComponent(datasetSlug)}/files/${encodeURIComponent(fileSlug)}/metadata`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileJson className="h-4 w-4 mr-1.5 shrink-0" />
                  View metadata
                </a>
              </Button>
              <DataQualityFeedbackDialog
                context={{ collectionSlug, datasetSlug, fileSlug }}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 justify-start px-3 font-normal text-muted-foreground"
                  >
                    <MessageSquareWarning className="h-4 w-4 mr-1.5 shrink-0" />
                    Report issue
                  </Button>
                }
              />
              {canViewSchema && (
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-10 justify-start px-3 font-normal text-muted-foreground"
                >
                  <Link
                    to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/schema"
                    params={{ collectionSlug, datasetSlug, fileSlug }}
                  >
                    <BookOpen className="h-4 w-4 mr-1.5 shrink-0" />
                    Schema
                  </Link>
                </Button>
              )}
              {canCompareVersions && (
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-10 justify-start px-3 font-normal text-muted-foreground"
                >
                  <Link
                    to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/compare"
                    params={{ collectionSlug, datasetSlug, fileSlug }}
                  >
                    <GitCompare className="h-4 w-4 mr-1.5 shrink-0" />
                    Compare versions
                  </Link>
                </Button>
              )}
            </div>
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
          onViewParquet={selectParquetOption}
          pmtilesUrl={pmtilesUrl}
          collectionId={collection.id}
          collectionSlug={collectionSlug}
          datasetSlug={datasetSlug}
          fileSlug={fileSlug}
        />

        <Separator />

        <div className="text-xs text-muted-foreground space-y-1">
          {fileSourceDateHistoryEntries(file.source_dates_by_version).map(({ label, value }) => (
            <p key={label}>
              {label}: {value}
            </p>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {parquetViewer ? (
        <div className="h-[calc(100vh-4rem)]">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="45%" minSize="25%" className="min-h-0 overflow-y-auto">
              {content}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ParquetPreviewDrawer
              options={parquetPreviewOptions}
              selection={parquetSelection}
              viewer={parquetViewer}
              onSelectOption={selectParquetOption}
              onClose={() => setParquetViewer(null)}
            />
          </ResizablePanelGroup>
        </div>
      ) : (
        content
      )}
    </div>
  );
}
