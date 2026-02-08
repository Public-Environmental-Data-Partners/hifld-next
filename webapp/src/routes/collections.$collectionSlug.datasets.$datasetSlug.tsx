import { createFileRoute, notFound, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getDatasetBySlug, getCollectionBySlug } from "@/lib/api-client";
import { DatasetFileTree } from "@/components/dataset/DatasetFileTree";

export const Route = createFileRoute(
  "/collections/$collectionSlug/datasets/$datasetSlug"
)({
  loader: async ({ params }) => {
    try {
      const collection = await getCollectionBySlug({
        data: { slug: params.collectionSlug },
      });
      if (!collection) {
        throw notFound();
      }
      // For dataset detail page: load files (no URLs) for the file tree
      // URLs are only loaded when viewing individual file pages
      const dataset = await getDatasetBySlug({
        data: {
          collectionSlug: params.collectionSlug,
          datasetSlug: params.datasetSlug,
          includeUrls: false, // Always false - we only need files list for the tree, not URLs
        },
      });
      if (!dataset) {
        throw notFound();
      }
      return { collection, dataset };
    } catch (error) {
      console.error("Error in dataset detail loader:", error);
      throw error;
    }
  },
  component: DatasetDetailPage,
});

function DatasetDetailPage() {
  const { collection, dataset } = Route.useLoaderData();
  const { collectionSlug, datasetSlug } = Route.useParams();
  const router = useRouterState();
  
  // Check if we're on a child route (file detail page)
  const isFileRoute = router.location.pathname.includes('/files/');

  const cleanDescription = dataset.description
    ?.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  // If we're on a file route, just render the outlet (file detail page will handle its own layout)
  if (isFileRoute) {
    return <Outlet />;
  }

  // Otherwise, render the dataset detail page
  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <Button variant="ghost" asChild className="mb-4">
            <Link
              to="/collections/$slug"
              params={{ slug: collection.slug }}
              search={{ query: "", limit: 100, offset: 0 }}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to {collection.name}
            </Link>
          </Button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight break-words">
              {dataset.name}
            </h1>
            {dataset.tags && Object.keys(dataset.tags).length > 0 && (
              <p className="font-mono break-all text-xs text-muted-foreground mt-2">
                {Object.entries(dataset.tags)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(", ")}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="font-medium mb-2">Description</h4>
            <p className="text-sm text-muted-foreground break-words">
              {cleanDescription || "No description available."}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge variant="default">ready</Badge>
            </div>
            {dataset.tags &&
              Object.entries(dataset.tags).map(([key, value]) => {
                const label = key
                  .split("_")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ");

                return (
                  <div key={key}>
                    <p className="text-sm text-muted-foreground mb-1">
                      {label}
                    </p>
                    {Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1">
                        {value.map((v: string, idx: number) => (
                          <Badge key={idx} variant="outline">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="font-medium break-words">{String(value)}</p>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Files Tree View */}
          {dataset.files && dataset.files.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium mb-4">Files</h4>
                <div className="border rounded-lg p-4 bg-muted/20">
                  <DatasetFileTree
                    dataset={dataset}
                    collectionSlug={collectionSlug}
                    datasetSlug={datasetSlug}
                  />
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Created: {new Date(dataset.created_at).toLocaleString()}</p>
            <p>Updated: {new Date(dataset.updated_at).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

