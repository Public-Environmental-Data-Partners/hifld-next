import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCollections } from "@/lib/api-client";

export const Route = createFileRoute("/collections/")({
  loader: async () => {
    const collections = await getCollections();
    return { collections };
  },
  component: CollectionsListPage,
});

function CollectionsListPage() {
  const { collections } = Route.useLoaderData();

  return (
    <div className="p-6 sm:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl break-words">Collections</h1>
          <p className="text-base sm:text-lg text-muted-foreground mt-2">Browse datasets organized by collection</p>
          <Button variant="outline" size="sm" asChild className="mt-4 font-mono">
            <a href="/api/collections" target="_blank" rel="noopener noreferrer">
              View Metadata
            </a>
          </Button>
        </div>

        {/* Collections Grid */}
        {collections && collections.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <Link key={collection.id} to="/collections/$slug" params={{ slug: collection.slug }} search={{}}>
                <Card className="cursor-pointer hover:bg-muted/60 transition-colors h-full">
                  <CardHeader>
                    <div className="flex items-center gap-2 mb-2 min-w-0">
                      <Folder className="h-5 w-5 text-muted-foreground shrink-0" />
                      <CardTitle className="text-lg break-words min-w-0">{collection.name}</CardTitle>
                    </div>
                    {collection.description && (
                      <CardDescription className="line-clamp-2 break-words">{collection.description}</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No collections found</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
