import { createFileRoute, notFound, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ArrowLeft, Database, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatasetCard } from "@/components/dataset";
import { Pagination } from "@/components/ui/pagination";
import { TagFilters, type TagFilter } from "@/components/tag-filters";
import {
  getCollectionBySlug,
  getCollectionDatasets,
  getCollectionTagValues,
} from "@/lib/api-client";
import type { DatasetWithUrls } from "@/lib/api-client";
import { trackSearchQuery, trackTagFilter } from "@/lib/analytics";

const SEARCH_DEBOUNCE_MS = 500;

export const Route = createFileRoute("/collections/$slug")({
  validateSearch: (search: Record<string, unknown> | undefined) => {
    if (!search) {
      return {
        query: "",
        limit: 100, // Default limit to prevent timeouts
        offset: 0,
      };
    }
    return {
      query: (search.query as string) || "",
      limit: search.limit ? Number(search.limit) : 100, // Default to 100 if not specified
      offset: search.offset ? Number(search.offset) : 0,
    };
  },
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
      return { collection, datasetsResponse, pageSize };
    } catch (error) {
      console.error("Error in collection detail loader:", error);
      throw error;
    }
  },
  component: CollectionDetailPage,
});

// Component runs on client by default
function CollectionDetailPage() {
  const {
    collection,
    datasetsResponse: initialResponse,
    pageSize,
  } = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = useSearch({ from: Route.fullPath, strict: false });
  
  // Use loader data as source of truth - it updates automatically when URL changes
  // Only maintain separate state when tag filters are active (loader doesn't support them)
  const [searchQuery, setSearchQuery] = useState(search?.query || "");
  const [selectedTagFilters, setSelectedTagFilters] = useState<TagFilter[]>([]);
  const [filteredDatasets, setFilteredDatasets] = useState<DatasetWithUrls[] | null>(null);
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<Record<string, string[]>>({});
  const [tagsLoading, setTagsLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevSearchQueryRef = useRef<string>(searchQuery);
  const lastTrackedQueryRef = useRef<string>(""); // Track last query we sent to analytics

  // Use loader data directly - it updates automatically when URL changes and loader re-runs
  // Only use filtered state when tag filters are active (loader doesn't support them)
  const hasTagFilters = selectedTagFilters.length > 0;
  const datasets = hasTagFilters ? (filteredDatasets || []) : (initialResponse?.items || []);
  const total = hasTagFilters ? (filteredTotal ?? 0) : (initialResponse?.total || 0);
  const offset = search?.offset || 0;

  // Update URL when search, offset, or limit changes
  const updateUrlParams = useCallback(
    (updates: { query?: string; offset?: number; limit?: number | undefined }) => {
      const currentSearch = search || { query: "", limit: 100, offset: 0 };
      const newSearch = {
        ...currentSearch,
        ...updates,
      };
      // Remove empty query from URL
      if (newSearch.query === "") {
        delete newSearch.query;
      }
      // Remove limit if it's the default (100) to keep URL clean
      if (newSearch.limit === 100) {
        delete newSearch.limit;
      }
      navigate({
        search: newSearch,
        replace: true,
      });
    },
    [navigate, search]
  );

  // Load available tag values
  useEffect(() => {
    const loadTagValues = async () => {
      setTagsLoading(true);
      try {
        const tagValues = await getCollectionTagValues({
          data: { collectionId: collection.id },
        });
        if (
          tagValues &&
          typeof tagValues === "object" &&
          !Array.isArray(tagValues)
        ) {
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

  // Convert selected filters to API format
  const getTagFiltersForAPI = (
    filters: TagFilter[]
  ): Record<string, string | string[]> => {
    const result: Record<string, string | string[]> = {};
    const filtersByKey: Record<string, string[]> = {};

    filters.forEach((filter) => {
      if (!filtersByKey[filter.key]) {
        filtersByKey[filter.key] = [];
      }
      filtersByKey[filter.key].push(filter.value);
    });

    Object.entries(filtersByKey).forEach(([key, values]) => {
      result[key] = values.length === 1 ? values[0] : values;
    });

    return result;
  };

  // Fetch datasets with tag filters (only needed when tag filters are present)
  const fetchDatasets = useCallback(
    async (
      searchQuery?: string,
      newOffset: number = 0,
      tagFilters: TagFilter[] = selectedTagFilters
    ) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);
      try {
        const trimmedQuery = searchQuery?.trim();
        const searchParam =
          trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined;

        const tagFiltersForAPI =
          tagFilters.length > 0 ? getTagFiltersForAPI(tagFilters) : undefined;

        const currentLimit = search?.limit ?? 100;
        
        const response = await getCollectionDatasets({
          data: {
            collectionId: collection.id,
            search: searchParam,
            includeUrls: false,
            limit: currentLimit,
            offset: newOffset,
            tagFilters: tagFiltersForAPI,
          },
        });

        if (abortController.signal.aborted) {
          return;
        }

        // Only update state when tag filters are active (loader handles the rest)
        if (tagFilters.length > 0) {
          setFilteredDatasets(response.items || []);
          setFilteredTotal(response.total || 0);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        if (abortController.signal.aborted) {
          return;
        }
        console.error("Error fetching datasets:", error);
        if (tagFilters.length > 0) {
          setFilteredDatasets([]);
          setFilteredTotal(0);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [collection.id, search?.limit, selectedTagFilters]
  );

  // Sync search query from URL (only when URL changes, not when local state changes)
  useEffect(() => {
    const urlQuery = search?.query || "";
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
    }
    
    // Track search when URL query changes (only once per unique query)
    // Use ref to prevent duplicate tracking when loader data updates
    const trimmedQuery = urlQuery.trim();
    if (trimmedQuery && !hasTagFilters && trimmedQuery !== lastTrackedQueryRef.current) {
      lastTrackedQueryRef.current = trimmedQuery;
      trackSearchQuery(
        trimmedQuery,
        collection.slug,
        initialResponse?.total || 0,
        {
          hasTagFilters: false,
          queryLength: trimmedQuery.length,
        }
      );
    }
  }, [search?.query, collection.slug, hasTagFilters]); // Removed initialResponse?.total to prevent duplicate tracking

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
          trackSearchQuery(
            searchQuery,
            collection.slug,
            filteredTotal ?? 0,
            {
              hasTagFilters: true,
              queryLength: searchQuery.trim().length,
            }
          );
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, updateUrlParams, hasTagFilters, fetchDatasets, selectedTagFilters]);

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

  // Handle tag filter change
  const handleFilterChange = async (key: string, values: string[]) => {
    const otherFilters = selectedTagFilters.filter((f) => f.key !== key);
    const newFilters: TagFilter[] = [
      ...otherFilters,
      ...values.map((value) => ({ key, value })),
    ];

    setSelectedTagFilters(newFilters);
    updateUrlParams({ offset: 0 });
    
    // Track tag filter application
    trackTagFilter(
      collection.slug,
      key,
      values,
      searchQuery || undefined
    );
    
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
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight break-words">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="text-base sm:text-lg text-muted-foreground mt-2 break-words">
                {collection.description}
              </p>
            )}
            <Button variant="outline" size="sm" asChild className="mt-4 font-mono">
              <a
                href={`/api/collections/${collection.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Metadata
              </a>
            </Button>
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
          <div className="text-sm text-muted-foreground">
            Loading filters...
          </div>
        ) : Object.keys(availableTags).length > 0 ? (
          <TagFilters
            availableTags={availableTags}
            selectedFilters={selectedTagFilters}
            onFilterChange={handleFilterChange}
          />
        ) : (
          <div className="text-sm text-muted-foreground">
            No tag filters available
          </div>
        )}

        {/* Datasets Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : datasets && datasets.length > 0 ? (
          <>
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 min-w-0">
              {datasets.map((dataset) => (
                <DatasetCard key={dataset.id} dataset={dataset} collectionSlug={collection.slug} />
              ))}
            </div>
            {(() => {
              const currentLimit = search?.limit ?? 100;
              return total > currentLimit && (
                <Pagination
                  total={total}
                  limit={currentLimit}
                  offset={offset}
                  onPageChange={handlePageChange}
                  className="mt-8"
                />
              );
            })()}
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchQuery
                  ? "No datasets found matching your search"
                  : "No datasets in this collection"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
