import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env/server";
import { buildLinkHeader, collectionDatasetsPaginationLinks, requestOrigin } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { collectionLinkBase, parseCollectionApiQuery, publishedDatasets } from "@/lib/catalog-listing";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";

export const Route = createFileRoute("/api/collections/$slug/datasets")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const collection = await catalog.collection(params.slug);
        if (!collection) return jsonProblem(404, "Collection not found");
        const query = parseCollectionApiQuery(new URL(request.url).searchParams);
        if (query instanceof Response) return query;
        const page = await catalog.datasets(params.slug, {
          ...(query.search ? { search: query.search } : {}),
          ...(query.tagFilters ? { tagFilters: query.tagFilters } : {}),
          limit: query.limit,
          offset: query.offset,
        });
        const datasets = await publishedDatasets(
          catalogUrl,
          page.items.map((dataset) => dataset.stac_href),
        );
        if (datasets instanceof Response) return datasets;
        const links = collectionDatasetsPaginationLinks(
          requestOrigin(request, env.WEBAPP_PUBLIC_ORIGIN),
          params.slug,
          collectionLinkBase(query),
          {
            total: page.total,
            limit: query.limit,
            offset: query.offset,
          },
        );
        const headers = new Headers({ "X-Catalog-Generation": catalog.generation });
        const linkHeader = buildLinkHeader(links);
        if (linkHeader) headers.set("Link", linkHeader);
        return Response.json(
          { datasets, total: page.total, limit: page.limit, offset: page.offset, links },
          { headers },
        );
      },
    },
  },
});
