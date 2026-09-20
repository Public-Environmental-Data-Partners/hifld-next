import { createFileRoute } from "@tanstack/react-router";
import { type ApiLinkMap, buildLinkHeader } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import { sqliteCatalogApi } from "@/lib/catalog-api";
import { parseCollectionApiQuery, publishedDatasets } from "@/lib/catalog-listing";
import { activeCatalogStacUrl } from "@/lib/catalog-runtime";

export const Route = createFileRoute("/api/datasets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const catalog = await sqliteCatalogApi();
        const catalogUrl = await activeCatalogStacUrl();
        if (!catalog || !catalogUrl) return jsonProblem(503, "Catalog metadata is unavailable");
        const query = parseCollectionApiQuery(new URL(request.url).searchParams);
        if (query instanceof Response) return query;
        const hrefs: string[] = [];
        let total = 0;
        for (const collection of await catalog.collections()) {
          const page = await catalog.datasets(collection.collection_slug, {
            ...(query.search ? { search: query.search } : {}),
            ...(query.tagFilters ? { tagFilters: query.tagFilters } : {}),
            limit: Math.max(0, query.limit - hrefs.length),
            offset: Math.max(0, query.offset - total),
          });
          total += page.total;
          hrefs.push(...page.items.map((dataset) => dataset.stac_href));
        }
        const datasets = await publishedDatasets(catalogUrl, hrefs);
        if (datasets instanceof Response) return datasets;
        const pageUrl = (offset: number) => {
          const url = new URL(request.url);
          url.searchParams.set("limit", String(query.limit));
          url.searchParams.set("offset", String(offset));
          return url.href;
        };
        const links: ApiLinkMap = {
          self: pageUrl(query.offset),
          first: pageUrl(0),
          last: pageUrl(total ? Math.floor((total - 1) / query.limit) * query.limit : 0),
        };
        if (query.offset > 0) links.prev = pageUrl(Math.max(0, query.offset - query.limit));
        if (query.offset + query.limit < total) links.next = pageUrl(query.offset + query.limit);
        const headers = new Headers({ "X-Catalog-Generation": catalog.generation });
        const linkHeader = buildLinkHeader(links);
        if (linkHeader) headers.set("Link", linkHeader);
        return Response.json({ datasets, total, limit: query.limit, offset: query.offset, links }, { headers });
      },
      POST: async () => jsonProblem(405, "Catalog data is managed by publication jobs"),
    },
  },
});
