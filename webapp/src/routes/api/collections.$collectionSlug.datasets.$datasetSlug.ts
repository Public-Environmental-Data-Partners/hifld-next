import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getDatasetBySlug,
} from "@/lib/api-client";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug"
)({
  server: {
    handlers: {
      // GET /api/collections/:collectionSlug/datasets/:datasetSlug - Get dataset details
      GET: async ({ params, request }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return Response.json({ error: "Collection not found" }, { status: 404 });
        }

        // Parse query parameter for includeUrls
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
          return Response.json({ error: "Dataset not found" }, { status: 404 });
        }

        return Response.json({
          collection,
          dataset,
        });
      },
    },
  },
});

