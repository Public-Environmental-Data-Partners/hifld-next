import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { activeCatalogLifecycle } from "@/lib/catalog-runtime";
import {
  buildStacCollectionsPage,
  decodeStacCursor,
  InvalidStacCursorError,
  StaleStacCursorError,
} from "@/lib/stac-api";

export async function serveStacCollections(request: Request): Promise<Response> {
  const lifecycle = await activeCatalogLifecycle();
  if (!lifecycle) return jsonProblem(503, "Catalog metadata is unavailable");
  return (
    (await lifecycle.withSnapshot(async ({ repository, catalogUrl, generation }) => {
      if (!catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
      let after: string | null;
      try {
        after = decodeStacCursor(new URL(request.url).searchParams.get("cursor"), generation);
      } catch (error) {
        if (error instanceof StaleStacCursorError) return jsonProblem(409, "STAC cursor is stale");
        if (error instanceof InvalidStacCursorError) return jsonProblem(400, "Invalid STAC cursor");
        throw error;
      }
      try {
        const entries = await repository.listStacVersions({ after, limit: 51 });
        const origin = requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN);
        const page = await buildStacCollectionsPage({ entries, catalogUrl, origin, generation, after });
        return Response.json(page, { headers: { "X-Catalog-Generation": generation } });
      } catch {
        return jsonProblem(502, "Published STAC metadata is unavailable");
      }
    })) ?? jsonProblem(503, "Catalog metadata is unavailable")
  );
}

export const Route = createFileRoute("/stac/collections")({
  server: {
    handlers: {
      GET: ({ request }) => serveStacCollections(request),
    },
  },
});
