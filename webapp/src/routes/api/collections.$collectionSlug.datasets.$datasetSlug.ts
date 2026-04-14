import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  type DatasetFile,
} from "@/lib/api-client";
import {
  collectionSelf,
  datasetSelf,
  fileSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug"
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

        const url = new URL(request.url);
        const includeUrls = url.searchParams.get("include_urls") === "true";

        const dataset = await getDatasetBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            includeUrls,
          },
        });
        if (!dataset) {
          return jsonProblem(404, "Dataset not found");
        }

        const origin = requestOrigin(request);
        const cs = params.collectionSlug;
        const ds = params.datasetSlug;
        const filesWithLinks = (dataset.files ?? []).map((f: DatasetFile) => ({
          ...f,
          links: {
            self: fileSelf(origin, cs, ds, f.slug),
          },
        }));
        const datasetOut = { ...dataset, files: filesWithLinks };

        return Response.json({
          links: {
            self: datasetSelf(origin, cs, ds, { include_urls: includeUrls }),
            collection: collectionSelf(origin, cs),
          },
          collection,
          dataset: datasetOut,
        });
      },
    },
  },
});

