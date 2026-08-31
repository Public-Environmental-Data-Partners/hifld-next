import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, MapIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { getComparableVersionSources, getDefaultCompareVersionPair } from "@/components/dataset/compareSources";
import { VersionCompare } from "@/components/dataset/VersionCompare";
import { formatVersionLabel } from "@/components/dataset/versionLabel";
import {
  descriptorForSource,
  encodeSourceDescriptorList,
  type SourceDescriptor,
} from "@/components/map/sourceDescriptors";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type DatasetFormat,
  type DatasetSource,
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileById,
  getDatasetFileBySlug,
  getFileVersions,
} from "@/lib/api-client";
import { failure, success } from "@/lib/webmcp/result";
import { useWebMcpTool } from "@/lib/webmcp/useWebMcpTool";
import { compareFileVersions } from "@/lib/webmcp/versionComparisonTool";

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/compare")({
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
      const fileResponse = await getDatasetFileById({
        data: {
          collectionId: collection.id,
          datasetId: dataset.id,
          fileId: file.id,
        },
      });
      const versions = await getFileVersions({
        data: {
          collectionId: collection.id,
          datasetId: dataset.id,
          fileId: file.id,
        },
      });
      return { collection, dataset: fileResponse.dataset, file: fileResponse.file, versions };
    }

    const fileResponse = await getDatasetFileBySlug({
      data: {
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        fileSlug: params.fileSlug,
      },
    });
    if (!fileResponse) {
      throw notFound();
    }

    return {
      collection,
      dataset: fileResponse.dataset,
      file: fileResponse.file,
      versions: {
        dataset_id: fileResponse.dataset.id,
        file_id: fileResponse.file.id,
        formats: fileResponse.file.formats ?? [],
      },
    };
  },
  component: FileComparePage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
});

export function pmtilesDescriptorForVersion({
  collectionSlug,
  datasetSlug,
  fileSlug,
  formats,
  source,
}: {
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  formats: DatasetFormat[] | undefined;
  source: DatasetSource | undefined;
}): SourceDescriptor | null {
  if (!source) return null;
  const pmtilesFormat = formats?.find((formatEntry) => formatEntry.format.format_type === "pmtiles");
  const pmtilesSource = pmtilesFormat?.sources?.find(
    (candidate) => String(candidate.version ?? "1") === String(source.version ?? "1"),
  );
  if (!pmtilesSource) return null;
  return descriptorForSource({
    collectionSlug,
    datasetSlug,
    fileSlug,
    formatType: "pmtiles",
    source: pmtilesSource,
  });
}

export function comparisonMapPath(collectionSlug: string, descriptors: SourceDescriptor[]): string | undefined {
  if (descriptors.length !== 2) return undefined;
  const encodedSources = encodeSourceDescriptorList(descriptors);
  if (!encodedSources) return undefined;
  return `/collections/${encodeURIComponent(collectionSlug)}/map?sources=${encodeURIComponent(encodedSources)}`;
}

export function comparisonSourcesForVersions(
  sources: DatasetSource[],
  leftVersion: string | number,
  rightVersion: string | number,
): { left: DatasetSource; right: DatasetSource } | null {
  const left = sources.find((source) => sourceVersionKey(source) === String(leftVersion));
  const right = sources.find((source) => sourceVersionKey(source) === String(rightVersion));
  return left && right ? { left, right } : null;
}

function sourceVersionKey(source: DatasetSource): string {
  return String(source.version ?? "1");
}

const compareFileVersionsInputSchema = z
  .object({
    left_version: z.union([z.string().min(1), z.number()]),
    right_version: z.union([z.string().min(1), z.number()]),
  })
  .strict();

const compareFileVersionsAnnotations: WebMCP.ToolAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: true,
};

type PendingComparison = {
  left: string;
  right: string;
  resolve: () => void;
};

function FileComparePage() {
  const { dataset, file, versions } = Route.useLoaderData();
  const params = Route.useParams();

  const versionSources = getComparableVersionSources(versions.formats);
  const { left: defaultSourceA, right: defaultSourceB } = getDefaultCompareVersionPair(versionSources);
  const [selectedVersionA, setSelectedVersionA] = useState(() => String(defaultSourceA?.version ?? ""));
  const [selectedVersionB, setSelectedVersionB] = useState(() => String(defaultSourceB?.version ?? ""));
  const pendingComparison = useRef<PendingComparison | null>(null);

  useEffect(() => {
    const pending = pendingComparison.current;
    if (!pending || pending.left !== selectedVersionA || pending.right !== selectedVersionB) return;
    pendingComparison.current = null;
    queueMicrotask(pending.resolve);
  }, [selectedVersionA, selectedVersionB]);

  const selectedSourceA =
    versionSources.find((source) => sourceVersionKey(source) === selectedVersionA) ?? defaultSourceA;
  const selectedSourceB =
    versionSources.find((source) => sourceVersionKey(source) === selectedVersionB) ?? defaultSourceB;

  useWebMcpTool({
    name: "compare_file_versions",
    title: "Compare file versions",
    description: "Compare metadata and schema changes between two versions of the current file.",
    schema: compareFileVersionsInputSchema,
    enabled: versionSources.length >= 2 && Boolean(selectedSourceA && selectedSourceB),
    annotations: compareFileVersionsAnnotations,
    execute: async ({ left_version, right_version }) => {
      const selectedSources = comparisonSourcesForVersions(versionSources, left_version, right_version);
      if (!selectedSources) {
        return failure("not_found", "Both versions must be available for this file.");
      }
      const { left: sourceA, right: sourceB } = selectedSources;

      const left = sourceVersionKey(sourceA);
      const right = sourceVersionKey(sourceB);
      if (left === selectedVersionA && right === selectedVersionB) {
        await Promise.resolve();
      } else {
        const rendered = new Promise<void>((resolve) => {
          pendingComparison.current = { left, right, resolve };
        });
        setSelectedVersionA(left);
        setSelectedVersionB(right);
        await rendered;
      }

      const comparison = compareFileVersions(sourceA, sourceB);
      const leftDescriptor = pmtilesDescriptorForVersion({
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        fileSlug: params.fileSlug,
        formats: versions.formats,
        source: sourceA,
      });
      const rightDescriptor = pmtilesDescriptorForVersion({
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        fileSlug: params.fileSlug,
        formats: versions.formats,
        source: sourceB,
      });
      const mapPath =
        leftDescriptor && rightDescriptor
          ? comparisonMapPath(params.collectionSlug, [leftDescriptor, rightDescriptor])
          : undefined;
      return success(
        `Compared ${formatVersionLabel(sourceA.version)} with ${formatVersionLabel(sourceB.version)}.`,
        mapPath ? { ...comparison, map_link: mapPath } : comparison,
      );
    },
  });

  if (!selectedSourceA || !selectedSourceB) {
    return (
      <div className="mx-auto box-border w-full max-w-[100vw] min-w-0 space-y-6 overflow-x-hidden px-4 py-4 sm:max-w-4xl sm:px-6 sm:py-6 md:px-8 md:py-8">
        <Button variant="ghost" asChild>
          <Link to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug" params={params}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to file
          </Link>
        </Button>
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          No comparable versions are available for this file yet.
        </div>
      </div>
    );
  }

  const mapDescriptors = [
    pmtilesDescriptorForVersion({
      collectionSlug: params.collectionSlug,
      datasetSlug: params.datasetSlug,
      fileSlug: params.fileSlug,
      formats: versions.formats,
      source: selectedSourceA,
    }),
    pmtilesDescriptorForVersion({
      collectionSlug: params.collectionSlug,
      datasetSlug: params.datasetSlug,
      fileSlug: params.fileSlug,
      formats: versions.formats,
      source: selectedSourceB,
    }),
  ].filter((descriptor): descriptor is SourceDescriptor => descriptor !== null);
  const encodedMapSources = encodeSourceDescriptorList(mapDescriptors);
  const mapSearch = encodedMapSources ? { sources: encodedMapSources } : {};
  const mapButtonLabel =
    mapDescriptors.length > 1
      ? "Open versions in map"
      : mapDescriptors.length === 1
        ? "Open available layer in map"
        : "No map layers available";

  return (
    <div className="mx-auto box-border w-full max-w-[100vw] min-w-0 space-y-8 overflow-x-hidden px-4 py-4 sm:max-w-5xl sm:px-6 sm:py-6 md:px-8 md:py-8">
      <div className="min-w-0 space-y-4">
        <Button variant="ghost" asChild>
          <Link to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug" params={params}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to file
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">Compare Versions</h1>
          <p className="mt-2 break-words text-muted-foreground">
            {dataset.name} / {file.name}
          </p>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Versions</h2>
              <p className="break-words text-sm text-muted-foreground">
                Pick the two file versions to compare. Metadata is resolved from the best available source for each
                version.
              </p>
            </div>
            {mapDescriptors.length > 0 ? (
              <Button variant="outline" size="sm" asChild className="w-full shrink-0 sm:w-auto">
                <Link
                  to="/collections/$collectionSlug/map"
                  params={{ collectionSlug: params.collectionSlug }}
                  search={mapSearch}
                >
                  <MapIcon className="h-4 w-4" />
                  {mapButtonLabel}
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled className="w-full shrink-0 sm:w-auto">
                <MapIcon className="h-4 w-4" />
                {mapButtonLabel}
              </Button>
            )}
          </div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <div className="text-sm text-muted-foreground">Version A</div>
              <Select value={sourceVersionKey(selectedSourceA)} onValueChange={setSelectedVersionA}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version A" />
                </SelectTrigger>
                <SelectContent>
                  {versionSources.map((source) => (
                    <SelectItem key={`a-${source.id}`} value={sourceVersionKey(source)}>
                      {formatVersionLabel(source.version)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-2">
              <div className="text-sm text-muted-foreground">Version B</div>
              <Select value={sourceVersionKey(selectedSourceB)} onValueChange={setSelectedVersionB}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version B" />
                </SelectTrigger>
                <SelectContent>
                  {versionSources.map((source) => (
                    <SelectItem key={`b-${source.id}`} value={sourceVersionKey(source)}>
                      {formatVersionLabel(source.version)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <VersionCompare
        leftSource={selectedSourceA}
        rightSource={selectedSourceB}
        leftLabel={`Version ${formatVersionLabel(selectedSourceA.version)}`}
        rightLabel={`Version ${formatVersionLabel(selectedSourceB.version)}`}
      />
    </div>
  );
}
