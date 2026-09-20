import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { activeCatalogLifecycle } from "@/lib/catalog-runtime";
import { buildStacCollection, loadStacDocument } from "@/lib/stac-api";

export async function serveStacCollection(request: Request, id: string): Promise<Response> {
  const lifecycle = await activeCatalogLifecycle();
  if (!lifecycle) return jsonProblem(503, "Catalog metadata is unavailable");
  return (
    (await lifecycle.withSnapshot(async ({ repository, catalogUrl, generation }) => {
      if (!catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
      const entry = await repository.getStacVersion(id);
      if (!entry) return jsonProblem(404, "Collection not found");
      try {
        const published = await loadStacDocument(catalogUrl, entry.collection_href);
        if (published.type !== "Collection" || published.id !== id) {
          return jsonProblem(502, "Published STAC Collection does not match catalog");
        }
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        return Response.json(buildStacCollection(published, origin), {
          headers: { "X-Catalog-Generation": generation },
        });
      } catch {
        return jsonProblem(502, "Published STAC metadata is unavailable");
      }
    })) ?? jsonProblem(503, "Catalog metadata is unavailable")
  );
}

export const Route = createFileRoute("/stac/collections/$collectionId")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveStacCollection(request, params.collectionId),
    },
  },
});
