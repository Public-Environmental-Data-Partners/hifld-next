import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
  getDatasetById,
  updateDataset,
  deleteDataset,
} from "@/lib/datasets";
import { type NewDataset } from "@/db/schema";

export const Route = createFileRoute("/api/datasets/$id")({
  server: {
    handlers: {
      // GET /api/datasets/:id - Get a single dataset
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

      // PUT /api/datasets/:id - Update a dataset
      PUT: async ({ request, params }) => {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
          return json({ error: "Invalid ID" }, { status: 400 });
        }

        try {
          const body = await request.json() as Partial<NewDataset>;
          const dataset = await updateDataset(id, body);

          if (!dataset) {
            return json({ error: "Dataset not found" }, { status: 404 });
          }

          return json(dataset);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return json({ error: message }, { status: 500 });
        }
      },

      // DELETE /api/datasets/:id - Delete a dataset
      DELETE: async ({ params }) => {
        const id = parseInt(params.id, 10);
        if (isNaN(id)) {
          return json({ error: "Invalid ID" }, { status: 400 });
        }

        const success = await deleteDataset(id);
        if (!success) {
          return json({ error: "Dataset not found" }, { status: 404 });
        }

        return json({ success: true });
      },
    },
  },
});

