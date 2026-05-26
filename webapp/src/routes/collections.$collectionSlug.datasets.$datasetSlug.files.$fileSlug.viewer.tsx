import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  encodeSourceDescriptor,
  firstSourceDescriptorForFormat,
  type SourceDescriptor,
} from "@/components/map/sourceDescriptors";
import { PageLoader } from "@/components/ui/page-loader";
import type { DatasetFile } from "@/lib/api-client";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileById, getDatasetFileBySlug } from "@/lib/api-client";

interface ViewerRedirectData {
  source: SourceDescriptor | null;
}

function firstPmtilesDescriptor({
  collectionSlug,
  datasetSlug,
  file,
}: {
  collectionSlug: string;
  datasetSlug: string;
  file: DatasetFile;
}): SourceDescriptor | null {
  const formatEntry = file.formats?.find((entry) => entry.format.format_type === "pmtiles");
  return firstSourceDescriptorForFormat({
    collectionSlug,
    datasetSlug,
    fileSlug: file.slug,
    formatEntry,
  });
}

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/viewer")({
  loader: async ({ params }): Promise<ViewerRedirectData> => {
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
      return {
        source: firstPmtilesDescriptor({
          collectionSlug: params.collectionSlug,
          datasetSlug: params.datasetSlug,
          file: result.file,
        }),
      };
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
    return {
      source: firstPmtilesDescriptor({
        collectionSlug: params.collectionSlug,
        datasetSlug: params.datasetSlug,
        file: result.file,
      }),
    };
  },
  component: FileViewerRedirect,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
  pendingMs: 200,
  ssr: false,
});

function FileViewerRedirect() {
  const { source } = Route.useLoaderData();
  const { collectionSlug } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });

  useEffect(() => {
    void navigate({
      to: "/collections/$collectionSlug/map",
      params: { collectionSlug },
      search: source ? { source: encodeSourceDescriptor(source) } : {},
      replace: true,
    });
  }, [collectionSlug, navigate, source]);

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  );
}
