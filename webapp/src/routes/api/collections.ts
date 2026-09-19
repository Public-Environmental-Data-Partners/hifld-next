import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections")({
  server: {
    handlers: {
      GET: async () => {
        const catalog = await sqliteCatalogApi();
        if (!catalog || !env.CATALOG_SQLITE_URL) return jsonProblem(503, "Catalog metadata is unavailable");
        const response = await fetchCatalogStac(env.CATALOG_SQLITE_URL, "catalog.json");
        response.headers.set("X-Catalog-Generation", catalog.generation);
        return response;
      },
    },
  },
});
