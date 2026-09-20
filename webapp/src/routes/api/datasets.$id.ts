import { createFileRoute } from "@tanstack/react-router";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/datasets/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [collectionSlug, datasetSlug, extra] = params.id.split("/");
        if (!collectionSlug || !datasetSlug || extra !== undefined)
          return jsonProblem(400, "Dataset identity must be collection/dataset");
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const dataset = await catalog.dataset(collectionSlug, datasetSlug);
        if (!dataset) return jsonProblem(404, "Dataset not found");
        const response = await fetchCatalogStac(catalogUrl, dataset.stac_href);
        response.headers.set("X-Catalog-Generation", catalog.generation);
        return response;
      },
      PUT: async () => jsonProblem(405, "Catalog data is managed by publication jobs"),
      DELETE: async () => jsonProblem(405, "Catalog data is managed by publication jobs"),
    },
  },
});
