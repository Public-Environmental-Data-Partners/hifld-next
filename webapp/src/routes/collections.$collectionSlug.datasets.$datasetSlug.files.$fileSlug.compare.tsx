import { createFileRoute, Link, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import {
  buildCompareSearchForLocation,
  getComparableLocations,
  getVersionSourcesForLocation,
  hasAnyComparableLocations,
} from "@/components/dataset/compareSources";
import { VersionCompare } from "@/components/dataset/VersionCompare";
import { formatVersionLabel } from "@/components/dataset/versionLabel";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileById,
  getDatasetFileBySlug,
  getFileVersions,
} from "@/lib/api-client";

type CompareSearch = {
  format?: string;
  location?: number;
  v1?: string;
  v2?: string;
};

const compareSearchSchema = z
  .object({
    format: z.string().optional(),
    location: z.coerce.number().finite().optional(),
    v1: z.string().optional(),
    v2: z.string().optional(),
  })
  .catch({});

function parseCompareSearch(search: z.input<typeof compareSearchSchema>): CompareSearch {
  const parsed = compareSearchSchema.parse(search);
  const result: CompareSearch = {};
  if (parsed.format !== undefined) result.format = parsed.format;
  if (parsed.location !== undefined) result.location = parsed.location;
  if (parsed.v1 !== undefined) result.v1 = parsed.v1;
  if (parsed.v2 !== undefined) result.v2 = parsed.v2;
  return result;
}

function completeCompareSearch(next: CompareSearch, fallback: Required<CompareSearch>): Required<CompareSearch> {
  return {
    format: next.format ?? fallback.format,
    location: next.location ?? fallback.location,
    v1: next.v1 ?? fallback.v1,
    v2: next.v2 ?? fallback.v2,
  };
}

function compareSearchForFormat(format: string, location: number | undefined, v1: string, v2: string): CompareSearch {
  const result: CompareSearch = { format, v1, v2 };
  if (location !== undefined) result.location = location;
  return result;
}

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/compare")({
  validateSearch: parseCompareSearch,
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

function FileComparePage() {
  const { dataset, file, versions } = Route.useLoaderData();
  const params = Route.useParams();
  const search = useSearch({ from: Route.fullPath });
  const navigate = useNavigate({ from: Route.fullPath });

  const availableFormats = versions.formats.filter((formatEntry) => hasAnyComparableLocations(formatEntry));

  const selectedFormatType =
    search.format ??
    availableFormats.find((formatEntry) => formatEntry.format.format_type === "geoparquet")?.format.format_type ??
    availableFormats[0]?.format.format_type;

  const selectedFormat = availableFormats.find((formatEntry) => formatEntry.format.format_type === selectedFormatType);
  const comparableLocations = getComparableLocations(selectedFormat);
  const selectedLocationId =
    comparableLocations.find((location) => location.id === search.location)?.id ?? comparableLocations[0]?.id;
  const versionSources = getVersionSourcesForLocation(selectedFormat, selectedLocationId);

  const defaultSourceA = versionSources[0];
  const defaultSourceB = versionSources[1];

  const selectedSourceA = versionSources.find((source) => String(source.version) === search.v1) ?? defaultSourceA;
  const selectedSourceB = versionSources.find((source) => String(source.version) === search.v2) ?? defaultSourceB;

  if (!selectedFormat || !selectedLocationId || !selectedSourceA || !selectedSourceB) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-4 sm:p-6 md:p-8">
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

  const fallbackSearch: Required<CompareSearch> = {
    format: selectedFormat.format.format_type,
    location: selectedLocationId,
    v1: String(selectedSourceA.version),
    v2: String(selectedSourceB.version),
  };

  const updateSearch = (next: CompareSearch) =>
    navigate({
      search: completeCompareSearch(next, fallbackSearch),
      replace: true,
    });

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6 md:p-8">
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug" params={params}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to file
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">Compare Versions</h1>
          <p className="text-muted-foreground mt-2">
            {dataset.name} / {file.name}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Scope</h2>
            <p className="text-sm text-muted-foreground">Choose the format and storage location to compare within.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Format</div>
              <Select
                value={selectedFormat.format.format_type}
                onValueChange={(value) => {
                  const nextFormat = availableFormats.find((formatEntry) => formatEntry.format.format_type === value);
                  const nextLocationId = getComparableLocations(nextFormat)[0]?.id;
                  const nextSearch = buildCompareSearchForLocation(nextFormat, nextLocationId);
                  updateSearch(
                    compareSearchForFormat(value, nextLocationId, nextSearch?.v1 ?? "", nextSearch?.v2 ?? ""),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  {availableFormats.map((formatEntry) => (
                    <SelectItem key={formatEntry.format.format_type} value={formatEntry.format.format_type}>
                      {formatEntry.format.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Location</div>
              <Select
                value={String(selectedLocationId)}
                onValueChange={(value) => {
                  const nextSearch = buildCompareSearchForLocation(selectedFormat, Number(value));
                  updateSearch({
                    location: Number(value),
                    v1: nextSearch?.v1 ?? "",
                    v2: nextSearch?.v2 ?? "",
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {comparableLocations.map((location) => (
                    <SelectItem key={location.id} value={String(location.id)}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Versions</h2>
            <p className="text-sm text-muted-foreground">Pick the two versions to compare within the selected scope.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Version A</div>
              <Select value={String(selectedSourceA.version)} onValueChange={(value) => updateSearch({ v1: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version A" />
                </SelectTrigger>
                <SelectContent>
                  {versionSources.map((source) => (
                    <SelectItem key={`a-${source.id}`} value={String(source.version)}>
                      {formatVersionLabel(source.version)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Version B</div>
              <Select value={String(selectedSourceB.version)} onValueChange={(value) => updateSearch({ v2: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select version B" />
                </SelectTrigger>
                <SelectContent>
                  {versionSources.map((source) => (
                    <SelectItem key={`b-${source.id}`} value={String(source.version)}>
                      {formatVersionLabel(source.version)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <VersionCompare sourceA={selectedSourceA} sourceB={selectedSourceB} />
    </div>
  );
}
