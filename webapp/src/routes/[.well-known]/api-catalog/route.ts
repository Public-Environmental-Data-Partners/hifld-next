import { createFileRoute } from "@tanstack/react-router";
import { API_CATALOG_CONTENT_TYPE, buildApiCatalogLinkset } from "@/lib/api-catalog-linkset";

export const Route = createFileRoute("/.well-known/api-catalog")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = buildApiCatalogLinkset(origin);
        return new Response(JSON.stringify(body, null, 2), {
          headers: {
            "Content-Type": API_CATALOG_CONTENT_TYPE,
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
