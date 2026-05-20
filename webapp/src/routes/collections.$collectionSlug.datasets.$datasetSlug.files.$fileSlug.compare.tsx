import { createFileRoute, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageLoader } from "@/components/ui/page-loader";
import { VersionCompare } from "@/components/dataset/VersionCompare";
import {
  buildCompareSearchForLocation,
  getComparableLocations,
  getVersionSourcesForLocation,
  hasAnyComparableLocations,
} from "@/components/dataset/compareSources";
import { formatVersionLabel } from "@/components/dataset/versionLabel";
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

function parseLocationSearchValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "number" ? parsed : typeof parsed === "string" ? Number(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export const Route = createFileRoute(
  "/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/compare"
)({
  validateSearch: (search: Record<string, unknown> | undefined): CompareSearch => ({
    format: typeof search?.format === "string" ? search.format : undefined,
    location: parseLocationSearchValue(search?.location),
    v1: typeof search?.v1 === "string" ? search.v1 : undefined,
    v2: typeof search?.v2 === "string" ? search.v2 : undefined,
  }),
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
    availableFormats.find((formatEntry) => formatEntry.format.format_type === "geoparquet")
      ?.format.format_type ??
    availableFormats[0]?.format.format_type;

  const selectedFormat = availableFormats.find(
    (formatEntry) => formatEntry.format.format_type === selectedFormatType
  );
  const comparableLocations = getComparableLocations(selectedFormat);
  const selectedLocationId =
    comparableLocations.find((location) => location.id === search.location)?.id ??
    comparableLocations[0]?.id;
  const versionSources = getVersionSourcesForLocation(selectedFormat, selectedLocationId);

  const defaultSourceA = versionSources[0];
  const defaultSourceB = versionSources[1];

  const selectedSourceA =
    versionSources.find((source) => String(source.version) === search.v1) ?? defaultSourceA;
  const selectedSourceB =
    versionSources.find((source) => String(source.version) === search.v2) ?? defaultSourceB;

  if (!selectedFormat || !selectedLocationId || !selectedSourceA || !selectedSourceB) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-4 sm:p-6 md:p-8">
        <Button variant="ghost" asChild>
          <Link
            to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
            params={params}
          >
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

  const updateSearch = (next: CompareSearch) =>
    navigate({
      search: {
        format: next.format ?? selectedFormatType,
        location: next.location ?? selectedLocationId,
        v1: next.v1 ?? String(selectedSourceA.version),
        v2: next.v2 ?? String(selectedSourceB.version),
      },
      replace: true,
    });

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6 md:p-8">
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link
            to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
            params={params}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to file
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">
            Compare Versions
          </h1>
          <p className="text-muted-foreground mt-2">
            {dataset.name} / {file.name}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Scope</h2>
            <p className="text-sm text-muted-foreground">
              Choose the format and storage location to compare within.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Format</label>
              <Select
                value={selectedFormatType}
                onValueChange={(value) => {
                  const nextFormat = availableFormats.find(
                    (formatEntry) => formatEntry.format.format_type === value
                  );
                  const nextLocationId = getComparableLocations(nextFormat)[0]?.id;
                  const nextSearch = buildCompareSearchForLocation(nextFormat, nextLocationId);
                  updateSearch({
                    format: value,
                    location: nextLocationId,
                    v1: nextSearch?.v1 ?? "",
                    v2: nextSearch?.v2 ?? "",
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  {availableFormats.map((formatEntry) => (
                    <SelectItem
                      key={formatEntry.format.format_type}
                      value={formatEntry.format.format_type}
                    >
                      {formatEntry.format.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Location</label>
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
            <p className="text-sm text-muted-foreground">
              Pick the two versions to compare within the selected scope.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Version A</label>
              <Select
                value={String(selectedSourceA.version)}
                onValueChange={(value) => updateSearch({ v1: value })}
              >
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
              <label className="text-sm text-muted-foreground">Version B</label>
              <Select
                value={String(selectedSourceB.version)}
                onValueChange={(value) => updateSearch({ v2: value })}
              >
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
