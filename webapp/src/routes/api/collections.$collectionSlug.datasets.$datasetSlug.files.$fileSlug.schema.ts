import { createFileRoute } from "@tanstack/react-router";
import {
  getBestSchemaSourceForVersion,
  getLatestSchemaVersion,
  getSchemaSummary,
  getSchemaVersionOptions,
} from "@/components/dataset/schemaSources";
import { getCollectionBySlug, getDatasetBySlug, getDatasetFileBySlug } from "@/lib/api-client";
import { collectionSelf, datasetSelf, fileSelf, requestOrigin, schemaSelf } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/schema")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return jsonProblem(404, "Collection not found");
        }

        const dataset = await getDatasetBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            includeUrls: false,
          },
        });
        if (!dataset) {
          return jsonProblem(404, "Dataset not found");
        }

        const result = await getDatasetFileBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            fileSlug: params.fileSlug,
          },
        });
        if (!result) {
          return jsonProblem(404, "File not found");
        }

        const origin = requestOrigin(request);
        const cs = params.collectionSlug;
        const ds = params.datasetSlug;
        const fs = params.fileSlug;
        const requestedVersion = new URL(request.url).searchParams.get("version");
        const versionOptions = getSchemaVersionOptions(result.file.formats);
        const selectedVersion =
          requestedVersion && versionOptions.some((version) => String(version) === requestedVersion)
            ? requestedVersion
            : getLatestSchemaVersion(result.file.formats);
        const selectedSchemaSource = getBestSchemaSourceForVersion(result.file.formats, selectedVersion);
        const metadata = selectedSchemaSource?.source.source_metadata ?? null;

        return Response.json({
          links: {
            self: schemaSelf(origin, cs, ds, fs, { version: selectedVersion }),
            file: fileSelf(origin, cs, ds, fs),
            dataset: datasetSelf(origin, cs, ds),
            collection: collectionSelf(origin, cs),
          },
          collection,
          dataset: result.dataset,
          file: {
            id: result.file.id,
            dataset_id: result.file.dataset_id,
            slug: result.file.slug,
            name: result.file.name,
            description: result.file.description,
            layer_name: result.file.layer_name,
          },
          versions: versionOptions,
          selected_version: selectedVersion,
          schema: selectedSchemaSource
            ? {
                version: selectedVersion,
                format_type: selectedSchemaSource.formatType,
                format_name: selectedSchemaSource.formatName,
                source_id: selectedSchemaSource.source.id,
                storage_location: selectedSchemaSource.source.storage_location ?? null,
                source: selectedSchemaSource.source,
                source_metadata: metadata,
                summary: getSchemaSummary(metadata),
                columns: metadata?.columns ?? [],
              }
            : null,
        });
      },
    },
  },
});
