import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Search, ArrowLeft, Database, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatasetCard } from "@/components/dataset";
import type { DatasetWithUrls } from "@/lib/api-client";

// Server function to fetch collection by ID
// Note: Don't pass parameters to server functions - use them directly in loader
const fetchCollectionByIdApi = async (id: number) => {
  const apiUrl = process.env.DATASET_API_URL || "http://localhost:8000";
  const response = await fetch(`${apiUrl}/api/collections/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch collection: ${response.statusText}`);
  }
  return response.json();
};

// Server function to fetch collection datasets
const fetchCollectionDatasetsApi = async (collectionId: number) => {
  const apiUrl = process.env.DATASET_API_URL || "http://localhost:8000";
  const url = `${apiUrl}/api/collections/${collectionId}/datasets?include_urls=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch collection datasets: ${response.statusText}`
    );
  }
  return response.json();
};

// Server function to search datasets
const searchDatasetsApi = async (collectionId: number, query: string) => {
  const apiUrl = process.env.DATASET_API_URL || "http://localhost:8000";
  const url = `${apiUrl}/api/collections/${collectionId}/datasets?search=${encodeURIComponent(query)}&include_urls=true`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to search datasets: ${response.statusText}`);
  }
  return response.json();
};

export const Route = createFileRoute("/collections/$id")({
  loader: async ({ params }) => {
    try {
      const collectionId = parseInt(params.id, 10);
      if (isNaN(collectionId)) {
        throw notFound();
      }
      const collection = await fetchCollectionByIdApi(collectionId);
      if (!collection) {
        throw notFound();
      }
      const datasets = await fetchCollectionDatasetsApi(collection.id);
      return { collection, datasets };
    } catch (error) {
      console.error("Error in collection detail loader:", error);
      throw error;
    }
  },
  component: CollectionDetailPage,
});

function CollectionDetailPage() {
  const { collection, datasets: initialDatasets } = Route.useLoaderData();
  const [searchQuery, setSearchQuery] = useState("");
  const [datasets, setDatasets] = useState<DatasetWithUrls[]>(
    initialDatasets || []
  );
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setIsSearching(true);
    try {
      const trimmedQuery = query.trim();
      const results = trimmedQuery
        ? await searchDatasetsApi(collection.id, trimmedQuery)
        : await fetchCollectionDatasetsApi(collection.id);
      setDatasets(results || []);
    } catch (error) {
      console.error("Search error:", error);
      setDatasets([]);
    } finally {
      setIsSearching(false);
    }
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
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Datasets Grid */}
        {datasets && datasets.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {datasets.map((dataset) => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
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
