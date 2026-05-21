import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { DatasetTags } from "@/lib/api-client";
import { getCollectionBySlug, getCollectionDatasets } from "@/lib/api-client";
import { omitDescriptionsFromDatasets } from "@/lib/api-dataset-shaping";
import {
  buildLinkHeader,
  type CollectionDatasetsLinkBase,
  collectionDatasetsPaginationLinks,
  datasetSelf,
  requestOrigin,
} from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";

const DEFAULT_COLLECTION_PAGE_SIZE = 50;

const tagFiltersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

interface CollectionApiQuery {
  search?: string;
  tagFilters?: DatasetTags;
  tagFiltersParam?: string;
  omit?: string;
  includeUrls: boolean;
  limit: number;
  offset: number;
}

function parsePositiveLimit(value: string | null): number | Response {
  if (value === null || value === "") {
    return DEFAULT_COLLECTION_PAGE_SIZE;
  }

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return jsonProblem(400, "Invalid limit", "limit must be a positive integer");
  }

  return parsed;
}

function parseNonNegativeOffset(value: string | null): number | Response {
  const parsed = value !== null && value !== "" ? parseInt(value, 10) : 0;
  if (Number.isNaN(parsed) || parsed < 0) {
    return jsonProblem(400, "Invalid offset", "offset must be a non-negative integer");
  }

  return parsed;
}

function parseTagFilters(value: string | null): DatasetTags | Response | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return tagFiltersSchema.parse(JSON.parse(value));
  } catch {
    return jsonProblem(400, "Invalid tag_filters", "tag_filters must be valid JSON");
  }
}

function parseCollectionApiQuery(searchParams: URLSearchParams): CollectionApiQuery | Response {
  const queryParam = searchParams.get("query");
  const searchParam = searchParams.get("search");
  const search = (queryParam ?? searchParam)?.trim();
  const limit = parsePositiveLimit(searchParams.get("limit"));
  if (limit instanceof Response) return limit;

  const offset = parseNonNegativeOffset(searchParams.get("offset"));
  if (offset instanceof Response) return offset;

  const tagFiltersParam = searchParams.get("tag_filters");
  const tagFilters = parseTagFilters(tagFiltersParam);
  if (tagFilters instanceof Response) return tagFilters;

  const omit = searchParams.get("omit") ?? undefined;
  const result: CollectionApiQuery = {
    includeUrls: searchParams.get("include_urls") === "true",
    limit,
    offset,
  };
  if (search && search.length > 0) result.search = search;
  if (tagFilters !== undefined) result.tagFilters = tagFilters;
  if (tagFiltersParam !== null) result.tagFiltersParam = tagFiltersParam;
  if (omit !== undefined) result.omit = omit;
  return result;
}

function collectionLinkBase(query: CollectionApiQuery): CollectionDatasetsLinkBase {
  const result: CollectionDatasetsLinkBase = {};
  if (query.search !== undefined) result.query = query.search;
  if (query.includeUrls) result.include_urls = true;
  if (query.tagFiltersParam !== undefined) result.tag_filters = query.tagFiltersParam;
  if (query.omit !== undefined) result.omit = query.omit;
  return result;
}

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
        const query = parseCollectionApiQuery(url.searchParams);
        if (query instanceof Response) return query;

        const omitDescription = query.omit
          ?.split(",")
          .map((s) => s.trim())
          .includes("description");

        const datasetsResponse = await getCollectionDatasets({
          data: {
            collectionId: collection.id,
            search: query.search,
            includeUrls: query.includeUrls,
            limit: query.limit,
            offset: query.offset,
            tagFilters: query.tagFilters,
          },
        });

        let items = datasetsResponse.items;
        if (omitDescription) {
          items = omitDescriptionsFromDatasets(items);
        }

        const origin = requestOrigin(request);
        const linkBase = collectionLinkBase(query);

        const pageLinks = collectionDatasetsPaginationLinks(origin, params.slug, linkBase, {
          total: datasetsResponse.total,
          limit: query.limit,
          offset: query.offset,
        });

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
            limit: datasetsResponse.limit ?? query.limit,
            offset: datasetsResponse.offset,
            links: pageLinks,
          },
          { headers },
        );
      },
    },
  },
});
