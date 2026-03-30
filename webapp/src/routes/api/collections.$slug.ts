import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getCollectionDatasets,
} from "@/lib/api-client";

export const Route = createFileRoute("/api/collections/$slug")({
  server: {
    handlers: {
      // GET /api/collections/:slug - Get collection with datasets
      GET: async ({ params, request }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.slug },
        });
        if (!collection) {
          return Response.json({ error: "Collection not found" }, { status: 404 });
        }

        // Parse query parameters for pagination and search
        const url = new URL(request.url);
        // Support both `query` (used by webapp URLs) and legacy `search`
        const queryParam = url.searchParams.get("query");
        const searchParam = url.searchParams.get("search");
        const search = (queryParam ?? searchParam)?.trim() || undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : undefined;
        const offset = url.searchParams.get("offset")
          ? parseInt(url.searchParams.get("offset")!, 10)
          : undefined;
        const includeUrls = url.searchParams.get("include_urls") === "true";

        // Parse tag filters if provided
        let tagFilters: Record<string, string | string[]> | undefined;
        const tagFiltersParam = url.searchParams.get("tag_filters");
        if (tagFiltersParam) {
          try {
            tagFilters = JSON.parse(tagFiltersParam);
          } catch (e) {
            return Response.json(
              { error: "Invalid tag_filters format. Must be valid JSON." },
              { status: 400 }
            );
          }
        }

        const datasetsResponse = await getCollectionDatasets({
          data: {
            collectionId: collection.id,
            search,
            includeUrls,
            limit,
            offset,
            tagFilters,
          },
        });

        return Response.json({
          collection,
          datasets: datasetsResponse.items,
          total: datasetsResponse.total,
          limit: datasetsResponse.limit,
          offset: datasetsResponse.offset,
        });
      },
    },
  },
});

