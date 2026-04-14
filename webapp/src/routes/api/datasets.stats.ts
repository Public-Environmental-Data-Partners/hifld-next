import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getDatasetStats } from "@/lib/datasets";
import { globalDatasetStatsSelf, requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

export const Route = createFileRoute("/api/datasets/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const stats = await getDatasetStats();
          const origin = requestOrigin(request);
          return json({
            links: { self: globalDatasetStatsSelf(origin) },
            ...stats,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return jsonProblem(502, "Failed to load dataset statistics", msg);
        }
      },
    },
  },
});
