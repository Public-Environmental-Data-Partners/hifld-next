import { createFileRoute } from "@tanstack/react-router";
import {
  getCollectionBySlug,
  getCollectionDatasets,
} from "@/lib/api-client";
import { omitDescriptionsFromDatasets } from "@/lib/api-dataset-shaping";
import { jsonProblem } from "@/lib/api-problem";
import {
  buildLinkHeader,
  collectionDatasetsListUrl,
  collectionDatasetsPaginationLinks,
  datasetSelf,
  requestOrigin,
  type ApiLinkMap,
} from "@/lib/api-links";

const DEFAULT_COLLECTION_PAGE_SIZE = 50;

export const Route = createFileRoute("/api/collections/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const collection = await getCollectionBySlug({
          data: { slug: params.slug },
        });
        if (!collection) {
          return jsonProblem(404, "Collection not found");
        }

        const url = new URL(request.url);
        const queryParam = url.searchParams.get("query");
        const searchParam = url.searchParams.get("search");
        const search = (queryParam ?? searchParam)?.trim() || undefined;

        const limitRaw = url.searchParams.get("limit");
        let effectiveLimit: number;
        if (limitRaw === null || limitRaw === "") {
          effectiveLimit = DEFAULT_COLLECTION_PAGE_SIZE;
        } else {
          const n = parseInt(limitRaw, 10);
          if (Number.isNaN(n) || n < 1) {
            return jsonProblem(
              400,
              "Invalid limit",
              "limit must be a positive integer"
            );
          }
          effectiveLimit = n;
        }

        const offsetRaw = url.searchParams.get("offset");
        const offset =
          offsetRaw !== null && offsetRaw !== ""
            ? parseInt(offsetRaw, 10)
            : 0;
        if (Number.isNaN(offset) || offset < 0) {
          return jsonProblem(400, "Invalid offset", "offset must be a non-negative integer");
        }

        const includeUrls = url.searchParams.get("include_urls") === "true";

        let tagFilters: Record<string, string | string[]> | undefined;
        const tagFiltersParam = url.searchParams.get("tag_filters");
        if (tagFiltersParam) {
          try {
            tagFilters = JSON.parse(tagFiltersParam);
          } catch {
            return jsonProblem(
              400,
              "Invalid tag_filters",
              "tag_filters must be valid JSON"
            );
          }
        }

        const omitDescription = url.searchParams
          .get("omit")
          ?.split(",")
          .map((s) => s.trim())
          .includes("description");

        const datasetsResponse = await getCollectionDatasets({
          data: {
            collectionId: collection.id,
            search,
            includeUrls,
            limit: effectiveLimit,
            offset,
            tagFilters,
          },
        });

        let items = datasetsResponse.items;
        if (omitDescription) {
          items = omitDescriptionsFromDatasets(items);
        }

        const origin = requestOrigin(request);
        const effectiveQuery = (queryParam ?? searchParam)?.trim() || undefined;
        const linkBase = {
          query: effectiveQuery,
          include_urls: includeUrls || undefined,
          tag_filters: tagFiltersParam ?? undefined,
          omit: url.searchParams.get("omit") ?? undefined,
        };

        const pageLinks = collectionDatasetsPaginationLinks(
          origin,
          params.slug,
          linkBase,
          {
            total: datasetsResponse.total,
            limit: effectiveLimit,
            offset,
          }
        );

        const datasetsWithLinks = items.map((d) => ({
          ...d,
          links: {
            self: datasetSelf(origin, params.slug, d.slug, {
              include_urls: false,
            }),
          },
        }));

        const headers = new Headers();
        const linkHdr = buildLinkHeader(pageLinks);
        if (linkHdr) headers.set("Link", linkHdr);

        return Response.json(
          {
            collection,
            datasets: datasetsWithLinks,
            total: datasetsResponse.total,
            limit: datasetsResponse.limit ?? effectiveLimit,
            offset: datasetsResponse.offset,
            links: pageLinks,
          },
          { headers }
        );
      },
    },
  },
});
