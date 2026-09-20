import { z } from "zod";
import type { CollectionDatasetsLinkBase } from "@/lib/api-links";
import { jsonProblem } from "@/lib/api-problem";
import type { CatalogTags as DatasetTags } from "@/lib/catalog-repository";
import { fetchCatalogStac, stacDocumentSchema } from "@/lib/catalog-stac";

const DEFAULT_COLLECTION_PAGE_SIZE = 50;

type PublishedStacDocument = z.infer<typeof stacDocumentSchema>;
type PublishedStacFailureKind = "transport" | "http" | "body" | "json" | "schema";

interface PublishedStacFailureDetails {
  causeCode?: string;
  contentLength?: string | null;
  errorMessage?: string;
  errorName?: string;
  httpStatus?: number;
  receivedTextLength?: number;
}

export function publishedStacErrorDetails(
  error: unknown,
): Pick<PublishedStacFailureDetails, "causeCode" | "errorMessage" | "errorName"> {
  const errorName = error instanceof Error ? error.name : "NonError";
  const errorMessage = error instanceof Error ? error.message.replaceAll(/\s+/g, " ").slice(0, 160) : undefined;
  const cause = z.object({ code: z.string().optional() }).safeParse(error instanceof Error ? error.cause : undefined);
  const details = errorMessage ? { errorName, errorMessage } : { errorName };
  return cause.success && cause.data.code ? { ...details, causeCode: cause.data.code } : details;
}

function reportPublishedStacFailure(
  href: string,
  kind: PublishedStacFailureKind,
  details: PublishedStacFailureDetails = {},
): void {
  console.error("Published STAC metadata failure", { href, kind, ...details });
}

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

export function parseCollectionApiQuery(searchParams: URLSearchParams): CollectionApiQuery | Response {
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

export function collectionLinkBase(query: CollectionApiQuery): CollectionDatasetsLinkBase {
  const result: CollectionDatasetsLinkBase = {};
  if (query.search !== undefined) result.query = query.search;
  if (query.includeUrls) result.include_urls = true;
  if (query.tagFiltersParam !== undefined) result.tag_filters = query.tagFiltersParam;
  if (query.omit !== undefined) result.omit = query.omit;
  return result;
}

export async function publishedDatasets(
  sqliteUrl: string,
  hrefs: string[],
): Promise<PublishedStacDocument[] | Response> {
  const documents: PublishedStacDocument[] = [];
  // Bound object-storage concurrency even for large requested pages.
  for (let offset = 0; offset < hrefs.length; offset += 8) {
    const fetched = await Promise.all(
      hrefs.slice(offset, offset + 8).map(async (href) => {
        try {
          return { href, response: await fetchCatalogStac(sqliteUrl, href) };
        } catch (error) {
          reportPublishedStacFailure(href, "transport", publishedStacErrorDetails(error));
          return null;
        }
      }),
    );
    const responses = fetched.filter((entry): entry is { href: string; response: Response } => entry !== null);
    if (responses.length !== fetched.length) return jsonProblem(502, "Published STAC metadata is unavailable");
    if (responses.some((entry) => !entry.response.ok)) {
      for (const entry of responses) {
        if (!entry.response.ok) {
          reportPublishedStacFailure(entry.href, "http", { httpStatus: entry.response.status });
        }
      }
      return jsonProblem(502, "Published STAC metadata is unavailable");
    }
    const batch = await Promise.all(
      responses.map(async ({ href, response }) => {
        const contentLength = response.headers.get("content-length");
        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          reportPublishedStacFailure(href, "body", { contentLength, ...publishedStacErrorDetails(error) });
          return null;
        }
        try {
          const document = stacDocumentSchema.safeParse(JSON.parse(text));
          if (document.success) return document.data;
          reportPublishedStacFailure(href, "schema", {
            contentLength,
            receivedTextLength: text.length,
          });
        } catch (error) {
          reportPublishedStacFailure(href, "json", {
            contentLength,
            receivedTextLength: text.length,
            ...publishedStacErrorDetails(error),
          });
        }
        return null;
      }),
    );
    if (batch.some((document) => document === null)) {
      return jsonProblem(502, "Published STAC metadata is invalid");
    }
    documents.push(...batch.filter((document): document is PublishedStacDocument => document !== null));
  }
  return documents;
}
