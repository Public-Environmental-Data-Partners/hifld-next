import { createFileRoute } from "@tanstack/react-router";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/$datasetSlug/metadata")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const dataset = await catalog.dataset(params.collectionSlug, params.datasetSlug);
        if (!dataset) return jsonProblem(404, "Dataset not found");
        return fetchCatalogStac(catalogUrl, dataset.stac_href);
      },
    },
  },
});
