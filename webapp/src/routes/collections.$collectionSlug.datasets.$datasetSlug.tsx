import { createFileRoute, Link, notFound, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { DatasetFileTree } from "@/components/dataset/DatasetFileTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { Separator } from "@/components/ui/separator";
import { getCollectionBySlug, getDatasetBySlug } from "@/lib/api-client";
import { buildDatasetJsonLd, datasetKeywords, pageTitle, plainTextForSeo, seoDescription } from "@/lib/seo";

export const Route = createFileRoute("/collections/$collectionSlug/datasets/$datasetSlug")({
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
  head: ({ loaderData, params }) => {
    const dataset = loaderData?.dataset;
    const collection = loaderData?.collection;
    const title = pageTitle(dataset?.name ?? params.datasetSlug);
    const description = seoDescription(dataset?.description);
    const canonical = `/collections/${encodeURIComponent(params.collectionSlug)}/datasets/${encodeURIComponent(
      params.datasetSlug,
    )}`;
    const metadataUrl = `/api/collections/${encodeURIComponent(params.collectionSlug)}/datasets/${encodeURIComponent(
      params.datasetSlug,
    )}`;
    const keywordList = datasetKeywords(dataset?.tags);
    const keywords = keywordList.length > 0 ? keywordList.join(", ") : undefined;

    const jsonLd = buildDatasetJsonLd({
      name: dataset?.name ?? params.datasetSlug,
      description: dataset?.description,
      url: canonical,
      metadataUrl,
      keywords: keywordList,
      isPartOf: collection?.name ? { type: "Collection", name: collection.name } : undefined,
      dateModified: dataset?.updated_at,
    });

    return {
      meta: [
        { title },
        ...(description ? [{ name: "description", content: description }] : []),
        ...(keywords ? [{ name: "keywords", content: keywords }] : []),
        { property: "og:title", content: title },
        ...(description ? [{ property: "og:description", content: description }] : []),
      ],
      links: [
        { rel: "canonical", href: canonical },
        {
          rel: "alternate",
          type: "application/json",
          href: metadataUrl,
          title: "Dataset metadata JSON",
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(jsonLd),
        },
      ],
    };
  },
  component: DatasetDetailPage,
  pendingComponent: () => (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center">
      <PageLoader size="lg" />
    </div>
  ),
  pendingMs: 200,
});

function DatasetDetailPage() {
  const { collection, dataset } = Route.useLoaderData();
  const { collectionSlug, datasetSlug } = Route.useParams();
  const router = useRouterState();

  // Check if we're on a child route (file detail page)
  const isFileRoute = router.location.pathname.includes("/files/");

  const cleanDescription = plainTextForSeo(dataset.description);

  // If we're on a file route, just render the outlet (file detail page will handle its own layout)
  if (isFileRoute) {
    return <Outlet />;
  }

  // Otherwise, render the dataset detail page
  return (
    <div className="p-6 sm:p-10">
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
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-mono font-bold tracking-tight break-words">
              {dataset.name}
            </h1>
            {dataset.tags && Object.keys(dataset.tags).length > 0 && (
              <Button variant="outline" size="sm" asChild className="mt-3 font-mono">
                <a
                  href={`/api/collections/${collectionSlug}/datasets/${datasetSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Metadata
                </a>
              </Button>
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
            {dataset.tags &&
              Object.entries(dataset.tags).map(([key, value]) => {
                const label = key
                  .split("_")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ");

                return (
                  <div key={key}>
                    <p className="text-sm text-muted-foreground mb-1">{label}</p>
                    {Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1">
                        {value.map((v: string) => (
                          <Badge key={`${key}-${v}`} variant="outline">
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
                  <DatasetFileTree dataset={dataset} collectionSlug={collectionSlug} datasetSlug={datasetSlug} />
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
