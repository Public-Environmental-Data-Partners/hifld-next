import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getCollectionById } from "@/lib/api-client";
import { getDatasetById } from "@/lib/datasets";
import {
  collectionSelf,
  globalDatasetByIdSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute("/api/datasets/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = parseInt(params.id, 10);
        if (Number.isNaN(id)) {
          return jsonProblem(400, "Invalid ID", "id must be an integer");
        }

        try {
          const dataset = await getDatasetById(id);
          if (!dataset) {
            return jsonProblem(404, "Dataset not found");
          }
          const origin = requestOrigin(request);
          const links: Record<string, string> = {
            self: globalDatasetByIdSelf(origin, id),
          };
          if (dataset.collection_id != null) {
            const col = await getCollectionById({
              data: { id: dataset.collection_id },
            });
            if (col) {
              links.collection = collectionSelf(origin, col.slug);
            }
          }
          return json({ links, dataset });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return jsonProblem(502, "Failed to load dataset", msg);
        }
      },

      PUT: async () => {
        return json(
          { error: "Dataset updates are handled by dataset-api import script" },
          { status: 405 }
        );
      },

      DELETE: async () => {
        return json(
          { error: "Dataset deletion is handled by dataset-api import script" },
          { status: 405 }
        );
      },
    },
  },
});
