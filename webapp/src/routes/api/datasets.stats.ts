import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getDatasetStats } from "@/lib/datasets";

export const Route = createFileRoute("/api/datasets/stats")({
  server: {
    handlers: {
      // GET /api/datasets/stats - Get dataset statistics
      GET: async () => {
        const stats = await getDatasetStats();
        return json(stats);
      },
    },
  },
});

