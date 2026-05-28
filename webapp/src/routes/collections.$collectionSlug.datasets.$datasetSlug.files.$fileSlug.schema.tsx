import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { SchemaViewer } from "@/components/dataset/SchemaViewer";
import {
  getBestSchemaSourceForVersion,
  getLatestSchemaVersion,
  getSchemaVersionOptions,
} from "@/components/dataset/schemaSources";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileById,
  getDatasetFileBySlug,
  getFileVersions,
} from "@/lib/api-client";

const schemaSearchSchema = z
  .object({
    version: z.string().optional(),
  })
  .catch({});

type SchemaSearch = {
  version?: string;
};

function parseSchemaSearch(search: z.input<typeof schemaSearchSchema>): SchemaSearch {
  const parsed = schemaSearchSchema.parse(search);
  const result: SchemaSearch = {};
  if (parsed.version !== undefined) result.version = parsed.version;
  return result;
}

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/schema")({
  validateSearch: parseSchemaSearch,
  loaderDeps: ({ search }) => ({
    version: search.version,
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
      return { dataset: fileResponse.dataset, file: fileResponse.file, versions };
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
      dataset: fileResponse.dataset,
      file: fileResponse.file,
      versions: {
        dataset_id: fileResponse.dataset.id,
        file_id: fileResponse.file.id,
        formats: fileResponse.file.formats ?? [],
      },
    };
  },
  component: FileSchemaPage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
});

function FileSchemaPage() {
  const { dataset, file, versions } = Route.useLoaderData();
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const versionOptions = getSchemaVersionOptions(versions.formats);
  const latestVersion = getLatestSchemaVersion(versions.formats);
  const initialVersion =
    search.version && versionOptions.some((version) => String(version) === search.version)
      ? search.version
      : latestVersion;
  const [selectedVersion, setSelectedVersion] = useState<string | number>(initialVersion ?? search.version ?? "1");
  const selectedSchemaSource = getBestSchemaSourceForVersion(versions.formats, selectedVersion);
  const rawMetadataHref = `/api/collections/${params.collectionSlug}/datasets/${params.datasetSlug}/files/${params.fileSlug}`;

  const onVersionChange = (version: string) => {
    setSelectedVersion(version);
    void navigate({
      search: (prev) => ({
        ...prev,
        version,
      }),
      replace: true,
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <Button variant="ghost" asChild>
        <Link to="/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug" params={params}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to file
        </Link>
      </Button>

      <SchemaViewer
        fileName={`${dataset.name} / ${file.name}`}
        selectedVersion={selectedVersion}
        versionOptions={versionOptions}
        selectedSchemaSource={selectedSchemaSource}
        rawMetadataHref={rawMetadataHref}
        onVersionChange={onVersionChange}
      />
    </div>
  );
}
