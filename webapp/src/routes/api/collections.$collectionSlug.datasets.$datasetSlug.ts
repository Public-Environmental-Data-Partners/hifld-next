import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/$datasetSlug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const catalog = await sqliteCatalogApi();
        if (!catalog || !env.CATALOG_SQLITE_URL) return jsonProblem(503, "Catalog metadata is unavailable");
        const dataset = await catalog.dataset(params.collectionSlug, params.datasetSlug);
        if (!dataset) return jsonProblem(404, "Dataset not found");
        const response = await fetchCatalogStac(env.CATALOG_SQLITE_URL, dataset.stac_href);
        response.headers.set("X-Catalog-Generation", catalog.generation);
        return response;
      },
    },
  },
});
