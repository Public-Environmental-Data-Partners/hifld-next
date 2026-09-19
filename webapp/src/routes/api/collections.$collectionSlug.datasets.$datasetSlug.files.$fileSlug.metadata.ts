import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { fetchCatalogStac } from "@/lib/catalog-stac";

export const Route = createFileRoute("/api/collections/$collectionSlug/datasets/$datasetSlug/files/$fileSlug/metadata")(
  {
    server: {
      handlers: {
        GET: async ({ params, request }) => {
          const catalog = await sqliteCatalogApi();
          if (!catalog || !env.CATALOG_SQLITE_URL) return jsonProblem(503, "Catalog metadata is unavailable");
          const version = new URL(request.url).searchParams.get("version") ?? undefined;
          const file = await catalog.file(params.collectionSlug, params.datasetSlug, params.fileSlug, version);
          if (!file) return jsonProblem(404, "File not found");
          if (!file.stac_href) return jsonProblem(404, "File version metadata not found");
          return fetchCatalogStac(env.CATALOG_SQLITE_URL, file.stac_href);
        },
      },
    },
  },
);
