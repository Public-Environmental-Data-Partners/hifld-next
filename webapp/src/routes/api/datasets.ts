import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
  getDatasets,
  createDataset,
  registerDataset,
  getDatasetStats,
} from "@/lib/datasets";
import { type NewDataset } from "@/db/schema";

export const Route = createFileRoute("/api/datasets")({
  server: {
    handlers: {
      // GET /api/datasets - List all datasets with optional search
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get("search") || undefined;
        
        const datasets = await getDatasets(search);
        return json(datasets);
      },

      // POST /api/datasets - Create a new dataset
      POST: async ({ request }) => {
        try {
          const body = await request.json() as NewDataset & { addToGeoServer?: boolean };
          const { addToGeoServer = false, ...datasetData } = body;

          if (!datasetData.name || !datasetData.alias || !datasetData.type) {
            return json(
              { error: "Missing required fields: name, alias, type" },
              { status: 400 }
            );
          }

          if (addToGeoServer) {
            const result = await registerDataset(datasetData, true);
            return json(result, { status: 201 });
          } else {
            const dataset = await createDataset(datasetData);
            return json({ dataset, geoserverSuccess: false }, { status: 201 });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

