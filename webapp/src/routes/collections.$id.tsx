import { createFileRoute, notFound } from "@tanstack/react-router";
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
  getCollectionById,
  getCollectionDatasets,
  getCollectionTagValues,
} from "@/lib/api-client";
import type { DatasetWithUrls } from "@/lib/api-client";

export const Route = createFileRoute("/collections/$id")({
  // Loader is isomorphic - runs on server (SSR) and client (navigation)
  // Server functions handle RPC automatically when called from client
  loader: async ({ params }) => {
    try {
      const collectionId = parseInt(params.id, 10);
      if (isNaN(collectionId)) {
        throw notFound();
      }
      const collection = await getCollectionById({
        data: { id: collectionId },
      });
      if (!collection) {
        throw notFound();
      }
      const pageSize = 12; // Default page size
      const datasetsResponse = await getCollectionDatasets({
        data: {
          collectionId: collection.id,
          includeUrls: true,
          limit: pageSize,
          offset: 0,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [datasets, setDatasets] = useState<DatasetWithUrls[]>(
    initialResponse?.items || []
  );
  const [total, setTotal] = useState(initialResponse?.total || 0);
  const [offset, setOffset] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTagFilters, setSelectedTagFilters] = useState<TagFilter[]>([]);
  const [availableTags, setAvailableTags] = useState<Record<string, string[]>>(
    {}
  );
  const [tagsLoading, setTagsLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load available tag values
  useEffect(() => {
    const loadTagValues = async () => {
      setTagsLoading(true);
      try {
        const tagValues = await getCollectionTagValues({
          data: { collectionId: collection.id },
        });
        console.log(
          "Loaded tag values for collection",
          collection.id,
          ":",
          tagValues
        );
        // Ensure we have a valid object
        if (
          tagValues &&
          typeof tagValues === "object" &&
          !Array.isArray(tagValues)
        ) {
          setAvailableTags(tagValues);
        } else {
          console.warn("Invalid tag values format:", tagValues);
          setAvailableTags({});
        }
      } catch (error) {
        console.error("Error loading tag values:", error);
        // Show error in UI for debugging
        if (error instanceof Error) {
          console.error("Error details:", error.message, error.stack);
        }
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
      // If only one value, send as string; otherwise as array
      result[key] = values.length === 1 ? values[0] : values;
    });

    return result;
  };

  // Fetch datasets with pagination and tag filters
  const fetchDatasets = useCallback(
    async (
      search?: string,
      newOffset: number = 0,
      tagFilters: TagFilter[] = selectedTagFilters,
      signal?: AbortSignal
    ) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const requestSignal = signal || abortController.signal;

      setIsLoading(true);
      try {
        const trimmedQuery = search?.trim();
        // If search is empty, don't pass it to the API
        const searchParam =
          trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined;

        const tagFiltersForAPI =
          tagFilters.length > 0 ? getTagFiltersForAPI(tagFilters) : undefined;

        const response = await getCollectionDatasets({
          data: {
            collectionId: collection.id,
            search: searchParam,
            includeUrls: true,
            limit: pageSize,
            offset: newOffset,
            tagFilters: tagFiltersForAPI,
          },
        });

        // Check if request was aborted
        if (requestSignal.aborted) {
          return;
        }

        setDatasets(response.items || []);
        setTotal(response.total || 0);
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        // Ignore errors from cancelled requests
        if (requestSignal.aborted) {
          return;
        }
        console.error("Error fetching datasets:", error);
        setDatasets([]);
        setTotal(0);
      } finally {
        // Only update loading state if request wasn't aborted
        if (!requestSignal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [collection.id, pageSize, selectedTagFilters]
  );

  // Debounced search handler
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip on initial mount - data is already loaded from loader
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If search is empty, immediately fetch without search (but debounce slightly to avoid rapid calls)
    if (!searchQuery.trim()) {
      setOffset(0);
      // Small debounce even for empty search to avoid rapid successive calls
      searchTimeoutRef.current = setTimeout(async () => {
        setIsSearching(true);
        await fetchDatasets(undefined, 0, selectedTagFilters);
        setIsSearching(false);
      }, 150);
      return;
    }

    // Set loading state immediately for better UX
    setIsSearching(true);
    setOffset(0);

    // Debounce the search - wait 300ms after user stops typing
    searchTimeoutRef.current = setTimeout(async () => {
      await fetchDatasets(searchQuery, 0, selectedTagFilters);
      setIsSearching(false);
    }, 300);

    // Cleanup function
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, fetchDatasets, selectedTagFilters]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Clear any pending timeouts
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Search input handler - just updates the query, debouncing is handled in useEffect
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  // Handle page change
  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    fetchDatasets(searchQuery, newOffset, selectedTagFilters);
  };

  // Handle tag filter change (multi-select)
  const handleFilterChange = async (key: string, values: string[]) => {
    // Get all filters except the ones for this key
    const otherFilters = selectedTagFilters.filter((f) => f.key !== key);

    // Add new filters for this key
    const newFilters: TagFilter[] = [
      ...otherFilters,
      ...values.map((value) => ({
        key,
        value,
      })),
    ];

    setSelectedTagFilters(newFilters);
    setOffset(0); // Reset to first page when filters change
    await fetchDatasets(searchQuery, 0, newFilters);
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <Button variant="ghost" asChild className="mb-4">
            <Link to="/collections">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Collections
            </Link>
          </Button>
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="text-lg text-muted-foreground mt-2">
                {collection.description}
              </p>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search datasets..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
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
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {datasets.map((dataset) => (
                <DatasetCard key={dataset.id} dataset={dataset} />
              ))}
            </div>
            {total > pageSize && (
              <Pagination
                total={total}
                limit={pageSize}
                offset={offset}
                onPageChange={handlePageChange}
                className="mt-8"
              />
            )}
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
