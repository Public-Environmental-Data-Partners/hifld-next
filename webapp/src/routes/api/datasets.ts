import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getDatasets } from "@/lib/datasets";

export const Route = createFileRoute("/api/datasets")({
  server: {
    handlers: {
      // GET /api/datasets - List all datasets with optional search
      // Proxies to dataset-api
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get("search") || undefined;

        const datasets = await getDatasets(search);
        return json(datasets);
      },

      // POST /api/datasets - Write operations removed
      // Dataset creation is handled by dataset-api import script
      POST: async () => {
        return json(
          { error: "Dataset creation is handled by dataset-api import script" },
          { status: 405 }
        );
      },
    },
  },
});
