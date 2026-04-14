import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileBySlug,
} from "@/lib/api-client";
import { attachDownloadZipLinksToFile } from "@/lib/api-file-sources";
import {
  collectionSelf,
  datasetSelf,
  fileSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
)({
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
        const file = attachDownloadZipLinksToFile(
          result.file,
          origin,
          cs,
          ds,
          fs
        );

        return Response.json({
          links: {
            self: fileSelf(origin, cs, ds, fs),
            dataset: datasetSelf(origin, cs, ds),
            collection: collectionSelf(origin, cs),
          },
          collection,
          dataset: result.dataset,
          file,
        });
      },
    },
  },
});

