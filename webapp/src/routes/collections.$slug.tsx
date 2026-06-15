import { createFileRoute, Link, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Database, Loader2, Map as MapIcon, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DatasetCard } from "@/components/dataset";
import { type TagFilter, TagFilters } from "@/components/tag-filters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { trackSearchQuery, trackTagFilter } from "@/lib/analytics";
import type { DatasetTags, DatasetWithUrls } from "@/lib/api-client";
import { getCollectionBySlug, getCollectionDatasets, getCollectionTagValues } from "@/lib/api-client";
import { pageTitle, seoDescription } from "@/lib/seo";

const SEARCH_DEBOUNCE_MS = 500;

type CollectionSearch = {
  query?: string;
  limit?: number;
  offset?: number;
};

interface TagValueLists {
  [tagKey: string]: string[];
}

const collectionSearchSchema = z
  .object({
    query: z.string().optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .catch({});

function parseCollectionSearch(search: z.input<typeof collectionSearchSchema>): CollectionSearch {
  const parsed = collectionSearchSchema.parse(search);
  const result: CollectionSearch = {};
  if (parsed.query && parsed.query.length > 0) result.query = parsed.query;
  if (parsed.limit !== undefined && parsed.limit !== 100) result.limit = parsed.limit;
  if (parsed.offset !== undefined && parsed.offset > 0) result.offset = parsed.offset;
  return result;
}

function getTagFiltersForAPI(filters: TagFilter[]): DatasetTags {
  const filtersByKey = new Map<string, string[]>();

  for (const filter of filters) {
    const values = filtersByKey.get(filter.key) ?? [];
    values.push(filter.value);
    filtersByKey.set(filter.key, values);
  }

  const result: DatasetTags = {};
  for (const [key, values] of filtersByKey) {
    const singleValue = values[0];
    result[key] = values.length === 1 && singleValue !== undefined ? singleValue : values;
  }

  return result;
}

function buildCollectionSearch(updates: CollectionSearch): CollectionSearch {
  const result: CollectionSearch = {};
  if (updates.query !== undefined && updates.query.length > 0) result.query = updates.query;
  if (updates.limit !== undefined && updates.limit !== 100) result.limit = updates.limit;
  if (updates.offset !== undefined && updates.offset > 0) result.offset = updates.offset;
  return result;
}

function mergeCollectionSearch(current: CollectionSearch, updates: CollectionSearch): CollectionSearch {
  const merged: CollectionSearch = {};
  if (updates.query !== undefined) merged.query = updates.query;
  else if (current.query !== undefined) merged.query = current.query;
  if (updates.limit !== undefined) merged.limit = updates.limit;
  else if (current.limit !== undefined) merged.limit = current.limit;
  if (updates.offset !== undefined) merged.offset = updates.offset;
  else if (current.offset !== undefined) merged.offset = current.offset;
  return buildCollectionSearch(merged);
}

interface SearchQuerySyncState {
  currentInput: string;
  nextUrlQuery: string;
  previousUrlQuery: string;
}

export function getSyncedSearchQuery({
  currentInput,
  nextUrlQuery,
  previousUrlQuery,
}: SearchQuerySyncState): string | undefined {
  if (nextUrlQuery === previousUrlQuery || nextUrlQuery === currentInput) {
    return undefined;
  }

  return nextUrlQuery;
}

export function collectionPageHref(collectionSlug: string, search: CollectionSearch, newOffset: number): string {
  const nextSearchInput: CollectionSearch = { offset: newOffset };
  const query = trimmedSearchParam(search.query);
  if (query) nextSearchInput.query = query;
  if (search.limit !== undefined) nextSearchInput.limit = search.limit;
  const nextSearch = buildCollectionSearch(nextSearchInput);
  const params = new URLSearchParams();
  if (nextSearch.query) params.set("query", nextSearch.query);
  if (nextSearch.limit !== undefined) params.set("limit", String(nextSearch.limit));
  if (nextSearch.offset !== undefined) params.set("offset", String(nextSearch.offset));
  const queryString = params.toString();
  return `/collections/${encodeURIComponent(collectionSlug)}${queryString ? `?${queryString}` : ""}`;
}

interface FilteredDatasetFetchArgs {
  collectionId: number;
  limit: number;
  offset: number;
  searchQuery?: string | undefined;
  tagFilters: TagFilter[];
  signal: AbortSignal;
}

interface FilteredDatasetFetchResult {
  items: DatasetWithUrls[];
  total: number;
}

function trimmedSearchParam(searchQuery: string | undefined): string | undefined {
  const trimmedQuery = searchQuery?.trim();
  return trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined;
}

async function loadFilteredDatasets({
  collectionId,
  limit,
  offset,
  searchQuery,
  tagFilters,
  signal,
}: FilteredDatasetFetchArgs): Promise<FilteredDatasetFetchResult | null> {
  const tagFiltersForAPI = tagFilters.length > 0 ? getTagFiltersForAPI(tagFilters) : undefined;
  const response = await getCollectionDatasets({
    data: {
      collectionId,
      search: trimmedSearchParam(searchQuery),
      includeUrls: false,
      limit,
      offset,
      tagFilters: tagFiltersForAPI,
    },
  });

  if (signal.aborted) {
    return null;
  }

  return {
    items: response.items || [],
    total: response.total || 0,
  };
}

function isAbortError(error: Error, signal: AbortSignal): boolean {
  return signal.aborted || error.name === "AbortError";
}

function applyFilteredDatasetResult(
  response: FilteredDatasetFetchResult | null,
  tagFilters: TagFilter[],
  setFilteredDatasets: (items: DatasetWithUrls[]) => void,
  setFilteredTotal: (total: number) => void,
): void {
  if (!response || tagFilters.length === 0) {
    return;
  }

  setFilteredDatasets(response.items);
  setFilteredTotal(response.total);
}

function handleFilteredDatasetError(
  error: Error,
  signal: AbortSignal,
  tagFilters: TagFilter[],
  setFilteredDatasets: (items: DatasetWithUrls[]) => void,
  setFilteredTotal: (total: number) => void,
): void {
  if (isAbortError(error, signal)) {
    return;
  }

  console.error("Error fetching datasets:", error);
  if (tagFilters.length > 0) {
    setFilteredDatasets([]);
    setFilteredTotal(0);
  }
}

interface RunFilteredDatasetRequestArgs {
  fetchArgs: FilteredDatasetFetchArgs;
  tagFilters: TagFilter[];
  setFilteredDatasets: (items: DatasetWithUrls[]) => void;
  setFilteredTotal: (total: number) => void;
  setIsLoading: (isLoading: boolean) => void;
}

async function runFilteredDatasetRequest({
  fetchArgs,
  tagFilters,
  setFilteredDatasets,
  setFilteredTotal,
  setIsLoading,
}: RunFilteredDatasetRequestArgs): Promise<void> {
  setIsLoading(true);
  try {
    const response = await loadFilteredDatasets(fetchArgs);
    applyFilteredDatasetResult(response, tagFilters, setFilteredDatasets, setFilteredTotal);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    handleFilteredDatasetError(err, fetchArgs.signal, tagFilters, setFilteredDatasets, setFilteredTotal);
  } finally {
    if (!fetchArgs.signal.aborted) {
      setIsLoading(false);
    }
  }
}

interface DatasetResultsProps {
  collectionSlug: string;
  datasets: DatasetWithUrls[];
  isLoading: boolean;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
  hrefForOffset: (newOffset: number) => string;
  searchQuery: string;
  total: number;
}

function DatasetResults({
  collectionSlug,
  datasets,
  isLoading,
  limit,
  offset,
  onPageChange,
  hrefForOffset,
  searchQuery,
  total,
}: DatasetResultsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (datasets.length > 0) {
    return (
      <>
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 min-w-0">
          {datasets.map((dataset) => (
            <DatasetCard key={dataset.id} dataset={dataset} collectionSlug={collectionSlug} />
          ))}
        </div>
        {total > limit && (
          <Pagination
            total={total}
            limit={limit}
            offset={offset}
            onPageChange={onPageChange}
            hrefForOffset={hrefForOffset}
            className="mt-8"
          />
        )}
      </>
    );
  }

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">
          {searchQuery ? "No datasets found matching your search" : "No datasets in this collection"}
        </p>
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/collections/$slug")({
  validateSearch: parseCollectionSearch,
  loaderDeps: ({ search }) => ({
    query: search?.query ?? "",
    limit: search?.limit ?? 100,
    offset: search?.offset ?? 0,
  }),
  // Loader is isomorphic - runs on server (SSR) and client (navigation)
  // Server functions handle RPC automatically when called from client
  loader: async ({ params, deps }) => {
    try {
      const collection = await getCollectionBySlug({
        data: { slug: params.slug },
      });
      if (!collection) {
        throw notFound();
      }
      // Search params are validated by validateSearch
      const pageSize = deps.limit ?? 100; // Default to 100 to prevent timeouts
      const offset = deps.offset ?? 0;
      const searchQuery = deps.query ?? "";

      // Use getCollectionDatasets directly with the collection ID
      // Note: includeUrls=false to avoid N+1 query performance issues in backend
      const datasetsResponse = await getCollectionDatasets({
        data: {
          collectionId: collection.id,
          includeUrls: false,
          limit: pageSize,
          offset: offset,
          search: searchQuery || undefined,
        },
      });
      return { collection, datasetsResponse };
    } catch (error) {
      console.error("Error in collection detail loader:", error);
      throw error;
    }
  },
  head: ({ loaderData, params }) => {
    const collection = loaderData?.collection;
    const title = pageTitle(collection?.name ?? params.slug);
    const description = seoDescription(collection?.description);
    const canonical = `/collections/${encodeURIComponent(collection?.slug ?? params.slug)}`;

    return {
      meta: [
        { title },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: title },
        ...(description ? [{ property: "og:description", content: description }] : []),
      ],
      links: [
        { rel: "canonical", href: canonical },
        {
          rel: "alternate",
          type: "application/json",
          href: `/api/collections/${encodeURIComponent(collection?.slug ?? params.slug)}`,
          title: "Collection metadata JSON",
        },
      ],
    };
  },
  component: CollectionDetailPage,
});

// Component runs on client by default
function CollectionDetailPage() {
  const { collection, datasetsResponse: initialResponse } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = useSearch({ from: Route.fullPath });

  // Use loader data as source of truth - it updates automatically when URL changes
  // Only maintain separate state when tag filters are active (loader doesn't support them)
  const [searchQuery, setSearchQuery] = useState(search.query ?? "");
  const [selectedTagFilters, setSelectedTagFilters] = useState<TagFilter[]>([]);
  const [filteredDatasets, setFilteredDatasets] = useState<DatasetWithUrls[] | null>(null);
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<TagValueLists>({});
  const [tagsLoading, setTagsLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevSearchQueryRef = useRef<string>(searchQuery);
  const lastUrlQueryRef = useRef<string>(search.query ?? "");
  const lastTrackedQueryRef = useRef<string>(""); // Track last query we sent to analytics

  // Use loader data directly - it updates automatically when URL changes and loader re-runs
  // Only use filtered state when tag filters are active (loader doesn't support them)
  const hasTagFilters = selectedTagFilters.length > 0;
  const datasets = hasTagFilters ? filteredDatasets || [] : initialResponse?.items || [];
  const initialTotal = initialResponse?.total ?? 0;
  const total = hasTagFilters ? (filteredTotal ?? 0) : initialTotal;
  const offset = search.offset ?? 0;
  const currentLimit = search.limit ?? 100;

  // Update URL when search, offset, or limit changes
  const updateUrlParams = useCallback(
    (updates: CollectionSearch) => {
      const newSearch = mergeCollectionSearch(search, updates);
      navigate({
        search: newSearch,
        replace: true,
      });
    },
    [navigate, search],
  );

  // Load available tag values
  useEffect(() => {
    const loadTagValues = async () => {
      setTagsLoading(true);
      try {
        const tagValues = await getCollectionTagValues({
          data: { collectionId: collection.id },
        });
        if (tagValues && typeof tagValues === "object" && !Array.isArray(tagValues)) {
          setAvailableTags(tagValues);
        } else {
          setAvailableTags({});
        }
      } catch (error) {
        console.error("Error loading tag values:", error);
        setAvailableTags({});
      } finally {
        setTagsLoading(false);
      }
    };
    loadTagValues();
  }, [collection.id]);

  // Fetch datasets with tag filters (only needed when tag filters are present)
  const fetchDatasets = useCallback(
    async (searchQuery?: string, newOffset: number = 0, tagFilters: TagFilter[] = selectedTagFilters) => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      await runFilteredDatasetRequest({
        fetchArgs: {
          collectionId: collection.id,
          searchQuery,
          limit: currentLimit,
          offset: newOffset,
          tagFilters,
          signal: abortController.signal,
        },
        tagFilters,
        setFilteredDatasets,
        setFilteredTotal,
        setIsLoading,
      });
    },
    [collection.id, currentLimit, selectedTagFilters],
  );

  // Sync search query from URL (only when URL changes, not when local state changes)
  useEffect(() => {
    const urlQuery = search.query ?? "";
    const syncedQuery = getSyncedSearchQuery({
      currentInput: searchQuery,
      nextUrlQuery: urlQuery,
      previousUrlQuery: lastUrlQueryRef.current,
    });

    lastUrlQueryRef.current = urlQuery;
    if (syncedQuery !== undefined) {
      setSearchQuery(syncedQuery);
    }

    // Track search when URL query changes (only once per unique query)
    // Use ref to prevent duplicate tracking when loader data updates
    const trimmedQuery = urlQuery.trim();
    if (trimmedQuery && !hasTagFilters && trimmedQuery !== lastTrackedQueryRef.current) {
      lastTrackedQueryRef.current = trimmedQuery;
      trackSearchQuery(trimmedQuery, collection.slug, initialTotal, {
        hasTagFilters: false,
        queryLength: trimmedQuery.length,
      });
    }
  }, [search.query, collection.slug, hasTagFilters, initialTotal, searchQuery]);

  // Debounced search handler - wait before updating URL/fetching to avoid
  // firing searches while the user is still typing.
  useEffect(() => {
    const queryChanged = prevSearchQueryRef.current !== searchQuery;
    prevSearchQueryRef.current = searchQuery;

    if (!queryChanged) return;

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      updateUrlParams({ query: searchQuery, offset: 0 });

      // If tag filters are active, we need to fetch manually
      if (hasTagFilters) {
        await fetchDatasets(searchQuery || undefined, 0, selectedTagFilters);

        // Track search query after results are fetched
        if (searchQuery.trim()) {
          trackSearchQuery(searchQuery, collection.slug, filteredTotal ?? 0, {
            hasTagFilters: true,
            queryLength: searchQuery.trim().length,
          });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, updateUrlParams, hasTagFilters, fetchDatasets, selectedTagFilters, collection.slug, filteredTotal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Search input handler
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  // Handle page change - just update URL, loader handles the fetch
  const handlePageChange = (newOffset: number) => {
    updateUrlParams({ offset: newOffset });
    // Only fetch if tag filters are present (loader doesn't support them)
    if (hasTagFilters) {
      fetchDatasets(searchQuery || undefined, newOffset, selectedTagFilters);
    }
  };

  const hrefForOffset = useCallback(
    (newOffset: number) => {
      const nextSearch: CollectionSearch = { limit: currentLimit };
      if (search.query) nextSearch.query = search.query;
      return collectionPageHref(collection.slug, nextSearch, newOffset);
    },
    [collection.slug, currentLimit, search.query],
  );

  // Handle tag filter change
  const handleFilterChange = async (key: string, values: string[]) => {
    const otherFilters = selectedTagFilters.filter((f) => f.key !== key);
    const newFilters: TagFilter[] = [...otherFilters, ...values.map((value) => ({ key, value }))];

    setSelectedTagFilters(newFilters);
    updateUrlParams({ offset: 0 });

    // Track tag filter application
    trackTagFilter(collection.slug, key, values, searchQuery || undefined);

    await fetchDatasets(searchQuery, 0, newFilters);
  };

  return (
    <div className="p-4 sm:p-6 md:p-10 overflow-x-hidden min-w-0">
      <div className="max-w-4xl mx-auto space-y-8 min-w-0">
        {/* Header */}
        <div>
          <Button variant="ghost" asChild className="mb-4">
            <Link to="/collections">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Collections
            </Link>
          </Button>
          <div className="text-center">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight break-words">{collection.name}</h1>
            {collection.description && (
              <p className="text-base sm:text-lg text-muted-foreground mt-2 break-words">{collection.description}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" asChild className="font-mono">
                <Link to="/collections/$collectionSlug/map" params={{ collectionSlug: collection.slug }}>
                  <MapIcon className="mr-2 h-4 w-4" />
                  Map Workspace
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="font-mono">
                <a href={`/api/collections/${collection.slug}`} target="_blank" rel="noopener noreferrer">
                  View Metadata
                </a>
              </Button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            type="search"
            placeholder="Search datasets..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 w-full min-w-0"
          />
        </div>

        {/* Tag Filters */}
        {tagsLoading ? (
          <div className="text-sm text-muted-foreground">Loading filters...</div>
        ) : Object.keys(availableTags).length > 0 ? (
          <TagFilters
            availableTags={availableTags}
            selectedFilters={selectedTagFilters}
            onFilterChange={handleFilterChange}
          />
        ) : (
          <div className="text-sm text-muted-foreground">No tag filters available</div>
        )}

        <DatasetResults
          collectionSlug={collection.slug}
          datasets={datasets}
          isLoading={isLoading}
          limit={currentLimit}
          offset={offset}
          onPageChange={handlePageChange}
          hrefForOffset={hrefForOffset}
          searchQuery={searchQuery}
          total={total}
        />
      </div>
    </div>
  );
}
