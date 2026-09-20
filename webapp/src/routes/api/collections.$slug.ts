import { createFileRoute } from "@tanstack/react-router";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const collection = await catalog.collection(params.slug);
        if (!collection) return jsonProblem(404, "Collection not found");
        const response = await fetchCatalogStac(catalogUrl, `${collection.collection_path}/catalog.json`);
        response.headers.set("X-Catalog-Generation", catalog.generation);
        return response;
      },
    },
  },
});
