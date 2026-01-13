import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getDatasetById } from "@/lib/datasets";

export const Route = createFileRoute("/api/datasets/$id")({
  server: {
    handlers: {
      // GET /api/datasets/:id - Get a single dataset
      // Proxies to dataset-api
      GET: async ({ params }) => {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
          return json({ error: "Invalid ID" }, { status: 400 });
        }

        const dataset = await getDatasetById(id);
        if (!dataset) {
          return json({ error: "Dataset not found" }, { status: 404 });
        }

        return json(dataset);
      },

      // PUT /api/datasets/:id - Write operations removed
      PUT: async () => {
        return json(
          { error: "Dataset updates are handled by dataset-api import script" },
          { status: 405 }
        );
      },

      // DELETE /api/datasets/:id - Write operations removed
      DELETE: async () => {
        return json(
          { error: "Dataset deletion is handled by dataset-api import script" },
          { status: 405 }
        );
      },
    },
  },
});

