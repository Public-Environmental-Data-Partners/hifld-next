import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getDatasetBySlug,
  getDatasetFileBySlug,
} from "@/lib/api-client";

export const Route = createFileRoute(
  "/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug"
)({
  server: {
    handlers: {
      // GET /api/collections/:collectionSlug/datasets/:datasetSlug/files/:fileSlug - Get file details
      GET: async ({ params }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.collectionSlug },
        });
        if (!collection) {
          return Response.json({ error: "Collection not found" }, { status: 404 });
        }

        // Try to get dataset to find file ID (for optimization)
        const dataset = await getDatasetBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            includeUrls: false,
          },
        });
        if (!dataset) {
          return Response.json({ error: "Dataset not found" }, { status: 404 });
        }

        // Get file by slug (this includes URLs)
        const result = await getDatasetFileBySlug({
          data: {
            collectionSlug: params.collectionSlug,
            datasetSlug: params.datasetSlug,
            fileSlug: params.fileSlug,
          },
        });
        if (!result) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }

        return Response.json({
          collection,
          dataset: result.dataset,
          file: result.file,
        });
      },
    },
  },
});

