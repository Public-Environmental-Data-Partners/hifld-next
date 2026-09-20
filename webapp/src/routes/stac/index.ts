import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { activeCatalogLifecycle } from "@/lib/catalog-runtime";
import { buildStacLanding, loadStacDocument } from "@/lib/stac-api";

export const Route = createFileRoute("/stac/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const lifecycle = await activeCatalogLifecycle();
        if (!lifecycle) return jsonProblem(503, "Catalog metadata is unavailable");
        return (
          (await lifecycle.withSnapshot(async ({ catalogUrl, generation }) => {
            if (!catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
            try {
              const published = await loadStacDocument(catalogUrl, "catalog.json");
              const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
              return Response.json(buildStacLanding(published, origin), {
                headers: { "X-Catalog-Generation": generation },
              });
            } catch {
              return jsonProblem(502, "Published STAC metadata is unavailable");
            }
          })) ?? jsonProblem(503, "Catalog metadata is unavailable")
        );
      },
    },
  },
});
