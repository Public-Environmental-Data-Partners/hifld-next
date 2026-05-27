import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { getComparableVersionSources, getDefaultCompareVersionPair } from "@/components/dataset/compareSources";
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

function FileComparePage() {
  const { dataset, file, versions } = Route.useLoaderData();
  const params = Route.useParams();

  const versionSources = getComparableVersionSources(versions.formats);
  const { left: defaultSourceA, right: defaultSourceB } = getDefaultCompareVersionPair(versionSources);
  const [selectedVersionA, setSelectedVersionA] = useState(() => String(defaultSourceA?.version ?? ""));
  const [selectedVersionB, setSelectedVersionB] = useState(() => String(defaultSourceB?.version ?? ""));

  const selectedSourceA =
    versionSources.find((source) => String(source.version) === selectedVersionA) ?? defaultSourceA;
  const selectedSourceB =
    versionSources.find((source) => String(source.version) === selectedVersionB) ?? defaultSourceB;

  if (!selectedSourceA || !selectedSourceB) {
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
            <h2 className="text-sm font-medium">Versions</h2>
            <p className="text-sm text-muted-foreground">
              Pick the two file versions to compare. Metadata is resolved from the best available source for each
              version.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Version A</div>
              <Select value={String(selectedSourceA.version)} onValueChange={setSelectedVersionA}>
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
              <Select value={String(selectedSourceB.version)} onValueChange={setSelectedVersionB}>
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

      <VersionCompare
        leftSource={selectedSourceA}
        rightSource={selectedSourceB}
        leftLabel={`Version ${formatVersionLabel(selectedSourceA.version)}`}
        rightLabel={`Version ${formatVersionLabel(selectedSourceB.version)}`}
      />
    </div>
  );
}
