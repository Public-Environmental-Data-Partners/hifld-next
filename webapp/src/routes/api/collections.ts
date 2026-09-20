import { createFileRoute } from "@tanstack/react-router";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections")({
  server: {
    handlers: {
      GET: async () => {
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const response = await fetchCatalogStac(catalogUrl, "catalog.json");
        response.headers.set("X-Catalog-Generation", catalog.generation);
        return response;
      },
    },
  },
});
